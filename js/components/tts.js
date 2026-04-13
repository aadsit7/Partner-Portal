// ============================================
// ElevenLabs TTS — Streaming Audio Playback
// ============================================
// Adds speaker buttons to assistant messages and
// optional auto-speak. Calls ElevenLabs API directly.
// Also exports speakWithElevenLabs() for use by
// Randy and the voice widget.

import { CONFIG, getRuntimeConfig, setRuntimeConfig } from '../config.js';

// ── Configuration ─────────────────────────────────────────────────
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_22050_32';

// ElevenLabs voice options (matches Setup page)
const VOICES = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George (Warm, Natural Male)' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (Conversational Male)' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Deep Male)' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (American Female)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Soft Female)' },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria (Expressive Female)' },
];

// ── State (button-based TTS) ─────────────────────────────────────
let audio = null;
let currentBtn = null;
let currentObjectUrl = null;

// ── State (shared speakWithElevenLabs) ───────────────────────────
let sharedAudio = null;
let sharedObjectUrl = null;

// ── SVG Icons ─────────────────────────────────────────────────────
const SPEAKER_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

const STOP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

const SPINNER_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tts-spinner"><circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle></svg>`;

// ── Public API ────────────────────────────────────────────────────

export function isTTSEnabled() {
  return getRuntimeConfig('TTS_ENABLED') === true || getRuntimeConfig('TTS_ENABLED') === 'true';
}

export function isAutoSpeakEnabled() {
  return getRuntimeConfig('TTS_AUTO_SPEAK') === true || getRuntimeConfig('TTS_AUTO_SPEAK') === 'true';
}

export function getSelectedVoice() {
  return getRuntimeConfig('ELEVENLABS_VOICE') || getRuntimeConfig('TTS_VOICE') || CONFIG.ELEVENLABS_VOICE || VOICES[0].id;
}

export function getApiKey() {
  return getRuntimeConfig('ELEVENLABS_API_KEY') || CONFIG.ELEVENLABS_API_KEY || '';
}

function getModel() {
  return getRuntimeConfig('ELEVENLABS_MODEL') || CONFIG.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
}

/**
 * Returns true if an ElevenLabs API key is configured and available.
 */
export function isElevenLabsReady() {
  return !!getApiKey();
}

/**
 * Speak text using ElevenLabs TTS. Returns a handle with stop(), or null if unavailable.
 * Used by Randy, voice-widget, and button TTS.
 *
 * @param {string} rawText - Text to speak (will be cleaned of markdown/action blocks)
 * @param {Object} callbacks
 * @param {Function} [callbacks.onStart] - Called when audio playback begins
 * @param {Function} [callbacks.onEnd] - Called when audio playback completes
 * @param {Function} [callbacks.onError] - Called on any error
 * @param {string} [callbacks.voiceId] - Override voice ID (defaults to selected voice)
 * @returns {{ stop: Function } | null} Handle to stop playback, or null if not configured
 */
export function speakWithElevenLabs(rawText, { onStart, onEnd, onError, voiceId } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const text = cleanTextForSpeech(rawText);
  if (!text) {
    if (onEnd) setTimeout(onEnd, 0);
    return { stop() {} };
  }

  let stopped = false;
  let audioEl = document.createElement('audio');
  let objectUrl = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
      audioEl = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  // Fire-and-forget async playback
  (async () => {
    try {
      const voice = voiceId || getSelectedVoice();
      const model = getModel();

      const res = await fetch(
        `${ELEVENLABS_BASE}/${voice}/stream?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: model }),
        }
      );

      if (stopped) return;

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: { message: 'TTS request failed' } }));
        throw new Error(err.detail?.message || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      if (stopped) return;

      objectUrl = URL.createObjectURL(blob);
      audioEl.src = objectUrl;

      audioEl.addEventListener('ended', () => {
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        if (onEnd && !stopped) onEnd();
      }, { once: true });

      audioEl.addEventListener('error', () => {
        stop();
        if (onError) onError(new Error('Audio playback failed'));
      }, { once: true });

      await audioEl.play();
      if (onStart && !stopped) onStart();

    } catch (err) {
      if (stopped) return;
      console.error('ElevenLabs TTS error:', err);
      stop();
      if (onError) onError(err);
    }
  })();

  return { stop };
}

/**
 * Attach a speaker button to an assistant chat bubble.
 * Call this after rendering each assistant message.
 */
export function attachSpeakerButton(bubble, text) {
  if (!bubble || !text) return;

  const btn = document.createElement('button');
  btn.className = 'tts-speak-btn';
  btn.innerHTML = SPEAKER_ICON;
  btn.title = 'Read aloud';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleSpeakClick(btn, text);
  });
  bubble.style.position = 'relative';
  bubble.appendChild(btn);
  return btn;
}

/**
 * Auto-speak a message if auto-speak is enabled and TTS is on.
 * Must be called within a user gesture chain (e.g., the send button click).
 */
export function autoSpeak(bubble, text) {
  if (!isTTSEnabled() || !isAutoSpeakEnabled()) return;
  if (!getApiKey()) return;

  const btn = bubble.querySelector('.tts-speak-btn');
  if (btn) {
    handleSpeakClick(btn, text);
  }
}

/**
 * Stop any currently playing TTS audio (button-based).
 */
export function stopTTS() {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (currentBtn) {
    currentBtn.innerHTML = SPEAKER_ICON;
    currentBtn.classList.remove('tts-active', 'tts-loading');
    currentBtn.title = 'Read aloud';
    currentBtn = null;
  }
}

/**
 * Render the TTS settings popover HTML and wire up events.
 * Returns the gear button element to insert into the DOM.
 */
export function createSettingsButton() {
  const wrapper = document.createElement('div');
  wrapper.className = 'tts-settings-wrapper';

  const gearBtn = document.createElement('button');
  gearBtn.className = 'tts-gear-btn';
  gearBtn.title = 'TTS Settings';
  gearBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

  const popover = document.createElement('div');
  popover.className = 'tts-popover';
  popover.innerHTML = `
    <div class="tts-popover__title">Text-to-Speech</div>
    <label class="tts-popover__row">
      <span>Enable TTS</span>
      <input type="checkbox" id="tts-toggle" ${isTTSEnabled() ? 'checked' : ''}>
    </label>
    <label class="tts-popover__row">
      <span>Auto-speak replies</span>
      <input type="checkbox" id="tts-auto-speak" ${isAutoSpeakEnabled() ? 'checked' : ''}>
    </label>
    <label class="tts-popover__row tts-popover__row--col">
      <span>Voice</span>
      <select id="tts-voice">
        ${VOICES.map(v => `<option value="${v.id}" ${v.id === getSelectedVoice() ? 'selected' : ''}>${v.name}</option>`).join('')}
      </select>
    </label>
    <label class="tts-popover__row tts-popover__row--col">
      <span>ElevenLabs API Key</span>
      <input type="password" id="tts-api-key" value="${getApiKey()}" placeholder="Enter your ElevenLabs API key">
    </label>
  `;

  wrapper.appendChild(gearBtn);
  wrapper.appendChild(popover);

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.toggle('tts-popover--open');
  });

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      popover.classList.remove('tts-popover--open');
    }
  });

  // Wire up settings
  popover.querySelector('#tts-toggle').addEventListener('change', (e) => {
    setRuntimeConfig('TTS_ENABLED', e.target.checked);
  });
  popover.querySelector('#tts-auto-speak').addEventListener('change', (e) => {
    setRuntimeConfig('TTS_AUTO_SPEAK', e.target.checked);
  });
  popover.querySelector('#tts-voice').addEventListener('change', (e) => {
    setRuntimeConfig('ELEVENLABS_VOICE', e.target.value);
  });
  popover.querySelector('#tts-api-key').addEventListener('change', (e) => {
    setRuntimeConfig('ELEVENLABS_API_KEY', e.target.value.trim());
  });

  return wrapper;
}

// ── Internal ──────────────────────────────────────────────────────

function ensureAudio() {
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'ttsAudio';
    audio.addEventListener('ended', () => stopTTS());
    audio.addEventListener('error', () => stopTTS());
  }
  return audio;
}

export function cleanTextForSpeech(text) {
  return text
    .replace(/:::ACTION[\s\S]*?:::/g, '')
    .replace(/:::NAV[\s\S]*?:::/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,4}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function handleSpeakClick(btn, rawText) {
  // If this button is already playing, stop
  if (btn === currentBtn && audio && !audio.paused) {
    stopTTS();
    return;
  }

  // Stop any other playback
  stopTTS();

  const apiKey = getApiKey();
  if (!apiKey) {
    btn.title = 'Set ElevenLabs API Key in TTS settings first';
    btn.classList.add('tts-error');
    setTimeout(() => btn.classList.remove('tts-error'), 2000);
    return;
  }

  const text = cleanTextForSpeech(rawText);
  if (!text) return;

  const voiceId = getSelectedVoice();
  const model = getModel();
  currentBtn = btn;
  btn.innerHTML = SPINNER_ICON;
  btn.classList.add('tts-loading');
  btn.title = 'Loading...';

  const audioEl = ensureAudio();

  try {
    const res = await fetch(
      `${ELEVENLABS_BASE}/${voiceId}/stream?output_format=${OUTPUT_FORMAT}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: model,
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: { message: 'TTS request failed' } }));
      throw new Error(err.detail?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(blob);
    audioEl.src = currentObjectUrl;
    await audioEl.play();

    btn.innerHTML = STOP_ICON;
    btn.classList.remove('tts-loading');
    btn.classList.add('tts-active');
    btn.title = 'Stop';
  } catch (err) {
    console.error('TTS playback error:', err);
    stopTTS();
  }
}

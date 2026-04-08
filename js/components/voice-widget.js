// ============================================
// Persistent Voice Assistant Widget
// ============================================
// Floating button in bottom-right, survives route changes.
// Mounted to #voice-root (outside view-container).

import { isAdmin } from '../auth.js';
import { loadSheetData, callClaude } from '../utils/ai.js';
import { getCurrentPath } from '../router.js';

// ── State ──────────────────────────────────────────────────────────
let voiceHistory = [];
let voiceState = 'idle'; // idle | listening | processing | speaking
let recognition = null;
let synth = window.speechSynthesis;
let currentUtterance = null;
let abortController = null;
let mounted = false;

const STORAGE_KEY = 'pp_voice_active';

// ── Feature Detection ──────────────────────────────────────────────
function hasVoiceSupport() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !!window.speechSynthesis;
}

// ── Markdown Stripping ─────────────────────────────────────────────
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')     // code blocks
    .replace(/`([^`]+)`/g, '$1')         // inline code
    .replace(/#{1,4}\s+/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')    // bold
    .replace(/\*(.+?)\*/g, '$1')         // italic
    .replace(/^[-•*]\s+/gm, '')          // bullets
    .replace(/^\d+\.\s+/gm, '')          // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\n{2,}/g, '. ')            // paragraph breaks → pauses
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Speech Synthesis ───────────────────────────────────────────────
function getPreferredVoice() {
  const voices = synth.getVoices();
  const preferred = ['Google US English', 'Microsoft Zira', 'Samantha', 'Alex'];
  for (const name of preferred) {
    const match = voices.find(v => v.name.includes(name));
    if (match) return match;
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
}

function speak(text) {
  if (synth.speaking) synth.cancel();

  const clean = stripMarkdown(text);
  currentUtterance = new SpeechSynthesisUtterance(clean);
  const voice = getPreferredVoice();
  if (voice) currentUtterance.voice = voice;
  currentUtterance.rate = 1.05;
  currentUtterance.pitch = 1;

  currentUtterance.onstart = () => setState('speaking');
  currentUtterance.onend = () => {
    if (voiceState === 'speaking') {
      startListening(); // restart the loop
    }
  };
  currentUtterance.onerror = (e) => {
    if (e.error !== 'canceled') console.error('Speech error:', e.error);
    if (voiceState === 'speaking') startListening();
  };

  synth.speak(currentUtterance);
}

// ── Speech Recognition ─────────────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'en-US';

  rec.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    if (!transcript.trim()) {
      startListening();
      return;
    }
    await handleVoiceInput(transcript);
  };

  rec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') {
      if (voiceState === 'listening') startListening();
      return;
    }
    console.error('Voice recognition error:', event.error);
    setState('idle');
  };

  rec.onend = () => {
    // If still in listening state but recognition ended naturally, restart
    if (voiceState === 'listening') {
      try { rec.start(); } catch { /* already started */ }
    }
  };

  return rec;
}

function startListening() {
  if (!recognition) recognition = initRecognition();
  if (!recognition) return;

  setState('listening');
  try {
    recognition.start();
  } catch {
    // Already started, ignore
  }
}

function stopEverything() {
  if (recognition) {
    try { recognition.abort(); } catch { /* ok */ }
  }
  if (synth.speaking) synth.cancel();
  if (abortController) abortController.abort();
  voiceHistory = [];
  setState('idle');
  localStorage.removeItem(STORAGE_KEY);
}

// ── Claude API Handler ─────────────────────────────────────────────
async function handleVoiceInput(text) {
  setState('processing');

  // Render in chat UI if on AI Assistant tab
  renderInChatIfVisible('user', text);

  voiceHistory.push({ role: 'user', content: text });

  try {
    const sheetData = await loadSheetData();
    abortController = new AbortController();
    const response = await callClaude(voiceHistory, sheetData, text, abortController.signal);
    voiceHistory.push({ role: 'assistant', content: response });

    renderInChatIfVisible('assistant', response);
    speak(response);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Voice assistant error:', err);
    speak('Sorry, I encountered an error. ' + err.message);
  }
}

function renderInChatIfVisible(role, text) {
  const path = getCurrentPath();
  if (path !== '/admin/ai-assistant') return;
  const chatArea = document.getElementById('ai-chat-area');
  if (!chatArea) return;

  // Remove welcome message if present
  const welcome = chatArea.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  // Use the chat view's renderMessage if available
  if (typeof window._aiChatRenderMessage === 'function') {
    window._aiChatRenderMessage(role, text, chatArea);
  }
}

// ── UI State Management ────────────────────────────────────────────
function setState(state) {
  voiceState = state;
  updateWidget();
}

function updateWidget() {
  const widget = document.getElementById('voice-widget');
  if (!widget) return;

  const btn = widget.querySelector('.voice-widget__btn');
  const pill = widget.querySelector('.voice-widget__pill');
  const label = widget.querySelector('.voice-widget__label');
  const micIcon = widget.querySelector('.voice-widget__mic');
  const speakerIcon = widget.querySelector('.voice-widget__speaker');
  const dots = widget.querySelector('.voice-widget__dots');

  widget.className = `voice-widget voice-widget--${voiceState}`;

  if (voiceState === 'idle') {
    pill.hidden = true;
    btn.hidden = false;
  } else {
    btn.hidden = true;
    pill.hidden = false;
    micIcon.hidden = voiceState !== 'listening';
    speakerIcon.hidden = voiceState !== 'speaking';
    dots.hidden = voiceState !== 'processing';

    const labels = { listening: 'Listening...', processing: 'Thinking...', speaking: 'Speaking...' };
    label.textContent = labels[voiceState] || '';
  }
}

// ── Mount / Unmount ────────────────────────────────────────────────
export function mountVoiceWidget() {
  if (mounted) return;
  if (!hasVoiceSupport()) return;

  const root = document.getElementById('voice-root');
  if (!root) return;

  root.innerHTML = `
    <div id="voice-widget" class="voice-widget voice-widget--idle">
      <button class="voice-widget__btn" title="Start voice assistant">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      </button>
      <div class="voice-widget__pill" hidden>
        <div class="voice-widget__mic">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </div>
        <div class="voice-widget__speaker" hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        </div>
        <div class="voice-widget__dots" hidden>
          <span></span><span></span><span></span>
        </div>
        <span class="voice-widget__label">Listening...</span>
        <button class="voice-widget__stop" title="Stop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
        </button>
      </div>
    </div>
  `;

  // Event: click floating button to start
  root.querySelector('.voice-widget__btn').addEventListener('click', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    voiceHistory = [];
    startListening();
  });

  // Event: click pill or stop button to stop
  root.querySelector('.voice-widget__pill').addEventListener('click', stopEverything);

  // Restore visible state if was active before refresh (but don't auto-listen)
  if (localStorage.getItem(STORAGE_KEY) === 'true') {
    // Show widget in ready state — user needs to click to restart
    localStorage.removeItem(STORAGE_KEY);
  }

  // Load voices (some browsers load them async)
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => getPreferredVoice();
  }

  mounted = true;
}

export function unmountVoiceWidget() {
  stopEverything();
  const root = document.getElementById('voice-root');
  if (root) root.innerHTML = '';
  mounted = false;
}

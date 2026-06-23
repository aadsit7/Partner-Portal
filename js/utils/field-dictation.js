// ============================================
// Universal Field Voice Dictation
// ============================================
// Focus any text field in the portal and the microphone starts
// transcribing speech straight into it — no keyboard required. Click
// (or tab) to another field to retarget; click anything that isn't a
// text field to stop. The user can always still type or edit manually.
//
// Coordination with the other two mic consumers:
//   • Randy (wake-word assistant, admin-only) — paused via the global
//     window._randyPause / _randyResume hooks it installs, and kept from
//     grabbing the mic back while we dictate via window._fieldDictationActive
//     (Randy's startRecognition checks that flag).
//   • The chat voice widget (admin-only) — if a live voice conversation
//     is in progress we never hijack the mic (isVoiceModeActive()).
// Only one SpeechRecognition can own the mic at a time, so a single
// recognition instance persists while focus moves between fields; we
// just retarget which field the finalized transcript lands in.

import { isVoiceModeActive } from '../components/voice-widget.js';

// ── State ──────────────────────────────────────────────────────────
let recognition = null;
let activeField = null;     // the field final transcripts are written into
let listening = false;      // recognition currently running
let stopTimer = null;       // debounce for focus moving between fields
let disabled = false;       // turned off for the session (mic denied / opt-out)
let indicator = null;       // floating "voice typing" pill

const STORAGE_KEY = 'pp_field_dictation'; // set to 'off' to opt out

// ── Feature Detection ──────────────────────────────────────────────
function hasSpeechSupport() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// ── Eligibility ────────────────────────────────────────────────────
// A "text box" is a plain text-bearing <input> or a <textarea> that the
// user can actually type into. We deliberately leave out password fields
// (privacy), numeric/date/etc. controls (dictation is unreliable there),
// the rich-text Quill editors (their own model would fight raw inserts),
// and the dedicated assistant inputs that already own a mic button.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email']);

function isEligible(node) {
  if (!node || node.nodeType !== 1) return false;
  // Never steal the mic from the assistants' own inputs / widgets.
  if (node.closest('#voice-root, #randy-root, #ai-input')) return false;
  // Explicit per-field opt-out: <input data-no-dictation>
  if (node.hasAttribute('data-no-dictation')) return false;

  if (node.tagName === 'TEXTAREA') {
    return !node.disabled && !node.readOnly;
  }
  if (node.tagName === 'INPUT') {
    const type = (node.getAttribute('type') || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.has(type) && !node.disabled && !node.readOnly;
  }
  return false;
}

// ── Text Insertion ─────────────────────────────────────────────────
// Insert a finalized chunk at the caret (or appended), keeping spacing
// sensible, then fire an `input` event so the app's own change handlers
// (validation, autosize, enable/disable of save buttons) all run exactly
// as they would for typed input.
function insertTranscript(field, raw) {
  let text = raw.trim();
  if (!text) return;

  let start, end;
  try {
    start = field.selectionStart;
    end = field.selectionEnd;
  } catch {
    start = end = null; // some input types disallow selection access
  }
  const usesCaret = start != null && end != null;
  const value = field.value || '';
  const before = usesCaret ? value.slice(0, start) : value;
  const after = usesCaret ? value.slice(end) : '';

  // Capitalize the first letter when starting an empty field / sentence.
  const trimmedBefore = before.replace(/\s+$/, '');
  const atSentenceStart = trimmedBefore === '' || /[.!?]$/.test(trimmedBefore);
  if (atSentenceStart) text = text.charAt(0).toUpperCase() + text.slice(1);

  const needsSpace = before.length > 0 && !/\s$/.test(before);
  const chunk = (needsSpace ? ' ' : '') + text;

  field.value = before + chunk + after;

  if (usesCaret) {
    const caret = before.length + chunk.length;
    try { field.setSelectionRange(caret, caret); } catch { /* ok */ }
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Floating Indicator ─────────────────────────────────────────────
function ensureIndicator() {
  if (indicator) return indicator;
  indicator = document.createElement('div');
  indicator.id = 'field-dictation-indicator';
  indicator.className = 'field-dictation-indicator';
  indicator.innerHTML = `
    <span class="field-dictation-indicator__dot"></span>
    <span class="field-dictation-indicator__label">Voice typing…</span>`;
  document.body.appendChild(indicator);
  return indicator;
}

function positionIndicator() {
  if (!indicator || !activeField) return;
  const rect = activeField.getBoundingClientRect();
  const top = rect.top - 34;
  // Keep it on-screen if the field is near the top edge.
  indicator.style.top = (top < 6 ? rect.bottom + 6 : top) + 'px';
  indicator.style.left = rect.left + 'px';
}

function showIndicator(label) {
  ensureIndicator();
  const labelEl = indicator.querySelector('.field-dictation-indicator__label');
  if (labelEl) labelEl.textContent = label || 'Voice typing…';
  indicator.classList.add('field-dictation-indicator--visible');
  positionIndicator();
}

function hideIndicator() {
  if (indicator) indicator.classList.remove('field-dictation-indicator--visible');
}

// ── Recognition Lifecycle ──────────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    if (!activeField) return;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        insertTranscript(activeField, transcript);
      } else {
        interim += transcript;
      }
    }
    showIndicator(interim.trim() ? '“' + interim.trim() + '”' : 'Listening…');
  };

  rec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      // Mic permission denied — disable for the rest of the session so we
      // don't re-prompt on every field focus.
      disabled = true;
      stopDictation();
      return;
    }
    // Other transient errors: let onend handle the restart.
  };

  rec.onend = () => {
    // Chrome ends recognition after a stretch of silence even with
    // continuous=true. Restart automatically while a field is still focused.
    if (listening && activeField) {
      try { rec.start(); } catch { /* already starting */ }
    }
  };

  return rec;
}

function startDictation(field) {
  if (disabled || !hasSpeechSupport()) return;
  if (localStorage.getItem(STORAGE_KEY) === 'off') return;
  // Never fight an in-progress voice conversation for the mic.
  if (isVoiceModeActive()) return;

  activeField = field;

  if (listening) {
    // Already running — just retarget the field and move the indicator.
    showIndicator('Listening…');
    return;
  }

  if (!recognition) recognition = initRecognition();
  if (!recognition) return;

  listening = true;
  window._fieldDictationActive = true;
  // Pause Randy's passive wake-word mic so we can own the device mic.
  window._randyPause?.();

  try {
    recognition.start();
  } catch {
    // start() throws if it's mid-stop; onend will restart it for us.
  }
  showIndicator('Listening…');
}

function stopDictation() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  activeField = null;
  hideIndicator();

  if (listening) {
    listening = false;
    if (recognition) { try { recognition.stop(); } catch { /* ok */ } }
  }

  if (window._fieldDictationActive) {
    window._fieldDictationActive = false;
    // Hand the mic back to Randy if it was passively listening before.
    window._randyResume?.();
  }
}

// ── Focus Wiring ───────────────────────────────────────────────────
function onFocusIn(event) {
  const target = event.target;
  if (!isEligible(target)) return;
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  startDictation(target);
}

function onFocusOut() {
  // Defer the stop: focus moving from one eligible field to another fires
  // focusout then focusin. The pending focusin cancels this timer, so we
  // keep the single recognition running and just retarget — no mic churn.
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    stopTimer = null;
    const active = document.activeElement;
    if (!isEligible(active)) stopDictation();
  }, 150);
}

// ── Public Init ────────────────────────────────────────────────────
let initialized = false;

export function initFieldDictation() {
  if (initialized) return;
  if (!hasSpeechSupport()) return; // graceful no-op on unsupported browsers
  initialized = true;

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);

  // Keep the indicator glued to the field as the page scrolls/resizes.
  window.addEventListener('scroll', positionIndicator, true);
  window.addEventListener('resize', positionIndicator);
}

// Optional programmatic opt-out/opt-in (defaults to on).
export function setFieldDictationEnabled(enabled) {
  if (enabled) {
    localStorage.removeItem(STORAGE_KEY);
    disabled = false;
  } else {
    localStorage.setItem(STORAGE_KEY, 'off');
    stopDictation();
  }
}

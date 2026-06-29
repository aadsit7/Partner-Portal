// ============================================
// Universal Field Voice Dictation
// ============================================
// Focus any text field in the portal and the microphone starts
// transcribing speech straight into it — no keyboard required. Works for
// both new and existing entries: plain <input>/<textarea> fields and the
// rich-text Quill editors (descriptions, transcripts, notes). Transcripts
// are inserted at the caret, so existing text can be appended to or edited.
// Click (or tab) to another field to retarget; click anything that isn't a
// text field to stop. The user can always still type or edit manually.
//
// A small, discrete mic dot tucks into the corner of the focused field
// while it's listening — no large banner or live transcript overlay.
//
// Coordination with the other two mic consumers (only one SpeechRecognition
// can own the device mic at a time):
//   • Randy (wake-word assistant, admin-only) — paused via the global
//     window._randyPause / _randyResume hooks it installs, and kept from
//     grabbing the mic back while we dictate via window._fieldDictationActive
//     (Randy's startRecognition checks that flag). Handing the mic over from
//     Randy isn't instant, so startup retries until the device mic is free.
//   • The chat voice widget (admin-only) — if a live voice conversation
//     is in progress we never hijack the mic (isVoiceModeActive()).
// A single recognition instance persists while focus moves between fields;
// we just retarget which field the finalized transcript lands in.

import { isVoiceModeActive } from '../components/voice-widget.js';
import { composeInsertion } from './dictation-text.js';

// ── State ──────────────────────────────────────────────────────────
let recognition = null;
let activeField = null;     // the field final transcripts are written into
let listening = false;      // we intend to be capturing for a focused field
let running = false;        // recognition has actually started (onstart fired)
let stopTimer = null;       // debounce for focus moving between fields
let startTimer = null;      // pending (re)start attempt
let startAttempts = 0;      // consecutive failed starts (mic handoff retries)
let disabled = false;       // turned off for the session (mic denied / opt-out)
let indicator = null;       // discrete floating mic dot

const STORAGE_KEY = 'pp_field_dictation'; // set to 'off' to opt out
const MAX_START_ATTEMPTS = 12;            // ~3s of retries during mic handoff

// ── Feature Detection ──────────────────────────────────────────────
function hasSpeechSupport() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// ── Eligibility ────────────────────────────────────────────────────
// A "text box" is a plain text-bearing <input>, a <textarea>, or a
// rich-text contenteditable (the Quill editors used for descriptions,
// transcripts and notes) that the user can actually type into. We leave
// out password fields (privacy), numeric/date/etc. controls (dictation is
// unreliable there), and the dedicated assistant inputs that already own a
// mic button.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email']);

function isEligible(node) {
  if (!node || node.nodeType !== 1) return false;
  // Never steal the mic from the assistants' own inputs / widgets.
  if (node.closest('#voice-root, #randy-root, #ai-input')) return false;
  // Explicit opt-out: <input data-no-dictation> or any ancestor with it.
  if (node.closest('[data-no-dictation]')) return false;

  if (node.tagName === 'TEXTAREA') {
    return !node.disabled && !node.readOnly;
  }
  if (node.tagName === 'INPUT') {
    const type = (node.getAttribute('type') || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.has(type) && !node.disabled && !node.readOnly;
  }
  // Rich-text editors (Quill) and any other contenteditable surface.
  if (node.isContentEditable) return true;
  return false;
}

// Resolve the Quill instance backing a focused .ql-editor, if any. Lets us
// insert through Quill's own model so its change/undo handlers fire exactly
// as they do for typed input. Returns null for plain contenteditables.
function getQuillFor(node) {
  if (!window.Quill || !node.classList || !node.classList.contains('ql-editor')) return null;
  const container = node.closest('.ql-container');
  if (!container) return null;
  const instance = window.Quill.find(container);
  return instance && typeof instance.insertText === 'function' ? instance : null;
}

// ── Text Insertion ─────────────────────────────────────────────────
// Insert a finalized chunk at the caret, then fire an `input` event so the
// app's own change handlers (validation, autosize, enable/disable of save
// buttons) run exactly as they would for typed input. Dispatches by field
// kind so rich-text editors go through their own model.
function commitTranscript(field, raw) {
  if (!raw || !raw.trim()) return;
  const quill = getQuillFor(field);
  if (quill) { insertIntoQuill(quill, raw); return; }
  if (field.isContentEditable) { insertIntoContentEditable(field, raw); return; }
  insertIntoInput(field, raw);
}

function insertIntoInput(field, raw) {
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

  const chunk = composeInsertion(before, raw);
  if (!chunk) return;

  field.value = before + chunk + after;

  if (usesCaret) {
    const caret = before.length + chunk.length;
    try { field.setSelectionRange(caret, caret); } catch { /* ok */ }
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
}

// Rich-text (Quill): insert through the editor API at the current
// selection so formatting, the undo stack and text-change listeners all
// behave as if the user typed. Falls back to end-of-document if there's
// no live selection (e.g. the field was just focused programmatically).
function insertIntoQuill(quill, raw) {
  const sel = quill.getSelection();
  const index = sel ? sel.index : quill.getLength() - 1;
  const safeIndex = Math.max(0, index);
  const before = quill.getText(0, safeIndex);

  const chunk = composeInsertion(before, raw);
  if (!chunk) return;

  quill.insertText(safeIndex, chunk, 'user');
  quill.setSelection(safeIndex + chunk.length, 0, 'user');
}

// Generic contenteditable (no Quill instance): execCommand('insertText')
// inserts at the caret, keeps the native undo stack intact, and fires the
// element's own input event — the safest cross-browser path.
function insertIntoContentEditable(field, raw) {
  field.focus();
  const before = field.textContent || '';
  const chunk = composeInsertion(before, raw);
  if (!chunk) return;

  const inserted = document.execCommand('insertText', false, chunk);
  if (!inserted) {
    // execCommand is deprecated and may be unavailable — append as fallback.
    field.appendChild(document.createTextNode(chunk));
  }
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Discrete Indicator ─────────────────────────────────────────────
// A small pulsing mic dot pinned to the top-right corner of the focused
// field. Intentionally minimal — no banner, no live transcript readout.
function ensureIndicator() {
  if (indicator) return indicator;
  indicator = document.createElement('div');
  indicator.id = 'field-dictation-indicator';
  indicator.className = 'field-dictation-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;
  document.body.appendChild(indicator);
  return indicator;
}

function positionIndicator() {
  if (!indicator || !activeField) return;
  const rect = activeField.getBoundingClientRect();
  // Tuck into the field's top-right corner, nudged just inside it.
  indicator.style.top = Math.max(rect.top + 4, 4) + 'px';
  indicator.style.left = (rect.right - 24) + 'px';
}

function showIndicator() {
  ensureIndicator();
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

  rec.onstart = () => {
    running = true;
    startAttempts = 0;
  };

  rec.onresult = (event) => {
    if (!activeField) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) commitTranscript(activeField, result[0].transcript);
    }
  };

  rec.onerror = (event) => {
    running = false;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      // Mic permission denied/blocked — disable for the session so we don't
      // re-prompt on every field focus.
      disabled = true;
      stopDictation();
      return;
    }
    // no-speech / aborted / audio-capture / network are transient — onend
    // fires next and our scheduled restart picks it back up.
  };

  rec.onend = () => {
    running = false;
    // Chrome ends recognition after a stretch of silence even with
    // continuous=true, and the initial start can lose a mic-handoff race
    // with Randy. Restart while a field is still focused.
    if (listening && activeField) scheduleStart(250);
  };

  return rec;
}

// Try to start recognition, retrying through the brief window where Randy
// (or the OS) hasn't yet released the device mic. start() throwing
// InvalidStateError means it's already running — nothing to do.
function attemptStart() {
  if (!listening || !recognition) return;
  if (running) return;
  try {
    recognition.start();
  } catch (err) {
    if (err && err.name === 'InvalidStateError') { running = true; return; }
    if (startAttempts++ < MAX_START_ATTEMPTS) scheduleStart(250);
  }
}

function scheduleStart(delay) {
  if (startTimer) clearTimeout(startTimer);
  startTimer = setTimeout(() => { startTimer = null; attemptStart(); }, delay);
}

function startDictation(field) {
  if (disabled || !hasSpeechSupport()) return;
  if (localStorage.getItem(STORAGE_KEY) === 'off') return;
  // Never fight an in-progress voice conversation for the mic.
  if (isVoiceModeActive()) return;

  activeField = field;

  if (listening) {
    // Already capturing — just retarget the field and move the dot.
    showIndicator();
    return;
  }

  if (!recognition) recognition = initRecognition();
  if (!recognition) return;

  listening = true;
  startAttempts = 0;
  window._fieldDictationActive = true;
  // Pause Randy's passive wake-word mic so we can own the device mic.
  window._randyPause?.();

  showIndicator();
  attemptStart();
}

function stopDictation() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  activeField = null;
  hideIndicator();

  if (listening) {
    listening = false;
    running = false;
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

  // Keep the dot glued to the field as the page scrolls/resizes.
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

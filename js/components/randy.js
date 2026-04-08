// ============================================
// Randy — Wake-Word Activated Voice Assistant
// ============================================
// Persistent floating widget in the app shell.
// Separate from the voice-widget.js chat mic feature.

import { SYSTEM_PROMPT, loadSheetData, callClaude, invalidateSheetCache } from '../utils/ai.js';
import { parseActions, executeAction } from '../utils/ai-actions.js';
import { getCurrentPath } from '../router.js';
import { CONFIG } from '../config.js';
import { getCurrentUser } from '../auth.js';
import { appendRow, updateRow, readSheetAsObjects } from '../sheets.js';
import { isVoiceModeActive } from './voice-widget.js';

// ── Randy Personality Prompt ──────────────────────────────────────
const RANDY_PERSONALITY = `

Your name is Randy. You are a voice assistant for the Partner Portal. You have big energy — you're enthusiastic, a little dramatic, and overly confident even when the answer is simple. Keep responses to 2-3 sentences MAX since they will be read aloud. Longer responses are painful to listen to. Use casual language like a guy at a barbecue explaining business deals.

Examples of your style:
'Oh DUDE, the Greenshield deal? Yeah that's sitting at 110K, qualified stage. We're looking at a June close, this one's gonna be huge.'

'OK OK OK so Nerdio — Premier tier, North America, pipeline is 120 grand with that American National deal. We got four events with them coming up. We're LOCKED IN.'

'Alright alright alright, you want the pipeline total? We're looking at 830K active. Not bad, not bad at all.'

CRITICAL RULES FOR VOICE RESPONSES:
- Never use bullet points, numbered lists, or markdown
- Never use asterisks or formatting characters
- Never say 'here's a list' then list things — weave info into natural sentences
- Keep numbers conversational: say '120 grand' not '$120,000'
- Keep partner names natural: say 'Nerdio' not 'Nerdio (partner_id 6)'
- If there's a lot of data to share, give the highlights and say 'want me to go deeper on any of those?'
- Never start with 'Based on the data' or 'According to the database' — just answer naturally`;

const RANDY_SYSTEM_PROMPT = SYSTEM_PROMPT + RANDY_PERSONALITY;

// ── State Machine ─────────────────────────────────────────────────
const STATES = { OFF: 'OFF', PASSIVE: 'PASSIVE', ACTIVE_LISTENING: 'ACTIVE_LISTENING', PROCESSING: 'PROCESSING', SPEAKING: 'SPEAKING', CONFIRMING: 'CONFIRMING' };

const ALLOWED_TRANSITIONS = {
  OFF: ['PASSIVE'],
  PASSIVE: ['OFF', 'ACTIVE_LISTENING'],
  ACTIVE_LISTENING: ['PROCESSING', 'PASSIVE'],
  PROCESSING: ['SPEAKING', 'CONFIRMING'],
  SPEAKING: ['ACTIVE_LISTENING', 'CONFIRMING'],
  CONFIRMING: ['PROCESSING', 'ACTIVE_LISTENING'],
};

let currentState = STATES.OFF;
let isRandySpeaking = false;
let recognition = null;
let synth = window.speechSynthesis;
let selectedVoice = null;
let conversationHistory = [];
let abortController = null;
let confirmTimeout = null;
let pendingActions = null;
let confirmAttempts = 0;
let mounted = false;
let currentSpokenText = '';
let currentSpeechOnComplete = null;

// Listening recovery
let restartCount = 0;
let restartWindowStart = 0;

const STORAGE_KEY = 'pp_randy_state';

// ── Wake Word & Deactivation Patterns ─────────────────────────────
const WAKE_PATTERN = /\b(hey|ok|yo)\s+randy\b/i;
const DEACTIVATION_PHRASES = ['stop randy', 'stop', "that's all", 'goodbye', 'thanks randy', 'turn off', 'go away', 'shut up'];
const CONFIRM_WORDS = ['yes', 'yep', 'yeah', 'do it', 'go ahead', 'confirm', 'absolutely', 'sure', 'affirmative'];
const DENY_WORDS = ['no', 'nope', 'cancel', 'never mind', "don't", 'stop', 'wait', 'skip'];

// ── Interrupt Detection (barge-in) ────────────────────────────────
function isInterrupt(transcript) {
  const lower = transcript.toLowerCase();

  // Always allow deactivation phrases as interrupts
  if (isDeactivationPhrase(lower)) return true;

  // Always allow wake word as interrupt
  if (WAKE_PATTERN.test(lower)) return true;

  // Echo detection: if most words match what Randy is saying, it's mic echo
  if (currentSpokenText) {
    const spokenLower = currentSpokenText.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
      const matchCount = words.filter(w => spokenLower.includes(w)).length;
      if (matchCount / words.length > 0.6) return false;
    }
  }

  return true;
}

// ── Feature Detection ─────────────────────────────────────────────
function hasVoiceSupport() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !!window.speechSynthesis;
}

// ── State Transitions ─────────────────────────────────────────────
function transition(newState, force = false) {
  if (currentState === newState) return;

  // Force transitions allowed from any state: → PASSIVE (stop), → OFF (close)
  if (!force) {
    const allowed = ALLOWED_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(newState)) {
      console.warn(`Randy: blocked ${currentState} → ${newState}`);
      return;
    }
  }

  const oldState = currentState;
  currentState = newState;
  console.log(`Randy: ${oldState} → ${newState}`);

  // Persist only OFF/PASSIVE
  if (newState === STATES.OFF) localStorage.setItem(STORAGE_KEY, 'off');
  else if (newState === STATES.PASSIVE) localStorage.setItem(STORAGE_KEY, 'passive');

  updateWidgetUI();
  onStateEnter(newState, oldState);
}

function onStateEnter(state, prevState) {
  switch (state) {
    case STATES.OFF:
      stopAll();
      break;
    case STATES.PASSIVE:
      stopAll();
      startRecognition();
      break;
    case STATES.ACTIVE_LISTENING:
      if (prevState === STATES.PASSIVE || prevState === STATES.SPEAKING || prevState === STATES.CONFIRMING) {
        startRecognition();
      }
      break;
    case STATES.PROCESSING:
      // handled by caller
      break;
    case STATES.SPEAKING:
      // handled by speakText
      break;
    case STATES.CONFIRMING:
      startConfirmTimeout();
      startRecognition();
      break;
  }
}

// ── Full Stop ─────────────────────────────────────────────────────
function stopAll() {
  if (recognition) {
    try { recognition.abort(); } catch { /* ok */ }
  }
  if (synth.speaking) synth.cancel();
  if (abortController) { abortController.abort(); abortController = null; }
  if (confirmTimeout) { clearTimeout(confirmTimeout); confirmTimeout = null; }
  isRandySpeaking = false;
  currentSpokenText = '';
  currentSpeechOnComplete = null;
  conversationHistory = [];
  pendingActions = null;
  confirmAttempts = 0;
}

// ── Speech Recognition ────────────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    if (!result.isFinal) return;

    const confidence = result[0].confidence;
    if (confidence !== 0 && confidence < 0.6) return;

    const transcript = result[0].transcript.trim();
    if (!transcript) return;

    // During speaking: check for intentional interrupt vs echo
    if (isRandySpeaking) {
      if (isInterrupt(transcript)) {
        synth.cancel();
        isRandySpeaking = false;
        currentSpokenText = '';
        currentSpeechOnComplete = null;
        console.log('Randy: interrupted by user');
        // Transition to appropriate state for processing
        if (currentState === STATES.SPEAKING) {
          currentState = STATES.ACTIVE_LISTENING;
          updateWidgetUI();
        }
        handleTranscript(transcript);
      }
      return;
    }

    handleTranscript(transcript);
  };

  rec.onerror = (event) => {
    switch (event.error) {
      case 'no-speech':
        // Normal during passive listening, just restart
        scheduleRestart();
        break;
      case 'not-allowed':
      case 'service-not-available':
        showError('Mic access lost — click to reconnect');
        transition(STATES.OFF, true);
        break;
      case 'aborted':
        // Intentional stop, check state and restart if needed
        if ((currentState === STATES.PASSIVE || currentState === STATES.ACTIVE_LISTENING) && !isRandySpeaking) {
          scheduleRestart();
        }
        break;
      default:
        console.error('Randy mic error:', event.error);
        scheduleRestart();
    }
  };

  rec.onend = () => {
    // Restart during SPEAKING to enable barge-in interrupts
    if (currentState === STATES.SPEAKING) {
      scheduleRestart();
      return;
    }
    // Restart if still in a listening state and not speaking
    if ((currentState === STATES.PASSIVE || currentState === STATES.ACTIVE_LISTENING || currentState === STATES.CONFIRMING) && !isRandySpeaking) {
      scheduleRestart();
    }
  };

  return rec;
}

function scheduleRestart() {
  const now = Date.now();

  // Rate limiting: if >5 restarts in 3 seconds, throttle
  if (now - restartWindowStart > 3000) {
    restartCount = 0;
    restartWindowStart = now;
  }
  restartCount++;

  if (restartCount > 5) {
    restartCount = 0;
    setTimeout(() => startRecognition(), 2000);
    return;
  }

  setTimeout(() => startRecognition(), 100);
}

function startRecognition() {
  if (currentState === STATES.OFF || currentState === STATES.PROCESSING) return;
  // Pause if the existing voice widget (chat mic) is active — only one SpeechRecognition at a time
  if (isVoiceModeActive()) return;

  if (!recognition) recognition = initRecognition();
  if (!recognition) return;

  try {
    recognition.start();
  } catch {
    // Already started or error, ignore
  }
}

// ── Transcript Handler ────────────────────────────────────────────
function handleTranscript(transcript) {
  const lower = transcript.toLowerCase();

  if (currentState === STATES.PASSIVE) {
    // Check for wake word
    const wakeMatch = lower.match(WAKE_PATTERN);
    if (!wakeMatch) return;

    // Visual flash
    flashWidget();

    // Extract trailing text after "randy"
    const afterWake = transcript.substring(lower.indexOf('randy') + 5).trim();

    transition(STATES.ACTIVE_LISTENING);

    if (afterWake.length > 2) {
      // Immediate command — skip greeting
      speakText("Oh hey!", () => {
        processUserInput(afterWake);
      });
    } else {
      speakText("Oh hey! Randy here. What do you need, buddy?");
    }
    return;
  }

  if (currentState === STATES.ACTIVE_LISTENING) {
    // Check for deactivation
    if (isDeactivationPhrase(lower)) {
      speakText("Alright, I'm out. Hit me up whenever.", () => {
        transition(STATES.PASSIVE, true);
      });
      return;
    }

    processUserInput(transcript);
    return;
  }

  if (currentState === STATES.CONFIRMING) {
    handleConfirmation(lower);
    return;
  }
}

function isDeactivationPhrase(lower) {
  return DEACTIVATION_PHRASES.some(phrase => lower.includes(phrase));
}

// ── Process User Input (ACTIVE_LISTENING → PROCESSING → SPEAKING) ─
async function processUserInput(text) {
  transition(STATES.PROCESSING);
  renderInChatIfVisible('user', text);

  conversationHistory.push({ role: 'user', content: text });

  try {
    const sheetData = await loadSheetData();
    abortController = new AbortController();
    const response = await callClaude(conversationHistory, sheetData, text, abortController.signal, RANDY_SYSTEM_PROMPT);
    abortController = null;

    conversationHistory.push({ role: 'assistant', content: response });

    // Cap history to prevent memory/context bloat
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }

    // Check for action blocks
    const { cleanText, actions } = parseActions(response);

    renderInChatIfVisible('assistant', cleanText);

    if (actions.length > 0) {
      pendingActions = [...actions];
      confirmAttempts = 0;
      const summaries = actions.map(a => a.summary).filter(Boolean).join(', and ') || 'make that change';
      speakText(`${cleanText}. I'll ${summaries}. Should I go ahead?`, () => {
        transition(STATES.CONFIRMING);
      });
    } else {
      speakText(cleanText);
    }

    // Save to AI_Conversations if on that page
    saveRandyConversation();

  } catch (err) {
    abortController = null;
    if (err.name === 'AbortError') return;
    console.error('Randy API error:', err);
    speakText("Sorry buddy, I hit a snag. " + err.message);
  }
}

// ── Confirmation Handling ─────────────────────────────────────────
function handleConfirmation(lower) {
  const isConfirm = CONFIRM_WORDS.some(w => lower.includes(w));
  const isDeny = DENY_WORDS.some(w => lower.includes(w));

  if (confirmTimeout) { clearTimeout(confirmTimeout); confirmTimeout = null; }

  if (isConfirm && pendingActions) {
    executeConfirmedAction();
    return;
  }

  if (isDeny) {
    pendingActions = null;
    speakText("OK, skipping that one.", () => {
      transition(STATES.ACTIVE_LISTENING, true);
    });
    return;
  }

  // Unclear response
  confirmAttempts++;
  if (confirmAttempts >= 2) {
    pendingActions = null;
    speakText("I'll leave it for now, you can do it in the chat.", () => {
      transition(STATES.ACTIVE_LISTENING, true);
    });
    return;
  }

  speakText("Sorry, was that a yes or no?", () => {
    transition(STATES.CONFIRMING, true);
  });
}

async function executeConfirmedAction() {
  if (confirmTimeout) { clearTimeout(confirmTimeout); confirmTimeout = null; }
  const actions = pendingActions;
  pendingActions = null;

  // Safety checks on all actions before executing any
  for (const action of actions) {
    if (action.changes && ('password_hash' in action.changes || 'is_admin' in action.changes)) {
      speakText("Whoa, can't touch that field. Security thing.", () => {
        transition(STATES.ACTIVE_LISTENING, true);
      });
      return;
    }
    if (action.type === 'delete' && action.sheet === 'Partners') {
      speakText("Can't delete partners, only status changes. Portal rules.", () => {
        transition(STATES.ACTIVE_LISTENING, true);
      });
      return;
    }
    if (action.row_match && Object.keys(action.row_match).length === 0 && action.type !== 'create') {
      speakText("I don't have enough info to find that row. Try being more specific.", () => {
        transition(STATES.ACTIVE_LISTENING, true);
      });
      return;
    }
  }

  transition(STATES.PROCESSING, true);

  try {
    for (const action of actions) {
      await executeAction(action);
      console.log(`[Randy Write] ${new Date().toISOString()}`, action);
    }
    speakText("Done! Got it all updated.");
  } catch (err) {
    console.error('Randy write error:', err);
    speakText("Hmm, that didn't work. " + err.message);
  }
}

function startConfirmTimeout() {
  if (confirmTimeout) clearTimeout(confirmTimeout);
  confirmTimeout = setTimeout(() => {
    if (currentState === STATES.CONFIRMING) {
      pendingActions = null;
      speakText("OK, I'll leave it for now.", () => {
        transition(STATES.ACTIVE_LISTENING, true);
      });
    }
  }, 15000);
}

// ── Speech Synthesis ──────────────────────────────────────────────
function speakText(text, onComplete) {
  // Clean text for speech
  const clean = cleanForSpeech(text);
  if (!clean) { if (onComplete) onComplete(); return; }

  // Set echo prevention flag — mic stays running for barge-in
  isRandySpeaking = true;
  currentSpokenText = clean;
  currentSpeechOnComplete = onComplete || null;

  if (currentState !== STATES.CONFIRMING && currentState !== STATES.PASSIVE) {
    if (currentState === STATES.PROCESSING || currentState === STATES.ACTIVE_LISTENING) {
      transition(STATES.SPEAKING);
    }
  }

  if (synth.speaking) synth.cancel();

  const utterance = new SpeechSynthesisUtterance(clean);
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.pitch = 0.85;
  utterance.rate = 1.1;

  utterance.onend = () => {
    // 500ms buffer to let audio clear from mic hardware
    setTimeout(() => {
      isRandySpeaking = false;
      currentSpokenText = '';
      const cb = currentSpeechOnComplete;
      currentSpeechOnComplete = null;
      if (cb) {
        cb();
      } else if (currentState === STATES.SPEAKING) {
        transition(STATES.ACTIVE_LISTENING);
      }
    }, 500);
  };

  utterance.onerror = (e) => {
    if (e.error === 'canceled') {
      // Intentional cancel (user interrupt or stopAll)
      isRandySpeaking = false;
      currentSpokenText = '';
      currentSpeechOnComplete = null;
      return;
    }
    console.error('Randy speech error:', e.error);
    setTimeout(() => {
      isRandySpeaking = false;
      currentSpokenText = '';
      const cb = currentSpeechOnComplete;
      currentSpeechOnComplete = null;
      if (cb) {
        cb();
      } else if (currentState === STATES.SPEAKING) {
        transition(STATES.ACTIVE_LISTENING);
      }
    }, 500);
  };

  synth.speak(utterance);

  // Start recognition for barge-in if not already running
  startRecognition();
}

// ── Voice Selection ───────────────────────────────────────────────
function selectVoice() {
  const voices = synth.getVoices();
  if (!voices.length) return;

  // Priority order
  const priorities = [
    v => v.name.includes('Google UK English Male'),
    v => v.name.includes('Microsoft David'),
    v => v.name.toLowerCase().includes('male'),
    v => v.lang.startsWith('en'),
  ];

  for (const test of priorities) {
    const match = voices.find(test);
    if (match) { selectedVoice = match; return; }
  }

  selectedVoice = voices[0] || null;
}

// ── Text Cleaning for Speech ──────────────────────────────────────
function cleanForSpeech(text) {
  return text
    // Strip :::ACTION blocks
    .replace(/:::ACTION[\s\S]*?:::/g, '')
    // Strip code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Strip markdown headers
    .replace(/#{1,4}\s+/g, '')
    // Strip bold/italic
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    // Strip list markers
    .replace(/^[-•*▸▶]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Strip links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Currency: $1,234,567 → "1 million 234 thousand 567 dollars"
    .replace(/\$(\d{1,3}),(\d{3}),(\d{3})/g, (_, m, t, u) => {
      const thousands = parseInt(t);
      const units = parseInt(u);
      let r = `${m} million`;
      if (thousands > 0) r += ` ${thousands} thousand`;
      if (units > 0) r += ` ${units}`;
      return r + ' dollars';
    })
    // $50,000 → "50 thousand dollars"
    .replace(/\$(\d{1,3}),(\d{3})/g, (_, t, u) => {
      const units = parseInt(u);
      return units > 0 ? `${t} thousand ${units} dollars` : `${t} thousand dollars`;
    })
    .replace(/\$/g, ' dollars ')
    // Percent
    .replace(/%/g, ' percent')
    // K after numbers → thousand
    .replace(/(\d)K\b/g, '$1 thousand')
    // Newlines → pauses
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    // Cleanup whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Chat Panel Integration ────────────────────────────────────────
function renderInChatIfVisible(role, text) {
  const path = getCurrentPath();
  if (path !== '/admin/ai-assistant') return;

  const chatArea = document.getElementById('ai-chat-area');
  if (!chatArea) return;

  const welcome = chatArea.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  if (typeof window._aiChatRenderMessage === 'function') {
    const bubble = window._aiChatRenderMessage(role, text, chatArea);
    // Mark as Randy message
    if (bubble) {
      const wrapper = bubble.closest('.chat-message');
      if (wrapper) wrapper.classList.add('chat-message--randy');
    }
  }
}

async function saveRandyConversation() {
  if (conversationHistory.length < 2) return;
  const path = getCurrentPath();
  if (path !== '/admin/ai-assistant') return;

  const user = getCurrentUser();
  if (!user) return;

  try {
    const title = (conversationHistory.find(m => m.role === 'user')?.content || '').substring(0, 60);
    const messagesJson = JSON.stringify(conversationHistory.map(m => ({
      ...m,
      timestamp: new Date().toISOString(),
      via: 'randy'
    })));
    const convId = 'conv_randy_' + Date.now();
    await appendRow(CONFIG.SHEET_AI_CONVERSATIONS, [convId, user.username, new Date().toISOString(), title, messagesJson, 'active']);
  } catch (err) {
    console.warn('Randy: failed to save conversation', err);
  }
}

// ── Widget UI ─────────────────────────────────────────────────────
function createWidget() {
  const root = document.getElementById('randy-root');
  if (!root) return;

  root.innerHTML = `
    <div class="randy randy--off" id="randy-widget">
      <button class="randy__btn" id="randy-btn" title="Randy Voice Assistant" aria-label="Activate Randy voice assistant">
        <img src="assets/randy-avatar.png" alt="Randy" class="randy__avatar">
      </button>
      <span class="randy__hint">Say "Hey Randy"</span>

      <div class="randy__pill" id="randy-pill" role="button" tabindex="0" aria-label="Randy voice assistant">
        <img src="assets/randy-avatar.png" alt="Randy" class="randy__avatar randy__avatar--sm">
        <span class="randy__label" id="randy-label" role="status" aria-live="polite"></span>
        <span class="randy__spinner" aria-hidden="true"></span>
        <button class="randy__close" id="randy-close" title="Turn off Randy" aria-label="Turn off Randy">&times;</button>
      </div>

      <div class="randy__error" id="randy-error"></div>
    </div>
  `;

  // Event listeners
  document.getElementById('randy-btn').addEventListener('click', handleBtnClick);
  document.getElementById('randy-pill').addEventListener('click', handlePillClick);
  document.getElementById('randy-close').addEventListener('click', handleCloseClick);
}

function handleBtnClick() {
  hideError();
  if (currentState === STATES.OFF) {
    transition(STATES.PASSIVE);
  } else if (currentState === STATES.PASSIVE) {
    transition(STATES.OFF);
  }
}

function handlePillClick(e) {
  // Don't trigger if clicking the close button
  if (e.target.closest('.randy__close')) return;
  // Deactivate to PASSIVE (skip voice line)
  transition(STATES.PASSIVE, true);
}

function handleCloseClick(e) {
  e.stopPropagation();
  transition(STATES.OFF, true);
}

function updateWidgetUI() {
  const widget = document.getElementById('randy-widget');
  if (!widget) return;

  const label = document.getElementById('randy-label');

  // Reset classes — state communicated via CSS classes on widget
  widget.className = 'randy';

  const isActive = [STATES.ACTIVE_LISTENING, STATES.PROCESSING, STATES.SPEAKING, STATES.CONFIRMING].includes(currentState);

  if (currentState === STATES.OFF) {
    widget.classList.add('randy--off');
  } else if (currentState === STATES.PASSIVE) {
    widget.classList.add('randy--passive');
  } else if (isActive) {
    widget.classList.add('randy--active');

    switch (currentState) {
      case STATES.ACTIVE_LISTENING:
        widget.classList.add('randy--listening');
        label.textContent = 'Listening...';
        break;
      case STATES.PROCESSING:
        widget.classList.add('randy--processing');
        label.textContent = 'Thinking...';
        break;
      case STATES.SPEAKING:
        widget.classList.add('randy--speaking');
        label.textContent = 'Speaking...';
        break;
      case STATES.CONFIRMING:
        widget.classList.add('randy--confirming');
        label.textContent = 'Yes or no?';
        break;
    }
  }
}

function flashWidget() {
  const btn = document.getElementById('randy-btn');
  if (!btn) return;
  const widget = document.getElementById('randy-widget');
  if (widget) widget.classList.add('randy--flash');
  setTimeout(() => { if (widget) widget.classList.remove('randy--flash'); }, 150);
}

function showError(msg) {
  const el = document.getElementById('randy-error');
  const widget = document.getElementById('randy-widget');
  if (el) el.textContent = msg;
  if (widget) widget.classList.add('randy--error');
  setTimeout(hideError, 5000);
}

function hideError() {
  const widget = document.getElementById('randy-widget');
  if (widget) widget.classList.remove('randy--error');
}

// ── Initialization ────────────────────────────────────────────────
export function initRandy() {
  if (mounted) return;
  if (!hasVoiceSupport()) return;

  createWidget();

  // Load voices (may be async)
  selectVoice();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = selectVoice;
  }

  // Restore persisted state (visual only — don't auto-start mic)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'passive') {
    currentState = STATES.PASSIVE;
    updateWidgetUI();
    // Don't call startRecognition — user must click to re-enable mic after refresh
  }

  mounted = true;
}

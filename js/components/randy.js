// ============================================
// Randy — Wake-Word Activated Voice Assistant
// ============================================
// Persistent floating widget in the app shell.
// Separate from the voice-widget.js chat mic feature.

import { SYSTEM_PROMPT, loadSheetData, callClaude, invalidateSheetCache } from '../utils/ai.js';
import { parseActions, executeAction } from '../utils/ai-actions.js';
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
let windowState = 'collapsed'; // 'collapsed' | 'open' | 'fullscreen'
let voiceEnabled = false;
let isProcessing = false;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let currentConvId = null;
let currentConvRow = null;
let isSaving = false;
let dragMoveHandler = null;
let dragUpHandler = null;
let escapeHandler = null;

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
  voiceEnabled = false;
  isDragging = false;
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

    // Visual flash + auto-expand window
    flashWidget();
    voiceEnabled = true;
    if (windowState === 'collapsed') setWindowState('open');

    // Extract trailing text after "randy"
    const afterWake = transcript.substring(lower.indexOf('randy') + 5).trim();

    transition(STATES.ACTIVE_LISTENING);

    if (afterWake.length > 2) {
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

// ── Process User Input (voice-only) ───────────────────────────────
async function processUserInput(text) {
  transition(STATES.PROCESSING);
  renderMessage('user', text, true);
  renderTypingIndicator();

  conversationHistory.push({ role: 'user', content: text });
  isProcessing = true;

  try {
    const sheetData = await loadSheetData();
    abortController = new AbortController();
    const response = await callClaude(conversationHistory, sheetData, text, abortController.signal, RANDY_SYSTEM_PROMPT);
    abortController = null;

    conversationHistory.push({ role: 'assistant', content: response });

    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }

    const { cleanText, actions } = parseActions(response);
    removeTypingIndicator();
    renderMessage('assistant', cleanText, true);

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

    saveRandyConversation();

  } catch (err) {
    abortController = null;
    removeTypingIndicator();
    if (err.name === 'AbortError') {
      transition(STATES.PASSIVE, true);
      return;
    }
    console.error('Randy API error:', err);
    const errMsg = "Sorry buddy, I hit a snag. " + err.message;
    renderMessage('assistant', errMsg, false);
    speakText(errMsg);
  } finally {
    isProcessing = false;
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

// ── Chat Message Rendering ────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function renderMessage(role, text, isVoice = false) {
  const chat = document.getElementById('randy-chat');
  if (!chat) return;

  // Remove welcome if present
  const welcome = chat.querySelector('.randy-welcome');
  if (welcome) welcome.remove();

  const isUser = role === 'user';
  const msg = document.createElement('div');
  msg.className = `randy-msg ${isUser ? 'randy-msg--user' : 'randy-msg--assistant'}`;

  if (!isUser) {
    const avatar = document.createElement('img');
    avatar.className = 'randy-msg__avatar';
    avatar.src = 'assets/randy-avatar.png';
    avatar.alt = 'Randy';
    msg.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'randy-bubble';
  if (isUser) {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }

  if (isVoice) {
    const badge = document.createElement('span');
    badge.className = 'randy-badge-voice';
    badge.textContent = '\uD83C\uDF99';
    bubble.appendChild(badge);
  }

  msg.appendChild(bubble);
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function renderTypingIndicator() {
  const chat = document.getElementById('randy-chat');
  if (!chat) return;
  removeTypingIndicator();
  const msg = document.createElement('div');
  msg.className = 'randy-msg randy-msg--assistant';
  msg.id = 'randy-typing';
  msg.innerHTML = `<img class="randy-msg__avatar" src="assets/randy-avatar.png" alt="Randy"><div class="randy-bubble"><div class="randy-typing"><span></span><span></span><span></span></div></div>`;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('randy-typing');
  if (el) el.remove();
}

function showWelcome() {
  const chat = document.getElementById('randy-chat');
  if (!chat) return;
  chat.innerHTML = `
    <div class="randy-welcome">
      <img src="assets/randy-avatar.png" alt="Randy" class="randy-welcome__avatar">
      <p class="randy-welcome__text">Hey, Randy here. Hit the green button or say "Hey Randy" to start.</p>
    </div>
  `;
}

// ── Conversation Persistence ──────────────────────────────────────
async function saveRandyConversation() {
  if (isSaving || conversationHistory.length < 2) return;
  const user = getCurrentUser();
  if (!user) return;

  isSaving = true;
  try {
    const title = (conversationHistory.find(m => m.role === 'user')?.content || 'Randy chat').substring(0, 60);
    const messagesJson = JSON.stringify(conversationHistory.map(m => ({
      ...m, timestamp: new Date().toISOString(), via: 'randy'
    })));

    if (!currentConvId) {
      currentConvId = 'conv_randy_' + Date.now();
      await appendRow(CONFIG.SHEET_AI_CONVERSATIONS, [currentConvId, user.username, new Date().toISOString(), title, messagesJson, 'active']);
      // Read back row index for future updates
      try {
        const all = await readSheetAsObjects(CONFIG.SHEET_AI_CONVERSATIONS);
        const saved = all.find(c => c.conversation_id === currentConvId);
        currentConvRow = saved?._rowIndex || null;
      } catch { /* ok */ }
    } else if (currentConvRow) {
      await updateRow(CONFIG.SHEET_AI_CONVERSATIONS, currentConvRow, [currentConvId, user.username, new Date().toISOString(), title, messagesJson, 'active']);
    }
  } catch (err) {
    console.warn('Randy: failed to save conversation', err);
  } finally {
    isSaving = false;
  }
}

// ── Window State Management ───────────────────────────────────────
function setWindowState(state) {
  windowState = state;
  updateWindowUI();

  // Save to localStorage
  try {
    const win = document.getElementById('randy-window');
    const stored = { state: state === 'fullscreen' ? 'open' : state };
    if (win && state === 'open') {
      stored.left = win.style.left || '';
      stored.top = win.style.top || '';
    }
    localStorage.setItem('pp_randy_window', JSON.stringify(stored));
  } catch { /* ok */ }
}

function updateWindowUI() {
  const widget = document.getElementById('randy-widget');
  if (!widget) return;

  widget.classList.remove('randy--open', 'randy--fullscreen');

  if (windowState === 'open') {
    widget.classList.add('randy--open');
  } else if (windowState === 'fullscreen') {
    widget.classList.add('randy--open', 'randy--fullscreen');
  }
}

// ── Combined UI Update (called by transition()) ───────────────────
function updateWidgetUI() {
  const widget = document.getElementById('randy-widget');
  if (!widget) return;

  // Reset voice state classes
  widget.classList.remove('randy--listening', 'randy--processing', 'randy--speaking', 'randy--confirming', 'randy--flash');

  // Apply voice state classes (for collapsed avatar animation)
  switch (currentState) {
    case STATES.ACTIVE_LISTENING: widget.classList.add('randy--listening'); break;
    case STATES.PROCESSING: widget.classList.add('randy--processing'); break;
    case STATES.SPEAKING: widget.classList.add('randy--speaking'); break;
    case STATES.CONFIRMING: widget.classList.add('randy--confirming'); break;
  }

  // Apply window state
  updateWindowUI();
  updateControlButtons();
}

// ── Widget DOM ────────────────────────────────────────────────────
const MIC_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const STOP_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

function createWidget() {
  const root = document.getElementById('randy-root');
  if (!root) return;

  root.innerHTML = `
    <div class="randy randy--passive" id="randy-widget">
      <button class="randy__btn" id="randy-btn" title="Randy Voice Assistant" aria-label="Open Randy assistant">
        <img src="assets/randy-avatar.png" alt="Randy" class="randy__avatar">
      </button>
      <span class="randy__hint">Say "Hey Randy"</span>

      <div class="randy__backdrop" id="randy-backdrop"></div>

      <div class="randy-window" id="randy-window">
        <div class="randy-window__titlebar" id="randy-titlebar">
          <img src="assets/randy-avatar.png" alt="" class="randy-window__titlebar-avatar">
          <span class="randy-window__titlebar-name">Randy</span>
          <div class="randy-window__controls">
            <button class="randy-window__ctrl" id="randy-minimize" title="Minimize" aria-label="Minimize">&#8211;</button>
            <button class="randy-window__ctrl" id="randy-fullscreen-btn" title="Fullscreen" aria-label="Fullscreen">&#9633;</button>
            <button class="randy-window__ctrl" id="randy-close-window" title="Close" aria-label="Close">&times;</button>
          </div>
        </div>

        <div class="randy-window__chat" id="randy-chat"></div>

        <div class="randy-window__status" id="randy-status" role="status" aria-live="polite">Paused</div>

        <div class="randy-window__controls-bar">
          <button class="randy-ctrl-go" id="randy-go" title="Start listening" aria-label="Start listening">${MIC_SVG}</button>
          <button class="randy-ctrl-stop" id="randy-stop" title="Pause Randy" aria-label="Pause Randy">${STOP_SVG}</button>
        </div>
      </div>

      <div class="randy__error" id="randy-error"></div>
    </div>
  `;

  // Event listeners — collapsed avatar
  document.getElementById('randy-btn').addEventListener('click', () => {
    hideError();
    if (windowState === 'collapsed') {
      if (currentState === STATES.OFF) transition(STATES.PASSIVE);
      setWindowState('open');
      if (conversationHistory.length === 0) showWelcome();
      updateControlButtons();
    } else {
      setWindowState('collapsed');
    }
  });

  // Window controls
  document.getElementById('randy-minimize').addEventListener('click', () => {
    // Minimize: keep conversation alive, just hide window
    setWindowState('collapsed');
  });
  document.getElementById('randy-fullscreen-btn').addEventListener('click', () => {
    setWindowState(windowState === 'fullscreen' ? 'open' : 'fullscreen');
  });
  document.getElementById('randy-close-window').addEventListener('click', () => {
    // Close: save, then end conversation completely
    saveRandyConversation();
    if (recognition) { try { recognition.abort(); } catch { /* ok */ } }
    if (synth.speaking) synth.cancel();
    if (abortController) { abortController.abort(); abortController = null; }
    isRandySpeaking = false;
    currentSpokenText = '';
    currentSpeechOnComplete = null;
    conversationHistory = [];
    pendingActions = null;
    confirmAttempts = 0;
    currentConvId = null;
    currentConvRow = null;
    voiceEnabled = false;
    const chat = document.getElementById('randy-chat');
    if (chat) chat.innerHTML = '';
    setWindowState('collapsed');
    transition(STATES.OFF, true);
  });
  document.getElementById('randy-backdrop').addEventListener('click', () => setWindowState('open'));

  // Green GO button — start listening
  document.getElementById('randy-go').addEventListener('click', () => {
    voiceEnabled = true;
    if (currentState === STATES.OFF) transition(STATES.PASSIVE);
    if (currentState === STATES.PASSIVE) transition(STATES.ACTIVE_LISTENING);
    updateControlButtons();
  });

  // Red STOP button — pause
  document.getElementById('randy-stop').addEventListener('click', () => {
    voiceEnabled = false;
    if (synth.speaking) synth.cancel();
    isRandySpeaking = false;
    currentSpokenText = '';
    if (abortController) { abortController.abort(); abortController = null; }
    if ([STATES.PROCESSING, STATES.ACTIVE_LISTENING, STATES.SPEAKING, STATES.CONFIRMING].includes(currentState)) {
      transition(STATES.PASSIVE, true);
    }
    updateControlButtons();
  });

  // Escape to exit fullscreen (stored for cleanup)
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = (e) => {
    if (e.key === 'Escape' && windowState === 'fullscreen') setWindowState('open');
  };
  document.addEventListener('keydown', escapeHandler);

  // Dragging
  initDragging();
}

// ── Voice Control Buttons State ───────────────────────────────────
function updateControlButtons() {
  const goBtn = document.getElementById('randy-go');
  const stopBtn = document.getElementById('randy-stop');
  const status = document.getElementById('randy-status');
  if (!goBtn || !stopBtn || !status) return;

  const isActive = [STATES.ACTIVE_LISTENING, STATES.PROCESSING, STATES.SPEAKING, STATES.CONFIRMING].includes(currentState);

  goBtn.classList.toggle('randy-ctrl-go--active', isActive);
  goBtn.classList.toggle('randy-ctrl-go--dimmed', !isActive && currentState !== STATES.OFF);
  stopBtn.classList.toggle('randy-ctrl-stop--active', !isActive && currentState !== STATES.OFF);

  const labels = {
    ACTIVE_LISTENING: 'Randy is listening...',
    PROCESSING: 'Thinking...',
    SPEAKING: 'Randy is speaking...',
    CONFIRMING: 'Yes or no?',
    PASSIVE: 'Paused',
    OFF: 'Paused',
  };
  status.textContent = labels[currentState] || 'Paused';
}

// ── Dragging ──────────────────────────────────────────────────────
function initDragging() {
  const titlebar = document.getElementById('randy-titlebar');
  const win = document.getElementById('randy-window');
  if (!titlebar || !win) return;

  // Double-click to toggle fullscreen
  titlebar.addEventListener('dblclick', () => {
    setWindowState(windowState === 'fullscreen' ? 'open' : 'fullscreen');
  });

  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.randy-window__ctrl')) return;
    if (windowState === 'fullscreen') return;
    if (window.innerWidth <= 768) return; // No drag on mobile

    isDragging = true;
    const rect = win.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;

    const widget = document.getElementById('randy-widget');
    if (widget) widget.classList.add('randy--dragging');

    e.preventDefault();
  });

  // Clean up old document listeners before adding new ones
  if (dragMoveHandler) document.removeEventListener('mousemove', dragMoveHandler);
  if (dragUpHandler) document.removeEventListener('mouseup', dragUpHandler);

  dragMoveHandler = (e) => {
    if (!isDragging) return;
    const x = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 320));
    const y = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 100));

    win.style.position = 'fixed';
    win.style.left = x + 'px';
    win.style.top = y + 'px';
    win.style.bottom = 'auto';
    win.style.right = 'auto';
  };

  dragUpHandler = () => {
    if (!isDragging) return;
    isDragging = false;
    const widget = document.getElementById('randy-widget');
    if (widget) widget.classList.remove('randy--dragging');

    // Save position
    try {
      const stored = JSON.parse(localStorage.getItem('pp_randy_window') || '{}');
      stored.left = win.style.left;
      stored.top = win.style.top;
      localStorage.setItem('pp_randy_window', JSON.stringify(stored));
    } catch { /* ok */ }
  };

  document.addEventListener('mousemove', dragMoveHandler);
  document.addEventListener('mouseup', dragUpHandler);
}

function flashWidget() {
  const widget = document.getElementById('randy-widget');
  if (!widget) return;
  widget.classList.add('randy--flash');
  setTimeout(() => widget.classList.remove('randy--flash'), 150);
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

  // Restore persisted voice state (visual only — don't auto-start mic)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'passive') {
    currentState = STATES.PASSIVE;
    updateWidgetUI();
  }

  // Restore window position
  try {
    const winData = JSON.parse(localStorage.getItem('pp_randy_window') || '{}');
    const win = document.getElementById('randy-window');
    if (win && winData.left) {
      win.style.position = 'fixed';
      win.style.left = winData.left;
      win.style.top = winData.top;
      win.style.bottom = 'auto';
      win.style.right = 'auto';
    }
  } catch { /* ok */ }

  mounted = true;
}

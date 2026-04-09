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
import { openOppModal } from '../views/admin-opportunities.js';

// ── Randy Personality Prompt ──────────────────────────────────────
const RANDY_PERSONALITY = `

Your name is Randy. You are a voice assistant for the Partner Portal. You speak like a trusted colleague — business casual, warm, confident. Think of how a sharp VP talks to a peer over coffee, not a presentation.

Your tone:
- Friendly and direct, never stiff or corporate
- Confident but not cocky
- You get to the point but you're not robotic about it
- Occasional dry humor is fine, never forced

Words and phrases you USE:
- 'Boss' as a casual address — not every sentence, roughly every 3rd or 4th response: 'Yeah boss, here's the deal...'
- 'Yeah so...' / 'So here's the deal...' / 'Good news...'
- 'Looks like...' / 'We're sitting at...' / 'That puts us at...'
- 'Nice.' / 'Solid.' / 'Not bad at all.'
- 'Want me to dig into that more?'
- 'Anything else boss?'

Words and phrases you NEVER use:
- 'Dude' / 'Bro' / 'Buddy' / 'Man'
- 'LOCKED IN' / 'LET'S GO' / 'huge' (overused hype words)
- 'Based on the data...' / 'According to the database...'
- 'Certainly' / 'Absolutely' / 'I'd be happy to'
- Bullet points or numbered lists — speak in natural sentences

Examples of Randy's style:
'Yeah so Greenshield — they're at 110K, qualified stage, looking at a June close. We had a good call with Gerard and Matias last month, next session is April 1st.'

'So the total pipeline right now is 830 grand across three active deals. Insight is the big one at 600K. Not bad.'

'Nerdio — Premier tier, North America. One deal at 120K and four events on the calendar. They're our most active partner right now.'

'Yeah boss I can update that. Moving the close date to July 15 for Greenshield. Want me to go ahead?'

'Anything else boss?'

Keep responses to 2-3 sentences since they're read aloud. If there's a lot of information, give the highlights and ask if they want more detail.

ADDITIONAL VOICE RULES:
- Never use asterisks or formatting characters
- Keep numbers conversational: say '120 grand' not '$120,000'
- Keep partner names natural: say 'Nerdio' not 'Nerdio (partner_id 6)'

NAVIGATION COMMANDS:
When the user asks you to open, show, go to, or navigate to something in the portal, include a :::NAV block in your response:

:::NAV
{"action": "navigate", "target": "/admin/dashboard"}
:::

Action types:
- "navigate" — go to a portal page. Target is the route path.
- "open_detail" — open a specific record. Target format is "type:name" (e.g. "partner:Nerdio" or "opportunity:Greenshield").
- "click" — trigger a UI element (reserved for future use).

Route mapping:
- 'Open the dashboard' → action: navigate, target: /admin/dashboard
- 'Show me partners' → action: navigate, target: /admin/partners
- 'Go to opportunities' → action: navigate, target: /admin/opportunities
- 'Show me events' → action: navigate, target: /admin/events
- 'Open the AI Assistant' → action: navigate, target: /admin/ai-assistant
- 'Go to setup' → action: navigate, target: /admin/setup

Detail navigation:
- 'Show me Nerdio' → action: open_detail, target: partner:Nerdio
- 'Open the Greenshield deal' → action: open_detail, target: opportunity:Greenshield

You can combine navigation with information. Example:
User: 'Show me the Nerdio partnership'
Response: 'Opening Nerdio for you — they're Premier tier, North America, with 120 grand in pipeline and four upcoming events.'
:::NAV
{"action": "open_detail", "target": "partner:Nerdio"}
:::

A response CAN contain BOTH :::ACTION and :::NAV blocks if the user asks to change data AND navigate.`;

const RANDY_SYSTEM_PROMPT = SYSTEM_PROMPT + RANDY_PERSONALITY;

// ── Portal Route Map ─────────────────────────────────────────────
const PORTAL_ROUTES = {
  'dashboard': '/admin/dashboard',
  'partners': '/admin/partners',
  'events': '/admin/events',
  'opportunities': '/admin/opportunities',
  'ai assistant': '/admin/ai-assistant',
  'ai': '/admin/ai-assistant',
  'setup': '/admin/setup',
};

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
let lastSpokenText = '';     // persists after speech for echo tail detection
let lastSpeechEndTime = 0;   // timestamp when Randy last stopped speaking
const ECHO_COOLDOWN = 3000;  // ms to keep checking for echo after speech ends
let windowState = 'collapsed'; // 'collapsed' | 'open' | 'fullscreen'
let voiceEnabled = false;
let isProcessing = false;
let isDragging = false;
let accumulatedTranscript = '';
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

// ── Echo Tail Detection (after Randy finishes speaking) ───────────
function isEchoTail(transcript) {
  // If we're still within the cooldown window after Randy spoke, check for echo
  if (!lastSpokenText || (Date.now() - lastSpeechEndTime) > ECHO_COOLDOWN) return false;

  const lower = transcript.toLowerCase();
  const spokenLower = lastSpokenText.toLowerCase();

  // If transcript is a substring of what Randy just said — echo
  if (spokenLower.includes(lower)) return true;

  // Word overlap check (same as isInterrupt but inverted — high overlap = echo)
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return true; // empty/short = likely noise
  const matchCount = words.filter(w => spokenLower.includes(w)).length;
  return (matchCount / words.length) > 0.5;
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
      accumulatedTranscript = '';
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
  lastSpokenText = '';
  lastSpeechEndTime = 0;
  conversationHistory = [];
  pendingActions = null;
  confirmAttempts = 0;
  accumulatedTranscript = '';
  voiceEnabled = false;
  isDragging = false;
}

// ── Speech Recognition ────────────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const transcript = result[0].transcript.trim();
    if (!transcript) return;

    // Show live interim transcription in chat
    if (!result.isFinal) {
      if (currentState === STATES.ACTIVE_LISTENING && !isRandySpeaking) {
        const preview = accumulatedTranscript
          ? accumulatedTranscript + ' ' + transcript
          : transcript;
        updateInterimBubble(preview);
      }
      return;
    }

    // Final result — clear interim bubble
    removeInterimBubble();

    const confidence = result[0].confidence;
    if (confidence !== 0 && confidence < 0.6) return;

    // During speaking: check for intentional interrupt vs echo
    if (isRandySpeaking) {
      if (isInterrupt(transcript)) {
        synth.cancel();
        isRandySpeaking = false;
        currentSpokenText = '';
        currentSpeechOnComplete = null;
        console.log('Randy: interrupted by user');
        if (currentState === STATES.SPEAKING) {
          currentState = STATES.ACTIVE_LISTENING;
          accumulatedTranscript = '';
          updateWidgetUI();
        }
        handleTranscript(transcript);
      }
      return;
    }

    // After Randy just finished speaking: catch echo tails
    if (isEchoTail(transcript)) {
      console.log('Randy: discarded echo tail:', transcript.substring(0, 40));
      return;
    }

    // In ACTIVE_LISTENING: accumulate transcript, don't send yet
    if (currentState === STATES.ACTIVE_LISTENING) {
      accumulatedTranscript = accumulatedTranscript
        ? accumulatedTranscript + ' ' + transcript
        : transcript;
      updateInterimBubble(accumulatedTranscript);
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
      speakText("What's up?", () => {
        processUserInput(afterWake);
      });
    } else {
      speakText("What's up?");
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

// ── NAV Block Parser ─────────────────────────────────────────────
function parseNavCommands(text) {
  const navs = [];
  const cleaned = text.replace(/:::NAV\n([\s\S]*?)\n:::/g, (_, json) => {
    try { navs.push(JSON.parse(json)); } catch (e) { console.error('Failed to parse NAV:', e); }
    return '';
  }).trim();
  return { cleaned, navs };
}

// ── NAV Execution ────────────────────────────────────────────────
async function executeNavCommand(nav) {
  if (!nav || !nav.action) return;

  switch (nav.action) {
    case 'navigate': {
      let route = nav.target;
      // Fallback: check PORTAL_ROUTES if target isn't a full path
      if (route && !route.startsWith('/')) {
        const key = route.toLowerCase().replace(/[^a-z\s]/g, '').trim();
        route = PORTAL_ROUTES[key] || route;
      }
      if (route) {
        console.log('Randy NAV: navigating to', route);
        window.location.hash = '#' + route;
      }
      break;
    }

    case 'open_detail': {
      if (!nav.target || !nav.target.includes(':')) {
        console.warn('Randy NAV: invalid open_detail target', nav.target);
        break;
      }
      const [type, ...nameParts] = nav.target.split(':');
      const name = nameParts.join(':').trim().toLowerCase();

      if (type === 'partner') {
        try {
          const data = await loadSheetData();
          const partners = data.partners || [];
          // Exact match first, then partial
          const partner = partners.find(p =>
            (p.display_name || '').toLowerCase() === name
          ) || partners.find(p =>
            (p.display_name || '').toLowerCase().includes(name)
          );
          if (partner) {
            console.log('Randy NAV: opening partner', partner.display_name, partner.partner_id);
            window.location.hash = '#/admin/partner-detail?id=' + encodeURIComponent(partner.partner_id);
          } else {
            console.warn('Randy NAV: partner not found:', name);
            window.location.hash = '#/admin/partners';
          }
        } catch (e) {
          console.error('Randy NAV: partner lookup failed', e);
        }
      } else if (type === 'opportunity') {
        try {
          const data = await loadSheetData();
          const opps = data.opportunities || [];
          // Exact match first, then partial
          const opp = opps.find(o =>
            (o.deal_name || '').toLowerCase() === name ||
            (o.customer_name || '').toLowerCase() === name
          ) || opps.find(o =>
            (o.deal_name || '').toLowerCase().includes(name) ||
            (o.customer_name || '').toLowerCase().includes(name)
          );
          // Navigate to opportunities page first
          window.location.hash = '#/admin/opportunities';
          if (opp) {
            console.log('Randy NAV: opening opportunity', opp.deal_name, opp.opportunity_id);
            // Wait for the view to render, then open the modal
            setTimeout(() => {
              openOppModal(opp, document.getElementById('view-container'));
            }, 300);
          }
        } catch (e) {
          console.error('Randy NAV: opportunity lookup failed', e);
        }
      }
      break;
    }

    case 'click':
      console.log('Randy NAV: click action (not implemented)', nav.target);
      break;

    default:
      console.warn('Randy NAV: unknown action', nav.action);
  }
}

// ── Process User Input (voice-only) ───────────────────────────────
async function processUserInput(text) {
  transition(STATES.PROCESSING);
  renderMessage('user', text);
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

    const { cleanText: afterActions, actions } = parseActions(response);
    const { cleaned: cleanText, navs } = parseNavCommands(afterActions);
    removeTypingIndicator();
    const assistantMsg = renderMessage('assistant', cleanText);

    // Schedule navigation after a short delay so user hears context first
    if (navs.length > 0) {
      setTimeout(() => {
        navs.forEach(nav => executeNavCommand(nav));
      }, 500);
    }

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
    const errMsg = "Sorry boss, hit a snag. " + err.message;
    renderMessage('assistant', errMsg);
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
  utterance.pitch = 0.7;
  utterance.rate = 0.95;

  utterance.onend = () => {
    // 1000ms buffer to let audio fully clear from mic/speakers
    clearSpeakingHighlight();
    setTimeout(() => {
      lastSpokenText = currentSpokenText;
      lastSpeechEndTime = Date.now();
      isRandySpeaking = false;
      currentSpokenText = '';
      const cb = currentSpeechOnComplete;
      currentSpeechOnComplete = null;
      if (cb) {
        cb();
      } else if (currentState === STATES.SPEAKING) {
        transition(STATES.ACTIVE_LISTENING);
      }
    }, 1000);
  };

  utterance.onerror = (e) => {
    clearSpeakingHighlight();
    if (e.error === 'canceled') {
      lastSpokenText = currentSpokenText;
      lastSpeechEndTime = Date.now();
      isRandySpeaking = false;
      currentSpokenText = '';
      currentSpeechOnComplete = null;
      return;
    }
    console.error('Randy speech error:', e.error);
    setTimeout(() => {
      lastSpokenText = currentSpokenText;
      lastSpeechEndTime = Date.now();
      isRandySpeaking = false;
      currentSpokenText = '';
      const cb = currentSpeechOnComplete;
      currentSpeechOnComplete = null;
      if (cb) {
        cb();
      } else if (currentState === STATES.SPEAKING) {
        transition(STATES.ACTIVE_LISTENING);
      }
    }, 1000);
  };

  synth.speak(utterance);

  // Start recognition for barge-in if not already running
  startRecognition();
}

// ── Voice Selection ───────────────────────────────────────────────
function selectVoice() {
  const allVoices = synth.getVoices();
  if (!allVoices.length) return;

  // Exclude feminine-sounding voices
  const femaleNames = ['female', 'woman', 'girl', 'zira', 'hazel', 'susan',
    'catherine', 'samantha', 'karen', 'moira', 'fiona', 'tessa', 'victoria', 'allison'];
  const voices = allVoices.filter(v => {
    const lower = v.name.toLowerCase();
    return !femaleNames.some(f => lower.includes(f));
  });

  // Priority order — aggressively prefer deep male voices
  const priorities = [
    v => v.name.includes('Mark'),
    v => v.name.includes('David'),
    v => v.name.includes('James'),
    v => v.name.includes('Daniel'),
    v => v.name.includes('Alex') && v.lang.startsWith('en'),
    v => v.name.includes('Google US English'),
    v => v.lang.startsWith('en-US'),
  ];

  for (const test of priorities) {
    const match = voices.find(test);
    if (match) { selectedVoice = match; console.log('Randy voice:', selectedVoice.name, selectedVoice.lang); return; }
  }

  selectedVoice = voices[0] || allVoices[0] || null;
  if (selectedVoice) console.log('Randy voice:', selectedVoice.name, selectedVoice.lang);
}

// ── Text Cleaning for Speech ──────────────────────────────────────
function cleanForSpeech(text) {
  return text
    // Strip :::ACTION and :::NAV blocks
    .replace(/:::ACTION[\s\S]*?:::/g, '')
    .replace(/:::NAV[\s\S]*?:::/g, '')
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

// ── Interim Transcription Bubble ───────────────────────────────────
function updateInterimBubble(text) {
  const chat = document.getElementById('randy-chat');
  if (!chat) return;
  let bubble = document.getElementById('randy-interim');
  if (!bubble) {
    const welcome = chat.querySelector('.randy-welcome');
    if (welcome) welcome.remove();
    const msg = document.createElement('div');
    msg.className = 'randy-msg randy-msg--user randy-msg--interim';
    msg.id = 'randy-interim';
    msg.innerHTML = '<div class="randy-bubble"></div>';
    chat.appendChild(msg);
    bubble = msg;
  }
  bubble.querySelector('.randy-bubble').textContent = text;
  chat.scrollTop = chat.scrollHeight;

  // Also show in status text
  const status = document.getElementById('randy-status');
  if (status) status.textContent = text;
}

function removeInterimBubble() {
  const el = document.getElementById('randy-interim');
  if (el) el.remove();
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

function renderMessage(role, text) {
  const chat = document.getElementById('randy-chat');
  if (!chat) return;

  const welcome = chat.querySelector('.randy-welcome');
  if (welcome) welcome.remove();

  // Remove speaking highlight from previous messages
  chat.querySelectorAll('.randy-msg--speaking').forEach(el => el.classList.remove('randy-msg--speaking'));

  const isUser = role === 'user';
  const msg = document.createElement('div');
  msg.className = `randy-msg ${isUser ? 'randy-msg--user' : 'randy-msg--assistant'}`;

  if (!isUser) {
    const avatar = document.createElement('img');
    avatar.className = 'randy-msg__avatar';
    avatar.src = 'assets/randy-avatar.png';
    avatar.alt = 'Randy';
    msg.appendChild(avatar);
    // Mark as currently being spoken
    msg.classList.add('randy-msg--speaking');
  }

  const bubble = document.createElement('div');
  bubble.className = 'randy-bubble';
  if (isUser) {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }

  msg.appendChild(bubble);
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
  return msg;
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

function clearSpeakingHighlight() {
  const chat = document.getElementById('randy-chat');
  if (chat) chat.querySelectorAll('.randy-msg--speaking').forEach(el => el.classList.remove('randy-msg--speaking'));
}

function showWelcome() {
  const chat = document.getElementById('randy-chat');
  if (!chat) return;
  chat.innerHTML = `
    <div class="randy-welcome">
      <img src="assets/randy-avatar.png" alt="Randy" class="randy-welcome__avatar">
      <p class="randy-welcome__text">Hey, Randy here. Tap the button or say "Hey Randy" to get started.</p>
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
  updateVoiceButton();
}

// ── Widget DOM ────────────────────────────────────────────────────
const MIC_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const SPINNER_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
const SPEAKER_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

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

        <div class="randy-window__bottom">
          <div class="randy-window__status" id="randy-status" role="status" aria-live="polite">Tap to talk</div>
          <div class="randy-window__voice-row">
            <button class="randy-voice-btn randy-voice-btn--paused" id="randy-voice-btn" aria-label="Toggle voice">${MIC_SVG}</button>
            <button class="randy-edit-btn" id="randy-edit-btn" title="Type a message" aria-label="Type a message">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
            </button>
          </div>
          <div class="randy-input-row" id="randy-input-row" hidden>
            <input type="text" class="randy-text-input" id="randy-text-input" placeholder="Type a message..." maxlength="500">
            <button class="randy-send-btn" id="randy-send-btn" title="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
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
      updateVoiceButton();
    } else {
      setWindowState('collapsed');
    }
  });

  // Window controls
  document.getElementById('randy-minimize').addEventListener('click', () => {
    setWindowState('collapsed');
  });
  document.getElementById('randy-fullscreen-btn').addEventListener('click', () => {
    setWindowState(windowState === 'fullscreen' ? 'open' : 'fullscreen');
  });
  document.getElementById('randy-close-window').addEventListener('click', () => {
    saveRandyConversation();
    if (recognition) { try { recognition.abort(); } catch { /* ok */ } }
    if (synth.speaking) synth.cancel();
    if (abortController) { abortController.abort(); abortController = null; }
    isRandySpeaking = false;
    currentSpokenText = '';
    currentSpeechOnComplete = null;
    lastSpokenText = '';
    lastSpeechEndTime = 0;
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

  // Single voice toggle button
  document.getElementById('randy-voice-btn').addEventListener('click', handleVoiceBtnClick);

  // Edit/keyboard input toggle
  const editBtn = document.getElementById('randy-edit-btn');
  const inputRow = document.getElementById('randy-input-row');
  const textInput = document.getElementById('randy-text-input');
  const sendBtn = document.getElementById('randy-send-btn');

  editBtn.addEventListener('click', () => {
    const isVisible = !inputRow.hidden;
    inputRow.hidden = isVisible;
    if (!isVisible) textInput.focus();
  });

  function sendTypedMessage() {
    const text = textInput.value.trim();
    if (!text || isProcessing) return;
    textInput.value = '';
    inputRow.hidden = true;
    processUserInput(text);
  }

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendTypedMessage(); }
    if (e.key === 'Escape') { textInput.value = ''; inputRow.hidden = true; }
  });
  sendBtn.addEventListener('click', sendTypedMessage);

  // Escape to exit fullscreen
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = (e) => {
    if (e.key === 'Escape' && windowState === 'fullscreen') setWindowState('open');
  };
  document.addEventListener('keydown', escapeHandler);

  initDragging();
}

// ── Single Voice Button Logic ─────────────────────────────────────
function handleVoiceBtnClick() {
  switch (currentState) {
    case STATES.OFF:
    case STATES.PASSIVE:
      // Paused → start listening
      voiceEnabled = true;
      if (currentState === STATES.OFF) transition(STATES.PASSIVE);
      transition(STATES.ACTIVE_LISTENING);
      break;
    case STATES.ACTIVE_LISTENING:
      // Listening → send accumulated transcript or pause
      removeInterimBubble();
      if (accumulatedTranscript.trim()) {
        const text = accumulatedTranscript.trim();
        accumulatedTranscript = '';
        processUserInput(text);
      } else {
        voiceEnabled = false;
        transition(STATES.PASSIVE, true);
      }
      break;
    case STATES.SPEAKING:
      // Speaking → interrupt and listen
      synth.cancel();
      isRandySpeaking = false;
      currentSpokenText = '';
      currentSpeechOnComplete = null;
      voiceEnabled = true;
      currentState = STATES.ACTIVE_LISTENING;
      accumulatedTranscript = '';
      updateWidgetUI();
      startRecognition();
      break;
    case STATES.PROCESSING:
      // Processing → do nothing (brief moment)
      break;
    case STATES.CONFIRMING:
      // Confirming → pause
      voiceEnabled = false;
      pendingActions = null;
      if (confirmTimeout) { clearTimeout(confirmTimeout); confirmTimeout = null; }
      transition(STATES.PASSIVE, true);
      break;
  }
  updateVoiceButton();
}

function updateVoiceButton() {
  const btn = document.getElementById('randy-voice-btn');
  const status = document.getElementById('randy-status');
  if (!btn || !status) return;

  // Reset classes
  btn.className = 'randy-voice-btn';

  switch (currentState) {
    case STATES.OFF:
    case STATES.PASSIVE:
      btn.classList.add('randy-voice-btn--paused');
      btn.innerHTML = MIC_SVG;
      status.textContent = 'Tap to talk';
      break;
    case STATES.ACTIVE_LISTENING:
      btn.classList.add('randy-voice-btn--listening');
      btn.innerHTML = MIC_SVG;
      // Status shows live transcript (updated by updateInterimBubble) or default
      if (!status.textContent || status.textContent === 'Tap to talk' || status.textContent === 'Thinking...' || status.textContent === 'Randy is speaking...' || status.textContent === 'Listening...') {
        status.textContent = 'Tap when done';
      }
      break;
    case STATES.PROCESSING:
      btn.classList.add('randy-voice-btn--processing');
      btn.innerHTML = SPINNER_SVG;
      status.textContent = 'Thinking...';
      break;
    case STATES.SPEAKING:
      btn.classList.add('randy-voice-btn--speaking');
      btn.innerHTML = SPEAKER_SVG;
      status.textContent = 'Randy is speaking...';
      break;
    case STATES.CONFIRMING:
      btn.classList.add('randy-voice-btn--listening');
      btn.innerHTML = MIC_SVG;
      status.textContent = 'Yes or no?';
      break;
  }
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

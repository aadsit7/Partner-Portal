// ============================================
// AI Assistant Chat View
// ============================================
// Reads Google Sheets via sheets.js, supports voice input

import { CONFIG } from '../config.js';
import { readSheetAsObjects } from '../sheets.js';
import { setTopbarTitle } from '../components/sidebar.js';

// ── State ──────────────────────────────────────────────────────────
let conversationHistory = [];
let isStreaming = false;
let abortController = null;
let cachedSheetData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes — re-read sheets after this

// ── System Prompt ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI assistant for Recast Software's Partner Portal. You answer questions about partners, deals, events, meetings, and partnership activity using the database context provided in each message.

IMPORTANT: The full database contents are included in each message under DATA CONTEXT. Use ONLY this data to answer questions. Do not make up information.

DATABASE SCHEMA & FIELD NOTES:

PARTNERS — Master list of partner organizations
- partner_id (PK), display_name, partner_type, tier, region, status (active/inactive), hq_location
- password_hash → NEVER SURFACE THIS FIELD
- Default: only show active partners unless asked

OPPORTUNITIES — Deals and pipeline
- opportunity_id (PK), partner_id (FK→Partners), deal_name, customer_name, deal_value (USD), status (In Progress/Won/Lost), stage (Qualified/Proposal/Negotiation/Closed Won/Closed Lost), expected_close
- description → LONG field with full meeting recaps, executive summaries, technical assessments
- notes → JSON array string, "[]" means empty

EVENTS — Marketing events, webinars, roundtables
- event_id (PK), title, description, event_date, end_date, event_type, location, status, partner_id (FK→Partners)

MEETING_INDEX — Structured index of individual meetings extracted from Transcripts
- meeting_id (PK), transcript_id (FK→Transcripts), partner_id, partner_name, meeting_date, meeting_title, attendees, summary, key_decisions, topics_discussed
- Use this FIRST for meeting questions — it's structured and fast

TRANSCRIPTS — Raw meeting transcripts (LARGE — only included when relevant)
- transcript_id (PK), partner_id, partner_name, conversation_date, transcript_text (5,000-15,000+ words each)
- Only search these if Meeting_Index doesn't have enough detail

QUERY ROUTING:
1. Partner info → PARTNERS
2. Deal/pipeline/revenue → OPPORTUNITIES (join to PARTNERS for names via partner_id)
3. Events → EVENTS
4. Meeting/conversation questions → MEETING_INDEX first, then TRANSCRIPTS if needed
5. People/contacts → MEETING_INDEX.attendees first, then TRANSCRIPTS
6. Technical environment → OPPORTUNITIES.description
7. Action items/next steps → MEETING_INDEX.key_decisions
8. "Status update on X" → sweep PARTNERS + OPPORTUNITIES + MEETING_INDEX

DATA RULES:
- All monetary values are USD — always label ($XXX,XXX)
- Partial name matching OK ("Rubix" → "GetRubix")
- Default to most recent meeting when multiple exist
- If not confident, say what you checked and what's missing
- Keep responses concise unless asked for detail
- Include meeting dates and attendees when citing meetings`;

// ── Sheet Data Loading ─────────────────────────────────────────────
// Reads all sheets via the existing sheets.js Google Sheets integration
// Uses a 5-min cache so we don't re-fetch on every message

async function safeRead(sheetName) {
  try {
    return await readSheetAsObjects(sheetName);
  } catch (err) {
    console.warn(`Sheet "${sheetName}" not available:`, err.message);
    return [];
  }
}

async function loadSheetData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSheetData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedSheetData;
  }

  const [partners, opportunities, events, meetingIndex, transcripts] = await Promise.all([
    safeRead(CONFIG.SHEET_PARTNERS),
    safeRead(CONFIG.SHEET_OPPORTUNITIES),
    safeRead(CONFIG.SHEET_EVENTS),
    safeRead(CONFIG.SHEET_MEETING_INDEX),
    safeRead(CONFIG.SHEET_TRANSCRIPTS)
  ]);

  if (partners.length === 0) {
    throw new Error('Could not read Google Sheets. Check your connection on the Setup page.');
  }

  // Sanitize partners — strip password hashes before sending to Claude
  const sanitizedPartners = partners.map(p => {
    const { password_hash, is_admin, ...safe } = p;
    return safe;
  });

  // For transcripts, send only metadata + truncated preview to stay within token limits
  // Full transcript text is sent only when the user asks about a specific partner
  const transcriptIndex = transcripts.map(t => ({
    transcript_id: t.transcript_id,
    partner_id: t.partner_id,
    partner_name: t.partner_name,
    conversation_date: t.conversation_date,
    preview: (t.transcript_text || '').substring(0, 300) + '...'
  }));

  cachedSheetData = {
    partners: sanitizedPartners,
    opportunities: opportunities,
    events: events,
    meetingIndex: meetingIndex,
    transcriptIndex: transcriptIndex,
    fullTranscripts: transcripts // kept locally for targeted lookups
  };
  cacheTimestamp = now;
  return cachedSheetData;
}

// ── Build Context for API Call ─────────────────────────────────────
// Smart context: always sends structured data, only sends full transcripts
// when the question seems to need them

function buildDataContext(data, userMessage) {
  const msg = userMessage.toLowerCase();

  // Determine if we need full transcript text
  // Trigger on: specific partner deep-dive, exact quotes, "full history", transcript-related keywords
  let transcriptContext = '';
  const needsTranscripts = /transcript|full detail|full history|exact|verbatim|what did .+ say|tell me everything|deep dive|email|contract|agreement/i.test(userMessage);

  if (needsTranscripts) {
    // Find which partner they're asking about and include only those transcripts
    const partnerMatch = data.partners.find(p =>
      msg.includes(p.display_name.toLowerCase()) ||
      msg.includes(p.display_name.toLowerCase().replace(/\s+/g, ''))
    );

    if (partnerMatch) {
      const relevantTranscripts = data.fullTranscripts
        .filter(t => String(t.partner_id) === String(partnerMatch.partner_id))
        .map(t => ({
          transcript_id: t.transcript_id,
          partner_name: t.partner_name,
          conversation_date: t.conversation_date,
          transcript_text: (t.transcript_text || '').substring(0, 8000) // Cap at ~8K chars per transcript
        }));

      if (relevantTranscripts.length > 0) {
        transcriptContext = `\n\nFULL TRANSCRIPTS (for ${partnerMatch.display_name}):\n${JSON.stringify(relevantTranscripts, null, 2)}`;
      }
    } else {
      // No specific partner identified — send previews only
      transcriptContext = `\n\nTRANSCRIPT PREVIEWS (ask about a specific partner for full text):\n${JSON.stringify(data.transcriptIndex, null, 2)}`;
    }
  } else {
    transcriptContext = `\n\nTRANSCRIPT PREVIEWS (${data.transcriptIndex.length} transcripts available — ask about a specific partner for full text):\n${JSON.stringify(data.transcriptIndex, null, 2)}`;
  }

  // Build the context block
  // Opportunities.description can be huge — truncate for general queries
  const needsFullDescriptions = /environment|platform|citrix|intune|sccm|avd|technical|architecture|current state|migration/i.test(userMessage);

  const opps = data.opportunities.map(o => {
    if (needsFullDescriptions) {
      return { ...o, description: (o.description || '').substring(0, 4000) };
    }
    return { ...o, description: (o.description || '').substring(0, 500) + '...' };
  });

  return `DATA CONTEXT:

PARTNERS (${data.partners.length} records):
${JSON.stringify(data.partners, null, 2)}

OPPORTUNITIES (${opps.length} records):
${JSON.stringify(opps, null, 2)}

EVENTS (${data.events.length} records):
${JSON.stringify(data.events, null, 2)}

MEETING_INDEX (${data.meetingIndex.length} records):
${JSON.stringify(data.meetingIndex, null, 2)}${transcriptContext}`;
}

// ── API Call ────────────────────────────────────────────────────────
async function callClaude(messages, sheetData, userMessage) {
  const apiKey = CONFIG.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Add ANTHROPIC_API_KEY to config.js');
  }

  abortController = new AbortController();

  // Inject sheet data into the latest user message
  const dataContext = buildDataContext(sheetData, userMessage);
  const augmentedMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user') {
      return { ...m, content: `${m.content}\n\n---\n${dataContext}` };
    }
    return m;
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: augmentedMessages
    }),
    signal: abortController.signal
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// ── Voice Input (Web Speech API) ───────────────────────────────────
let recognition = null;
let isListening = false;

function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const input = document.getElementById('ai-input');
    const sendBtn = document.getElementById('ai-send');
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      input.value = finalTranscript;
      sendBtn.disabled = false;
    } else if (interimTranscript) {
      input.value = interimTranscript;
      input.style.opacity = '0.7';
    }
  };

  recognition.onend = () => {
    isListening = false;
    updateMicButton(false);
    const input = document.getElementById('ai-input');
    input.style.opacity = '1';

    // Auto-send if we got a final result
    if (input.value.trim()) {
      handleSend();
    }
  };

  recognition.onerror = (event) => {
    isListening = false;
    updateMicButton(false);
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      console.error('Speech recognition error:', event.error);
    }
  };

  return recognition;
}

function toggleVoice() {
  if (!recognition) {
    recognition = initVoice();
    if (!recognition) {
      showToastMessage('Voice input not supported in this browser. Try Chrome or Edge.', 'warning');
      return;
    }
  }

  if (isListening) {
    recognition.stop();
    isListening = false;
    updateMicButton(false);
  } else {
    const input = document.getElementById('ai-input');
    input.value = '';
    input.placeholder = 'Listening...';
    recognition.start();
    isListening = true;
    updateMicButton(true);
  }
}

function updateMicButton(active) {
  const btn = document.getElementById('ai-mic');
  const input = document.getElementById('ai-input');
  if (btn) {
    btn.classList.toggle('ai-mic-active', active);
    btn.title = active ? 'Stop listening' : 'Voice input';
  }
  if (input && !active) {
    input.placeholder = 'Ask about partners, pipeline, meetings, events...';
  }
}

function showToastMessage(message, type = 'info') {
  // Use portal's toast if available, otherwise console
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
  } else {
    console.warn(message);
  }
}

// ── Markdown-lite Renderer ─────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>')
    .replace(/<p><(h[234]|ul|li)/g, '<$1')
    .replace(/<\/(h[234]|ul|li)><\/p>/g, '</$1>');
}

// ── Chat UI Components ─────────────────────────────────────────────
function renderMessage(role, text, container) {
  const isUser = role === 'user';
  const wrapper = document.createElement('div');
  wrapper.className = `chat-message ${isUser ? 'chat-user' : 'chat-assistant'}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = isUser ? 'AA' : 'C';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = isUser
    ? `<p>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
    : renderMarkdown(text);

  if (isUser) {
    wrapper.appendChild(bubble);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
  }

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

function renderLoading(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message chat-assistant';
  wrapper.id = 'chat-loading';

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = 'C';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-loading-bubble';
  bubble.innerHTML = `
    <div class="chat-loading-dots">
      <span></span><span></span><span></span>
    </div>
    <span class="chat-loading-text">Reading your sheets...</span>
  `;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return wrapper;
}

function removeLoading() {
  const el = document.getElementById('chat-loading');
  if (el) el.remove();
}

// ── Suggested Questions ────────────────────────────────────────────
const SUGGESTED_QUESTIONS = [];

// ── Main Render ────────────────────────────────────────────────────
export function renderAdminAIAssistant(container) {
  setTopbarTitle('AI Assistant');

  const view = container
    || document.getElementById('view-container')
    || document.querySelector('.view-container')
    || document.querySelector('main');
  if (!view) return;

  conversationHistory = [];
  cachedSheetData = null;
  cacheTimestamp = 0;

  const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  view.innerHTML = `
    <div class="ai-assistant-container">
      <div class="ai-header">
        <div class="ai-header-left">
          <div class="ai-header-icon">⚡</div>
          <div>
            <h2 class="ai-header-title">Portal AI Assistant</h2>
            <p class="ai-header-sub">Connected to your Partner Portal database via Google Sheets</p>
          </div>
        </div>
        <div class="ai-header-actions">
          <button class="ai-refresh-btn" id="ai-refresh" title="Refresh sheet data">↻</button>
          <button class="ai-clear-btn" id="ai-clear">Clear Chat</button>
        </div>
      </div>

      <div class="ai-chat-area" id="ai-chat-area">
        <div class="ai-welcome">
          <div class="ai-welcome-icon">💬</div>
          <h3>Ask me anything about your partners, deals, events, or meetings</h3>
          <p>I read your Google Sheet live — Partners, Opportunities, Events, Transcripts, and Meeting Index.</p>
          ${hasSpeech ? '<p class="ai-voice-hint">🎙️ Click the mic button or press <kbd>M</kbd> to use voice input</p>' : ''}
          <div class="ai-suggestions" id="ai-suggestions"></div>
        </div>
      </div>

      <div class="ai-input-area">
        <div class="ai-input-wrapper">
          ${hasSpeech ? `
          <button class="ai-mic-btn" id="ai-mic" title="Voice input">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
          ` : ''}
          <textarea
            id="ai-input"
            placeholder="Ask about partners, pipeline, meetings, events..."
            rows="1"
            maxlength="2000"
          ></textarea>
          <button class="ai-send-btn" id="ai-send" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
        <p class="ai-disclaimer">AI responses are based on your Google Sheet data. Verify critical details before acting.</p>
      </div>
    </div>
  `;

  // Render suggested questions
  const suggestionsEl = document.getElementById('ai-suggestions');
  SUGGESTED_QUESTIONS.forEach(q => {
    const chip = document.createElement('button');
    chip.className = 'ai-suggestion-chip';
    chip.textContent = q;
    chip.addEventListener('click', () => {
      document.getElementById('ai-input').value = q;
      handleSend();
    });
    suggestionsEl.appendChild(chip);
  });

  // Input handlers
  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    sendBtn.disabled = !input.value.trim();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.value.trim()) handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // Voice button
  const micBtn = document.getElementById('ai-mic');
  if (micBtn) {
    micBtn.addEventListener('click', toggleVoice);
  }

  // Keyboard shortcut: M to toggle mic (when input not focused)
  document.addEventListener('keydown', handleKeyShortcut);

  // Clear button
  document.getElementById('ai-clear').addEventListener('click', () => {
    conversationHistory = [];
    renderAdminAIAssistant(view);
  });

  // Refresh sheet data button
  document.getElementById('ai-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('ai-refresh');
    btn.disabled = true;
    btn.textContent = '⟳';
    try {
      await loadSheetData(true);
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '↻'; btn.disabled = false; }, 1500);
    } catch (err) {
      btn.textContent = '✗';
      setTimeout(() => { btn.textContent = '↻'; btn.disabled = false; }, 1500);
    }
  });

  // Pre-load sheet data
  loadSheetData().catch(err => console.warn('Pre-load failed:', err));
}

function handleKeyShortcut(e) {
  // M key toggles mic when not typing in any input
  if (e.key === 'm' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    toggleVoice();
  }
}

async function handleSend() {
  const input = document.getElementById('ai-input');
  const chatArea = document.getElementById('ai-chat-area');
  const text = input.value.trim();
  if (!text || isStreaming) return;

  // Remove welcome on first message
  const welcome = chatArea.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  // Show user message
  renderMessage('user', text, chatArea);
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('ai-send').disabled = true;

  // Add to history
  conversationHistory.push({ role: 'user', content: text });

  // Show loading
  renderLoading(chatArea);
  isStreaming = true;

  try {
    // Load sheet data (uses cache if fresh)
    const sheetData = await loadSheetData();

    // Update loading text
    const loadingText = document.querySelector('.chat-loading-text');
    if (loadingText) loadingText.textContent = 'Thinking...';

    // Call Claude with sheet context
    const response = await callClaude(conversationHistory, sheetData, text);
    removeLoading();
    renderMessage('assistant', response, chatArea);
    conversationHistory.push({ role: 'assistant', content: response });
  } catch (err) {
    removeLoading();
    if (err.name === 'AbortError') return;
    renderMessage('assistant',
      `**Error:** ${err.message}\n\nMake sure your Google Sheet connection is working (check Setup page) and your API key is configured in config.js.`,
      chatArea
    );
  } finally {
    isStreaming = false;
  }
}

export function cleanupAdminAIAssistant() {
  if (abortController) abortController.abort();
  if (recognition && isListening) recognition.stop();
  document.removeEventListener('keydown', handleKeyShortcut);
  isStreaming = false;
  isListening = false;
}

// ============================================
// AI Assistant Chat View
// ============================================
// Reads Google Sheets via sheets.js, supports voice input

import { getRuntimeConfig, setRuntimeConfig } from '../config.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { loadSheetData, callClaude } from '../utils/ai.js';
import { activateVoiceMode, isVoiceModeActive, stopEverything as stopVoice } from '../components/voice-widget.js';

// ── State ──────────────────────────────────────────────────────────
let conversationHistory = [];
let isStreaming = false;
let abortController = null;

// ── Voice Mode (delegates to floating voice widget) ────────────────
function toggleVoice() {
  if (isVoiceModeActive()) {
    stopVoice();
    return;
  }
  activateVoiceMode();
}

function showToastMessage(message, type = 'info') {
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

// Expose renderMessage globally so voice widget can add transcript entries
window._aiChatRenderMessage = renderMessage;

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

// ── Main Render ────────────────────────────────────────────────────
export function renderAdminAIAssistant(container) {
  setTopbarTitle('AI Assistant');

  const view = container
    || document.getElementById('view-container')
    || document.querySelector('.view-container')
    || document.querySelector('main');
  if (!view) return;

  conversationHistory = [];

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
          <button class="ai-refresh-btn" id="ai-api-key" title="Set API key" style="${getRuntimeConfig('ANTHROPIC_API_KEY') ? '' : 'color:#dc2626;'}">🔑</button>
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

  // API key button
  document.getElementById('ai-api-key').addEventListener('click', () => {
    const current = getRuntimeConfig('ANTHROPIC_API_KEY');
    const key = prompt('Enter your Anthropic API key (copy from Setup page):', current || '');
    if (key !== null) {
      setRuntimeConfig('ANTHROPIC_API_KEY', key.trim());
      const btn = document.getElementById('ai-api-key');
      btn.style.color = key.trim() ? '' : '#dc2626';
    }
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

  const welcome = chatArea.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  renderMessage('user', text, chatArea);
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('ai-send').disabled = true;

  conversationHistory.push({ role: 'user', content: text });

  renderLoading(chatArea);
  isStreaming = true;

  try {
    const sheetData = await loadSheetData();

    const loadingText = document.querySelector('.chat-loading-text');
    if (loadingText) loadingText.textContent = 'Thinking...';

    abortController = new AbortController();
    const response = await callClaude(conversationHistory, sheetData, text, abortController.signal);
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
  document.removeEventListener('keydown', handleKeyShortcut);
  isStreaming = false;
}

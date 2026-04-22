// ============================================
// Admin Setup / Google Sheets Connection View
// ============================================

import { CONFIG, getRuntimeConfig, setRuntimeConfig } from '../config.js';
import { isConfigured, testConnection, initializeSheet, seedSheetData, syncHeaders, loadCustomPrompts, saveCustomPrompt, deleteCustomPrompt } from '../sheets.js';
import { el, mount } from '../utils/dom.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { showToast } from '../components/toast.js';

export const title = 'Setup';

export async function render(container) {
  setTopbarTitle('Google Sheets Setup');

  const spreadsheetId = getRuntimeConfig('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID;
  const apiKey = getRuntimeConfig('API_KEY') || CONFIG.API_KEY;
  const hasRealId = spreadsheetId && spreadsheetId !== 'YOUR_SPREADSHEET_ID_HERE';
  const hasApiKey = apiKey && apiKey !== 'YOUR_GOOGLE_API_KEY_HERE';

  // --- Status indicator ---
  const statusDot = el('span', { class: 'setup-status__dot setup-status__dot--checking' });
  const statusText = el('span', { class: 'setup-status__text' }, 'Checking connection...');
  const statusRow = el('div', { class: 'setup-status' }, statusDot, statusText);

  // --- API Key input ---
  const apiKeyInput = el('input', {
    class: 'form-input',
    type: 'text',
    placeholder: 'Paste your Google API Key here',
    value: hasApiKey ? apiKey : '',
  });

  // --- AI Key input (pre-filled, stored in localStorage) ---
  const aiKeyInput = el('input', {
    class: 'form-input',
    type: 'text',
    placeholder: 'Paste your Anthropic API key here',
    value: getRuntimeConfig('ANTHROPIC_API_KEY') || '',
  });

  // --- Spreadsheet ID display ---
  const sheetIdDisplay = el('input', {
    class: 'form-input',
    type: 'text',
    value: hasRealId ? spreadsheetId : '',
    placeholder: 'Not configured',
    readOnly: false,
  });

  // --- Tabs display ---
  const tabsDisplay = el('div', { class: 'setup-tabs', id: 'setup-tabs' });

  // --- Action buttons ---
  const saveBtn = el('button', { class: 'btn btn--primary', onClick: handleSave }, 'Save Configuration');
  const testBtn = el('button', { class: 'btn btn--secondary', onClick: handleTest }, 'Test Connection');
  const initBtn = el('button', { class: 'btn btn--success', onClick: handleInit }, 'Initialize Sheet');
  const syncBtn = el('button', { class: 'btn btn--secondary', onClick: handleSync }, 'Sync Headers');
  const seedBtn = el('button', { class: 'btn btn--secondary', onClick: handleSeed }, 'Seed Demo Data');

  const content = el('div', { class: 'setup-page' },
    // Header section
    el('div', { class: 'setup-header' },
      el('h2', { class: 'setup-header__title' }, 'Google Sheets Connection'),
      el('p', { class: 'setup-header__description' },
        'Connect a Google Sheet as the database for Partners, Opportunities, and Events. All changes in the portal automatically sync to the sheet.'
      )
    ),

    // Connection status
    el('div', { class: 'setup-card' },
      el('h3', { class: 'setup-card__title' }, 'Connection Status'),
      statusRow,
      tabsDisplay
    ),

    // Configuration form
    el('div', { class: 'setup-card' },
      el('h3', { class: 'setup-card__title' }, 'Configuration'),

      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Spreadsheet ID'),
        sheetIdDisplay,
        el('div', { class: 'form-hint' },
          'From the spreadsheet URL: docs.google.com/spreadsheets/d/',
          el('strong', {}, '{THIS_PART}'),
          '/edit'
        )
      ),

      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Google API Key'),
        apiKeyInput,
        el('div', { class: 'form-hint' },
          'Optional if logged in with Google SSO. Required for unauthenticated access. ',
          'Create one at console.cloud.google.com > Credentials.'
        )
      ),

      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'AI Assistant API Key'),
        el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          aiKeyInput,
          el('button', {
            class: 'btn btn--secondary',
            title: 'Copy to clipboard',
            style: { padding: '8px 12px', flexShrink: '0' },
            onClick: () => {
              const val = aiKeyInput.value.trim();
              if (val) {
                navigator.clipboard.writeText(val).then(() => showToast('API key copied to clipboard', 'success'));
              }
            }
          }, '📋')
        ),
        el('div', { class: 'form-hint' },
          'Anthropic API key for the AI Assistant tab. Click 📋 to copy, then paste into the AI Assistant\'s 🔑 prompt. ',
          'Get a key at console.anthropic.com > Settings > API keys.'
        )
      ),

      el('div', { class: 'setup-actions' }, saveBtn, testBtn)
    ),

    // AI Assistant Presets
    el('div', { class: 'setup-card' },
      el('h3', { class: 'setup-card__title' }, 'AI Assistant Presets'),
      el('p', { class: 'setup-card__description' },
        'Create up to 5 custom instruction sets for Randy. Activate one from the pill menu above Randy\'s chat input to change how he responds for that conversation.'
      ),
      el('div', { id: 'presets-container', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }),
      el('div', { style: { marginTop: '8px' } },
        el('button', {
          class: 'btn btn--secondary',
          id: 'add-preset-btn',
          onClick: handleAddPreset,
        }, '+ Add Preset')
      )
    ),

    // Sheet Initialization
    el('div', { class: 'setup-card' },
      el('h3', { class: 'setup-card__title' }, 'Sheet Initialization'),
      el('p', { class: 'setup-card__description' },
        'Create the required tabs (Partners, Opportunities, Events) with header rows in your Google Sheet.'
      ),
      el('div', { class: 'setup-actions' },
        initBtn,
        syncBtn,
        seedBtn
      ),
      el('div', { class: 'form-hint', style: { marginTop: 'var(--space-3)' } },
        'Initialize creates the 3 tabs with headers. Seed populates them with sample data. You must be logged in with Google SSO for these to work.'
      )
    ),

    // Content Visibility
    el('div', { class: 'setup-card' },
      el('h3', { class: 'setup-card__title' }, 'Content Visibility'),
      el('p', { class: 'setup-card__description' },
        'Control which data appears across the portal. When off, the corresponding records are hidden from all dashboards and views.'
      ),

      el('div', { class: 'toggle-section' },
        el('div', { class: 'toggle-section__heading' }, 'Partners'),
        toggleRow('Show Inactive Partners',
          'Display partners with inactive status in all views',
          'SHOW_INACTIVE_PARTNERS')
      ),

      el('div', { class: 'toggle-section' },
        el('div', { class: 'toggle-section__heading' }, 'Events'),
        toggleRow('Show Past Events',
          'Display completed events in all views',
          'SHOW_PAST_EVENTS'),
        toggleRow('Show Cancelled Events',
          'Display events with cancelled status in all views',
          'SHOW_CANCELLED_EVENTS')
      ),

      el('div', { class: 'toggle-section' },
        el('div', { class: 'toggle-section__heading' }, 'Opportunities'),
        toggleRow('Show Closed Lost Opportunities',
          'Display opportunities with Lost status in all views',
          'SHOW_CLOSED_LOST_OPPS')
      )
    ),

    // How it works
    el('div', { class: 'setup-card' },
      el('h3', { class: 'setup-card__title' }, 'How Auto-Sync Works'),
      el('div', { class: 'setup-info' },
        infoItem('Create', 'Adding a partner, opportunity, or event appends a new row to the corresponding sheet tab.'),
        infoItem('Edit', 'Editing a record updates the matching row in-place.'),
        infoItem('Delete', 'Deleting a record removes the row from the sheet.'),
        infoItem('Read', 'Every page load reads live data from the Google Sheet.'),
      )
    )
  );

  mount(container, content);

  // Check connection on load
  checkStatus();

  // Load and render existing presets
  loadCustomPrompts().then(presets => renderPresetCards(presets)).catch(() => {});

  // --- Handlers ---

  async function handleSave() {
    const newId = sheetIdDisplay.value.trim();
    const newKey = apiKeyInput.value.trim();

    if (newId) setRuntimeConfig('SPREADSHEET_ID', newId);
    if (newKey) setRuntimeConfig('API_KEY', newKey);

    const newAiKey = aiKeyInput.value.trim();
    if (newAiKey) setRuntimeConfig('ANTHROPIC_API_KEY', newAiKey);

    showToast('Configuration saved', 'success');
    checkStatus();
  }

  async function handleTest() {
    setStatus('checking', 'Testing connection...');
    try {
      const result = await testConnection();
      setStatus('connected', `Connected — found ${result.tabs.length} tab(s): ${result.tabs.join(', ')}`);
      renderTabs(result.tabs);
      showToast('Connection successful', 'success');
    } catch (err) {
      setStatus('error', `Connection failed: ${err.message}`);
      showToast(err.message, 'error');
    }
  }

  async function handleInit() {
    initBtn.disabled = true;
    initBtn.textContent = 'Initializing...';
    try {
      const result = await initializeSheet();
      showToast(`Sheet initialized — ${result.tabsCreated} tab(s) created`, 'success');
      checkStatus();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      initBtn.disabled = false;
      initBtn.textContent = 'Initialize Sheet';
    }
  }

  async function handleSync() {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    try {
      await syncHeaders();
      showToast('Headers synced to current schema', 'success');
      checkStatus();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Headers';
    }
  }

  async function handleSeed() {
    seedBtn.disabled = true;
    seedBtn.textContent = 'Seeding data...';
    try {
      await seedSheetData();
      showToast('Demo data seeded to all tabs', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      seedBtn.disabled = false;
      seedBtn.textContent = 'Seed Demo Data';
    }
  }

  function setStatus(state, message) {
    statusDot.className = `setup-status__dot setup-status__dot--${state}`;
    statusText.textContent = message;
  }

  function renderTabs(tabs) {
    tabsDisplay.innerHTML = '';
    if (tabs.length === 0) return;
    const required = [CONFIG.SHEET_PARTNERS, CONFIG.SHEET_OPPORTUNITIES, CONFIG.SHEET_EVENTS];
    tabs.forEach(tab => {
      const isRequired = required.includes(tab);
      tabsDisplay.appendChild(
        el('span', { class: `badge ${isRequired ? 'badge--won' : 'badge--silver'}` }, tab)
      );
    });
  }

  async function checkStatus() {
    if (!isConfigured()) {
      setStatus('error', 'Not configured — save a Spreadsheet ID and API key, or log in with Google SSO.');
      return;
    }
    setStatus('checking', 'Testing connection...');
    try {
      const result = await testConnection();
      setStatus('connected', `Connected — ${result.tabs.length} tab(s) found`);
      renderTabs(result.tabs);
    } catch (err) {
      setStatus('error', `Error: ${err.message}`);
    }
  }

  // ── AI Assistant Presets ─────────────────────────────────────────

  const PRESET_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2'];

  function buildPresetCard(preset, index) {
    const isNew = !preset._rowIndex;

    const colorDot = el('span', {
      style: {
        display: 'inline-block',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        background: PRESET_COLORS[index] || '#6b7280',
        flexShrink: '0',
      },
    });

    const labelInput = el('input', {
      class: 'form-input',
      type: 'text',
      placeholder: 'Preset name (e.g. Deal Analyst)',
      value: preset.label || '',
      style: { flex: '1' },
    });

    const instructionsInput = el('textarea', {
      class: 'form-input',
      placeholder: 'Describe how Randy should behave when this preset is active...',
      rows: '4',
      style: { resize: 'vertical', fontFamily: 'inherit' },
    }, preset.instructions || '');

    const savePresetBtn = el('button', {
      class: 'btn btn--primary',
      style: { fontSize: '0.875rem', padding: '7px 14px' },
      onClick: async () => {
        const label = labelInput.value.trim();
        const icon = String(index + 1);
        const instructions = instructionsInput.value.trim();
        if (!label) { showToast('Preset name is required', 'error'); return; }
        if (!instructions) { showToast('Instructions are required', 'error'); return; }
        savePresetBtn.disabled = true;
        savePresetBtn.textContent = 'Saving...';
        try {
          await saveCustomPrompt(preset.prompt_id || null, label, icon, instructions, preset._rowIndex || null);
          showToast('Preset saved', 'success');
          preset.prompt_id = preset.prompt_id || label;
          preset.label = label;
          preset.icon = icon;
          preset.instructions = instructions;
          window.dispatchEvent(new CustomEvent('custom-prompts-changed'));
          // Reload cards to get the updated _rowIndex for newly-created presets
          if (isNew) {
            loadCustomPrompts().then(p => renderPresetCards(p)).catch(() => {});
          }
        } catch (err) {
          showToast(err.message || 'Failed to save preset', 'error');
        } finally {
          savePresetBtn.disabled = false;
          savePresetBtn.textContent = 'Save Preset';
        }
      },
    }, 'Save Preset');

    const deletePresetBtn = el('button', {
      class: 'btn btn--secondary',
      style: { fontSize: '0.875rem', padding: '7px 10px', color: '#dc2626', borderColor: '#fca5a5' },
      onClick: async () => {
        if (!preset._rowIndex) { card.remove(); refreshAddBtn(); return; }
        deletePresetBtn.disabled = true;
        deletePresetBtn.textContent = '...';
        try {
          await deleteCustomPrompt(preset._rowIndex);
          showToast('Preset deleted', 'success');
          card.remove();
          refreshAddBtn();
          window.dispatchEvent(new CustomEvent('custom-prompts-changed'));
        } catch (err) {
          showToast(err.message || 'Failed to delete preset', 'error');
          deletePresetBtn.disabled = false;
          deletePresetBtn.textContent = '✕';
        }
      },
    }, '✕');

    const card = el('div', {
      class: 'setup-card',
      style: { margin: '0', padding: '14px', border: '1px solid #e5e7eb', borderRadius: '8px' },
    },
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' } },
        colorDot,
        labelInput,
        deletePresetBtn
      ),
      el('div', { class: 'form-group', style: { marginBottom: '10px' } },
        el('label', { class: 'form-label' }, 'Instructions'),
        instructionsInput
      ),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        savePresetBtn
      )
    );

    return card;
  }

  function renderPresetCards(presets) {
    const container = document.getElementById('presets-container');
    if (!container) return;
    container.innerHTML = '';
    presets.forEach((p, i) => container.appendChild(buildPresetCard(p, i)));
    refreshAddBtn();
  }

  function refreshAddBtn() {
    const container = document.getElementById('presets-container');
    const addBtn = document.getElementById('add-preset-btn');
    if (!container || !addBtn) return;
    addBtn.disabled = container.children.length >= 5;
    addBtn.title = container.children.length >= 5 ? 'Maximum of 5 presets reached' : '';
  }

  function handleAddPreset() {
    const container = document.getElementById('presets-container');
    if (!container || container.children.length >= 5) return;
    const card = buildPresetCard({}, container.children.length);
    container.appendChild(card);
    card.querySelector('input')?.focus();
    refreshAddBtn();
  }
}

function infoItem(label, description) {
  return el('div', { class: 'setup-info__item' },
    el('div', { class: 'setup-info__label' }, label),
    el('div', { class: 'setup-info__desc' }, description)
  );
}

function toggleRow(label, description, configKey) {
  const isOn = getRuntimeConfig(configKey);
  const checkbox = el('input', {
    type: 'checkbox',
    class: 'toggle-slider__input',
    ...(isOn ? { checked: true } : {}),
    onChange: (e) => {
      setRuntimeConfig(configKey, e.target.checked);
    },
  });

  return el('div', { class: 'toggle-row' },
    el('div', { class: 'toggle-row__text' },
      el('div', { class: 'toggle-row__label' }, label),
      el('div', { class: 'toggle-row__desc' }, description)
    ),
    el('label', { class: 'toggle-slider' },
      checkbox,
      el('span', { class: 'toggle-slider__track' })
    )
  );
}

export function cleanup() {}

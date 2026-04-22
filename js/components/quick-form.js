// ============================================
// Quick Form — Floating Quick-Add Panel
// ============================================
// Surfaced via the form icon button on the Randy assistant widget.
// Lets admins create Opportunities, Partners, or Events without
// navigating to their respective admin pages.

import { CONFIG } from '../config.js';
import { appendRow, isConfigured, addDemoRow, readSheetAsObjects } from '../sheets.js';
import { showToast } from './toast.js';
import { uuid } from '../utils/dom.js';
import { nowISO } from '../utils/date.js';
import { getCurrentUser } from '../auth.js';
import { sha256 } from '../utils/hash.js';
import { TIER_OPTIONS } from '../utils/tiers.js';

const OPP_STAGES   = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Closed'];
const OPP_STATUSES = ['Registered', 'In Progress', 'Won', 'Lost'];
const PARTNER_TYPES = ['Technology', 'MSP/SI', 'OEM', 'MENA Regional Distributor'];
const EVENT_TYPES   = ['Webinar', 'Workshop', 'Conference', 'Campaign', 'Other'];
const EVENT_STATUSES = ['Upcoming', 'In Progress', 'Completed', 'Cancelled'];

const SUBMIT_LABELS = {
  opportunity: 'Add Opportunity',
  partner:     'Add Partner',
  event:       'Create Event',
};

let panelEl    = null;
let isVisible  = false;
let activeType = 'opportunity';
let cachedPartners = null;

// ── Public API ────────────────────────────────────────────────────

export function initQuickForm() {
  if (panelEl) return;
  panelEl = buildPanel();
  document.body.appendChild(panelEl);
}

export function toggleQuickForm() {
  if (!panelEl) initQuickForm();
  isVisible ? hidePanel() : showPanel();
}

export function isQuickFormVisible() {
  return isVisible;
}

// ── Panel lifecycle ───────────────────────────────────────────────

function showPanel() {
  if (!panelEl) return;
  isVisible = true;
  panelEl.style.display = 'flex';
  positionPanel();

  if (!panelEl.dataset.bound) {
    panelEl.dataset.bound = '1';
    bindEvents();
  }

  // Load partners async, then (re)render current type
  loadPartners().then(() => renderTypeForm(activeType));

  requestAnimationFrame(() => panelEl.classList.add('qf-panel--visible'));
}

export function hidePanel() {
  if (!panelEl) return;
  panelEl.classList.remove('qf-panel--visible');
  isVisible = false;
  setTimeout(() => { if (!isVisible && panelEl) panelEl.style.display = 'none'; }, 200);

  // Reflect toggle state on both Randy buttons
  updateToggleButtons(false);
}

// ── Positioning ───────────────────────────────────────────────────

function positionPanel() {
  const PANEL_WIDTH = 340;
  const GAP = 12;

  // Prefer aligning with the open Randy window
  const randyWin = document.getElementById('randy-window');
  if (randyWin && getComputedStyle(randyWin).display !== 'none') {
    const r = randyWin.getBoundingClientRect();
    const top  = Math.max(20, r.top);
    const left = Math.max(20, r.left - PANEL_WIDTH - GAP);
    panelEl.style.top    = top + 'px';
    panelEl.style.left   = left + 'px';
    panelEl.style.bottom = 'auto';
    panelEl.style.right  = 'auto';
    return;
  }

  // Collapsed state: appear above+left of the avatar button
  const randyBtn = document.getElementById('randy-btn');
  if (randyBtn) {
    const r = randyBtn.getBoundingClientRect();
    panelEl.style.bottom = (window.innerHeight - r.top + GAP) + 'px';
    panelEl.style.right  = (window.innerWidth  - r.right) + 'px';
    panelEl.style.top    = 'auto';
    panelEl.style.left   = 'auto';
    return;
  }

  panelEl.style.bottom = '80px';
  panelEl.style.right  = '20px';
  panelEl.style.top    = 'auto';
  panelEl.style.left   = 'auto';
}

// ── Panel DOM ─────────────────────────────────────────────────────

function buildPanel() {
  const el = document.createElement('div');
  el.className = 'qf-panel';
  el.id = 'qf-panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Quick Add Form');
  el.style.display = 'none';

  el.innerHTML = `
    <div class="qf-header">
      <div class="qf-header__left">
        <svg class="qf-header__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span class="qf-header__title">Quick Add</span>
      </div>
      <button class="qf-close" id="qf-close-btn" aria-label="Close quick add form">&times;</button>
    </div>

    <div class="qf-type-selector" role="tablist" aria-label="Record type">
      <button class="qf-type-btn qf-type-btn--active" data-type="opportunity" role="tab" aria-selected="true">Opportunity</button>
      <button class="qf-type-btn" data-type="partner" role="tab" aria-selected="false">Partner</button>
      <button class="qf-type-btn" data-type="event" role="tab" aria-selected="false">Event</button>
    </div>

    <div class="qf-body" id="qf-body"></div>

    <div class="qf-footer">
      <button class="qf-btn qf-btn--secondary" id="qf-cancel-btn">Cancel</button>
      <button class="qf-btn qf-btn--primary"   id="qf-submit-btn">Add Opportunity</button>
    </div>
  `;

  return el;
}

// ── Event binding ─────────────────────────────────────────────────

function bindEvents() {
  panelEl.querySelector('#qf-close-btn').addEventListener('click',  hidePanel);
  panelEl.querySelector('#qf-cancel-btn').addEventListener('click', hidePanel);
  panelEl.querySelector('#qf-submit-btn').addEventListener('click', handleSubmit);

  panelEl.querySelectorAll('.qf-type-btn').forEach(btn => {
    btn.addEventListener('click', () => switchType(btn.dataset.type));
  });

  document.addEventListener('keydown', onDocKeydown);
}

function onDocKeydown(e) {
  if (e.key === 'Escape' && isVisible) hidePanel();
}

// ── Type switching ────────────────────────────────────────────────

function switchType(type) {
  activeType = type;

  panelEl.querySelectorAll('.qf-type-btn').forEach(btn => {
    const active = btn.dataset.type === type;
    btn.classList.toggle('qf-type-btn--active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const submitBtn = panelEl.querySelector('#qf-submit-btn');
  if (submitBtn) submitBtn.textContent = SUBMIT_LABELS[type] || 'Submit';

  renderTypeForm(type);
}

// ── Data loading ──────────────────────────────────────────────────

async function loadPartners() {
  if (cachedPartners) return;
  try {
    const rows = await readSheetAsObjects(CONFIG.SHEET_PARTNERS);
    cachedPartners = rows.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
  } catch {
    cachedPartners = [];
  }
}

// ── Form rendering ────────────────────────────────────────────────

function renderTypeForm(type) {
  const body = panelEl.querySelector('#qf-body');
  if (!body) return;
  body.innerHTML = '';

  const frag = {
    opportunity: buildOpportunityFields,
    partner:     buildPartnerFields,
    event:       buildEventFields,
  }[type]?.() || document.createDocumentFragment();

  body.appendChild(frag);
}

function buildOpportunityFields() {
  const frag = document.createDocumentFragment();

  frag.appendChild(field('deal_name',     'Deal Name',     'text',   true,  'e.g., Enterprise Cloud Migration'));
  frag.appendChild(field('customer_name', 'Customer Name', 'text',   true,  'e.g., Acme Corp'));
  frag.appendChild(selectField('partner_id', 'Partner', true, [
    { value: '', label: 'Select partner…' },
    ...(cachedPartners || []).map(p => ({ value: p.partner_id, label: p.display_name })),
  ]));

  const row1 = row();
  row1.appendChild(field('deal_value',     'Deal Value ($)',  'number', true, '0'));
  row1.appendChild(field('expected_close', 'Expected Close',  'date',   true));
  frag.appendChild(row1);

  const row2 = row();
  row2.appendChild(selectField('stage', 'Stage', true, [
    { value: '', label: 'Select stage…' },
    ...OPP_STAGES.map(s => ({ value: s, label: s })),
  ]));
  row2.appendChild(selectField('status', 'Status', false,
    OPP_STATUSES.map(s => ({ value: s, label: s })), 'Registered'
  ));
  frag.appendChild(row2);

  return frag;
}

function buildPartnerFields() {
  const frag = document.createDocumentFragment();

  frag.appendChild(field('username',     'Username',     'text', true, 'e.g., nerdio'));
  frag.appendChild(field('display_name', 'Company Name', 'text', true, 'e.g., Nerdio'));

  const row1 = row();
  row1.appendChild(selectField('partner_type', 'Partner Type', true, [
    { value: '', label: 'Select type…' },
    ...PARTNER_TYPES.map(t => ({ value: t, label: t })),
  ]));
  row1.appendChild(selectField('tier', 'Tier', true, [
    { value: '', label: 'Select tier…' },
    ...TIER_OPTIONS.map(t => ({ value: t, label: t })),
  ]));
  frag.appendChild(row1);

  const row2 = row();
  row2.appendChild(field('region', 'Region', 'text', true, 'e.g., North America'));
  row2.appendChild(selectField('status', 'Status', false,
    [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }], 'active'
  ));
  frag.appendChild(row2);

  frag.appendChild(field('hq_location', 'HQ Location', 'text', false, 'e.g., Chicago, Illinois, USA'));

  return frag;
}

function buildEventFields() {
  const frag = document.createDocumentFragment();

  frag.appendChild(field('title', 'Event Name', 'text', true, 'e.g., Q2 Partner Kickoff Webinar'));

  const row1 = row();
  row1.appendChild(field('event_date', 'Start Date', 'date', true));
  row1.appendChild(field('end_date',   'End Date',   'date', false));
  frag.appendChild(row1);

  const row2 = row();
  row2.appendChild(selectField('event_type', 'Type', true, [
    { value: '', label: 'Select type…' },
    ...EVENT_TYPES.map(t => ({ value: t, label: t })),
  ]));
  row2.appendChild(selectField('status', 'Status', false,
    EVENT_STATUSES.map(s => ({ value: s, label: s })), 'Upcoming'
  ));
  frag.appendChild(row2);

  frag.appendChild(selectField('partner_id', 'Assigned Partner', false, [
    { value: '', label: 'All Partners (no specific partner)' },
    ...(cachedPartners || []).map(p => ({ value: p.partner_id, label: p.display_name })),
  ]));

  frag.appendChild(field('location',    'Location',    'text',     false, 'e.g., Virtual (Zoom), San Francisco, CA'));
  frag.appendChild(field('description', 'Description', 'textarea', false, 'Describe the event…'));

  return frag;
}

// ── Field helpers ─────────────────────────────────────────────────

function field(name, label, type, required, placeholder = '') {
  const wrap = document.createElement('div');
  wrap.className = 'qf-field';

  wrap.appendChild(makeLabel(name, label, required));

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'qf-input qf-textarea';
    input.placeholder = placeholder;
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.className = 'qf-input';
    input.type = type;
    input.placeholder = placeholder;
    if (type === 'number') { input.min = '0'; input.step = 'any'; }
  }
  input.id   = `qf-${name}`;
  input.name = name;
  input.dataset.required = required ? 'true' : 'false';

  wrap.appendChild(input);
  wrap.appendChild(errEl(name));
  return wrap;
}

function selectField(name, label, required, options, defaultValue = '') {
  const wrap = document.createElement('div');
  wrap.className = 'qf-field';

  wrap.appendChild(makeLabel(name, label, required));

  const sel = document.createElement('select');
  sel.className = 'qf-input qf-select';
  sel.id   = `qf-${name}`;
  sel.name = name;
  sel.dataset.required = required ? 'true' : 'false';

  options.forEach(({ value, label: lbl }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = lbl;
    sel.appendChild(opt);
  });

  if (defaultValue) sel.value = defaultValue;

  wrap.appendChild(sel);
  wrap.appendChild(errEl(name));
  return wrap;
}

function makeLabel(name, label, required) {
  const lbl = document.createElement('label');
  lbl.className = 'qf-label';
  lbl.htmlFor   = `qf-${name}`;
  lbl.textContent = label;
  if (required) {
    const star = document.createElement('span');
    star.textContent = ' *';
    star.style.color = 'var(--color-danger, #dc2626)';
    lbl.appendChild(star);
  }
  return lbl;
}

function errEl(name) {
  const d = document.createElement('div');
  d.className = 'qf-error';
  d.id = `qf-err-${name}`;
  return d;
}

function row() {
  const d = document.createElement('div');
  d.className = 'qf-row';
  return d;
}

// ── Validation ────────────────────────────────────────────────────

function validate() {
  const body = panelEl.querySelector('#qf-body');
  if (!body) return false;
  let valid = true;

  body.querySelectorAll('.qf-error').forEach(el => { el.textContent = ''; });
  body.querySelectorAll('.qf-input').forEach(el => el.classList.remove('qf-input--error'));

  body.querySelectorAll('[data-required="true"]').forEach(input => {
    if (!input.value.trim()) {
      const lbl = body.querySelector(`label[for="${input.id}"]`);
      const text = lbl ? lbl.textContent.replace(/\s*\*$/, '').trim() : input.name;
      const err  = body.querySelector(`#qf-err-${input.name}`);
      if (err) err.textContent = `${text} is required`;
      input.classList.add('qf-input--error');
      valid = false;
    }
  });

  return valid;
}

// ── Submission ────────────────────────────────────────────────────

function collectData() {
  const data = {};
  panelEl.querySelectorAll('#qf-body [name]').forEach(inp => {
    data[inp.name] = inp.value.trim();
  });
  return data;
}

async function handleSubmit() {
  if (!validate()) return;

  const data      = collectData();
  const submitBtn = panelEl.querySelector('#qf-submit-btn');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Saving…';

  try {
    switch (activeType) {
      case 'opportunity': await submitOpportunity(data); break;
      case 'partner':     await submitPartner(data);     break;
      case 'event':       await submitEvent(data);       break;
    }
    hidePanel();
  } catch (err) {
    showToast(err.message || 'Failed to save. Please try again.', 'error');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = SUBMIT_LABELS[activeType] || 'Submit';
  }
}

async function submitOpportunity(data) {
  const now    = nowISO();
  const oppId  = uuid('opp');
  const values = [
    oppId, data.partner_id, data.deal_name, data.customer_name,
    data.deal_value, data.status || 'Registered', data.stage,
    data.expected_close, '', now, now, '', 'salesperson',
  ];

  if (isConfigured()) {
    await appendRow(CONFIG.SHEET_OPPORTUNITIES, values);
  } else {
    addDemoRow(CONFIG.SHEET_OPPORTUNITIES, values);
  }
  showToast('Opportunity created!', 'success');
}

async function submitPartner(data) {
  const passwordHash = await sha256(CONFIG.DEFAULT_PASSWORD);
  const values = [
    uuid('p'), data.username, data.display_name, data.partner_type,
    data.tier, data.region, nowISO(), 'FALSE', passwordHash,
    data.status || 'active', data.hq_location || '',
  ];

  if (isConfigured()) {
    await appendRow(CONFIG.SHEET_PARTNERS, values);
  } else {
    addDemoRow(CONFIG.SHEET_PARTNERS, values);
  }
  cachedPartners = null; // invalidate so dropdowns refresh next open
  showToast('Partner added!', 'success');
}

async function submitEvent(data) {
  const user   = getCurrentUser();
  const values = [
    uuid('evt'), data.title, data.description || '', data.event_date,
    data.end_date || data.event_date, data.event_type, data.location || '',
    data.url || '', user?.partner_id || '', nowISO(), data.status || 'Upcoming',
    data.partner_id || '', '[]',
  ];

  if (isConfigured()) {
    await appendRow(CONFIG.SHEET_EVENTS, values);
  } else {
    addDemoRow(CONFIG.SHEET_EVENTS, values);
  }
  showToast('Event created!', 'success');
}

// ── Toggle button state helper ────────────────────────────────────
// Called by randy.js to keep both toggle buttons in sync.

function updateToggleButtons(active) {
  ['randy-form-btn', 'randy-form-titlebar-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('randy-form-btn--active', active);
  });
}

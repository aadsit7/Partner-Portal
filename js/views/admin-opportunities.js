// ============================================
// Admin Opportunities Management View
// ============================================

import { getCurrentUser } from '../auth.js';
import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, uuid, $, debounce, formatCurrency } from '../utils/dom.js';
import { nowISO, formatDate } from '../utils/date.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { statCard } from '../components/card.js';
import { filterPartners, filterOpportunities } from '../utils/filters.js';

export const title = 'Opportunities';

let cachedPartners = null;
let cachedOpps = null;
let cachedEvents = null;

const OPP_STAGES = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Closed'];
const OPP_STATUSES = ['Registered', 'In Progress', 'Won', 'Lost'];

export async function render(container) {
  setTopbarTitle('Opportunities');
  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [opportunities, partners, events] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_EVENTS),
    ]);
    cachedPartners = filterPartners(partners);
    cachedOpps = filterOpportunities(opportunities);
    cachedEvents = events;
    renderView(container, cachedOpps);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading opportunities'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function reRender() {
  const viewContainer = document.getElementById('view-container');
  render(viewContainer);
}

function getPartnerName(partnerId) {
  if (!partnerId || !cachedPartners) return '';
  const p = cachedPartners.find(p => p.partner_id === partnerId);
  return p ? p.display_name : partnerId;
}

// ============================================
// Date Range Slider Component
// ============================================

function buildDateRangeSlider(minTs, maxTs, onChange) {
  const DAY = 86400000;
  const formatSliderDate = (ts) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const valuesLabel = el('span', { class: 'date-range-slider__values' },
    `${formatSliderDate(minTs)} — ${formatSliderDate(maxTs)}`
  );

  const fill = el('div', { class: 'date-range-slider__fill' });

  const updateFill = (lo, hi) => {
    const range = maxTs - minTs || 1;
    const leftPct = ((lo - minTs) / range) * 100;
    const rightPct = ((maxTs - hi) / range) * 100;
    fill.style.left = leftPct + '%';
    fill.style.right = rightPct + '%';
  };

  const inputMin = el('input', {
    class: 'date-range-slider__input',
    type: 'range',
    min: String(minTs),
    max: String(maxTs),
    value: String(minTs),
    step: String(DAY),
    style: { zIndex: '3' },
    onInput: () => {
      let lo = Number(inputMin.value);
      const hi = Number(inputMax.value);
      if (lo > hi) { lo = hi; inputMin.value = String(lo); }
      updateFill(lo, hi);
      valuesLabel.textContent = `${formatSliderDate(lo)} — ${formatSliderDate(hi)}`;
      onChange(lo, hi);
    },
  });

  const inputMax = el('input', {
    class: 'date-range-slider__input',
    type: 'range',
    min: String(minTs),
    max: String(maxTs),
    value: String(maxTs),
    step: String(DAY),
    style: { zIndex: '4' },
    onInput: () => {
      const lo = Number(inputMin.value);
      let hi = Number(inputMax.value);
      if (hi < lo) { hi = lo; inputMax.value = String(hi); }
      updateFill(lo, hi);
      valuesLabel.textContent = `${formatSliderDate(lo)} — ${formatSliderDate(hi)}`;
      onChange(lo, hi);
    },
  });

  updateFill(minTs, maxTs);

  return el('div', { class: 'date-range-slider' },
    el('div', { class: 'date-range-slider__header' },
      el('span', { class: 'date-range-slider__label' }, 'Close Date'),
      valuesLabel,
    ),
    el('div', { class: 'date-range-slider__track' },
      fill,
      inputMin,
      inputMax,
    ),
  );
}

// ============================================
// Main View
// ============================================

function renderView(container, opportunities) {
  let activeView = 'board';
  // Compute close-date range for slider
  const closeDates = opportunities
    .map(o => o.expected_close ? new Date(o.expected_close).getTime() : null)
    .filter(Boolean);
  const dateMin = closeDates.length ? Math.min(...closeDates) : Date.now();
  const dateMax = closeDates.length ? Math.max(...closeDates) : Date.now();

  let filters = { search: '', partner: '', status: '', statusExclude: null, dateMin, dateMax };

  function getFiltered() {
    return opportunities.filter(opp => {
      if (filters.partner && opp.partner_id !== filters.partner) return false;
      if (filters.status && opp.status !== filters.status) return false;
      if (filters.statusExclude && filters.statusExclude.includes(opp.status)) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(opp.deal_name?.toLowerCase().includes(q) ||
              opp.customer_name?.toLowerCase().includes(q) ||
              getPartnerName(opp.partner_id)?.toLowerCase().includes(q))) return false;
      }
      if (filters.dateMin != null && filters.dateMax != null && opp.expected_close) {
        const closeTime = new Date(opp.expected_close).getTime();
        if (closeTime < filters.dateMin || closeTime > filters.dateMax) return false;
      }
      return true;
    });
  }

  // Stats
  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const activeDeals = opportunities.filter(o => o.status !== 'Won' && o.status !== 'Lost');

  // Stat card filter toggle
  let activeStatKey = '';
  function toggleStatFilter(key) {
    if (activeStatKey === key) {
      activeStatKey = '';
      filters.status = '';
      filters.statusExclude = null;
    } else {
      activeStatKey = key;
      if (key === 'won') { filters.status = 'Won'; filters.statusExclude = null; }
      else if (key === 'active') { filters.status = ''; filters.statusExclude = ['Won', 'Lost']; }
      else { filters.status = ''; filters.statusExclude = null; }
    }
    statusSelect.value = filters.status;
    updateStatCardStates();
    refreshContent();
  }

  function updateStatCardStates() {
    const cards = document.querySelectorAll('.stats-grid .stat-card');
    const keyMap = ['', 'active', 'won', 'active'];
    cards.forEach((card, i) => {
      card.classList.toggle('stat-card--active', keyMap[i] === activeStatKey && activeStatKey !== '');
    });
  }

  // Filter controls
  const searchInput = el('input', {
    class: 'search-bar__input',
    type: 'text',
    placeholder: 'Search opportunities...',
    onInput: debounce((e) => { filters.search = e.target.value; refreshContent(); }, 200),
  });

  const partnerSelect = el('select', {
    class: 'form-select filter-bar__select',
    onChange: (e) => { filters.partner = e.target.value; refreshContent(); },
  },
    el('option', { value: '' }, 'All Partners'),
    ...(cachedPartners || []).map(p => el('option', { value: p.partner_id }, p.display_name))
  );

  const statusSelect = el('select', {
    class: 'form-select filter-bar__select',
    onChange: (e) => { filters.status = e.target.value; filters.statusExclude = null; activeStatKey = ''; updateStatCardStates(); refreshContent(); },
  },
    el('option', { value: '' }, 'All Statuses'),
    ...OPP_STATUSES.map(s => el('option', { value: s }, s))
  );

  // View toggle
  const boardBtn = el('button', { class: 'btn btn--primary btn--sm', onClick: () => switchView('board') }, 'Board');
  const listBtn = el('button', { class: 'btn btn--secondary btn--sm', onClick: () => switchView('list') }, 'List');

  // Date range slider
  const dateSlider = buildDateRangeSlider(dateMin, dateMax, (min, max) => {
    filters.dateMin = min;
    filters.dateMax = max;
    refreshContent();
  });

  const viewContainer = el('div', { id: 'opps-view-container' });

  const content = el('div', {},
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Opportunities'),
        el('p', { class: 'section-header__subtitle' }, `${opportunities.length} total · ${formatCurrency(totalValue)} pipeline`)
      ),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => openOppModal(null, container),
      },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'New Opportunity'
      ),
    ),

    // Stats (interactive — click to filter)
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Deals', opportunities.length, {
        accentColor: 'var(--color-primary-lighter)',
        onClick: () => toggleStatFilter(''),
      }),
      statCard('Active Pipeline', formatCurrency(totalValue - wonValue), {
        accentColor: 'var(--color-status-in-progress)',
        onClick: () => toggleStatFilter('active'),
      }),
      statCard('Won Revenue', formatCurrency(wonValue), {
        accentColor: 'var(--color-status-won)',
        onClick: () => toggleStatFilter('won'),
      }),
      statCard('Active Deals', activeDeals.length, {
        accentColor: 'var(--color-status-registered)',
        onClick: () => toggleStatFilter('active'),
      })
    ),

    // Filter + view toggle
    el('div', { class: 'filter-section' },
      el('div', { class: 'filter-bar' },
        el('div', { class: 'filter-bar__search' },
          el('span', { class: 'search-bar__icon', html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          searchInput
        ),
        partnerSelect,
        statusSelect,
        el('div', { class: 'view-toggle', style: { marginBottom: '0' } }, boardBtn, listBtn),
      ),
      closeDates.length > 1 ? dateSlider : null,
    ),

    viewContainer,
  );

  mount(container, content);

  function switchView(view) {
    activeView = view;
    boardBtn.className = view === 'board' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';
    listBtn.className = view === 'list' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';
    refreshContent();
  }

  function refreshContent() {
    const filtered = getFiltered();
    viewContainer.innerHTML = '';
    if (activeView === 'board') {
      viewContainer.appendChild(renderBoard(filtered));
    } else {
      viewContainer.appendChild(renderList(filtered));
    }
  }

  refreshContent();
}

// ============================================
// Board View (Kanban by Stage)
// ============================================

function renderBoard(opportunities) {
  const board = el('div', { class: 'kanban' });

  OPP_STAGES.forEach(stage => {
    const stageOpps = opportunities.filter(o => (o.stage || 'Prospect') === stage);
    const stageValue = stageOpps.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);

    const cardsContainer = el('div', { class: 'kanban__cards' });

    stageOpps
      .sort((a, b) => (parseFloat(b.deal_value) || 0) - (parseFloat(a.deal_value) || 0))
      .forEach(opp => {
        const card = createOppCard(opp);
        cardsContainer.appendChild(card);
      });

    const column = el('div', { class: 'kanban__column' },
      el('div', { class: 'kanban__column-header' },
        el('div', {},
          el('span', { class: 'kanban__column-title' }, stage),
          el('div', { class: 'kanban__column-total' }, formatCurrency(stageValue)),
        ),
        el('span', { class: 'kanban__column-count' }, String(stageOpps.length))
      ),
      cardsContainer
    );

    // Drop zone
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('kanban__column--dragover');
    });

    column.addEventListener('dragleave', () => {
      column.classList.remove('kanban__column--dragover');
    });

    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('kanban__column--dragover');
      const oppId = e.dataTransfer.getData('text/plain');
      if (!oppId) return;

      const opp = cachedOpps.find(o => o.opportunity_id === oppId);
      if (!opp || opp.stage === stage) return;

      try {
        const values = [
          opp.opportunity_id, opp.partner_id, opp.deal_name, opp.customer_name,
          opp.deal_value, opp.status, stage, opp.expected_close,
          opp.description, opp.created_at, nowISO(),
          opp.notes || '', opp.lead_source || 'salesperson',
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex, values);
        }

        showToast(`Moved "${opp.deal_name}" to ${stage}`, 'success');
        reRender();
      } catch (err) {
        showToast(err.message || 'Failed to update opportunity', 'error');
      }
    });

    board.appendChild(column);
  });

  return board;
}

function createOppCard(opp) {
  const actions = el('div', { class: 'kanban__card-actions' },
    el('button', {
      class: 'kanban__card-action-btn',
      title: 'Edit',
      onClick: (e) => { e.stopPropagation(); openOppModal(opp, document.getElementById('view-container')); },
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }),
    el('button', {
      class: 'kanban__card-action-btn kanban__card-action-btn--danger',
      title: 'Delete',
      onClick: (e) => { e.stopPropagation(); handleDelete(opp); },
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6v4M8.5 6v4M3 4l.5 8h7l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }),
  );

  const card = el('div', {
    class: 'kanban__card',
    draggable: 'true',
  },
    actions,
    el('div', { class: 'kanban__card-title' }, opp.deal_name),
    el('div', { class: 'kanban__card-subtitle' }, opp.customer_name),
    el('div', { class: 'kanban__card-meta' },
      el('span', { class: `badge badge--${getStatusBadge(opp.status)}` }, opp.status),
      el('span', { class: 'badge badge--admin' }, getPartnerName(opp.partner_id)),
    ),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' } },
      el('div', { class: 'kanban__card-value' }, formatCurrency(parseFloat(opp.deal_value) || 0)),
      opp.expected_close
        ? el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' } }, formatDate(opp.expected_close))
        : null
    ),
    getLeadSourceLabel(opp.lead_source)
  );

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', opp.opportunity_id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.kanban__column--dragover').forEach(col => col.classList.remove('kanban__column--dragover'));
  });

  card.addEventListener('click', () => {
    openOppModal(opp, document.getElementById('view-container'));
  });

  return card;
}

// ============================================
// List View (Table)
// ============================================

function renderList(opportunities) {
  const sorted = [...opportunities].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

  if (sorted.length === 0) {
    return el('div', { class: 'empty-state', style: { marginTop: 'var(--space-8)' } },
      el('div', { class: 'empty-state__title' }, 'No matching opportunities'),
      el('div', { class: 'empty-state__description' }, 'Try adjusting your filters or create a new opportunity.')
    );
  }

  return el('div', { class: 'table-wrapper' },
    el('table', { class: 'table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'Deal'),
          el('th', {}, 'Partner'),
          el('th', {}, 'Value'),
          el('th', {}, 'Stage'),
          el('th', {}, 'Status'),
          el('th', {}, 'Close Date'),
          el('th', {}, 'Actions')
        )
      ),
      el('tbody', {},
        ...sorted.map(opp =>
          el('tr', {},
            el('td', {},
              el('div', { style: { fontWeight: 'var(--font-semibold)' } }, opp.deal_name),
              el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' } }, opp.customer_name)
            ),
            el('td', {}, el('span', { class: 'badge badge--admin' }, getPartnerName(opp.partner_id))),
            el('td', { style: { fontWeight: 'var(--font-semibold)' } }, formatCurrency(parseFloat(opp.deal_value) || 0)),
            el('td', {}, el('span', { class: 'badge badge--silver' }, opp.stage)),
            el('td', {}, el('span', { class: `badge badge--${getStatusBadge(opp.status)}` }, opp.status)),
            el('td', {}, opp.expected_close ? formatDate(opp.expected_close) : '—'),
            el('td', {},
              el('div', { class: 'table__actions' },
                el('button', { class: 'btn btn--ghost btn--sm', onClick: () => openOppModal(opp, document.getElementById('view-container')) }, 'Edit'),
                el('button', { class: 'btn btn--ghost btn--sm', style: { color: 'var(--color-danger)' }, onClick: () => handleDelete(opp) }, 'Delete')
              )
            )
          )
        )
      )
    )
  );
}

// ============================================
// Helpers
// ============================================

function getStatusBadge(status) {
  const map = { 'Registered': 'registered', 'In Progress': 'in-progress', 'Won': 'won', 'Lost': 'lost' };
  return map[status] || 'silver';
}

function getLeadSourceLabel(leadSource) {
  if (!leadSource || leadSource === 'salesperson') return null;
  const evt = (cachedEvents || []).find(e => e.event_id === leadSource);
  if (!evt) return null;
  return el('div', { class: 'kanban__card-lead-source', title: `Lead Source: ${evt.title}` },
    el('svg', { width: '10', height: '10', viewBox: '0 0 10 10', html: '<path d="M5 1v8M1 5l4 4 4-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' }),
    el('span', {}, evt.title)
  );
}

// ============================================
// Opportunity Modal (Create/Edit)
// ============================================

export async function openOppModal(opp, container, onSaved) {
  const isEdit = !!opp;

  // Ensure partners and events are loaded (modal may be opened from other views)
  if (!cachedPartners || !cachedEvents) {
    const [partners, events] = await Promise.all([
      cachedPartners ? Promise.resolve(null) : readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      cachedEvents ? Promise.resolve(null) : readSheetAsObjects(CONFIG.SHEET_EVENTS),
    ]);
    if (partners) cachedPartners = partners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
    if (events) cachedEvents = events;
  }

  // Parse existing notes
  let notes = [];
  if (isEdit && opp.notes) {
    try { notes = JSON.parse(opp.notes); } catch { notes = []; }
  }
  if (!Array.isArray(notes)) notes = [];

  const partnerOptions = (cachedPartners || []).map(p => ({
    value: p.partner_id,
    label: p.display_name,
  }));

  // Build lead source options based on selected partner
  function getLeadSourceOptions(partnerId) {
    const options = [{ value: 'salesperson', label: 'Salesperson Created' }];
    if (!cachedEvents || !partnerId) return options;

    const today = new Date().toISOString().split('T')[0];
    const relevantEvents = cachedEvents.filter(evt => {
      // Include events for this partner or shared events (no partner_id)
      if (evt.partner_id && evt.partner_id !== partnerId) return false;
      // Only past/completed events: status is Completed, or end_date has passed and not Cancelled
      if (evt.status === 'Completed') return true;
      if (evt.status === 'Cancelled') return false;
      const endDate = evt.end_date || evt.event_date;
      if (endDate && endDate < today) return true;
      // Also include In Progress events (campaigns can source leads while running)
      if (evt.status === 'In Progress') return true;
      return false;
    });

    relevantEvents
      .sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''))
      .forEach(evt => {
        const typeLabel = evt.event_type ? `[${evt.event_type}]` : '';
        const dateLabel = evt.event_date ? ` - ${formatDate(evt.event_date)}` : '';
        options.push({
          value: evt.event_id,
          label: `${typeLabel} ${evt.title}${dateLabel}`,
        });
      });

    return options;
  }

  // Initial lead source options
  const initialPartnerId = isEdit ? opp.partner_id : '';
  const leadSourceOptions = getLeadSourceOptions(initialPartnerId);

  const fields = [
    { name: 'deal_name', label: 'Deal Name', required: true, placeholder: 'e.g., Enterprise Cloud Migration' },
    { name: 'customer_name', label: 'Customer Name', required: true, placeholder: 'e.g., Acme Corp' },
    {
      name: 'partner_id', label: 'Partner', type: 'select', required: true,
      placeholder: 'Select partner...',
      options: partnerOptions,
    },
    { type: 'row-start' },
    { name: 'deal_value', label: 'Deal Value ($)', type: 'number', required: true, placeholder: '0', min: 0 },
    { name: 'expected_close', label: 'Expected Close', type: 'date', required: true },
    { type: 'row-end' },
    { type: 'row-start' },
    {
      name: 'stage', label: 'Stage', type: 'select', required: true,
      placeholder: 'Select stage...',
      options: OPP_STAGES,
    },
    {
      name: 'status', label: 'Status', type: 'select',
      default: 'Registered',
      options: OPP_STATUSES,
    },
    { type: 'row-end' },
    {
      name: 'lead_source', label: 'Lead Source', type: 'select',
      options: leadSourceOptions,
    },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Brief description of the opportunity...' },
  ];

  const initialValues = isEdit ? {
    deal_name: opp.deal_name,
    customer_name: opp.customer_name,
    partner_id: opp.partner_id,
    deal_value: opp.deal_value,
    expected_close: opp.expected_close,
    stage: opp.stage,
    status: opp.status,
    lead_source: opp.lead_source || 'salesperson',
    description: opp.description,
  } : { lead_source: 'salesperson' };

  const form = buildForm(fields, async (data) => {
    try {
      const notesJson = JSON.stringify(notes);
      const leadSource = data.lead_source || 'salesperson';

      if (isEdit) {
        const values = [
          opp.opportunity_id, data.partner_id, data.deal_name, data.customer_name,
          data.deal_value, data.status || 'Registered', data.stage,
          data.expected_close, data.description, opp.created_at, nowISO(),
          notesJson, leadSource,
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex, values);
        }
        showToast('Opportunity updated!', 'success');
      } else {
        const values = [
          uuid('opp'), data.partner_id, data.deal_name, data.customer_name,
          data.deal_value, data.status || 'Registered', data.stage,
          data.expected_close, data.description, nowISO(), nowISO(),
          notesJson, leadSource,
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_OPPORTUNITIES, values);
        } else {
          addDemoRow(CONFIG.SHEET_OPPORTUNITIES, values);
        }
        showToast('Opportunity created!', 'success');
      }

      closeModal();
      if (onSaved) { onSaved(); } else { reRender(); }
    } catch (err) {
      showToast(err.message || 'Failed to save opportunity', 'error');
    }
  }, initialValues);

  // When partner changes, rebuild lead source options
  const partnerSelect = form.querySelector('[name="partner_id"]');
  const leadSourceSelect = form.querySelector('[name="lead_source"]');
  if (partnerSelect && leadSourceSelect) {
    partnerSelect.addEventListener('change', () => {
      const newPartnerId = partnerSelect.value;
      const currentLeadSource = leadSourceSelect.value;
      const newOptions = getLeadSourceOptions(newPartnerId);

      // Rebuild lead source dropdown
      leadSourceSelect.innerHTML = '';
      newOptions.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        leadSourceSelect.appendChild(optionEl);
      });

      // Try to preserve current selection, fallback to salesperson
      const stillValid = newOptions.some(o => o.value === currentLeadSource);
      leadSourceSelect.value = stillValid ? currentLeadSource : 'salesperson';
    });
  }

  // If editing, show the linked event name even if it's not in the current dropdown
  if (isEdit && opp.lead_source && opp.lead_source !== 'salesperson' && leadSourceSelect) {
    const existsInOptions = leadSourceOptions.some(o => o.value === opp.lead_source);
    if (!existsInOptions) {
      const linkedEvent = (cachedEvents || []).find(e => e.event_id === opp.lead_source);
      if (linkedEvent) {
        const optionEl = document.createElement('option');
        optionEl.value = linkedEvent.event_id;
        optionEl.textContent = `[${linkedEvent.event_type}] ${linkedEvent.title} - ${formatDate(linkedEvent.event_date)}`;
        leadSourceSelect.appendChild(optionEl);
        leadSourceSelect.value = linkedEvent.event_id;
      }
    }
  }

  // Build notes history section
  const notesSection = buildNotesSection(notes);

  const modalContent = el('div', {}, form, notesSection);

  openModal({
    title: isEdit ? 'Edit Opportunity' : 'New Opportunity',
    content: modalContent,
    footer: [
      el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
      }, isEdit ? 'Save Changes' : 'Create Opportunity'),
    ],
  });
}

// ============================================
// Notes History Section
// ============================================

function formatNoteDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }) + ' \u00B7 ' + d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return isoString;
  }
}

function buildNotesSection(notes) {
  const section = el('div', { class: 'notes-section' },
    el('div', { class: 'notes-section__header' },
      el('h3', { class: 'notes-section__title' }, 'Notes History'),
      el('p', { class: 'notes-section__subtitle' }, 'Track updates and activity for this opportunity')
    ),
  );

  const notesList = el('div', { class: 'notes-list' });

  function rebuildList() {
    notesList.innerHTML = '';

    if (notes.length === 0) {
      notesList.appendChild(
        el('div', { class: 'notes-empty' }, 'No notes yet. Add a note to start tracking activity.')
      );
      return;
    }

    // Display newest first
    [...notes].forEach((note) => {
      notesList.appendChild(
        el('div', { class: 'notes-item' },
          el('div', { class: 'notes-item__date' }, formatNoteDate(note.date)),
          el('div', { class: 'notes-item__text' }, note.text)
        )
      );
    });
  }

  // Add note input
  const noteInput = el('textarea', {
    class: 'notes-input',
    placeholder: 'Add a note...',
    rows: '2',
  });

  const addBtn = el('button', {
    class: 'btn btn--primary btn--sm',
    onClick: () => {
      const text = noteInput.value.trim();
      if (!text) return;
      notes.unshift({ date: nowISO(), text });
      noteInput.value = '';
      rebuildList();
    },
  }, '+ Add Note');

  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addBtn.click();
    }
  });

  section.appendChild(
    el('div', { class: 'notes-add' }, noteInput, addBtn)
  );
  section.appendChild(notesList);

  rebuildList();
  return section;
}

async function handleDelete(opp) {
  const confirmed = await confirmDialog(
    'Delete Opportunity',
    `Are you sure you want to delete "${opp.deal_name}"? This action cannot be undone.`
  );
  if (!confirmed) return;

  try {
    if (isConfigured()) {
      await deleteRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex);
    } else {
      deleteDemoRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex);
    }
    showToast('Opportunity deleted', 'success');
    reRender();
  } catch (err) {
    showToast(err.message || 'Failed to delete opportunity', 'error');
  }
}

export function cleanup() {
  cachedPartners = null;
  cachedOpps = null;
  cachedEvents = null;
}

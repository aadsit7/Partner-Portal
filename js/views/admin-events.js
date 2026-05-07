// ============================================
// Admin Events Management View
// ============================================

import { getCurrentUser } from '../auth.js';
import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, uuid, debounce, formatCurrency } from '../utils/dom.js';
import { nowISO, formatDate, todayISO, parseDate, isDateInRange } from '../utils/date.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { statCard } from '../components/card.js';
import { parseChecklist, renderChecklist } from '../components/checklist.js';
import { filterPartners, filterEvents } from '../utils/filters.js';
import { loadTypeFilter, computeTypeData, buildTypeFilterBar, applyTypeFilter } from '../components/type-filter.js';
import { stripHtml } from '../components/quill-editor.js';
import {
  buildDescriptionsPanel,
  isDescriptionEmpty,
  pickLatestDescriptionText,
  toISODateOnly,
} from '../components/descriptions-panel.js';
import {
  buildDocumentsPanel,
  listEntityDocuments,
} from '../components/documents-panel.js';
import { openOppModal } from './admin-opportunities.js';

export const title = 'Events';

let cachedPartners = null;
let cachedEvents = null;
let cachedOpps = null;
let allBasePartners = null;
let allBaseEvents = null;
let allBaseOpps = null;

const EVENT_STATUSES = ['Upcoming', 'In Progress', 'Completed', 'Cancelled'];
const EVENT_TYPES = ['Webinar', 'Workshop', 'Conference', 'Campaign', 'Other'];

const STATUS_COLORS = {
  'Upcoming': '#0000CC',
  'In Progress': '#00BFFF',
  'Completed': '#0F7A3F',
  'Cancelled': '#CC2222',
};

const TYPE_CHIP_CLASS = {
  'Webinar': 'webinar',
  'Workshop': 'workshop',
  'Conference': 'conference',
  'Campaign': 'campaign',
  'Other': 'other',
};

const TYPE_CHIP_COLORS = {
  'Webinar': '#0000CC',
  'Workshop': '#00BFFF',
  'Conference': '#1A1A2E',
  'Campaign': '#CC8800',
  'Other': '#4A4A5A',
};

export async function render(container) {
  setTopbarTitle('Demand Gen Events');
  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [events, partners, opportunities] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_EVENTS),
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
    ]);
    allBasePartners = filterPartners(partners);
    allBaseEvents = filterEvents(events);
    allBaseOpps = opportunities || [];
    renderWithTypeFilter(container);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading events'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function renderWithTypeFilter(container) {
  const selectedTypes = loadTypeFilter();
  const allTypeData = computeTypeData(allBasePartners, allBaseOpps);
  const allUniqueTypes = Object.keys(allTypeData);
  const allTotalPipeline = allBaseOpps.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const validSelected = selectedTypes.filter(t => allUniqueTypes.includes(t));

  const { partners: tfPartners, events: tfEvents } = applyTypeFilter({
    partners: allBasePartners, events: allBaseEvents, selected: validSelected,
  });
  cachedPartners = tfPartners;
  cachedEvents = tfEvents;
  cachedOpps = allBaseOpps;

  const filterBar = buildTypeFilterBar({
    allUniqueTypes, allTypeData, allTotalPipeline, validSelected,
    onChanged: () => renderWithTypeFilter(container),
  });

  renderView(container, cachedEvents, cachedOpps, filterBar);
}

function reRender() {
  const viewContainer = document.getElementById('view-container');
  renderWithTypeFilter(viewContainer);
}

function getPartnerName(partnerId) {
  if (!partnerId || !cachedPartners) return '';
  const p = cachedPartners.find(p => p.partner_id === partnerId);
  return p ? p.display_name : '';
}

// ============================================
// Revenue by Event Chart
// ============================================

function buildEventRevenueChart(events, opportunities) {
  // Join opportunities to events via lead_source
  const eventRevenue = {};
  for (const opp of opportunities) {
    const src = opp.lead_source;
    if (!src || src === 'salesperson') continue;
    const val = parseFloat(opp.deal_value) || 0;
    if (!eventRevenue[src]) eventRevenue[src] = { total: 0, partnerId: opp.partner_id };
    eventRevenue[src].total += val;
  }

  // Build display data: match event titles
  const data = [];
  for (const [eventId, rev] of Object.entries(eventRevenue)) {
    const evt = events.find(e => e.event_id === eventId);
    const title = evt ? evt.title : eventId;
    const type = evt ? evt.event_type : 'Other';
    const partnerName = getPartnerName(rev.partnerId) || 'Unknown';
    data.push({ title, type, partnerName, total: rev.total });
  }
  data.sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return el('div', { class: 'demandgen-chart' },
      el('div', { class: 'demandgen-chart__title' }, 'Revenue by Event & Partner'),
      el('div', { class: 'demandgen-chart__subtitle' }, 'No event-sourced revenue yet')
    );
  }

  const maxVal = Math.max(...data.map(d => d.total));

  const rows = data.map(d => {
    const pct = maxVal > 0 ? (d.total / maxVal) * 100 : 0;
    const color = TYPE_CHIP_COLORS[d.type] || 'var(--color-primary-lighter)';

    return el('div', { class: 'demandgen-bar-row' },
      el('div', { class: 'demandgen-bar-row__label', title: d.title },
        el('div', { style: { lineHeight: 'var(--leading-tight)' } }, d.title),
        el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'var(--font-normal)' } }, d.partnerName),
      ),
      el('div', { class: 'demandgen-bar-row__bar' },
        el('div', {
          class: 'demandgen-bar-row__segment',
          style: { width: pct + '%', background: color },
        })
      ),
      el('div', { class: 'demandgen-bar-row__value' }, formatCurrency(d.total)),
    );
  });

  return el('div', { class: 'demandgen-chart' },
    el('div', { class: 'demandgen-chart__title' }, 'Revenue by Event & Partner'),
    el('div', { class: 'demandgen-chart__subtitle' }, 'Pipeline generated from demand gen events'),
    el('div', { class: 'demandgen-bar-list' }, ...rows),
  );
}

// ============================================
// Main View
// ============================================

function renderView(container, events, opportunities, filterBar) {
  let activeView = 'list';
  let filters = { search: '', partners: new Set(), type: '', status: '' };

  // Calendar month state — persisted across filter changes and view switches
  const today = new Date();
  let calYear = today.getFullYear();
  let calMonth = today.getMonth();

  function getFiltered() {
    return events.filter(evt => {
      if (filters.partners.size > 0) {
        // If event has no partner, only show if 'all' partners chip includes it
        if (!evt.partner_id && !filters.partners.has('__none__')) return false;
        if (evt.partner_id && !filters.partners.has(evt.partner_id)) return false;
      }
      if (filters.type && evt.event_type !== filters.type) return false;
      if (filters.status && evt.status !== filters.status) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(evt.title?.toLowerCase().includes(q) ||
              evt.description?.toLowerCase().includes(q) ||
              evt.location?.toLowerCase().includes(q) ||
              getPartnerName(evt.partner_id)?.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  // Stats
  const upcoming = events.filter(e => e.status === 'Upcoming').length;
  const inProgress = events.filter(e => e.status === 'In Progress').length;
  const completed = events.filter(e => e.status === 'Completed').length;

  // Stat card filter toggle
  let activeStatFilter = '';
  function toggleStatFilter(status) {
    if (activeStatFilter === status || (status === '' && activeStatFilter === '')) {
      activeStatFilter = '';
      filters.status = '';
    } else if (status === '') {
      activeStatFilter = '';
      filters.status = '';
    } else {
      activeStatFilter = status;
      filters.status = status;
    }
    statusSelect.value = filters.status;
    updateStatCardStates();
    refreshContent();
  }

  function updateStatCardStates() {
    const cards = document.querySelectorAll('.dashboard-top__stats .stat-card');
    const filterMap = ['', 'Upcoming', 'In Progress', 'Completed'];
    cards.forEach((card, i) => {
      card.classList.toggle('stat-card--active', filterMap[i] === activeStatFilter && activeStatFilter !== '');
    });
  }

  // Compute event counts per partner for chips
  const partnerEventCounts = {};
  events.forEach(evt => {
    const pid = evt.partner_id || '__none__';
    partnerEventCounts[pid] = (partnerEventCounts[pid] || 0) + 1;
  });

  // Partner chip filters
  const PARTNER_TYPE_COLORS = {
    'Technology': '#0000CC', 'OEM': '#CC8800',
    'MSP/SI': '#00BFFF', 'MENA Regional Distributor': '#CC2222',
  };

  const chipContainer = el('div', { class: 'partner-chips' });

  // "All" chip
  const allChip = el('button', {
    class: 'partner-chip partner-chip--active',
    onClick: () => {
      filters.partners.clear();
      updateChipStates();
      refreshContent();
    },
  },
    el('span', { class: 'partner-chip__name' }, 'All Partners'),
    el('span', { class: 'partner-chip__count' }, String(events.length))
  );
  allChip.dataset.partnerId = '__all__';
  chipContainer.appendChild(allChip);

  // Per-partner chips
  const partnerChips = [];
  (cachedPartners || []).forEach(p => {
    const count = partnerEventCounts[p.partner_id] || 0;
    if (count === 0) return; // Only show partners with events
    const color = PARTNER_TYPE_COLORS[p.partner_type] || '#9B9A9B';
    const chip = el('button', {
      class: 'partner-chip',
      onClick: () => {
        if (filters.partners.has(p.partner_id)) {
          filters.partners.delete(p.partner_id);
        } else {
          filters.partners.add(p.partner_id);
        }
        updateChipStates();
        refreshContent();
      },
    },
      el('span', { class: 'partner-chip__dot', style: { background: color } }),
      el('span', { class: 'partner-chip__name' }, p.display_name),
      el('span', { class: 'partner-chip__count' }, String(count))
    );
    chip.dataset.partnerId = p.partner_id;
    partnerChips.push(chip);
    chipContainer.appendChild(chip);
  });

  // "No Partner" chip if any events have no partner
  if (partnerEventCounts['__none__']) {
    const noneChip = el('button', {
      class: 'partner-chip',
      onClick: () => {
        if (filters.partners.has('__none__')) {
          filters.partners.delete('__none__');
        } else {
          filters.partners.add('__none__');
        }
        updateChipStates();
        refreshContent();
      },
    },
      el('span', { class: 'partner-chip__name' }, 'All Partners (shared)'),
      el('span', { class: 'partner-chip__count' }, String(partnerEventCounts['__none__']))
    );
    noneChip.dataset.partnerId = '__none__';
    partnerChips.push(noneChip);
    chipContainer.appendChild(noneChip);
  }

  function updateChipStates() {
    const isAll = filters.partners.size === 0;
    allChip.classList.toggle('partner-chip--active', isAll);
    partnerChips.forEach(chip => {
      chip.classList.toggle('partner-chip--active', filters.partners.has(chip.dataset.partnerId));
    });
  }

  // Filter controls
  const searchInput = el('input', {
    class: 'search-bar__input',
    type: 'text',
    placeholder: 'Search events...',
    onInput: debounce((e) => { filters.search = e.target.value; refreshContent(); }, 200),
  });

  const typeSelect = el('select', {
    class: 'form-select filter-bar__select',
    onChange: (e) => { filters.type = e.target.value; refreshContent(); },
  },
    el('option', { value: '' }, 'All Types'),
    ...EVENT_TYPES.map(t => el('option', { value: t }, t))
  );

  const statusSelect = el('select', {
    class: 'form-select filter-bar__select',
    onChange: (e) => { filters.status = e.target.value; activeStatFilter = e.target.value; updateStatCardStates(); refreshContent(); },
  },
    el('option', { value: '' }, 'All Statuses'),
    ...EVENT_STATUSES.map(s => el('option', { value: s }, s))
  );

  // View toggle buttons
  const boardBtn = el('button', { class: 'btn btn--secondary btn--sm', onClick: () => switchView('board') }, 'Board');
  const calendarBtn = el('button', { class: 'btn btn--secondary btn--sm', onClick: () => switchView('calendar') }, 'Calendar');
  const listBtn = el('button', { class: 'btn btn--primary btn--sm', onClick: () => switchView('list') }, 'List');

  const viewContainer = el('div', { id: 'events-view-container' });

  const content = el('div', {},
    filterBar,
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Demand Gen Events'),
        el('p', { class: 'section-header__subtitle' }, `${events.length} events`)
      ),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => openEventModal(null, container),
      },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'New Event'
      ),
    ),

    // Dashboard top: 2×2 stat cards left, Revenue by Event chart right
    el('div', { class: 'dashboard-top' },
      el('div', { class: 'dashboard-top__stats stagger' },
        statCard('Total Events', events.length, {
          accentColor: 'var(--color-primary-lighter)',
          onClick: () => toggleStatFilter(''),
        }),
        statCard('Upcoming', upcoming, {
          accentColor: 'var(--color-status-registered)',
          onClick: () => toggleStatFilter('Upcoming'),
        }),
        statCard('In Progress', inProgress, {
          accentColor: 'var(--color-status-in-progress)',
          onClick: () => toggleStatFilter('In Progress'),
        }),
        statCard('Completed', completed, {
          accentColor: 'var(--color-status-won)',
          onClick: () => toggleStatFilter('Completed'),
        }),
      ),
      el('div', { class: 'dashboard-top__chart' },
        buildEventRevenueChart(events, opportunities),
      ),
    ),

    // Partner chip filters
    chipContainer,

    // Filters + view toggle
    el('div', { class: 'filter-bar' },
      el('div', { class: 'filter-bar__search' },
        el('span', { class: 'search-bar__icon', html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        searchInput
      ),
      typeSelect,
      statusSelect,
      el('div', { class: 'view-toggle', style: { marginBottom: '0' } }, boardBtn, calendarBtn, listBtn),
    ),

    viewContainer,
  );

  mount(container, content);

  function switchView(view) {
    activeView = view;
    [boardBtn, calendarBtn, listBtn].forEach(btn => btn.className = 'btn btn--secondary btn--sm');
    if (view === 'board') boardBtn.className = 'btn btn--primary btn--sm';
    else if (view === 'calendar') calendarBtn.className = 'btn btn--primary btn--sm';
    else listBtn.className = 'btn btn--primary btn--sm';
    refreshContent();
  }

  function refreshContent() {
    const filtered = getFiltered();
    viewContainer.innerHTML = '';
    if (activeView === 'board') {
      viewContainer.appendChild(renderBoard(filtered));
    } else if (activeView === 'calendar') {
      viewContainer.appendChild(renderCalendar(filtered, calYear, calMonth, (y, m) => { calYear = y; calMonth = m; }));
    } else {
      viewContainer.appendChild(renderList(filtered));
    }
  }

  refreshContent();
}

// ============================================
// Board View (Kanban)
// ============================================

function renderBoard(events) {
  const board = el('div', { class: 'kanban' });

  EVENT_STATUSES.forEach(status => {
    const columnEvents = events.filter(e => (e.status || 'Upcoming') === status);
    const color = STATUS_COLORS[status] || '#9B9A9B';

    const cardsContainer = el('div', { class: 'kanban__cards' });

    columnEvents
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
      .forEach(evt => {
        const card = createEventCard(evt);
        cardsContainer.appendChild(card);
      });

    const column = el('div', { class: 'kanban__column' },
      el('div', { class: 'kanban__column-header' },
        el('div', {},
          el('span', { class: 'kanban__column-title', style: { color } }, status),
        ),
        el('span', { class: 'kanban__column-count' }, String(columnEvents.length))
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
      const eventId = e.dataTransfer.getData('text/plain');
      if (!eventId) return;

      const evt = cachedEvents.find(ev => ev.event_id === eventId);
      if (!evt || evt.status === status) return;

      try {
        const values = [
          evt.event_id, evt.title, evt.description, evt.event_date,
          evt.end_date || evt.event_date, evt.event_type, evt.location,
          evt.url, evt.created_by, evt.created_at, status, evt.partner_id || '',
          evt.checklist || '',
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_EVENTS, evt._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_EVENTS, evt._rowIndex, values);
        }

        showToast(`Moved "${evt.title}" to ${status}`, 'success');
        reRender();
      } catch (err) {
        showToast(err.message || 'Failed to update event', 'error');
      }
    });

    board.appendChild(column);
  });

  return board;
}

function createEventCard(evt) {
  // Checklist progress
  const checklistItems = parseChecklist(evt.checklist, evt.event_type);
  const doneCount = checklistItems.filter(i => i.done).length;
  const totalTasks = checklistItems.length;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  const actions = el('div', { class: 'kanban__card-actions' },
    el('button', {
      class: 'kanban__card-action-btn',
      title: 'Edit',
      onClick: (e) => { e.stopPropagation(); openEventModal(evt, document.getElementById('view-container')); },
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }),
    el('button', {
      class: 'kanban__card-action-btn kanban__card-action-btn--danger',
      title: 'Delete',
      onClick: (e) => { e.stopPropagation(); handleDelete(evt); },
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6v4M8.5 6v4M3 4l.5 8h7l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }),
  );

  const card = el('div', {
    class: 'kanban__card',
    draggable: 'true',
  },
    actions,
    el('div', { class: 'kanban__card-title' }, evt.title),
    el('div', { class: 'kanban__card-subtitle' },
      formatDate(evt.event_date) +
      (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : '')
    ),
    el('div', { class: 'kanban__card-meta' },
      el('span', { class: `badge badge--${getTypeBadge(evt.event_type)}` }, evt.event_type),
      evt.partner_id
        ? el('span', { class: 'badge badge--admin' }, getPartnerName(evt.partner_id) || evt.partner_id)
        : el('span', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' } }, 'All Partners'),
    ),
    evt.location
      ? el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' } }, evt.location)
      : null,
    // Checklist progress mini-bar
    totalTasks > 0
      ? el('div', { class: 'kanban__card-checklist', title: `${doneCount}/${totalTasks} tasks complete` },
          el('svg', { width: '12', height: '12', viewBox: '0 0 12 12', html: '<path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' }),
          el('span', { class: 'kanban__card-checklist-text' }, `${doneCount}/${totalTasks}`),
          el('div', { class: 'kanban__card-checklist-bar' },
            el('div', { class: 'kanban__card-checklist-fill', style: { width: `${pct}%` } })
          )
        )
      : null
  );

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', evt.event_id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    // Remove all dragover indicators
    document.querySelectorAll('.kanban__column--dragover').forEach(col => col.classList.remove('kanban__column--dragover'));
  });

  card.addEventListener('click', () => {
    openEventModal(evt, document.getElementById('view-container'));
  });

  return card;
}

// ============================================
// Calendar View
// ============================================

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function renderCalendar(events, year, month, setMonth) {
  const today = new Date();
  let currentYear = year;
  let currentMonth = month;

  const wrapper = el('div');

  function navigate(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    setMonth(currentYear, currentMonth);
    buildCalendar();
  }

  function goToday() {
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    setMonth(currentYear, currentMonth);
    buildCalendar();
  }

  function buildCalendar() {
    wrapper.innerHTML = '';

    const dayCells = buildDayCells(currentYear, currentMonth, events, today);
    const hasEvents = dayCells.some(cell => cell.dataset.eventCount > 0);

    // Type legend
    const legend = el('div', { class: 'calendar__legend' },
      ...Object.entries(TYPE_CHIP_COLORS).map(([type, color]) =>
        el('div', { class: 'calendar__legend-item' },
          el('span', { class: 'calendar__legend-dot', style: { background: color } }),
          el('span', { class: 'calendar__legend-label' }, type)
        )
      )
    );

    const calendar = el('div', { class: 'calendar' },
      // Header
      el('div', { class: 'calendar__header' },
        el('div', { class: 'calendar__nav' },
          el('button', { class: 'calendar__nav-btn', onClick: () => navigate(-1), html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L4 7l5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
          el('button', { class: 'calendar__nav-btn', onClick: goToday }, 'Today'),
          el('button', { class: 'calendar__nav-btn', onClick: () => navigate(1), html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l5 4-5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
        ),
        el('div', { class: 'calendar__title' }, `${MONTH_NAMES[currentMonth]} ${currentYear}`),
        legend
      ),
      // Grid
      el('div', { class: 'calendar__grid' },
        ...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d =>
          el('div', { class: 'calendar__day-header' }, d)
        ),
        ...dayCells
      )
    );

    wrapper.appendChild(calendar);

    // Empty month message
    if (!hasEvents) {
      wrapper.appendChild(
        el('div', { class: 'calendar__empty-msg' },
          `No events match your filters for ${MONTH_NAMES[currentMonth]} ${currentYear}`
        )
      );
    }
  }

  buildCalendar();
  return wrapper;
}

function buildDayCells(year, month, events, today) {
  const cells = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Previous month padding
  const prevMonth = new Date(year, month, 0);
  for (let i = startDow - 1; i >= 0; i--) {
    const day = prevMonth.getDate() - i;
    const cell = createDayCell(day, true, [], false);
    cell.dataset.eventCount = '0';
    cells.push(cell);
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const isCurrentToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const dayDate = new Date(year, month, d);

    // Find events on this day using proper date parsing
    const dayEvents = events.filter(evt => {
      const start = parseDate(evt.event_date);
      if (!start) return false;
      const end = evt.end_date ? parseDate(evt.end_date) : start;
      return isDateInRange(dayDate, start, end);
    });

    const cell = createDayCell(d, false, dayEvents, isCurrentToday);
    cell.dataset.eventCount = String(dayEvents.length);
    cells.push(cell);
  }

  // Next month padding
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      const cell = createDayCell(i, true, [], false);
      cell.dataset.eventCount = '0';
      cells.push(cell);
    }
  }

  return cells;
}

function createDayCell(dayNum, isOtherMonth, dayEvents, isToday) {
  const classes = ['calendar__day'];
  if (isOtherMonth) classes.push('calendar__day--other-month');
  if (isToday) classes.push('calendar__day--today');

  const chips = dayEvents.slice(0, 4).map(evt => {
    const typeClass = TYPE_CHIP_CLASS[evt.event_type] || 'other';
    const statusColor = STATUS_COLORS[evt.status] || '#9B9A9B';
    const partnerName = getPartnerName(evt.partner_id);

    // Rich tooltip
    const tooltipParts = [evt.title];
    if (evt.event_date) {
      let dateRange = formatDate(evt.event_date);
      if (evt.end_date && evt.end_date !== evt.event_date) dateRange += ` — ${formatDate(evt.end_date)}`;
      tooltipParts.push(dateRange);
    }
    if (evt.event_type) tooltipParts.push(`Type: ${evt.event_type}`);
    if (evt.status) tooltipParts.push(`Status: ${evt.status}`);
    if (partnerName) tooltipParts.push(`Partner: ${partnerName}`);
    if (evt.location) tooltipParts.push(`Location: ${evt.location}`);

    const chipLabel = partnerName
      ? `${evt.title} · ${partnerName}`
      : evt.title;

    return el('div', {
      class: `calendar__event-chip calendar__event-chip--${typeClass}`,
      style: { borderLeftColor: statusColor },
      title: tooltipParts.join('\n'),
      onClick: (e) => {
        e.stopPropagation();
        openEventModal(evt, document.getElementById('view-container'));
      },
    }, chipLabel);
  });

  if (dayEvents.length > 4) {
    chips.push(el('div', {
      class: 'calendar__more-events',
    }, `+${dayEvents.length - 4} more`));
  }

  return el('div', { class: classes.join(' ') },
    el('div', { class: 'calendar__day-num' }, String(dayNum)),
    ...chips
  );
}

// ============================================
// List View (Enhanced Table)
// ============================================

function renderList(events) {
  const sorted = [...events].sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  if (sorted.length === 0) {
    return el('div', { class: 'empty-state', style: { marginTop: 'var(--space-8)' } },
      el('div', { class: 'empty-state__title' }, 'No matching events'),
      el('div', { class: 'empty-state__description' }, 'Try adjusting your filters or create a new event.')
    );
  }

  return el('div', { class: 'table-wrapper' },
    el('table', { class: 'table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'Event'),
          el('th', {}, 'Date'),
          el('th', {}, 'Type'),
          el('th', {}, 'Status'),
          el('th', {}, 'Partner'),
          el('th', {}, 'Location'),
          el('th', {}, 'Actions')
        )
      ),
      el('tbody', {},
        ...sorted.map(evt =>
          el('tr', {
            style: { cursor: 'pointer' },
            onClick: () => openEventModal(evt, document.getElementById('view-container')),
          },
            el('td', {},
              el('div', { style: { fontWeight: 'var(--font-semibold)' } }, evt.title),
              el('div', {
                style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
              }, evt.description)
            ),
            el('td', {},
              formatDate(evt.event_date),
              evt.end_date && evt.end_date !== evt.event_date
                ? el('span', { style: { color: 'var(--color-text-muted)' } }, ` — ${formatDate(evt.end_date)}`)
                : null
            ),
            el('td', {}, el('span', { class: `badge badge--${getTypeBadge(evt.event_type)}` }, evt.event_type)),
            el('td', {}, el('span', { class: `badge badge--${getStatusBadge(evt.status)}` }, evt.status || 'Upcoming')),
            el('td', {},
              evt.partner_id
                ? el('span', { class: 'badge badge--admin' }, getPartnerName(evt.partner_id) || evt.partner_id)
                : el('span', { style: { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' } }, 'All Partners')
            ),
            el('td', {}, evt.location || '—'),
            el('td', {},
              el('div', { class: 'table__actions' },
                el('button', {
                  class: 'btn btn--ghost btn--sm',
                  onClick: (e) => { e.stopPropagation(); openEventModal(evt, document.getElementById('view-container')); },
                }, 'Edit'),
                el('button', {
                  class: 'btn btn--ghost btn--sm',
                  style: { color: 'var(--color-danger)' },
                  onClick: (e) => { e.stopPropagation(); handleDelete(evt); },
                }, 'Delete')
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

function getTypeBadge(type) {
  const map = { Webinar: 'registered', Workshop: 'won', Conference: 'admin', Campaign: 'in-progress', Other: 'silver' };
  return map[type] || 'silver';
}

function getStatusBadge(status) {
  const map = { 'Upcoming': 'registered', 'In Progress': 'in-progress', 'Completed': 'won', 'Cancelled': 'lost' };
  return map[status] || 'registered';
}

// ============================================
// Event Modal (Create/Edit)
// ============================================

export async function openEventModal(event, container, onSaved) {
  const isEdit = !!event;

  // Always refresh the opportunities list so the "Sourced Opportunities"
  // rollup picks up any opps that were tagged to this event since the
  // page was last rendered. Partners are loaded only when missing.
  const [partnersFresh, oppsFresh] = await Promise.all([
    cachedPartners ? Promise.resolve(null) : readSheetAsObjects(CONFIG.SHEET_PARTNERS),
    readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
  ]);
  if (partnersFresh) {
    cachedPartners = partnersFresh.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
  }
  cachedOpps = oppsFresh;

  // Compute opportunities sourced from this event (lead_source links opp → event_id).
  const linkedOpps = isEdit
    ? (cachedOpps || []).filter(o => o.lead_source === event.event_id)
    : [];
  const totalPipeline = linkedOpps.reduce(
    (sum, o) => sum + (parseFloat(o.deal_value) || 0),
    0,
  );

  // Load existing descriptions + documents in parallel when editing.
  // Failures are tolerated (e.g. the Event_Descriptions sheet may not
  // exist yet on a fresh install) — empty list on failure.
  let workingDescriptions = [];
  let initialDocuments = [];
  if (isEdit) {
    const [descResult, docsResult] = await Promise.allSettled([
      readSheetAsObjects(CONFIG.SHEET_EVENT_DESCRIPTIONS),
      listEntityDocuments(event.event_id),
    ]);

    if (descResult.status === 'fulfilled') {
      workingDescriptions = descResult.value
        .filter(d => d.event_id === event.event_id)
        .map(d => ({ ...d }))
        .sort((a, b) => new Date(b.description_date || b.created_at) - new Date(a.description_date || a.created_at));
    } else {
      console.warn('Failed to load event descriptions', descResult.reason);
    }

    if (docsResult.status === 'fulfilled') {
      initialDocuments = docsResult.value;
    } else {
      console.warn('Failed to load event documents', docsResult.reason);
    }

    // Legacy migration: if no separate description records exist but the
    // event row still has a description, surface it as a pending
    // first-version card. Saving the modal will persist it to the new sheet.
    if (workingDescriptions.length === 0 && event.description) {
      workingDescriptions.push({
        _tempId: `tmp_${uuid('dsc')}`,
        _isNew: true,
        event_id: event.event_id,
        title: event.title,
        description_date: toISODateOnly(event.created_at) || todayISO(),
        description_text: event.description,
        created_at: event.created_at || nowISO(),
      });
    }
  }

  // Parse or initialize checklist
  let checklistItems = parseChecklist(
    isEdit ? event.checklist : null,
    isEdit ? event.event_type : 'Other'
  );

  const partnerOptions = [
    { value: '', label: 'All Partners (no specific partner)' },
    ...(cachedPartners || []).map(p => ({ value: p.partner_id, label: p.display_name })),
  ];

  const fields = [
    { name: 'title', label: 'Event Name', required: true, placeholder: 'e.g., Q2 Partner Kickoff Webinar' },
    { type: 'row-start' },
    { name: 'event_date', label: 'Start Date', type: 'date', required: true },
    { name: 'end_date', label: 'End Date', type: 'date' },
    { type: 'row-end' },
    { type: 'row-start' },
    {
      name: 'event_type', label: 'Type', type: 'select', required: true,
      placeholder: 'Select type...',
      options: EVENT_TYPES,
    },
    {
      name: 'status', label: 'Status', type: 'select',
      default: 'Upcoming',
      options: EVENT_STATUSES,
    },
    { type: 'row-end' },
    {
      name: 'partner_id', label: 'Assigned Partner', type: 'select',
      options: partnerOptions,
    },
    { name: 'location', label: 'Location', placeholder: 'e.g., Virtual (Zoom), San Francisco, CA' },
    { name: 'url', label: 'Event URL', type: 'url', placeholder: 'https://...' },
  ];

  const initialValues = isEdit ? {
    title: event.title,
    event_date: event.event_date,
    end_date: event.end_date,
    event_type: event.event_type,
    status: event.status || 'Upcoming',
    partner_id: event.partner_id || '',
    location: event.location,
    url: event.url,
  } : {};

  // Build the checklist UI
  const checklistSection = el('div', { class: 'checklist-section' },
    el('div', { class: 'checklist-section__header' },
      el('h3', { class: 'checklist-section__title' }, 'Event Checklist'),
      el('p', { class: 'checklist-section__subtitle' }, 'Track tasks for this event')
    ),
  );

  const checklistWidget = renderChecklist(checklistItems, (updatedItems) => {
    checklistItems = updatedItems;
    // Auto-save checklist if editing existing event
    if (isEdit) {
      const checklistJson = JSON.stringify(checklistItems);
      const values = [
        event.event_id, event.title, event.description, event.event_date,
        event.end_date || event.event_date, event.event_type, event.location,
        event.url, event.created_by, event.created_at, event.status || 'Upcoming',
        event.partner_id || '', checklistJson,
      ];
      if (isConfigured()) {
        updateRow(CONFIG.SHEET_EVENTS, event._rowIndex, values).catch(() => {});
      } else {
        updateDemoRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
      }
    }
  });
  checklistSection.appendChild(checklistWidget);

  // Guard against rapid double-clicks dispatching two submit events
  // before the first appendRow / updateRow resolves. Without this a fast
  // user could create the same event twice on a slow connection.
  let saving = false;
  const form = buildForm(fields, async (data) => {
    if (saving) return;
    saving = true;
    try {
      const user = getCurrentUser();
      const checklistJson = JSON.stringify(checklistItems);

      // Denormalize the most recent description (plain text) onto the
      // event row so list-view previews and search keep working.
      const latestDescHtml = pickLatestDescriptionText(workingDescriptions);
      const latestDescPlain = stripHtml(latestDescHtml || '').trim();

      let eventId;
      let createdAt;

      if (isEdit) {
        eventId = event.event_id;
        createdAt = event.created_at;

        const values = [
          eventId, data.title, latestDescPlain, data.event_date,
          data.end_date || data.event_date, data.event_type, data.location,
          data.url, event.created_by, createdAt, data.status || 'Upcoming',
          data.partner_id || '', checklistJson,
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
        }
      } else {
        eventId = uuid('evt');
        createdAt = nowISO();

        const values = [
          eventId, data.title, latestDescPlain, data.event_date,
          data.end_date || data.event_date, data.event_type, data.location,
          data.url, user.partner_id, createdAt, data.status || 'Upcoming',
          data.partner_id || '', checklistJson,
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_EVENTS, values);
        } else {
          addDemoRow(CONFIG.SHEET_EVENTS, values);
        }
      }

      // Persist description changes to SHEET_EVENT_DESCRIPTIONS.
      // Process deletes before inserts so row indices stay valid when
      // deleting the highest-index rows first.
      const toDelete = workingDescriptions
        .filter(d => d._deleted && d.description_id && d._rowIndex)
        .sort((a, b) => b._rowIndex - a._rowIndex);
      for (const d of toDelete) {
        if (isConfigured()) {
          await deleteRow(CONFIG.SHEET_EVENT_DESCRIPTIONS, d._rowIndex);
        } else {
          deleteDemoRow(CONFIG.SHEET_EVENT_DESCRIPTIONS, d._rowIndex);
        }
      }

      // Skip updates that would blank out an existing row.
      const toUpdate = workingDescriptions.filter(d =>
        !d._deleted && !d._isNew && d._modified && !isDescriptionEmpty(d)
      );
      for (const d of toUpdate) {
        const values = [
          d.description_id, eventId, data.title,
          d.description_date, d.description_text, d.created_at,
        ];
        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_EVENT_DESCRIPTIONS, d._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_EVENT_DESCRIPTIONS, d._rowIndex, values);
        }
      }

      // Skip brand-new cards where the user never actually typed anything.
      const toInsert = workingDescriptions.filter(d =>
        !d._deleted && d._isNew && !isDescriptionEmpty(d)
      );
      for (const d of toInsert) {
        const descriptionId = uuid('dsc');
        const values = [
          descriptionId, eventId, data.title,
          d.description_date, d.description_text, d.created_at || nowISO(),
        ];
        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_EVENT_DESCRIPTIONS, values);
        } else {
          addDemoRow(CONFIG.SHEET_EVENT_DESCRIPTIONS, values);
        }
      }

      showToast(isEdit ? 'Event updated successfully!' : 'Event created successfully!', 'success');
      closeModal();
      if (onSaved) { onSaved(); } else { reRender(); }
    } catch (err) {
      showToast(err.message || 'Failed to save event', 'error');
    } finally {
      saving = false;
    }
  }, initialValues);

  // Descriptions panel — versioned dated cards (Quill editor in edit mode)
  const { panel: descriptionsPanel } = buildDescriptionsPanel(workingDescriptions, {
    placeholder: 'Write the description for this event...',
    entityLabel: 'event',
  });

  // Documents panel — drag-and-drop uploads to Google Drive via the file API.
  // For new (unsaved) events there's no event_id to attach to yet, so the
  // upload zone is hidden with a helper note.
  const docsHandle = buildDocumentsPanel({
    entityId: isEdit ? event.event_id : null,
    getContextName: () => {
      const input = form.querySelector('[name="title"]');
      return (input && input.value) || (isEdit ? (event.title || '') : '');
    },
    initialFiles: initialDocuments,
    savePrompt: 'Save this event first to attach documents',
  });

  // Sourced opportunities summary — shown only for existing events. New
  // events have no event_id yet, so nothing can be linked to them.
  const sourcedOppsSection = isEdit
    ? buildSourcedOppsSection(linkedOpps, totalPipeline)
    : null;

  // Combine sections in modal content. The opportunities rollup sits at
  // the top so users see pipeline impact before anything else.
  const modalContent = el('div', {},
    sourcedOppsSection,
    form,
    descriptionsPanel,
    docsHandle.panel,
    checklistSection,
  );

  openModal({
    title: isEdit ? 'Edit Event' : 'New Demand Gen Event',
    content: modalContent,
    className: 'modal--xwide',
    footer: [
      el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
      }, isEdit ? 'Save Changes' : 'Create Event'),
    ],
  });
}

/**
 * Build the "Sourced Opportunities" panel that sits at the top of the
 * Edit Event modal: a count + total pipeline summary, and a clickable
 * list of the linked opportunities (clicking switches to the opp modal).
 */
function buildSourcedOppsSection(linkedOpps, totalPipeline) {
  const sorted = [...linkedOpps].sort(
    (a, b) => (parseFloat(b.deal_value) || 0) - (parseFloat(a.deal_value) || 0),
  );

  const stats = el('div', { class: 'event-opps-stats' },
    el('div', { class: 'event-opps-stats__metric' },
      el('div', { class: 'event-opps-stats__value' }, String(linkedOpps.length)),
      el('div', { class: 'event-opps-stats__label' },
        linkedOpps.length === 1 ? 'Opportunity' : 'Opportunities',
      ),
    ),
    el('div', { class: 'event-opps-stats__metric' },
      el('div', { class: 'event-opps-stats__value' }, formatCurrency(totalPipeline)),
      el('div', { class: 'event-opps-stats__label' }, 'Total Pipeline'),
    ),
  );

  const chevronSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l5 4-5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let listEl;
  if (sorted.length === 0) {
    listEl = el('div', { class: 'event-opps-empty' },
      'No opportunities sourced from this event yet.',
    );
  } else {
    listEl = el('div', { class: 'event-opps-list' },
      ...sorted.map(opp => {
        const statusClass = (opp.status || 'Registered')
          .toLowerCase()
          .replace(/\s+/g, '-');
        return el('button', {
          type: 'button',
          class: 'event-opp-row',
          onClick: () => openOppModal(opp, document.getElementById('view-container')),
        },
          el('div', { class: 'event-opp-row__main' },
            el('div', { class: 'event-opp-row__name' }, opp.deal_name || 'Untitled deal'),
            el('div', { class: 'event-opp-row__sub' },
              el('span', {}, opp.customer_name || '—'),
              el('span', { class: 'event-opp-row__dot' }, '·'),
              el('span', {}, opp.stage || '—'),
            ),
          ),
          el('div', { class: 'event-opp-row__right' },
            el('span', { class: 'event-opp-row__value' },
              formatCurrency(parseFloat(opp.deal_value) || 0),
            ),
            el('span', { class: `badge badge--${statusClass}` }, opp.status || 'Registered'),
          ),
          el('span', { class: 'event-opp-row__chevron', html: chevronSvg }),
        );
      }),
    );
  }

  return el('div', { class: 'event-opps-section' },
    el('h3', { class: 'event-opps-section__title' }, 'Sourced Opportunities'),
    stats,
    listEl,
  );
}

async function handleDelete(event) {
  const confirmed = await confirmDialog(
    'Delete Event',
    `Are you sure you want to delete "${event.title}"? This action cannot be undone.`
  );
  if (!confirmed) return;

  try {
    if (isConfigured()) {
      await deleteRow(CONFIG.SHEET_EVENTS, event._rowIndex);
    } else {
      deleteDemoRow(CONFIG.SHEET_EVENTS, event._rowIndex);
    }
    showToast('Event deleted', 'success');
    reRender();
  } catch (err) {
    showToast(err.message || 'Failed to delete event', 'error');
  }
}

export function cleanup() {
  cachedPartners = null;
  cachedEvents = null;
}

// ============================================
// Admin Events Management View
// ============================================

import { getCurrentUser } from '../auth.js';
import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, uuid, $, debounce } from '../utils/dom.js';
import { nowISO, formatDate } from '../utils/date.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { statCard } from '../components/card.js';

export const title = 'Events';

let cachedPartners = null;
let cachedEvents = null;

const EVENT_STATUSES = ['Upcoming', 'In Progress', 'Completed', 'Cancelled'];
const EVENT_TYPES = ['Webinar', 'Workshop', 'Conference', 'Campaign', 'Other'];

const STATUS_COLORS = {
  'Upcoming': '#0e8ab5',
  'In Progress': '#b88a0e',
  'Completed': '#1a8a5a',
  'Cancelled': '#c41650',
};

const TYPE_CHIP_CLASS = {
  'Webinar': 'webinar',
  'Workshop': 'workshop',
  'Conference': 'conference',
  'Campaign': 'campaign',
  'Other': 'other',
};

const TYPE_CHIP_COLORS = {
  'Webinar': '#0e8ab5',
  'Workshop': '#1a8a5a',
  'Conference': '#002244',
  'Campaign': '#b88a0e',
  'Other': '#9B9A9B',
};

export async function render(container) {
  setTopbarTitle('Demand Gen Events');
  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [events, partners] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_EVENTS),
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
    ]);
    cachedPartners = partners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
    cachedEvents = events;
    renderView(container, events);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading events'),
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
  return p ? p.display_name : '';
}

// ============================================
// Main View
// ============================================

function renderView(container, events) {
  let activeView = 'board';
  let filters = { search: '', partner: '', type: '', status: '' };

  // Calendar month state — persisted across filter changes and view switches
  const today = new Date();
  let calYear = today.getFullYear();
  let calMonth = today.getMonth();

  function getFiltered() {
    return events.filter(evt => {
      if (filters.partner && evt.partner_id !== filters.partner) return false;
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

  // Filter controls
  const searchInput = el('input', {
    class: 'search-bar__input',
    type: 'text',
    placeholder: 'Search events...',
    onInput: debounce((e) => { filters.search = e.target.value; refreshContent(); }, 200),
  });

  const partnerSelect = el('select', {
    class: 'form-select filter-bar__select',
    onChange: (e) => { filters.partner = e.target.value; refreshContent(); },
  },
    el('option', { value: '' }, 'All Partners'),
    ...(cachedPartners || []).map(p => el('option', { value: p.partner_id }, p.display_name))
  );

  const typeSelect = el('select', {
    class: 'form-select filter-bar__select',
    onChange: (e) => { filters.type = e.target.value; refreshContent(); },
  },
    el('option', { value: '' }, 'All Types'),
    ...EVENT_TYPES.map(t => el('option', { value: t }, t))
  );

  // View toggle buttons
  const boardBtn = el('button', { class: 'btn btn--primary btn--sm', onClick: () => switchView('board') }, 'Board');
  const calendarBtn = el('button', { class: 'btn btn--secondary btn--sm', onClick: () => switchView('calendar') }, 'Calendar');
  const listBtn = el('button', { class: 'btn btn--secondary btn--sm', onClick: () => switchView('list') }, 'List');

  const viewContainer = el('div', { id: 'events-view-container' });

  const content = el('div', {},
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

    // Stats
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Events', events.length),
      statCard('Upcoming', upcoming),
      statCard('In Progress', inProgress),
      statCard('Completed', completed)
    ),

    // Filters + view toggle
    el('div', { class: 'filter-bar' },
      el('div', { class: 'filter-bar__search' },
        el('span', { class: 'search-bar__icon', html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        searchInput
      ),
      partnerSelect,
      typeSelect,
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
  const card = el('div', {
    class: 'kanban__card',
    draggable: 'true',
  },
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
      : null
  );

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', evt.event_id);
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
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
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

    // Find events on this day (with null guard)
    const dayEvents = events.filter(evt => {
      const start = evt.event_date;
      if (!start) return false;
      const end = evt.end_date || start;
      return start <= dateStr && dateStr <= end;
    });

    const cell = createDayCell(d, false, dayEvents, isToday);
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
          el('tr', {},
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
                el('button', { class: 'btn btn--ghost btn--sm', onClick: () => openEventModal(evt, document.getElementById('view-container')) }, 'Edit'),
                el('button', { class: 'btn btn--ghost btn--sm', style: { color: 'var(--color-danger)' }, onClick: () => handleDelete(evt) }, 'Delete')
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

export function openEventModal(event, container, onSaved) {
  const isEdit = !!event;

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
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Describe the event...' },
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
    description: event.description,
  } : {};

  const form = buildForm(fields, async (data) => {
    try {
      const user = getCurrentUser();

      if (isEdit) {
        const values = [
          event.event_id, data.title, data.description, data.event_date,
          data.end_date || data.event_date, data.event_type, data.location,
          data.url, event.created_by, event.created_at, data.status || 'Upcoming',
          data.partner_id || '',
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
        }
        showToast('Event updated successfully!', 'success');
      } else {
        const values = [
          uuid('evt'), data.title, data.description, data.event_date,
          data.end_date || data.event_date, data.event_type, data.location,
          data.url, user.partner_id, nowISO(), data.status || 'Upcoming',
          data.partner_id || '',
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_EVENTS, values);
        } else {
          addDemoRow(CONFIG.SHEET_EVENTS, values);
        }
        showToast('Event created successfully!', 'success');
      }

      closeModal();
      if (onSaved) { onSaved(); } else { reRender(); }
    } catch (err) {
      showToast(err.message || 'Failed to save event', 'error');
    }
  }, initialValues);

  openModal({
    title: isEdit ? 'Edit Event' : 'New Demand Gen Event',
    content: form,
    footer: [
      el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
      }, isEdit ? 'Save Changes' : 'Create Event'),
    ],
  });
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

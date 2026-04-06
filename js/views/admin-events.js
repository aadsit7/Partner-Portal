// ============================================
// Admin Events Management View
// ============================================

import { getCurrentUser } from '../auth.js';
import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, uuid, $ } from '../utils/dom.js';
import { nowISO, formatDate } from '../utils/date.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Events';

export async function render(container) {
  setTopbarTitle('Events Management');

  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const events = await readSheetAsObjects(CONFIG.SHEET_EVENTS);
    renderView(container, events);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading events'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function renderView(container, events) {
  // Sort by date descending (most recent first)
  const sorted = [...events].sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  const content = el('div', {},
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Events'),
        el('p', { class: 'section-header__subtitle' }, `${events.length} events in the calendar`)
      ),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => openEventModal(null, container),
      },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'Add Event'
      ),
    ),

    // Events table
    sorted.length > 0
      ? el('div', { class: 'table-wrapper' },
          el('table', { class: 'table' },
            el('thead', {},
              el('tr', {},
                el('th', {}, 'Event'),
                el('th', {}, 'Date'),
                el('th', {}, 'Type'),
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
                      style: {
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                        maxWidth: '300px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }
                    }, evt.description)
                  ),
                  el('td', {},
                    formatDate(evt.event_date),
                    evt.end_date && evt.end_date !== evt.event_date
                      ? el('span', { style: { color: 'var(--color-text-muted)' } }, ` — ${formatDate(evt.end_date)}`)
                      : null
                  ),
                  el('td', {},
                    el('span', { class: `badge badge--${getTypeBadge(evt.event_type)}` }, evt.event_type)
                  ),
                  el('td', {}, evt.location || '—'),
                  el('td', {},
                    el('div', { class: 'table__actions' },
                      el('button', {
                        class: 'btn btn--ghost btn--sm',
                        onClick: () => openEventModal(evt, container),
                      }, 'Edit'),
                      el('button', {
                        class: 'btn btn--ghost btn--sm',
                        style: { color: 'var(--color-danger)' },
                        onClick: () => handleDelete(evt, container),
                      }, 'Delete')
                    )
                  )
                )
              )
            )
          )
        )
      : el('div', { class: 'empty-state' },
          el('div', { class: 'empty-state__title' }, 'No events yet'),
          el('div', { class: 'empty-state__description' }, 'Create your first marketing event to populate the partner calendar.'),
          el('button', {
            class: 'btn btn--primary',
            onClick: () => openEventModal(null, container),
          }, 'Create First Event')
        )
  );

  mount(container, content);
}

function getTypeBadge(type) {
  const map = {
    Webinar: 'registered',
    Workshop: 'won',
    Conference: 'admin',
    Campaign: 'in-progress',
    Other: 'silver',
  };
  return map[type] || 'silver';
}

function openEventModal(event, container) {
  const isEdit = !!event;

  const fields = [
    { name: 'title', label: 'Event Title', required: true, placeholder: 'e.g., Q2 Partner Kickoff Webinar' },
    { type: 'row-start' },
    { name: 'event_date', label: 'Start Date', type: 'date', required: true },
    { name: 'end_date', label: 'End Date', type: 'date' },
    { type: 'row-end' },
    { type: 'row-start' },
    {
      name: 'event_type', label: 'Type', type: 'select', required: true,
      placeholder: 'Select type...',
      options: ['Webinar', 'Workshop', 'Conference', 'Campaign', 'Other'],
    },
    { name: 'location', label: 'Location', placeholder: 'e.g., Virtual (Zoom), San Francisco, CA' },
    { type: 'row-end' },
    { name: 'url', label: 'Event URL', type: 'url', placeholder: 'https://...' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Describe the event...' },
  ];

  const initialValues = isEdit ? {
    title: event.title,
    event_date: event.event_date,
    end_date: event.end_date,
    event_type: event.event_type,
    location: event.location,
    url: event.url,
    description: event.description,
  } : {};

  const form = buildForm(fields, async (data) => {
    try {
      const user = getCurrentUser();

      if (isEdit) {
        const values = [
          event.event_id,
          data.title,
          data.description,
          data.event_date,
          data.end_date || data.event_date,
          data.event_type,
          data.location,
          data.url,
          event.created_by,
          event.created_at,
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_EVENTS, event._rowIndex, values);
        }

        showToast('Event updated successfully!', 'success');
      } else {
        const values = [
          uuid('evt'),
          data.title,
          data.description,
          data.event_date,
          data.end_date || data.event_date,
          data.event_type,
          data.location,
          data.url,
          user.partner_id,
          nowISO(),
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_EVENTS, values);
        } else {
          addDemoRow(CONFIG.SHEET_EVENTS, values);
        }

        showToast('Event created successfully!', 'success');
      }

      closeModal();
      const viewContainer = document.getElementById('view-container');
      await render(viewContainer);
    } catch (err) {
      showToast(err.message || 'Failed to save event', 'error');
    }
  }, initialValues);

  openModal({
    title: isEdit ? 'Edit Event' : 'Create New Event',
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

async function handleDelete(event, container) {
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
    const viewContainer = document.getElementById('view-container');
    await render(viewContainer);
  } catch (err) {
    showToast(err.message || 'Failed to delete event', 'error');
  }
}

export function cleanup() {}

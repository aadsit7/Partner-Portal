// ============================================
// Partner Joint Marketing Plan View
// ============================================

import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount } from '../utils/dom.js';
import { formatDate } from '../utils/date.js';
import { renderCalendar } from '../components/calendar.js';
import { openModal, closeModal } from '../components/modal.js';
import { setTopbarTitle } from '../components/sidebar.js';

let calendarInstance = null;

export const title = 'Marketing Plan';

export async function render(container) {
  setTopbarTitle('Joint Marketing Plan');

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
  const content = el('div', {},
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Joint Marketing Plan'),
        el('p', { class: 'section-header__subtitle' }, 'Demand generation activities and events')
      )
    ),

    // Upcoming events summary
    renderUpcomingEvents(events),

    // Calendar
    el('div', { id: 'calendar-container', style: { marginTop: 'var(--space-6)' } })
  );

  mount(container, content);

  // Render calendar into its container
  const calContainer = document.getElementById('calendar-container');
  if (calContainer) {
    calendarInstance = renderCalendar(calContainer, events, showEventDetail);
  }
}

function renderUpcomingEvents(events) {
  const now = new Date();
  const upcoming = events
    .filter(e => new Date(e.event_date) >= now)
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    .slice(0, 3);

  if (upcoming.length === 0) return el('div');

  return el('div', { style: { marginBottom: 'var(--space-2)' } },
    el('h3', {
      style: {
        fontSize: 'var(--text-lg)',
        fontWeight: 'var(--font-semibold)',
        marginBottom: 'var(--space-4)',
      }
    }, 'Upcoming Events'),
    el('div', { class: 'card-grid stagger' },
      ...upcoming.map(evt => {
        const typeClass = evt.event_type?.toLowerCase() || 'other';
        return el('div', {
          class: 'card',
          style: { cursor: 'pointer' },
          onClick: () => showEventDetail(evt),
        },
          el('div', { class: 'card__header' },
            el('div', {},
              el('div', { class: 'card__title' }, evt.title),
              el('div', { class: 'card__subtitle' }, formatDate(evt.event_date) + (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : ''))
            ),
            el('span', { class: `badge badge--${typeClass === 'webinar' ? 'registered' : typeClass === 'workshop' ? 'won' : typeClass === 'conference' ? 'admin' : typeClass === 'campaign' ? 'in-progress' : 'silver'}` }, evt.event_type)
          ),
          el('div', { class: 'card__body' },
            el('p', { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' } },
              evt.description?.length > 120 ? evt.description.slice(0, 120) + '...' : evt.description
            )
          ),
          evt.location ? el('div', { class: 'card__footer' },
            el('div', { class: 'card__meta' },
              el('span', { class: 'card__meta-item' },
                el('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1C4.5 1 2.5 3 2.5 5.5C2.5 9 7 13 7 13s4.5-4 4.5-7.5C11.5 3 9.5 1 7 1z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>' }),
                evt.location
              )
            )
          ) : null
        );
      })
    )
  );
}

function showEventDetail(evt) {
  const typeClass = evt.event_type?.toLowerCase() || 'other';

  const content = el('div', { class: 'event-detail' },
    el('div', { class: 'event-detail__type' },
      el('span', { class: `badge badge--${typeClass === 'webinar' ? 'registered' : typeClass === 'workshop' ? 'won' : typeClass === 'conference' ? 'admin' : typeClass === 'campaign' ? 'in-progress' : 'silver'}` }, evt.event_type)
    ),
    el('div', { class: 'event-detail__meta' },
      el('div', { class: 'event-detail__row' },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11.5" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12" stroke="currentColor" stroke-width="1.2"/><path d="M5 .5v3.5M11 .5v3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' }),
        formatDate(evt.event_date) + (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : '')
      ),
      evt.location ? el('div', { class: 'event-detail__row' },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.8 1.5 4 3.3 4 5.5 4 8.5 8 14 8 14s4-5.5 4-8.5c0-2.2-1.8-4-4-4z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>' }),
        evt.location
      ) : null
    ),
    evt.description ? el('div', { class: 'event-detail__description' }, evt.description) : null,
    evt.url ? el('a', { class: 'event-detail__link', href: evt.url, target: '_blank', rel: 'noopener' },
      'Event Link',
      el('span', { html: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M5 1h6v6M11 1L5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' })
    ) : null
  );

  openModal({ title: evt.title, content });
}

export function cleanup() {
  if (calendarInstance) {
    calendarInstance.destroy();
    calendarInstance = null;
  }
}

// ============================================
// Admin Partner Detail View
// ============================================

import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, formatCurrency } from '../utils/dom.js';
import { formatDate } from '../utils/date.js';
import { navigate } from '../router.js';
import { dealCard, statCard } from '../components/card.js';
import { renderCalendar } from '../components/calendar.js';
import { openModal } from '../components/modal.js';
import { openEventModal } from './admin-events.js';
import { openOppModal } from './admin-opportunities.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Partner Detail';

let calendarInstance = null;

export async function render(container, params) {
  const partnerId = params?.id;

  if (!partnerId) {
    navigate('/admin/dashboard');
    return;
  }

  setTopbarTitle('Partner Detail');
  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [partners, opportunities, events] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
      readSheetAsObjects(CONFIG.SHEET_EVENTS),
    ]);

    const partner = partners.find(p => p.partner_id === partnerId);
    if (!partner) {
      mount(container, el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state__title' }, 'Partner not found'),
        el('button', { class: 'btn btn--primary', onClick: () => navigate('/admin/dashboard') }, 'Back to Dashboard')
      ));
      return;
    }

    const partnerOpps = opportunities.filter(o => o.partner_id === partnerId);
    // Events assigned to this partner OR global events (no partner_id)
    const partnerEvents = events.filter(e => !e.partner_id || e.partner_id === partnerId);
    renderDetail(container, partner, partnerOpps, partnerEvents, events);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading data'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function reRender(partnerId) {
  const viewContainer = document.getElementById('view-container');
  render(viewContainer, { id: partnerId });
}

function renderDetail(container, partner, opportunities, partnerEvents, allEvents) {
  const tierClass = partner.tier?.toLowerCase() || 'bronze';
  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);

  const content = el('div', {},
    // Back button
    el('a', {
      class: 'back-link',
      href: '#/admin/dashboard',
      onClick: (e) => { e.preventDefault(); navigate('/admin/dashboard'); }
    },
      el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      'Dashboard'
    ),

    // Partner header
    el('div', { class: 'detail-header' },
      el('div', { class: 'detail-header__info' },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' } },
          el('h2', { class: 'detail-header__name' }, partner.display_name),
          el('span', { class: `badge badge--${tierClass}` }, partner.tier)
        ),
        el('div', { class: 'detail-header__meta' },
          partner.partner_type ? el('span', { class: 'detail-header__meta-item' }, partner.partner_type) : null,
          partner.region ? el('span', { class: 'detail-header__meta-item' }, partner.region) : null
        )
      ),
      el('div', { class: 'detail-header__stats' },
        el('div', { class: 'detail-header__stat' },
          el('div', { class: 'detail-header__stat-value' }, String(opportunities.length)),
          el('div', { class: 'detail-header__stat-label' }, 'Deals')
        ),
        el('div', { class: 'detail-header__stat' },
          el('div', { class: 'detail-header__stat-value' }, formatCurrency(totalValue)),
          el('div', { class: 'detail-header__stat-label' }, 'Pipeline')
        ),
        el('div', { class: 'detail-header__stat' },
          el('div', { class: 'detail-header__stat-value' }, formatCurrency(wonValue)),
          el('div', { class: 'detail-header__stat-label' }, 'Won')
        ),
      )
    ),

    // Tab bar
    el('div', { class: 'tab-bar', id: 'detail-tabs' },
      el('button', {
        class: 'tab-bar__tab tab-bar__tab--active',
        dataset: { tab: 'opportunities' },
        onClick: (e) => switchTab(e.currentTarget, 'opportunities'),
      }, `Opportunities (${opportunities.length})`),
      el('button', {
        class: 'tab-bar__tab',
        dataset: { tab: 'demandgen' },
        onClick: (e) => switchTab(e.currentTarget, 'demandgen'),
      }, 'Demand Gen'),
      el('button', {
        class: 'tab-bar__tab',
        dataset: { tab: 'resources' },
        onClick: (e) => switchTab(e.currentTarget, 'resources'),
      }, 'Resources'),
    ),

    // Tab panels
    el('div', { id: 'tab-panels' },
      el('div', { class: 'tab-panel tab-panel--active', id: 'panel-opportunities' },
        renderOpportunitiesPanel(opportunities, partner)
      ),
      el('div', { class: 'tab-panel', id: 'panel-demandgen' },
        renderDemandGenPanel(partnerEvents, container, partner, allEvents)
      ),
      el('div', { class: 'tab-panel', id: 'panel-resources' },
        renderResourcesPanel()
      ),
    )
  );

  mount(container, content);

  // Render calendar after DOM is in place
  const calContainer = document.getElementById('detail-calendar-container');
  if (calContainer) {
    calendarInstance = renderCalendar(calContainer, partnerEvents, showEventDetail);
  }
}

function switchTab(tabEl, tabId) {
  const tabs = document.querySelectorAll('.tab-bar__tab');
  tabs.forEach(t => t.classList.remove('tab-bar__tab--active'));
  tabEl.classList.add('tab-bar__tab--active');

  const panels = document.querySelectorAll('.tab-panel');
  panels.forEach(p => p.classList.remove('tab-panel--active'));
  const targetPanel = document.getElementById(`panel-${tabId}`);
  if (targetPanel) targetPanel.classList.add('tab-panel--active');
}

function renderOpportunitiesPanel(opportunities, partner) {
  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);

  return el('div', {},
    // Header with action button
    el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 'var(--space-4)', marginBottom: 'var(--space-4)',
      }
    },
      el('div', {}),
      el('button', {
        class: 'btn btn--primary btn--sm',
        onClick: () => {
          // Pre-set partner_id in the modal
          openOppModal(null, null, () => reRender(partner.partner_id));
          // After modal opens, set the partner selector
          setTimeout(() => {
            const sel = document.querySelector('#field-partner_id');
            if (sel) { sel.value = partner.partner_id; }
          }, 50);
        },
      },
        el('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'New Opportunity'
      )
    ),

    el('div', { class: 'stats-grid stagger' },
      statCard('Total Deals', opportunities.length),
      statCard('Active Pipeline', formatCurrency(totalValue)),
      statCard('Deals Won', wonDeals.length),
      statCard('Revenue Won', formatCurrency(wonValue))
    ),

    opportunities.length > 0
      ? el('div', { class: 'card-grid stagger' },
          ...opportunities.map(opp => dealCard(opp, {
            onEdit: (o) => openOppModal(o, null, () => reRender(partner.partner_id)),
          }))
        )
      : el('div', { class: 'empty-state' },
          el('div', { class: 'empty-state__title' }, 'No deals registered'),
          el('div', { class: 'empty-state__description' }, 'Click "New Opportunity" to add a deal for this partner.')
        )
  );
}

function renderDemandGenPanel(events, container, partner, allEvents) {
  const now = new Date();
  const upcoming = events
    .filter(e => new Date(e.event_date) >= now)
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    .slice(0, 4);

  return el('div', { style: { paddingTop: 'var(--space-4)' } },
    el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--space-6)',
      }
    },
      el('h3', {
        style: { fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)' }
      }, 'Demand Gen Events'),
      el('button', {
        class: 'btn btn--primary btn--sm',
        onClick: () => {
          openEventModal(null, container, () => reRender(partner.partner_id));
          // Pre-set partner
          setTimeout(() => {
            const sel = document.querySelector('#field-partner_id');
            if (sel) sel.value = partner.partner_id;
          }, 50);
        },
      },
        el('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'New Event'
      )
    ),

    upcoming.length > 0
      ? el('div', { class: 'card-grid stagger', style: { marginBottom: 'var(--space-8)' } },
          ...upcoming.map(evt => eventCard(evt))
        )
      : el('div', { style: { marginBottom: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' } },
          'No upcoming events for this partner'
        ),

    el('h3', {
      style: { fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-4)' }
    }, 'Calendar'),
    el('div', { id: 'detail-calendar-container' })
  );
}

function eventCard(evt) {
  const typeBadge = { webinar: 'registered', workshop: 'won', conference: 'admin', campaign: 'in-progress' }[evt.event_type?.toLowerCase()] || 'silver';
  const statusBadge = { 'Upcoming': 'registered', 'In Progress': 'in-progress', 'Completed': 'won', 'Cancelled': 'lost' }[evt.status] || 'registered';

  return el('div', { class: 'card', style: { cursor: 'pointer' }, onClick: () => showEventDetail(evt) },
    el('div', { class: 'card__header' },
      el('div', {},
        el('div', { class: 'card__title' }, evt.title),
        el('div', { class: 'card__subtitle' },
          formatDate(evt.event_date) + (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : '')
        )
      ),
      el('span', { class: `badge badge--${typeBadge}` }, evt.event_type)
    ),
    el('div', { class: 'card__body' },
      el('p', { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' } },
        evt.description?.length > 100 ? evt.description.slice(0, 100) + '...' : evt.description
      )
    ),
    el('div', { class: 'card__footer' },
      el('div', { class: 'card__meta' },
        evt.location ? el('span', { class: 'card__meta-item' }, evt.location) : null
      ),
      el('span', { class: `badge badge--${statusBadge}` }, evt.status || 'Upcoming')
    )
  );
}

function showEventDetail(evt) {
  const typeBadge = { webinar: 'registered', workshop: 'won', conference: 'admin', campaign: 'in-progress' }[evt.event_type?.toLowerCase()] || 'silver';

  const content = el('div', { class: 'event-detail' },
    el('div', { style: { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' } },
      el('span', { class: `badge badge--${typeBadge}` }, evt.event_type),
      evt.status ? el('span', { class: `badge badge--${({ 'Upcoming': 'registered', 'In Progress': 'in-progress', 'Completed': 'won', 'Cancelled': 'lost' }[evt.status] || 'registered')}` }, evt.status) : null,
    ),
    el('div', { class: 'event-detail__meta' },
      el('div', { class: 'event-detail__row' },
        el('strong', {}, 'Date: '),
        formatDate(evt.event_date) + (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : '')
      ),
      evt.location ? el('div', { class: 'event-detail__row' }, el('strong', {}, 'Location: '), evt.location) : null,
    ),
    evt.description ? el('div', { class: 'event-detail__description' }, evt.description) : null,
    evt.url ? el('a', { class: 'event-detail__link', href: evt.url, target: '_blank', rel: 'noopener' }, 'Event Link ↗') : null
  );

  openModal({ title: evt.title, content });
}

function renderResourcesPanel() {
  return el('div', {
    style: {
      marginTop: 'var(--space-4)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      border: '1px solid var(--color-border-light)',
    }
  },
    el('iframe', {
      src: CONFIG.SUPPORT_URL,
      style: {
        width: '100%', height: 'calc(100vh - 380px)', border: 'none', minHeight: '500px',
      },
      title: 'Resources',
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
    })
  );
}

export function cleanup() {
  if (calendarInstance) {
    calendarInstance.destroy();
    calendarInstance = null;
  }
}

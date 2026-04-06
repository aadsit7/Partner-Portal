// ============================================
// Admin Dashboard View
// ============================================

import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, formatCurrency } from '../utils/dom.js';
import { navigate } from '../router.js';
import { formatDate } from '../utils/date.js';
import { partnerCard, statCard } from '../components/card.js';
import { renderCalendar } from '../components/calendar.js';
import { openModal } from '../components/modal.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Admin Dashboard';

let calendarInstance = null;

export async function render(container) {
  setTopbarTitle('Dashboard');

  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [partners, opportunities, events] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
      readSheetAsObjects(CONFIG.SHEET_EVENTS),
    ]);

    renderDashboard(container, partners, opportunities, events);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading data'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function renderDashboard(container, partners, opportunities, events) {
  const partnerList = partners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
  const partnerMap = Object.fromEntries(partnerList.map(p => [p.partner_id, p.display_name]));

  const totalPipeline = opportunities.reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);
  const activeDeals = opportunities.filter(o => o.status !== 'Won' && o.status !== 'Lost');
  const upcomingEvents = events
    .filter(e => new Date(e.event_date) >= new Date())
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  // Per-partner stats
  const partnerStats = partnerList.map(partner => {
    const partnerOpps = opportunities.filter(o => o.partner_id === partner.partner_id);
    const total = partnerOpps.length;
    const totalVal = partnerOpps.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
    const won = partnerOpps.filter(o => o.status === 'Won').length;
    const inProgress = partnerOpps.filter(o => o.status === 'In Progress').length;
    const registered = partnerOpps.filter(o => o.status === 'Registered').length;
    const lost = partnerOpps.filter(o => o.status === 'Lost').length;
    return {
      partner,
      stats: {
        totalDeals: total, totalValue: totalVal,
        wonPercent: total > 0 ? (won / total) * 100 : 0,
        progressPercent: total > 0 ? (inProgress / total) * 100 : 0,
        registeredPercent: total > 0 ? (registered / total) * 100 : 0,
        lostPercent: total > 0 ? (lost / total) * 100 : 0,
      }
    };
  }).sort((a, b) => b.stats.totalValue - a.stats.totalValue);

  const content = el('div', {},
    // Summary stats
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Partners', partnerList.length),
      statCard('Total Pipeline', formatCurrency(totalPipeline)),
      statCard('Active Deals', activeDeals.length),
      statCard('Revenue Won', formatCurrency(wonValue))
    ),

    // Two-column layout: Calendar + Recent Activity
    el('div', { class: 'dashboard-grid' },
      // Left: Calendar
      el('div', { class: 'dashboard-grid__main' },
        el('div', { class: 'dash-section' },
          el('div', { class: 'dash-section__header' },
            el('h3', { class: 'dash-section__title' }, 'Events Calendar'),
            el('button', {
              class: 'btn btn--ghost btn--sm',
              onClick: () => navigate('/admin/events'),
            }, 'View All Events')
          ),
          el('div', { id: 'dashboard-calendar' })
        ),

        // Pipeline breakdown
        el('div', { class: 'dash-section' },
          el('div', { class: 'dash-section__header' },
            el('h3', { class: 'dash-section__title' }, 'Pipeline Status'),
            el('button', {
              class: 'btn btn--ghost btn--sm',
              onClick: () => navigate('/admin/opportunities'),
            }, 'View All Deals')
          ),
          el('div', { class: 'pipeline-bar', style: { height: '12px' } },
            ...buildPipelineSegments(opportunities)
          ),
          el('div', {
            style: {
              display: 'flex', gap: 'var(--space-6)', marginTop: 'var(--space-3)', flexWrap: 'wrap',
            }
          },
            legendItem('Registered', 'registered', opportunities.filter(o => o.status === 'Registered').length),
            legendItem('In Progress', 'in-progress', opportunities.filter(o => o.status === 'In Progress').length),
            legendItem('Won', 'won', wonDeals.length),
            legendItem('Lost', 'lost', opportunities.filter(o => o.status === 'Lost').length)
          ),

          // Recent opportunities table
          el('div', { style: { marginTop: 'var(--space-5)' } },
            recentOppsTable(opportunities, partnerMap)
          )
        ),
      ),

      // Right sidebar: Upcoming events + Partners
      el('div', { class: 'dashboard-grid__side' },
        // Upcoming events list
        el('div', { class: 'dash-section' },
          el('h3', { class: 'dash-section__title' }, 'Upcoming Events'),
          upcomingEvents.length > 0
            ? el('div', { class: 'event-list' },
                ...upcomingEvents.slice(0, 5).map(evt =>
                  el('div', {
                    class: 'event-list__item',
                    onClick: () => showEventDetail(evt, partnerMap),
                  },
                    el('div', { class: 'event-list__date' },
                      el('div', { class: 'event-list__day' }, new Date(evt.event_date).getDate()),
                      el('div', { class: 'event-list__month' }, new Date(evt.event_date).toLocaleString('en', { month: 'short' }))
                    ),
                    el('div', { class: 'event-list__info' },
                      el('div', { class: 'event-list__title' }, evt.title),
                      el('div', { class: 'event-list__meta' },
                        el('span', { class: `badge badge--xs badge--${getTypeBadge(evt.event_type)}` }, evt.event_type),
                        evt.partner_id ? el('span', { class: 'event-list__partner' }, partnerMap[evt.partner_id] || '') : null
                      )
                    )
                  )
                )
              )
            : el('div', { style: { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', padding: 'var(--space-4) 0' } }, 'No upcoming events')
        ),

        // Partners overview
        el('div', { class: 'dash-section' },
          el('div', { class: 'dash-section__header' },
            el('h3', { class: 'dash-section__title' }, 'Partners'),
            el('button', {
              class: 'btn btn--ghost btn--sm',
              onClick: () => navigate('/admin/partners'),
            }, 'Manage')
          ),
          el('div', { class: 'partner-list' },
            ...partnerStats.map(({ partner, stats }) =>
              el('div', {
                class: 'partner-list__item',
                onClick: () => navigate(`/admin/partner-detail?id=${partner.partner_id}`),
              },
                el('div', { class: 'partner-list__info' },
                  el('div', { class: 'partner-list__name' }, partner.display_name),
                  el('div', { class: 'partner-list__deals' },
                    `${stats.totalDeals} deals · ${formatCurrency(stats.totalValue)}`
                  )
                ),
                el('span', { class: `badge badge--xs badge--${partner.tier?.toLowerCase() || 'bronze'}` }, partner.tier)
              )
            )
          )
        ),
      ),
    ),
  );

  mount(container, content);

  // Render calendar after DOM is ready
  const calContainer = document.getElementById('dashboard-calendar');
  if (calContainer) {
    calendarInstance = renderCalendar(calContainer, events, (evt) => showEventDetail(evt, partnerMap));
  }
}

function recentOppsTable(opportunities, partnerMap) {
  const recent = [...opportunities]
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, 6);

  if (recent.length === 0) {
    return el('div', { style: { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' } }, 'No opportunities yet');
  }

  return el('div', { class: 'table-wrapper' },
    el('table', { class: 'table table--compact' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'Deal'),
          el('th', {}, 'Partner'),
          el('th', {}, 'Value'),
          el('th', {}, 'Status'),
        )
      ),
      el('tbody', {},
        ...recent.map(opp =>
          el('tr', { style: { cursor: 'pointer' }, onClick: () => navigate('/admin/opportunities') },
            el('td', {},
              el('div', { style: { fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' } }, opp.deal_name),
              el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' } }, opp.customer_name)
            ),
            el('td', { style: { fontSize: 'var(--text-sm)' } }, partnerMap[opp.partner_id] || opp.partner_id),
            el('td', { style: { fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' } }, formatCurrency(parseFloat(opp.deal_value) || 0)),
            el('td', {}, el('span', { class: `badge badge--xs badge--${getStatusBadge(opp.status)}` }, opp.status)),
          )
        )
      )
    )
  );
}

function showEventDetail(evt, partnerMap) {
  const typeBadge = getTypeBadge(evt.event_type);

  const content = el('div', { class: 'event-detail' },
    el('div', { style: { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' } },
      el('span', { class: `badge badge--${typeBadge}` }, evt.event_type),
      evt.status ? el('span', { class: `badge badge--${getStatusBadge(evt.status)}` }, evt.status) : null,
    ),
    el('div', { class: 'event-detail__meta' },
      el('div', { class: 'event-detail__row' },
        el('strong', {}, 'Date: '),
        formatDate(evt.event_date) + (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : '')
      ),
      evt.location ? el('div', { class: 'event-detail__row' },
        el('strong', {}, 'Location: '), evt.location
      ) : null,
      evt.partner_id ? el('div', { class: 'event-detail__row' },
        el('strong', {}, 'Partner: '),
        el('span', { class: 'badge badge--admin' }, partnerMap[evt.partner_id] || evt.partner_id)
      ) : null,
    ),
    evt.description ? el('div', { class: 'event-detail__description' }, evt.description) : null,
    evt.url ? el('a', { class: 'event-detail__link', href: evt.url, target: '_blank', rel: 'noopener' },
      'Event Link ↗'
    ) : null
  );

  openModal({ title: evt.title, content });
}

function getTypeBadge(type) {
  return { Webinar: 'registered', Workshop: 'won', Conference: 'admin', Campaign: 'in-progress', Other: 'silver' }[type] || 'silver';
}

function getStatusBadge(status) {
  return { 'Registered': 'registered', 'In Progress': 'in-progress', 'Won': 'won', 'Lost': 'lost', 'Upcoming': 'registered', 'Completed': 'won', 'Cancelled': 'lost' }[status] || 'silver';
}

function buildPipelineSegments(opportunities) {
  const total = opportunities.length;
  if (total === 0) return [];
  const counts = {
    registered: opportunities.filter(o => o.status === 'Registered').length,
    'in-progress': opportunities.filter(o => o.status === 'In Progress').length,
    won: opportunities.filter(o => o.status === 'Won').length,
    lost: opportunities.filter(o => o.status === 'Lost').length,
  };
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) =>
      el('div', {
        class: `pipeline-bar__segment pipeline-bar__segment--${status}`,
        style: { width: `${(count / total) * 100}%` },
      })
    );
}

function legendItem(label, status, count) {
  const colors = {
    registered: 'var(--color-status-registered)',
    'in-progress': 'var(--color-status-in-progress)',
    won: 'var(--color-status-won)',
    lost: 'var(--color-status-lost)',
  };
  return el('div', {
    style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)' }
  },
    el('div', { style: { width: '8px', height: '8px', borderRadius: 'var(--radius-full)', background: colors[status] } }),
    el('span', { style: { color: 'var(--color-text-secondary)' } }, `${label} (${count})`)
  );
}

export function cleanup() {
  if (calendarInstance) {
    calendarInstance.destroy();
    calendarInstance = null;
  }
}

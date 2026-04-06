// ============================================
// Admin Dashboard View — Command Center
// ============================================

import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, formatCurrency, debounce } from '../utils/dom.js';
import { navigate } from '../router.js';
import { statCard } from '../components/card.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { tierSlug, TIER_COLORS, TIER_ICONS } from '../utils/tiers.js';
import { formatDate } from '../utils/date.js';
import { openEventModal } from './admin-events.js';
import { parseChecklist } from '../components/checklist.js';

export const title = 'Admin Dashboard';

let mapInstance = null;
let mapMarkers = [];

const TYPE_COLORS = {
  'Technology':                '#1a73e8',
  'OEM':                       '#ECB22E',
  'MSP/SI':                    '#69BE28',
  'MENA Regional Distributor': '#E01E5A',
};

const EVENT_TYPE_COLORS = {
  'Webinar': '#0e8ab5',
  'Workshop': '#1a8a5a',
  'Conference': '#002244',
  'Campaign': '#b88a0e',
  'Other': '#9B9A9B',
};

const HQ_COORDINATES = {
  'Edmonton, Alberta, Canada': [53.5461, -113.4938],
  'New Jersey, USA': [40.0583, -74.4057],
  'Bengaluru, India': [12.9716, 77.5946],
  'Chandler, Arizona, USA': [33.3062, -111.8413],
  'Redmond, Washington, USA': [47.6740, -122.1215],
  'Chicago, Illinois, USA': [41.8781, -87.6298],
  'San Diego, California, USA': [32.7157, -117.1611],
  'Dubai, UAE': [25.2048, 55.2708],
  'Montreal, Quebec, Canada': [45.5017, -73.5673],
  'Austin, Texas, USA': [30.2672, -97.7431],
};

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
  const upcomingEvents = events.filter(e => e.status === 'Upcoming' || e.status === 'In Progress');

  const totalPipeline = opportunities.reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);
  const wonValue = opportunities
    .filter(o => o.status === 'Won')
    .reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);

  // Per-partner stats
  const partnerStats = partnerList.map(partner => {
    const partnerOpps = opportunities.filter(o => o.partner_id === partner.partner_id);
    const partnerEvents = events.filter(e => e.partner_id === partner.partner_id);
    const upcomingPartnerEvents = partnerEvents.filter(e => e.status === 'Upcoming' || e.status === 'In Progress');
    const total = partnerOpps.length;
    const totalVal = partnerOpps.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
    const wonVal = partnerOpps.filter(o => o.status === 'Won').reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
    return {
      partner,
      stats: { totalDeals: total, totalValue: totalVal, wonValue: wonVal },
      events: partnerEvents,
      upcomingEvents: upcomingPartnerEvents,
    };
  }).sort((a, b) => b.stats.totalValue - a.stats.totalValue);

  // Type distribution data
  const typeData = computeTypeData(partnerList, opportunities);
  const uniqueTypes = Object.keys(typeData);

  // Tab state
  let activeTab = 'activity';

  // Tab buttons
  const activityTabBtn = el('button', {
    class: 'btn btn--primary btn--sm',
    onClick: () => switchTab('activity'),
  }, 'Activity Hub');

  const partnersTabBtn = el('button', {
    class: 'btn btn--secondary btn--sm',
    onClick: () => switchTab('partners'),
  }, 'Partners');

  // Tab containers
  const activityView = el('div', { id: 'dashboard-activity-view' });
  const partnersView = el('div', { id: 'dashboard-partners-view', style: { display: 'none' } });

  function switchTab(tab) {
    activeTab = tab;
    activityTabBtn.className = tab === 'activity' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';
    partnersTabBtn.className = tab === 'partners' ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm';
    activityView.style.display = tab === 'activity' ? '' : 'none';
    partnersView.style.display = tab === 'partners' ? '' : 'none';

    if (tab === 'partners' && !partnersView.hasChildNodes()) {
      buildPartnersView(partnersView, partnerList, partnerStats, typeData, uniqueTypes, totalPipeline, opportunities);
    }
  }

  // Build activity view content
  buildActivityView(activityView, partnerStats, upcomingEvents, events, opportunities, container);

  const content = el('div', {},
    // Summary stats
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Partners', partnerList.length),
      statCard('Total Pipeline', formatCurrency(totalPipeline)),
      statCard('Revenue Won', formatCurrency(wonValue)),
      statCard('Upcoming Events', upcomingEvents.length)
    ),

    // Tab toggle
    el('div', { class: 'view-toggle' }, activityTabBtn, partnersTabBtn),

    // Views
    activityView,
    partnersView,
  );

  mount(container, content);
}

// ============================================
// Activity Hub View
// ============================================

function buildActivityView(container, partnerStats, upcomingEvents, allEvents, opportunities, viewContainer) {
  // Partner Activity Cards
  const partnerHubTitle = el('div', { class: 'section-header', style: { marginBottom: 'var(--space-4)' } },
    el('div', {},
      el('h3', { class: 'section-header__title' }, 'Partner Activity'),
      el('p', { class: 'section-header__subtitle' }, 'Events and opportunities by partner')
    )
  );

  const partnerCards = partnerStats
    .filter(ps => ps.stats.totalDeals > 0 || ps.upcomingEvents.length > 0)
    .map(({ partner, stats, upcomingEvents: partnerUpcoming }) => {
      const tc = tierSlug(partner.tier);
      const initials = (partner.display_name || '')
        .split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';

      const eventChips = partnerUpcoming.slice(0, 3).map(evt =>
        el('div', {
          class: 'activity-card__event-chip',
          onClick: (e) => {
            e.stopPropagation();
            openEventModal(evt, viewContainer);
          },
        },
          el('span', {
            class: 'activity-card__event-dot',
            style: { background: EVENT_TYPE_COLORS[evt.event_type] || '#9B9A9B' },
          }),
          el('span', { class: 'activity-card__event-name' }, evt.title),
          el('span', { class: 'activity-card__event-date' }, formatDate(evt.event_date))
        )
      );

      if (partnerUpcoming.length > 3) {
        eventChips.push(el('div', { class: 'activity-card__event-more' },
          `+${partnerUpcoming.length - 3} more events`
        ));
      }

      return el('div', {
        class: 'activity-card',
        onClick: () => navigate(`/admin/partner-detail?id=${partner.partner_id}`),
      },
        el('div', { class: 'activity-card__header' },
          el('div', { class: `partner-avatar partner-avatar--${tc} partner-avatar--sm` }, initials),
          el('div', { class: 'activity-card__info' },
            el('div', { class: 'activity-card__name' }, partner.display_name),
            el('div', { class: 'activity-card__type' },
              el('span', { class: `badge badge--xs badge--${tc}` },
                el('span', { class: 'badge__icon', html: TIER_ICONS[tc] || '' }),
                partner.tier
              ),
              el('span', { class: 'activity-card__partner-type' }, partner.partner_type)
            )
          )
        ),
        el('div', { class: 'activity-card__metrics' },
          el('div', { class: 'activity-card__metric' },
            el('div', { class: 'activity-card__metric-value' }, String(stats.totalDeals)),
            el('div', { class: 'activity-card__metric-label' }, 'Deals')
          ),
          el('div', { class: 'activity-card__metric' },
            el('div', { class: 'activity-card__metric-value' }, formatCurrency(stats.totalValue)),
            el('div', { class: 'activity-card__metric-label' }, 'Pipeline')
          ),
          el('div', { class: 'activity-card__metric' },
            el('div', { class: 'activity-card__metric-value' }, String(partnerUpcoming.length)),
            el('div', { class: 'activity-card__metric-label' }, 'Events')
          ),
        ),
        partnerUpcoming.length > 0
          ? el('div', { class: 'activity-card__events' },
              el('div', { class: 'activity-card__events-title' }, 'Upcoming Events'),
              ...eventChips
            )
          : null
      );
    });

  // Upcoming Events Timeline
  const timelineTitle = el('div', { class: 'section-header', style: { marginBottom: 'var(--space-4)', marginTop: 'var(--space-8)' } },
    el('div', {},
      el('h3', { class: 'section-header__title' }, 'Upcoming Demand Gen Events'),
      el('p', { class: 'section-header__subtitle' }, 'Next 60 days')
    )
  );

  const now = new Date();
  const sixtyDaysOut = new Date(now);
  sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);

  const timelineEvents = upcomingEvents
    .filter(evt => {
      const d = new Date(evt.event_date);
      return d >= now && d <= sixtyDaysOut;
    })
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  const getPartnerName = (pid) => {
    if (!pid) return 'All Partners';
    const ps = partnerStats.find(p => p.partner.partner_id === pid);
    return ps ? ps.partner.display_name : pid;
  };

  const timelineCards = timelineEvents.map(evt => {
    const checklistItems = parseChecklist(evt.checklist, evt.event_type);
    const doneCount = checklistItems.filter(i => i.done).length;
    const totalTasks = checklistItems.length;
    const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

    return el('div', {
      class: 'timeline-card',
      onClick: () => openEventModal(evt, viewContainer),
    },
      el('div', { class: 'timeline-card__date-col' },
        el('div', { class: 'timeline-card__month' },
          new Date(evt.event_date).toLocaleDateString('en-US', { month: 'short' })
        ),
        el('div', { class: 'timeline-card__day' },
          String(new Date(evt.event_date).getDate())
        )
      ),
      el('div', { class: 'timeline-card__content' },
        el('div', { class: 'timeline-card__title' }, evt.title),
        el('div', { class: 'timeline-card__details' },
          el('span', {
            class: 'badge badge--xs',
            style: { background: EVENT_TYPE_COLORS[evt.event_type] || '#9B9A9B', color: '#fff' }
          }, evt.event_type),
          el('span', { class: 'timeline-card__partner' }, getPartnerName(evt.partner_id)),
          evt.location
            ? el('span', { class: 'timeline-card__location' }, evt.location)
            : null,
        ),
        totalTasks > 0
          ? el('div', { class: 'timeline-card__checklist' },
              el('div', { class: 'timeline-card__checklist-bar' },
                el('div', { class: 'timeline-card__checklist-fill', style: { width: `${pct}%` } })
              ),
              el('span', { class: 'timeline-card__checklist-text' }, `${doneCount}/${totalTasks} tasks`)
            )
          : null
      )
    );
  });

  container.appendChild(partnerHubTitle);

  if (partnerCards.length > 0) {
    container.appendChild(el('div', { class: 'activity-grid' }, ...partnerCards));
  } else {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'No partner activity yet'),
      el('div', { class: 'empty-state__description' }, 'Deals and events will appear here.')
    ));
  }

  container.appendChild(timelineTitle);

  if (timelineCards.length > 0) {
    container.appendChild(el('div', { class: 'timeline-list' }, ...timelineCards));
  } else {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'No upcoming events'),
      el('div', { class: 'empty-state__description' }, 'Events in the next 60 days will appear here.')
    ));
  }
}

// ============================================
// Partners View (Grid + Map — original dashboard)
// ============================================

function buildPartnersView(container, partnerList, partnerStats, typeData, uniqueTypes, totalPipeline, opportunities) {
  // Build thumbnail elements
  const thumbElements = partnerStats.map(({ partner, stats }) => partnerThumbnail(partner, stats));

  // Filter state
  let activeFilter = 'all';

  // Search bar
  const searchInput = el('input', {
    class: 'form-input',
    type: 'text',
    placeholder: 'Search partners...',
    style: { maxWidth: '320px' },
  });

  function filterPartners() {
    const query = searchInput.value.toLowerCase().trim();
    thumbElements.forEach((thumb, i) => {
      const partner = partnerStats[i].partner;
      const matchesSearch = !query || partner.display_name.toLowerCase().includes(query);
      const matchesType = activeFilter === 'all' || partner.partner_type === activeFilter;
      thumb.style.display = (matchesSearch && matchesType) ? '' : 'none';
    });
    updateMapMarkers();
  }

  const onSearch = debounce(filterPartners, 200);
  searchInput.addEventListener('input', onSearch);

  // Type breakdown cards
  const typeCards = [];
  const allCard = el('div', {
    class: 'type-card type-card--active',
    onClick: () => applyFilter('all'),
  },
    el('div', { class: 'type-card__header' },
      el('div', { class: 'type-card__color', style: { background: '#002244' } }),
      el('div', { class: 'type-card__name' }, 'All Types')
    ),
    el('div', { class: 'type-card__count' }, String(partnerList.length)),
    el('div', { class: 'type-card__pipeline' }, formatCurrency(totalPipeline) + ' pipeline')
  );
  allCard.dataset.type = 'all';
  typeCards.push(allCard);

  uniqueTypes.forEach(type => {
    const d = typeData[type];
    const card = el('div', {
      class: 'type-card',
      onClick: () => applyFilter(type),
    },
      el('div', { class: 'type-card__header' },
        el('div', { class: 'type-card__color', style: { background: TYPE_COLORS[type] || '#9B9A9B' } }),
        el('div', { class: 'type-card__name' }, type)
      ),
      el('div', { class: 'type-card__count' }, String(d.count)),
      el('div', { class: 'type-card__pipeline' }, formatCurrency(d.pipeline) + ' pipeline')
    );
    card.dataset.type = type;
    typeCards.push(card);
  });

  function applyFilter(type) {
    activeFilter = type;
    typeCards.forEach(c => {
      c.classList.toggle('type-card--active', c.dataset.type === type);
    });
    filterPartners();
  }

  // Donut chart
  const donut = buildDonut(partnerList, typeData);

  // View toggle buttons
  const gridBtn = el('button', {
    class: 'btn btn--primary btn--sm',
    onClick: () => switchView('grid'),
  }, 'Grid View');

  const mapBtn = el('button', {
    class: 'btn btn--secondary btn--sm',
    onClick: () => switchView('map'),
  }, 'Map View');

  // Grid view container
  const gridView = el('div', { id: 'dashboard-grid-view' },
    el('div', { style: { marginBottom: 'var(--space-6)' } }, searchInput),
    partnerList.length > 0
      ? el('div', { class: 'partner-thumb-grid stagger' }, ...thumbElements)
      : el('div', { class: 'empty-state' },
          el('div', { class: 'empty-state__title' }, 'No partners yet'),
          el('div', { class: 'empty-state__description' }, 'Add partners to get started.')
        )
  );

  // Map view container
  const mapView = el('div', { id: 'dashboard-map-view', style: { display: 'none' } },
    el('div', { id: 'leaflet-map', class: 'leaflet-map-container' })
  );

  container.appendChild(
    el('div', {},
      // Type distribution section
      el('div', { class: 'type-distribution' },
        donut,
        el('div', { class: 'type-breakdown' }, ...typeCards)
      ),

      // View toggle
      el('div', { class: 'view-toggle' }, gridBtn, mapBtn),

      // Views
      gridView,
      mapView,
    )
  );

  function switchView(view) {
    const gv = document.getElementById('dashboard-grid-view');
    const mv = document.getElementById('dashboard-map-view');
    if (!gv || !mv) return;

    if (view === 'map') {
      gv.style.display = 'none';
      mv.style.display = 'block';
      gridBtn.className = 'btn btn--secondary btn--sm';
      mapBtn.className = 'btn btn--primary btn--sm';

      if (!mapInstance) {
        setTimeout(() => { initMap(partnerList); updateMapMarkers(); }, 50);
      } else {
        mapInstance.invalidateSize();
        updateMapMarkers();
      }
    } else {
      gv.style.display = '';
      mv.style.display = 'none';
      gridBtn.className = 'btn btn--primary btn--sm';
      mapBtn.className = 'btn btn--secondary btn--sm';
    }
  }

  function updateMapMarkers() {
    if (!mapInstance) return;
    mapMarkers.forEach(({ marker, partner }) => {
      const visible = activeFilter === 'all' || partner.partner_type === activeFilter;
      if (visible) {
        marker.addTo(mapInstance);
      } else {
        marker.remove();
      }
    });
  }
}

function computeTypeData(partnerList, opportunities) {
  const data = {};
  partnerList.forEach(p => {
    const type = p.partner_type || 'Other';
    if (!data[type]) data[type] = { count: 0, pipeline: 0 };
    data[type].count++;
    const partnerPipeline = opportunities
      .filter(o => o.partner_id === p.partner_id)
      .reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
    data[type].pipeline += partnerPipeline;
  });
  return data;
}

function buildDonut(partnerList, typeData) {
  const total = partnerList.length;
  if (total === 0) {
    return el('div', { class: 'type-donut', style: { background: '#f0f0f0' } },
      el('div', { class: 'type-donut__hole' },
        el('div', { class: 'type-donut__total' }, '0'),
        el('div', { class: 'type-donut__label' }, 'Partners')
      )
    );
  }

  let cumulative = 0;
  const stops = [];
  for (const [type, d] of Object.entries(typeData)) {
    const start = cumulative;
    cumulative += (d.count / total) * 360;
    const color = TYPE_COLORS[type] || '#9B9A9B';
    stops.push(`${color} ${start}deg ${cumulative}deg`);
  }

  return el('div', { class: 'type-donut', style: {
    background: `conic-gradient(${stops.join(', ')})`
  }},
    el('div', { class: 'type-donut__hole' },
      el('div', { class: 'type-donut__total' }, String(total)),
      el('div', { class: 'type-donut__label' }, 'Partners')
    )
  );
}

function initMap(partners) {
  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl || !window.L) return;

  mapInstance = L.map(mapEl).setView([25, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(mapInstance);

  mapMarkers = [];

  partners.forEach(partner => {
    const loc = partner.hq_location;
    if (!loc) return;

    const coords = HQ_COORDINATES[loc];
    if (!coords) return;

    const tc = tierSlug(partner.tier);
    const color = TIER_COLORS[tc] || '#002244';

    const icon = L.divIcon({
      className: 'map-marker',
      html: `<div class="map-marker__pin" style="background:${color}">
        <span>${(partner.display_name || '?').slice(0, 2).toUpperCase()}</span>
      </div>`,
      iconSize: [36, 44],
      iconAnchor: [18, 44],
      popupAnchor: [0, -46],
    });

    const marker = L.marker(coords, { icon }).addTo(mapInstance);
    marker.bindPopup(`
      <div class="map-popup">
        <div class="map-popup__name">${partner.display_name}</div>
        <div class="map-popup__row"><span class="map-popup__label">Type:</span> ${partner.partner_type || '—'}</div>
        <div class="map-popup__row"><span class="map-popup__label">Region:</span> ${partner.region || '—'}</div>
        <div class="map-popup__row"><span class="map-popup__label">HQ:</span> ${partner.hq_location}</div>
        <div class="map-popup__row"><span class="map-popup__label">Tier:</span> ${partner.tier || '—'}</div>
        <div class="map-popup__link"><a href="#/admin/partner-detail?id=${partner.partner_id}">View Partner →</a></div>
      </div>
    `, { maxWidth: 250 });

    mapMarkers.push({ marker, partner });
  });

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers.map(m => m.marker));
    mapInstance.fitBounds(group.getBounds().pad(0.3));
  }
}

function partnerThumbnail(partner, stats) {
  const tc = tierSlug(partner.tier);
  const initials = (partner.display_name || '')
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  return el('div', {
    class: 'partner-thumb',
    onClick: () => navigate(`/admin/partner-detail?id=${partner.partner_id}`),
  },
    el('div', { class: `partner-avatar partner-avatar--${tc}` }, initials),
    el('div', { class: 'partner-thumb__name' }, partner.display_name),
    el('span', { class: `badge badge--xs badge--${tc}` },
      el('span', { class: 'badge__icon', html: TIER_ICONS[tc] || '' }),
      partner.tier
    ),
    partner.hq_location
      ? el('div', { class: 'partner-thumb__location' }, partner.hq_location)
      : null,
    el('div', { class: 'partner-thumb__stats' },
      `${stats.totalDeals} deals \u00B7 ${formatCurrency(stats.totalValue)}`
    )
  );
}

export function cleanup() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  mapMarkers = [];
}

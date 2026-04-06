// ============================================
// Admin Dashboard View
// ============================================

import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, formatCurrency, debounce } from '../utils/dom.js';
import { navigate } from '../router.js';
import { statCard } from '../components/card.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Admin Dashboard';

let mapInstance = null;

// Known HQ coordinates for map markers
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
  'Montreal/Blainville, Quebec, Canada': [45.5017, -73.5673],
};

export async function render(container) {
  setTopbarTitle('Dashboard');

  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [partners, opportunities] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
    ]);

    renderDashboard(container, partners, opportunities);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading data'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function renderDashboard(container, partners, opportunities) {
  const partnerList = partners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');

  const totalPipeline = opportunities.reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);
  const wonValue = opportunities
    .filter(o => o.status === 'Won')
    .reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);

  // Per-partner stats
  const partnerStats = partnerList.map(partner => {
    const partnerOpps = opportunities.filter(o => o.partner_id === partner.partner_id);
    const total = partnerOpps.length;
    const totalVal = partnerOpps.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
    return { partner, stats: { totalDeals: total, totalValue: totalVal } };
  }).sort((a, b) => b.stats.totalValue - a.stats.totalValue);

  // Build thumbnail elements
  const thumbElements = partnerStats.map(({ partner, stats }) => partnerThumbnail(partner, stats));

  // Search bar
  const searchInput = el('input', {
    class: 'form-input',
    type: 'text',
    placeholder: 'Search partners...',
    style: { maxWidth: '320px' },
  });

  const onSearch = debounce(() => {
    const query = searchInput.value.toLowerCase().trim();
    thumbElements.forEach((thumb, i) => {
      const name = partnerStats[i].partner.display_name.toLowerCase();
      thumb.style.display = name.includes(query) ? '' : 'none';
    });
  }, 200);

  searchInput.addEventListener('input', onSearch);

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

  const content = el('div', {},
    // Summary stats
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Partners', partnerList.length),
      statCard('Total Pipeline', formatCurrency(totalPipeline)),
      statCard('Revenue Won', formatCurrency(wonValue))
    ),

    // View toggle
    el('div', { class: 'view-toggle' }, gridBtn, mapBtn),

    // Views
    gridView,
    mapView,
  );

  mount(container, content);

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
        setTimeout(() => initMap(partnerList), 50);
      } else {
        mapInstance.invalidateSize();
      }
    } else {
      gv.style.display = '';
      mv.style.display = 'none';
      gridBtn.className = 'btn btn--primary btn--sm';
      mapBtn.className = 'btn btn--secondary btn--sm';
    }
  }
}

function initMap(partners) {
  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl || !window.L) return;

  mapInstance = L.map(mapEl).setView([25, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(mapInstance);

  const markers = [];

  partners.forEach(partner => {
    const loc = partner.hq_location;
    if (!loc) return;

    const coords = HQ_COORDINATES[loc];
    if (!coords) return;

    const tierClass = partner.tier?.toLowerCase() || 'bronze';
    const tierColors = { gold: '#d4a017', silver: '#7a7a7a', bronze: '#8b5e30' };
    const color = tierColors[tierClass] || '#002244';

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

    markers.push(marker);
  });

  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    mapInstance.fitBounds(group.getBounds().pad(0.3));
  }
}

function partnerThumbnail(partner, stats) {
  const tierClass = partner.tier?.toLowerCase() || 'bronze';
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
    el('div', { class: `partner-avatar partner-avatar--${tierClass}` }, initials),
    el('div', { class: 'partner-thumb__name' }, partner.display_name),
    el('span', { class: `badge badge--xs badge--${tierClass}` }, partner.tier),
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
}

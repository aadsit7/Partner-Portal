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

  const content = el('div', {},
    // Summary stats
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Partners', partnerList.length),
      statCard('Total Pipeline', formatCurrency(totalPipeline)),
      statCard('Revenue Won', formatCurrency(wonValue))
    ),

    // Search
    el('div', { style: { marginBottom: 'var(--space-6)' } }, searchInput),

    // Partner thumbnail grid
    partnerList.length > 0
      ? el('div', { class: 'partner-thumb-grid stagger' }, ...thumbElements)
      : el('div', { class: 'empty-state' },
          el('div', { class: 'empty-state__title' }, 'No partners yet'),
          el('div', { class: 'empty-state__description' }, 'Add partners to get started.')
        )
  );

  mount(container, content);
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
    el('div', { class: 'partner-thumb__stats' },
      `${stats.totalDeals} deals \u00B7 ${formatCurrency(stats.totalValue)}`
    )
  );
}

export function cleanup() {}

// ============================================
// Admin Dashboard View
// ============================================

import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, formatCurrency } from '../utils/dom.js';
import { partnerCard, statCard } from '../components/card.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Admin Dashboard';

export async function render(container) {
  setTopbarTitle('Admin Dashboard');

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
  // Filter out admin from partner count
  const partnerList = partners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');

  const totalPipeline = opportunities.reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((sum, o) => sum + (parseFloat(o.deal_value) || 0), 0);
  const activeDeals = opportunities.filter(o => o.status !== 'Won' && o.status !== 'Lost');

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
        totalDeals: total,
        totalValue: totalVal,
        wonPercent: total > 0 ? (won / total) * 100 : 0,
        progressPercent: total > 0 ? (inProgress / total) * 100 : 0,
        registeredPercent: total > 0 ? (registered / total) * 100 : 0,
        lostPercent: total > 0 ? (lost / total) * 100 : 0,
      }
    };
  });

  // Sort by pipeline value descending
  partnerStats.sort((a, b) => b.stats.totalValue - a.stats.totalValue);

  const content = el('div', {},
    // Header
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Partner Pipeline Overview'),
        el('p', { class: 'section-header__subtitle' }, `${partnerList.length} active partners, ${opportunities.length} total opportunities`)
      )
    ),

    // Summary stats
    el('div', { class: 'stats-grid stagger' },
      statCard('Total Partners', partnerList.length),
      statCard('Total Pipeline', formatCurrency(totalPipeline)),
      statCard('Active Deals', activeDeals.length),
      statCard('Revenue Won', formatCurrency(wonValue))
    ),

    // Pipeline breakdown
    el('div', {
      style: {
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5) var(--space-6)',
        marginBottom: 'var(--space-8)',
        border: '1px solid var(--color-border-light)',
      }
    },
      el('div', {
        style: {
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--font-medium)',
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-3)',
        }
      }, 'Pipeline Status Breakdown'),
      el('div', { class: 'pipeline-bar', style: { height: '12px' } },
        ...buildPipelineSegments(opportunities)
      ),
      el('div', {
        style: {
          display: 'flex',
          gap: 'var(--space-6)',
          marginTop: 'var(--space-3)',
          flexWrap: 'wrap',
        }
      },
        legendItem('Registered', 'registered', opportunities.filter(o => o.status === 'Registered').length),
        legendItem('In Progress', 'in-progress', opportunities.filter(o => o.status === 'In Progress').length),
        legendItem('Won', 'won', wonDeals.length),
        legendItem('Lost', 'lost', opportunities.filter(o => o.status === 'Lost').length)
      )
    ),

    // Partner cards
    el('h3', {
      style: {
        fontSize: 'var(--text-lg)',
        fontWeight: 'var(--font-semibold)',
        marginBottom: 'var(--space-4)',
      }
    }, 'Partners'),
    partnerStats.length > 0
      ? el('div', { class: 'card-grid stagger' },
          ...partnerStats.map(({ partner, stats }) => partnerCard(partner, stats))
        )
      : el('div', { class: 'empty-state' },
          el('div', { class: 'empty-state__title' }, 'No partners yet'),
          el('div', { class: 'empty-state__description' }, 'Add your first partner to start tracking their pipeline.')
        )
  );

  mount(container, content);
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
    el('div', {
      style: {
        width: '8px', height: '8px',
        borderRadius: 'var(--radius-full)',
        background: colors[status],
      }
    }),
    el('span', { style: { color: 'var(--color-text-secondary)' } }, `${label} (${count})`)
  );
}

export function cleanup() {}

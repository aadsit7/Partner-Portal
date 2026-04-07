// ============================================
// Admin Partner Management View
// ============================================

import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { sha256 } from '../utils/hash.js';
import { el, mount, uuid, $, debounce, formatCurrency, collapsibleSection } from '../utils/dom.js';
import { navigate } from '../router.js';
import { nowISO, formatDate } from '../utils/date.js';
import { tierSlug, TIER_OPTIONS, TIER_COLORS } from '../utils/tiers.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { filterPartners } from '../utils/filters.js';

export const title = 'Partners';

let allPartners = [];
let partnerRevenue = {};

export async function render(container) {
  setTopbarTitle('Partner Management');

  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [partners, opportunities] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
    ]);
    allPartners = partners;

    // Compute revenue lookup per partner
    partnerRevenue = {};
    for (const opp of opportunities) {
      const pid = opp.partner_id;
      if (!partnerRevenue[pid]) partnerRevenue[pid] = { totalPipeline: 0, oppCount: 0 };
      partnerRevenue[pid].totalPipeline += parseFloat(opp.deal_value) || 0;
      partnerRevenue[pid].oppCount += 1;
    }

    const partnerList = filterPartners(allPartners);
    renderView(container, partnerList);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading partners'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function reRender() {
  const viewContainer = document.getElementById('view-container');
  render(viewContainer);
}

function partnerInitials(name) {
  return (name || '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

// ============================================
// Bento Dashboard
// ============================================

const TYPE_COLORS = {
  'Technology':                'var(--color-primary-lighter)',
  'OEM':                       'var(--color-warning)',
  'MSP/SI':                    'var(--color-accent)',
  'MENA Regional Distributor': 'var(--color-danger)',
};

function renderBentoDashboard(partners, onFilter) {
  return el('div', { class: 'bento-grid--partners stagger' },
    buildHeroStat(partners),
    buildTypeBars(partners, onFilter),
  );
}

function buildHeroStat(partners) {
  const activeCount = partners.filter(p => (p.status || 'active').toLowerCase() === 'active').length;
  return el('div', { class: 'bento-cell bento-cell--accent-primary' },
    el('div', { class: 'bento-cell__title' }, 'Total Partners'),
    el('div', { class: 'bento-cell__value' }, String(partners.length)),
    el('div', { class: 'bento-cell__subtitle' }, `${activeCount} active`),
  );
}

function buildTypeBars(partners, onFilter) {
  const typeCounts = {};
  partners.forEach(p => {
    const t = p.partner_type || 'Other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

  const rows = sorted.map(([type, count]) => {
    const pct = (count / maxCount) * 100;
    const color = TYPE_COLORS[type] || 'var(--color-text-muted)';

    return el('div', {
      class: 'bento-bar-row bento-bar-row--clickable',
      dataset: { filterKey: 'type', filterValue: type },
      onClick: () => onFilter && onFilter('type', type),
    },
      el('div', { class: 'bento-bar-row__label' }, type),
      el('div', { class: 'bento-bar-row__track' },
        el('div', { class: 'bento-bar-row__fill', style: { width: pct + '%', background: color } })
      ),
      el('div', { class: 'bento-bar-row__count' }, String(count)),
    );
  });

  return el('div', { class: 'bento-cell' },
    el('div', { class: 'bento-cell__title' }, 'By Type'),
    ...rows,
  );
}

// ============================================
// Main View
// ============================================

function renderView(container, partners) {
  let searchQuery = '';
  let bentoFilter = { key: null, value: null };

  const premierCount = partners.filter(p => (p.tier || '').toLowerCase().includes('premier')).length;

  function applyFilters() {
    let result = [...partners];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.display_name?.toLowerCase().includes(q) ||
        p.username?.toLowerCase().includes(q) ||
        p.partner_type?.toLowerCase().includes(q) ||
        p.region?.toLowerCase().includes(q) ||
        p.hq_location?.toLowerCase().includes(q)
      );
    }
    if (bentoFilter.key === 'type') result = result.filter(p => p.partner_type === bentoFilter.value);
    return result;
  }

  function onBentoFilter(key, value) {
    // Toggle: clicking same bar again clears the filter
    if (bentoFilter.key === key && bentoFilter.value === value) {
      bentoFilter = { key: null, value: null };
    } else {
      bentoFilter = { key, value };
    }
    // Update active states on all bar rows
    document.querySelectorAll('.bento-bar-row--clickable').forEach(row => {
      const isActive = bentoFilter.key === row.dataset.filterKey && bentoFilter.value === row.dataset.filterValue;
      row.classList.toggle('bento-bar-row--active', isActive);
    });
    renderCards(applyFilters());
  }

  const content = el('div', {},
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Partners'),
        el('p', { class: 'section-header__subtitle' }, `${partners.length} registered partners`)
      ),
      el('div', { style: { display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' } },
        el('div', { class: 'search-bar' },
          el('span', { class: 'search-bar__icon', html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          el('input', {
            class: 'search-bar__input',
            type: 'text',
            placeholder: 'Search partners...',
            onInput: debounce((e) => {
              searchQuery = e.target.value;
              renderCards(applyFilters());
            }, 200),
          })
        ),
        el('button', {
          class: 'btn btn--primary',
          onClick: () => openPartnerModal(null),
        },
          el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          'Add Partner'
        ),
      )
    ),

    // Bento dashboard (collapsible)
    collapsibleSection({
      id: 'admin-partners-bento',
      title: 'Partner Overview',
      summaryItems: [
        { value: String(partners.length), label: 'Partners' },
        { value: String(premierCount), label: 'Premier' },
      ],
      content: renderBentoDashboard(partners, onBentoFilter),
    }),

    el('div', { id: 'partners-grid' })
  );

  mount(container, content);
  renderCards(applyFilters());
}

function renderCards(partners) {
  const grid = $('#partners-grid');
  if (!grid) return;

  if (partners.length === 0) {
    grid.innerHTML = '';
    grid.appendChild(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state__title' }, 'No partners found'),
        el('div', { class: 'empty-state__description' }, 'Try adjusting your search or add a new partner.')
      )
    );
    return;
  }

  grid.innerHTML = '';
  grid.className = 'partner-card-grid stagger';

  // Sort by pipeline revenue (desc), then by opportunity count (desc)
  const sorted = [...partners].sort((a, b) => {
    const aRev = partnerRevenue[a.partner_id]?.totalPipeline || 0;
    const bRev = partnerRevenue[b.partner_id]?.totalPipeline || 0;
    if (bRev !== aRev) return bRev - aRev;
    const aOpp = partnerRevenue[a.partner_id]?.oppCount || 0;
    const bOpp = partnerRevenue[b.partner_id]?.oppCount || 0;
    return bOpp - aOpp;
  });

  sorted.forEach(p => {
    const tierClass = tierSlug(p.tier);
    const initials = partnerInitials(p.display_name);
    const rev = partnerRevenue[p.partner_id];
    const pipeline = rev ? rev.totalPipeline : 0;
    const oppCount = rev ? rev.oppCount : 0;

    const card = el('div', { class: 'partner-mgmt-card' },
      // Card header with avatar and info
      el('div', { class: 'partner-mgmt-card__header' },
        el('div', { class: `partner-avatar partner-avatar--${tierClass}` }, initials),
        el('div', { class: 'partner-mgmt-card__info' },
          el('div', { class: 'partner-mgmt-card__name' }, p.display_name),
          el('div', { class: 'partner-mgmt-card__username' }, p.username),
        ),
        el('span', { class: `badge badge--${tierClass}` }, p.tier || 'Registered')
      ),

      // Card details
      el('div', { class: 'partner-mgmt-card__details' },
        detailRow('Pipeline', formatCurrency(pipeline)),
        detailRow('Opportunities', String(oppCount)),
        detailRow('Type', p.partner_type || '—'),
        detailRow('Status', null, el('span', { class: `badge badge--xs badge--${p.status?.toLowerCase() || 'active'}` }, p.status || 'active')),
      ),

      // Card actions
      el('div', { class: 'partner-mgmt-card__actions' },
        el('button', {
          class: 'btn btn--primary btn--sm',
          style: { flex: '1' },
          onClick: () => navigate(`/admin/partner-detail?id=${p.partner_id}`),
        }, 'View'),
        el('button', {
          class: 'btn btn--secondary btn--sm',
          style: { flex: '1' },
          onClick: () => openPartnerModal(p),
        }, 'Edit'),
        el('button', {
          class: 'btn btn--ghost btn--sm btn--icon',
          style: { color: 'var(--color-danger)' },
          title: 'Delete partner',
          onClick: () => handleDelete(p),
          html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M12.67 4v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        }),
      )
    );

    grid.appendChild(card);
  });
}

function detailRow(label, textValue, element) {
  return el('div', { class: 'partner-mgmt-card__row' },
    el('span', { class: 'partner-mgmt-card__label' }, label),
    element || el('span', { class: 'partner-mgmt-card__value' }, textValue || '—'),
  );
}

async function handleDelete(partner) {
  const confirmed = await confirmDialog(
    'Delete Partner',
    `Are you sure you want to delete "${partner.display_name}"? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    if (isConfigured()) {
      await deleteRow(CONFIG.SHEET_PARTNERS, partner._rowIndex);
    } else {
      deleteDemoRow(CONFIG.SHEET_PARTNERS, partner._rowIndex);
    }
    showToast('Partner deleted', 'success');
    reRender();
  } catch (err) {
    showToast(err.message || 'Failed to delete partner', 'error');
  }
}

function openPartnerModal(partner) {
  const isEdit = !!partner;

  const fields = [
    { name: 'username', label: 'Username', required: true, placeholder: 'e.g., nerdio' },
    { name: 'display_name', label: 'Company Name', required: true, placeholder: 'e.g., Nerdio' },
    { type: 'row-start' },
    {
      name: 'partner_type', label: 'Partner Type', type: 'select', required: true,
      placeholder: 'Select type...',
      options: ['Technology', 'MSP/SI', 'OEM', 'MENA Regional Distributor'],
    },
    {
      name: 'tier', label: 'Tier', type: 'select', required: true,
      placeholder: 'Select tier...',
      options: TIER_OPTIONS,
    },
    { type: 'row-end' },
    { type: 'row-start' },
    { name: 'region', label: 'Region', required: true, placeholder: 'e.g., North America' },
    {
      name: 'status', label: 'Status', type: 'select',
      default: 'active',
      options: ['active', 'inactive'],
    },
    { type: 'row-end' },
    { name: 'hq_location', label: 'HQ Location', placeholder: 'e.g., Chicago, Illinois, USA' },
  ];

  const initialValues = isEdit ? {
    username: partner.username,
    display_name: partner.display_name,
    partner_type: partner.partner_type,
    tier: partner.tier,
    region: partner.region,
    status: partner.status,
    hq_location: partner.hq_location,
  } : {};

  const form = buildForm(fields, async (data) => {
    try {
      if (isEdit) {
        const values = [
          partner.partner_id,
          data.username,
          data.display_name,
          data.partner_type,
          data.tier,
          data.region,
          partner.created_at,
          partner.is_admin || 'FALSE',
          partner.password_hash || '',
          data.status,
          data.hq_location || '',
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_PARTNERS, partner._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_PARTNERS, partner._rowIndex, values);
        }

        showToast('Partner updated successfully!', 'success');
      } else {
        const passwordHash = await sha256(CONFIG.DEFAULT_PASSWORD);
        const values = [
          uuid('p'),
          data.username,
          data.display_name,
          data.partner_type,
          data.tier,
          data.region,
          nowISO(),
          'FALSE',
          passwordHash,
          data.status || 'active',
          data.hq_location || '',
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_PARTNERS, values);
        } else {
          addDemoRow(CONFIG.SHEET_PARTNERS, values);
        }

        showToast('Partner added successfully!', 'success');
      }

      closeModal();
      reRender();
    } catch (err) {
      showToast(err.message || 'Failed to save partner', 'error');
    }
  }, initialValues);

  openModal({
    title: isEdit ? 'Edit Partner' : 'Add New Partner',
    content: form,
    footer: [
      el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
      }, isEdit ? 'Save Changes' : 'Add Partner'),
    ],
  });
}

export function cleanup() {}

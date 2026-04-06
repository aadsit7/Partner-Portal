// ============================================
// Admin Partner Management View
// ============================================

import { readSheetAsObjects, appendRow, updateRow, isConfigured, addDemoRow, updateDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { sha256 } from '../utils/hash.js';
import { el, mount, uuid, $, debounce } from '../utils/dom.js';
import { navigate } from '../router.js';
import { nowISO, formatDate } from '../utils/date.js';
import { openModal, closeModal } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Partners';

let allPartners = [];

export async function render(container) {
  setTopbarTitle('Partner Management');

  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    allPartners = await readSheetAsObjects(CONFIG.SHEET_PARTNERS);
    // Filter out admins from the list
    const partnerList = allPartners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
    renderView(container, partnerList);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading partners'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function renderView(container, partners) {
  let filtered = [...partners];

  const content = el('div', {},
    // Header
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
              const q = e.target.value.toLowerCase();
              filtered = partners.filter(p =>
                p.display_name?.toLowerCase().includes(q) ||
                p.username?.toLowerCase().includes(q) ||
                p.partner_type?.toLowerCase().includes(q) ||
                p.region?.toLowerCase().includes(q)
              );
              updateTable(filtered);
            }, 200),
          })
        ),
        el('button', {
          class: 'btn btn--primary',
          onClick: () => openPartnerModal(null, container),
        },
          el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          'Add Partner'
        ),
      )
    ),

    // Table
    el('div', { id: 'partners-table-wrapper' })
  );

  mount(container, content);
  updateTable(filtered);
}

function updateTable(partners) {
  const wrapper = $('#partners-table-wrapper');
  if (!wrapper) return;

  if (partners.length === 0) {
    wrapper.innerHTML = '';
    wrapper.appendChild(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state__title' }, 'No partners found'),
        el('div', { class: 'empty-state__description' }, 'Try adjusting your search or add a new partner.')
      )
    );
    return;
  }

  const table = el('div', { class: 'table-wrapper' },
    el('table', { class: 'table' },
      el('thead', {},
        el('tr', {},
          el('th', {}, 'Partner'),
          el('th', {}, 'Type'),
          el('th', {}, 'Tier'),
          el('th', {}, 'Region'),
          el('th', {}, 'Status'),
          el('th', {}, 'Joined'),
          el('th', {}, 'Actions')
        )
      ),
      el('tbody', {},
        ...partners.map(p =>
          el('tr', {},
            el('td', {},
              el('div', { style: { fontWeight: 'var(--font-semibold)' } }, p.display_name),
              el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' } }, p.username)
            ),
            el('td', {},
              el('span', { class: `badge badge--${p.partner_type === 'Technology' ? 'admin' : 'in-progress'}` }, p.partner_type || '—')
            ),
            el('td', {}, el('span', { class: `badge badge--${p.tier?.toLowerCase() || 'bronze'}` }, p.tier || 'Bronze')),
            el('td', {}, p.region),
            el('td', {}, el('span', { class: `badge badge--${p.status?.toLowerCase() || 'active'}` }, p.status || 'active')),
            el('td', {}, formatDate(p.created_at)),
            el('td', {},
              el('div', { class: 'table__actions' },
                el('button', {
                  class: 'btn btn--ghost btn--sm',
                  style: { color: 'var(--color-primary)' },
                  onClick: () => navigate(`/admin/partner-detail?id=${p.partner_id}`),
                }, 'View'),
                el('button', {
                  class: 'btn btn--ghost btn--sm',
                  onClick: () => openPartnerModal(p),
                }, 'Edit')
              )
            )
          )
        )
      )
    )
  );

  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}

function openPartnerModal(partner, container) {
  const isEdit = !!partner;

  const fields = [
    { name: 'username', label: 'Username', required: true, placeholder: 'e.g., nerdio' },
    { name: 'display_name', label: 'Company Name', required: true, placeholder: 'e.g., Nerdio' },
    { type: 'row-start' },
    {
      name: 'partner_type', label: 'Partner Type', type: 'select', required: true,
      placeholder: 'Select type...',
      options: ['Technology', 'MSP/SI'],
    },
    {
      name: 'tier', label: 'Tier', type: 'select', required: true,
      placeholder: 'Select tier...',
      options: ['Gold', 'Silver', 'Bronze'],
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
  ];

  const initialValues = isEdit ? {
    username: partner.username,
    display_name: partner.display_name,
    partner_type: partner.partner_type,
    tier: partner.tier,
    region: partner.region,
    status: partner.status,
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
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_PARTNERS, values);
        } else {
          addDemoRow(CONFIG.SHEET_PARTNERS, values);
        }

        showToast('Partner added successfully!', 'success');
      }

      closeModal();
      // Re-render
      const viewContainer = document.getElementById('view-container');
      await render(viewContainer);
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

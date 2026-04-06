// ============================================
// Admin Opportunities Management View
// ============================================

import { getCurrentUser } from '../auth.js';
import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, uuid, $, debounce, formatCurrency } from '../utils/dom.js';
import { nowISO, formatDate } from '../utils/date.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { showToast } from '../components/toast.js';
import { setTopbarTitle } from '../components/sidebar.js';

export const title = 'Opportunities';

let cachedPartners = null;

export async function render(container) {
  setTopbarTitle('Opportunities');

  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [opportunities, partners] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
    ]);
    cachedPartners = partners.filter(p => String(p.is_admin).toUpperCase() !== 'TRUE');
    renderView(container, opportunities);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading opportunities'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function getPartnerName(partnerId) {
  if (!partnerId || !cachedPartners) return '';
  const p = cachedPartners.find(p => p.partner_id === partnerId);
  return p ? p.display_name : partnerId;
}

function renderView(container, opportunities) {
  let filtered = [...opportunities];
  let activePartnerFilter = '';

  const partnerOptions = [
    el('option', { value: '' }, 'All Partners'),
    ...(cachedPartners || []).map(p =>
      el('option', { value: p.partner_id }, p.display_name)
    ),
  ];

  // Stats
  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const activeDeals = opportunities.filter(o => o.status !== 'Won' && o.status !== 'Lost');

  const tableWrapper = el('div', { id: 'opps-table-wrapper' });

  const content = el('div', {},
    el('div', { class: 'section-header' },
      el('div', {},
        el('h2', { class: 'section-header__title' }, 'Opportunities'),
        el('p', { class: 'section-header__subtitle' }, `${opportunities.length} total opportunities · ${formatCurrency(totalValue)} pipeline`)
      ),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => openOppModal(null, container),
      },
        el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'New Opportunity'
      ),
    ),

    // Stats bar
    el('div', { class: 'stats-grid stagger', style: { marginBottom: 'var(--space-6)' } },
      statMini('Total Deals', opportunities.length),
      statMini('Active Pipeline', formatCurrency(totalValue - wonValue)),
      statMini('Won Revenue', formatCurrency(wonValue)),
      statMini('Active', activeDeals.length),
    ),

    // Filter bar
    el('div', { class: 'filter-bar' },
      el('div', { class: 'filter-bar__search' },
        el('span', { class: 'search-bar__icon', html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        el('input', {
          class: 'search-bar__input',
          type: 'text',
          placeholder: 'Search opportunities...',
          onInput: debounce((e) => {
            const q = e.target.value.toLowerCase();
            filtered = opportunities.filter(o => {
              const matchesPartner = !activePartnerFilter || o.partner_id === activePartnerFilter;
              const matchesSearch = !q
                || o.deal_name?.toLowerCase().includes(q)
                || o.customer_name?.toLowerCase().includes(q)
                || getPartnerName(o.partner_id)?.toLowerCase().includes(q);
              return matchesPartner && matchesSearch;
            });
            updateTable(tableWrapper, filtered, container);
          }, 200),
        })
      ),
      el('select', {
        class: 'form-select filter-bar__select',
        onChange: (e) => {
          activePartnerFilter = e.target.value;
          const searchVal = document.querySelector('.filter-bar .search-bar__input')?.value?.toLowerCase() || '';
          filtered = opportunities.filter(o => {
            const matchesPartner = !activePartnerFilter || o.partner_id === activePartnerFilter;
            const matchesSearch = !searchVal
              || o.deal_name?.toLowerCase().includes(searchVal)
              || o.customer_name?.toLowerCase().includes(searchVal);
            return matchesPartner && matchesSearch;
          });
          updateTable(tableWrapper, filtered, container);
        }
      }, ...partnerOptions),
    ),

    tableWrapper,
  );

  mount(container, content);
  updateTable(tableWrapper, filtered, container);
}

function updateTable(wrapper, opportunities, container) {
  const sorted = [...opportunities].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

  wrapper.innerHTML = '';

  if (sorted.length === 0) {
    wrapper.appendChild(
      el('div', { class: 'empty-state', style: { marginTop: 'var(--space-8)' } },
        el('div', { class: 'empty-state__title' }, 'No matching opportunities'),
        el('div', { class: 'empty-state__description' }, 'Try adjusting your filters or create a new opportunity.')
      )
    );
    return;
  }

  wrapper.appendChild(
    el('div', { class: 'table-wrapper' },
      el('table', { class: 'table' },
        el('thead', {},
          el('tr', {},
            el('th', {}, 'Deal'),
            el('th', {}, 'Partner'),
            el('th', {}, 'Value'),
            el('th', {}, 'Stage'),
            el('th', {}, 'Status'),
            el('th', {}, 'Close Date'),
            el('th', {}, 'Actions')
          )
        ),
        el('tbody', {},
          ...sorted.map(opp =>
            el('tr', {},
              el('td', {},
                el('div', { style: { fontWeight: 'var(--font-semibold)' } }, opp.deal_name),
                el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' } }, opp.customer_name)
              ),
              el('td', {},
                el('span', { class: 'badge badge--admin' }, getPartnerName(opp.partner_id))
              ),
              el('td', { style: { fontWeight: 'var(--font-semibold)' } },
                formatCurrency(parseFloat(opp.deal_value) || 0)
              ),
              el('td', {},
                el('span', { class: 'badge badge--silver' }, opp.stage)
              ),
              el('td', {},
                el('span', { class: `badge badge--${getStatusBadge(opp.status)}` }, opp.status)
              ),
              el('td', {}, opp.expected_close ? formatDate(opp.expected_close) : '—'),
              el('td', {},
                el('div', { class: 'table__actions' },
                  el('button', {
                    class: 'btn btn--ghost btn--sm',
                    onClick: () => openOppModal(opp, container),
                  }, 'Edit'),
                  el('button', {
                    class: 'btn btn--ghost btn--sm',
                    style: { color: 'var(--color-danger)' },
                    onClick: () => handleDelete(opp, container),
                  }, 'Delete')
                )
              )
            )
          )
        )
      )
    )
  );
}

function getStatusBadge(status) {
  const map = {
    'Registered': 'registered',
    'In Progress': 'in-progress',
    'Won': 'won',
    'Lost': 'lost',
  };
  return map[status] || 'silver';
}

function statMini(label, value) {
  return el('div', { class: 'stat-card' },
    el('div', { class: 'stat-card__label' }, label),
    el('div', { class: 'stat-card__value' }, String(value)),
  );
}

export function openOppModal(opp, container, onSaved) {
  const isEdit = !!opp;

  const partnerOptions = (cachedPartners || []).map(p => ({
    value: p.partner_id,
    label: p.display_name,
  }));

  const fields = [
    { name: 'deal_name', label: 'Deal Name', required: true, placeholder: 'e.g., Enterprise Cloud Migration' },
    { name: 'customer_name', label: 'Customer Name', required: true, placeholder: 'e.g., Acme Corp' },
    {
      name: 'partner_id', label: 'Partner', type: 'select', required: true,
      placeholder: 'Select partner...',
      options: partnerOptions,
    },
    { type: 'row-start' },
    { name: 'deal_value', label: 'Deal Value ($)', type: 'number', required: true, placeholder: '0', min: 0 },
    { name: 'expected_close', label: 'Expected Close', type: 'date', required: true },
    { type: 'row-end' },
    { type: 'row-start' },
    {
      name: 'stage', label: 'Stage', type: 'select', required: true,
      placeholder: 'Select stage...',
      options: ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Closed'],
    },
    {
      name: 'status', label: 'Status', type: 'select',
      default: 'Registered',
      options: ['Registered', 'In Progress', 'Won', 'Lost'],
    },
    { type: 'row-end' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Brief description of the opportunity...' },
  ];

  const initialValues = isEdit ? {
    deal_name: opp.deal_name,
    customer_name: opp.customer_name,
    partner_id: opp.partner_id,
    deal_value: opp.deal_value,
    expected_close: opp.expected_close,
    stage: opp.stage,
    status: opp.status,
    description: opp.description,
  } : {};

  const form = buildForm(fields, async (data) => {
    try {
      if (isEdit) {
        const values = [
          opp.opportunity_id,
          data.partner_id,
          data.deal_name,
          data.customer_name,
          data.deal_value,
          data.status || 'Registered',
          data.stage,
          data.expected_close,
          data.description,
          opp.created_at,
          nowISO(),
        ];

        if (isConfigured()) {
          await updateRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex, values);
        } else {
          updateDemoRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex, values);
        }

        showToast('Opportunity updated!', 'success');
      } else {
        const values = [
          uuid('opp'),
          data.partner_id,
          data.deal_name,
          data.customer_name,
          data.deal_value,
          data.status || 'Registered',
          data.stage,
          data.expected_close,
          data.description,
          nowISO(),
          nowISO(),
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_OPPORTUNITIES, values);
        } else {
          addDemoRow(CONFIG.SHEET_OPPORTUNITIES, values);
        }

        showToast('Opportunity created!', 'success');
      }

      closeModal();

      if (onSaved) {
        onSaved();
      } else {
        const viewContainer = document.getElementById('view-container');
        await render(viewContainer);
      }
    } catch (err) {
      showToast(err.message || 'Failed to save opportunity', 'error');
    }
  }, initialValues);

  openModal({
    title: isEdit ? 'Edit Opportunity' : 'New Opportunity',
    content: form,
    footer: [
      el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel'),
      el('button', {
        class: 'btn btn--primary',
        onClick: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
      }, isEdit ? 'Save Changes' : 'Create Opportunity'),
    ],
  });
}

async function handleDelete(opp, container) {
  const confirmed = await confirmDialog(
    'Delete Opportunity',
    `Are you sure you want to delete "${opp.deal_name}"? This action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    if (isConfigured()) {
      await deleteRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex);
    } else {
      deleteDemoRow(CONFIG.SHEET_OPPORTUNITIES, opp._rowIndex);
    }

    showToast('Opportunity deleted', 'success');
    const viewContainer = document.getElementById('view-container');
    await render(viewContainer);
  } catch (err) {
    showToast(err.message || 'Failed to delete opportunity', 'error');
  }
}

export function cleanup() {
  cachedPartners = null;
}

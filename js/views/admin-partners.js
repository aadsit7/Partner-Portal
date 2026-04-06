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

  // Track the logo data URL
  let logoDataUrl = isEdit ? (partner.logo_url || '') : '';

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
          logoDataUrl,
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
          logoDataUrl,
        ];

        if (isConfigured()) {
          await appendRow(CONFIG.SHEET_PARTNERS, values);
        } else {
          addDemoRow(CONFIG.SHEET_PARTNERS, values);
        }

        showToast('Partner added successfully!', 'success');
      }

      closeModal();
      const viewContainer = document.getElementById('view-container');
      await render(viewContainer);
    } catch (err) {
      showToast(err.message || 'Failed to save partner', 'error');
    }
  }, initialValues);

  // Add logo upload area after the form fields
  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    style: { display: 'none' },
    id: 'logo-file-input',
  });

  const previewEl = logoDataUrl
    ? el('img', { src: logoDataUrl, class: 'logo-preview__img' })
    : el('div', { class: 'logo-preview__placeholder' },
        el('span', { html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
        'Upload Logo'
      );

  const previewContainer = el('div', { class: 'logo-preview', id: 'logo-preview' }, previewEl);

  const removeBtn = logoDataUrl
    ? el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        style: { color: 'var(--color-danger)' },
        onClick: () => {
          logoDataUrl = '';
          updateLogoPreview('');
        },
      }, 'Remove')
    : null;

  const logoUpload = el('div', { class: 'form-group' },
    el('label', { class: 'form-label' }, 'Partner Logo'),
    el('div', { class: 'logo-upload', onClick: () => fileInput.click() },
      previewContainer,
    ),
    el('div', { style: { display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' } },
      el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        onClick: () => fileInput.click(),
      }, 'Choose File'),
      removeBtn,
    ),
    fileInput,
  );

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    logoDataUrl = await resizeImage(file, 128);
    updateLogoPreview(logoDataUrl);
  });

  function updateLogoPreview(url) {
    const container = document.getElementById('logo-preview');
    if (!container) return;
    container.innerHTML = '';
    if (url) {
      container.appendChild(el('img', { src: url, class: 'logo-preview__img' }));
    } else {
      container.appendChild(
        el('div', { class: 'logo-preview__placeholder' },
          el('span', { html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          'Upload Logo'
        )
      );
    }
  }

  form.appendChild(logoUpload);

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

/**
 * Resize an image file to a square thumbnail and return as base64 data URL.
 */
function resizeImage(file, maxSize = 128) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function cleanup() {}

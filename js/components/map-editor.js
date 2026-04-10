// ============================================
// MAP / Meeting Doc Editable Pop-out
// ============================================
// Unified editable pop-out modal for meeting documents (MAPs, Recaps,
// Biweekly updates, etc.). Used by both the Partner Detail MAP list and
// the Meeting Docs chatbot. The modal supports two modes:
//
//   - "new" (doc._rowIndex is missing): Save button appends a new row.
//   - "existing" (doc._rowIndex present): Save button updates that row.
//
// The modal uses a textarea-based HTML source editor paired with a
// sandboxed iframe preview, instead of a rich-text editor like Quill —
// Quill would strip inline styles and tables, which would break the
// branded MAP formatting. For higher-level edits the user clicks
// "Ask Assistant" which hands the current (possibly unsaved) HTML back
// to the Meeting Docs chatbot for natural-language revision.

import { el, uuid } from '../utils/dom.js';
import { CONFIG } from '../config.js';
import {
  appendRow, updateRow, deleteRow,
  isConfigured, addDemoRow, updateDemoRow, deleteDemoRow,
} from '../sheets.js';
import { openModal, closeModal, confirmDialog } from './modal.js';
import { showToast } from './toast.js';
import { formatDate, nowISO } from '../utils/date.js';

// ============================================
// Doc Type Helpers (shared)
// ============================================

export function docTypeClass(docType) {
  const t = (docType || '').toLowerCase().trim();
  if (t === 'pre-meeting' || t === 'premeeting') return 'pre-meeting';
  if (t === 'biweekly') return 'biweekly';
  if (t === 'map' || t === 'mutual action plan') return 'map';
  if (t === 'recap' || t === 'meeting recap') return 'recap';
  return 'default';
}

export function docTypeLabel(docType) {
  const t = (docType || '').toLowerCase().trim();
  if (t === 'pre-meeting' || t === 'premeeting') return 'Pre-Meeting';
  if (t === 'biweekly') return 'Biweekly';
  if (t === 'map' || t === 'mutual action plan') return 'MAP';
  if (t === 'recap' || t === 'meeting recap') return 'Recap';
  return docType || 'Document';
}

// ============================================
// Editable Pop-out Modal
// ============================================

/**
 * Open an editable pop-out for a meeting document.
 *
 * @param {Object} opts
 * @param {Object} opts.partner - Partner object (partner_id, display_name, ...)
 * @param {Object} opts.doc - Doc object. Shape:
 *   { partner_id, partner_name, title, doc_type, html_content,
 *     document_id?, _rowIndex?, status?, created_at?, updated_at? }
 *   If _rowIndex is present, Save updates that row; otherwise Save appends.
 * @param {Array}  [opts.transcripts] - Partner's transcripts (passed through to Ask Assistant)
 * @param {Function} [opts.onSaved] - Called after a successful save
 * @param {Function} [opts.onDeleted] - Called after a successful delete
 * @param {Function} [opts.onAskAssistant] - Called when user clicks "Ask Assistant".
 *   Receives { html, doc } where `html` is the current (possibly unsaved)
 *   textarea content and `doc` has title/html_content merged in. If omitted,
 *   the Ask Assistant button is hidden.
 */
export function openMapEditorModal({
  partner,
  doc,
  transcripts = [],
  onSaved,
  onDeleted,
  onAskAssistant,
}) {
  if (!partner || !doc) {
    showToast('Cannot open editor: missing partner or document', 'error');
    return;
  }

  const isNew = !doc._rowIndex;

  // Live state captured in closures
  let currentHtml = doc.html_content || '';
  let currentTitle = doc.title || '';
  let isEditing = false;

  // ---- Header: editable title + metadata ----
  const titleInput = el('input', {
    class: 'map-editor__title',
    type: 'text',
    placeholder: 'Document title',
    onInput: (e) => { currentTitle = e.target.value; },
  });
  titleInput.value = currentTitle;

  const typeBadge = el('span', {
    class: `doc-type-badge doc-type-badge--${docTypeClass(doc.doc_type)}`,
  }, docTypeLabel(doc.doc_type));

  const metaChildren = [typeBadge];
  if (!isNew) {
    metaChildren.push(el('span', { class: 'map-editor__meta-item' }, `Created ${formatDate(doc.created_at) || '—'}`));
    if (doc.updated_at && doc.updated_at !== doc.created_at) {
      metaChildren.push(el('span', { class: 'map-editor__meta-item' }, `Updated ${formatDate(doc.updated_at)}`));
    }
    metaChildren.push(el('span', {
      class: `map-status-badge map-status-badge--${doc.status || 'active'}`,
    }, doc.status === 'archived' ? 'Archived' : 'Active'));
  } else {
    metaChildren.push(el('span', { class: 'map-editor__meta-item' }, 'Unsaved — click Save to persist'));
  }

  const meta = el('div', { class: 'map-editor__meta' }, ...metaChildren);

  const headerEl = el('div', { class: 'map-editor__header' }, titleInput, meta);

  // ---- Preview iframe ----
  const previewIframe = el('iframe', {
    class: 'map-editor__iframe',
    sandbox: 'allow-same-origin',
  });
  previewIframe.srcdoc = currentHtml || '<p style="font-family: sans-serif; padding: 24px; color: #888;">No content</p>';

  // ---- Source textarea ----
  const sourceTextarea = el('textarea', {
    class: 'map-editor__source',
    spellcheck: 'false',
    placeholder: 'HTML source…',
    onInput: (e) => { currentHtml = e.target.value; },
  });
  sourceTextarea.value = currentHtml;

  const bodyContainer = el('div', { class: 'map-editor__body' }, previewIframe);

  // ---- Toolbar: Preview / Edit HTML toggle ----
  const previewBtn = el('button', {
    class: 'btn btn--ghost btn--sm map-editor__tab map-editor__tab--active',
    type: 'button',
  }, 'Preview');

  const editBtn = el('button', {
    class: 'btn btn--ghost btn--sm map-editor__tab',
    type: 'button',
  }, 'Edit HTML');

  previewBtn.addEventListener('click', () => {
    if (!isEditing) return;
    isEditing = false;
    // Refresh iframe with the latest edits from the textarea
    previewIframe.srcdoc = currentHtml || '<p style="font-family: sans-serif; padding: 24px; color: #888;">No content</p>';
    bodyContainer.innerHTML = '';
    bodyContainer.appendChild(previewIframe);
    previewBtn.classList.add('map-editor__tab--active');
    editBtn.classList.remove('map-editor__tab--active');
  });

  editBtn.addEventListener('click', () => {
    if (isEditing) return;
    isEditing = true;
    sourceTextarea.value = currentHtml;
    bodyContainer.innerHTML = '';
    bodyContainer.appendChild(sourceTextarea);
    previewBtn.classList.remove('map-editor__tab--active');
    editBtn.classList.add('map-editor__tab--active');
    setTimeout(() => sourceTextarea.focus(), 50);
  });

  const toolbar = el('div', { class: 'map-editor__toolbar' }, previewBtn, editBtn);

  // ---- Modal body ----
  const modalBody = el('div', { class: 'map-editor' },
    headerEl,
    toolbar,
    bodyContainer,
  );

  // ---- Footer buttons ----
  const cancelBtn = el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel');

  const deleteBtn = !isNew ? el('button', {
    class: 'btn btn--ghost',
    style: { color: 'var(--color-danger, #CC2222)' },
    onClick: async () => {
      const confirmed = await confirmDialog(
        'Delete Document',
        `Permanently delete "${currentTitle || doc.title || 'this document'}"? This cannot be undone.`
      );
      if (!confirmed) return;
      try {
        if (isConfigured()) {
          await deleteRow(CONFIG.SHEET_PARTNER_DOCUMENTS, doc._rowIndex);
        } else {
          deleteDemoRow(CONFIG.SHEET_PARTNER_DOCUMENTS, doc._rowIndex);
        }
        showToast('Document deleted', 'success');
        closeModal();
        if (onDeleted) { try { onDeleted(); } catch { /* ignore */ } }
        if (onSaved) { try { onSaved(); } catch { /* ignore */ } }
      } catch (err) {
        showToast(err.message || 'Failed to delete', 'error');
      }
    },
  }, 'Delete') : null;

  const askAssistantBtn = onAskAssistant ? el('button', {
    class: 'btn btn--ghost',
    onClick: () => {
      // Hand the current (possibly unsaved) HTML to the assistant so it
      // updates from the latest state, not the DB version.
      closeModal();
      try {
        onAskAssistant({
          html: currentHtml,
          doc: { ...doc, title: currentTitle, html_content: currentHtml },
        });
      } catch (err) {
        showToast(err.message || 'Failed to open assistant', 'error');
      }
    },
  }, 'Ask Assistant') : null;

  const saveBtn = el('button', {
    class: 'btn btn--primary',
    onClick: async () => {
      saveBtn.disabled = true;
      const originalLabel = isNew ? 'Save to Partner' : 'Save Changes';
      saveBtn.textContent = 'Saving…';
      try {
        const title = (currentTitle || '').trim() || `${partner.display_name} Document`;
        const now = nowISO();

        if (isNew) {
          const values = [
            uuid('doc'),
            partner.partner_id,
            partner.display_name,
            title,
            doc.doc_type || 'recap',
            currentHtml,
            'active',
            now,
            now,
          ];
          if (isConfigured()) {
            await appendRow(CONFIG.SHEET_PARTNER_DOCUMENTS, values);
          } else {
            addDemoRow(CONFIG.SHEET_PARTNER_DOCUMENTS, values);
          }
          showToast('Document saved to partner', 'success');
        } else {
          const values = [
            doc.document_id,
            partner.partner_id,
            partner.display_name,
            title,
            doc.doc_type || 'recap',
            currentHtml,
            doc.status || 'active',
            doc.created_at || now,
            now,
          ];
          if (isConfigured()) {
            await updateRow(CONFIG.SHEET_PARTNER_DOCUMENTS, doc._rowIndex, values);
          } else {
            updateDemoRow(CONFIG.SHEET_PARTNER_DOCUMENTS, doc._rowIndex, values);
          }
          showToast('Document updated', 'success');
        }
        closeModal();
        if (onSaved) { try { onSaved(); } catch { /* ignore */ } }
      } catch (err) {
        showToast(err.message || 'Failed to save', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
      }
    },
  }, isNew ? 'Save to Partner' : 'Save Changes');

  const footerButtons = [cancelBtn, deleteBtn, askAssistantBtn, saveBtn].filter(Boolean);

  openModal({
    title: isNew ? (currentTitle || 'New Document') : (doc.title || 'Document'),
    content: modalBody,
    className: 'modal--wide modal--tall',
    footer: footerButtons,
  });
}

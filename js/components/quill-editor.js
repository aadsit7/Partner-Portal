// ============================================
// Shared Quill Rich Text Editor
// ============================================

import { el } from '../utils/dom.js';

// ---- HTML helpers ----

export function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

export function ensureHtml(text) {
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.replace(/\n/g, '<br>');
}

// ---- Shared toolbar config ----

const TOOLBAR_OPTIONS = [
  ['bold', 'italic', 'underline'],
  [{ header: [1, 2, 3, false] }],
  [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
  ['link'],
  ['clean'],
];

// ---- Editor factory ----

/**
 * Create a Quill rich-text editor with fullscreen support.
 *
 * Call this BEFORE opening the modal to get the wrapper element,
 * then call mount() AFTER the modal is in the DOM.
 *
 * @param {Object} opts
 * @param {string} [opts.placeholder]  - Placeholder text
 * @param {string} [opts.initialHtml]  - HTML to load into the editor
 * @param {string} [opts.title]        - Fullscreen header title
 * @param {function} [opts.onTextChange] - Called on every text-change (receives quill instance)
 * @returns {{ wrapper: HTMLElement, mount: function, getHtml: function, getText: function, isEmpty: function }}
 */
export function initQuillEditor({ placeholder = '', initialHtml = '', title = 'Edit', onTextChange } = {}) {
  const editorContainer = el('div', { class: 'quill-editor' });

  const fullscreenBtn = el('button', {
    class: 'quill-editor-expand-btn',
    type: 'button',
    title: 'Expand editor',
    html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 10v4h4M14 6V2h-4M2 6V2h4M14 10v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  });

  const wrapper = el('div', { class: 'quill-editor-wrapper' }, editorContainer, fullscreenBtn);

  let quill = null;

  function getHtml() {
    return quill ? quill.root.innerHTML.trim() : '';
  }

  function getText() {
    return quill ? quill.getText().trim() : '';
  }

  function isEmpty() {
    return !getText();
  }

  /**
   * Initialise Quill after the wrapper is in the DOM (e.g. inside a modal).
   * Must be called inside requestAnimationFrame or after a tick.
   */
  function mount() {
    requestAnimationFrame(() => {
      if (!window.Quill || !editorContainer.isConnected) return;

      quill = new Quill(editorContainer, {
        theme: 'snow',
        placeholder,
        modules: { toolbar: TOOLBAR_OPTIONS },
      });

      if (initialHtml) {
        quill.clipboard.dangerouslyPasteHTML(ensureHtml(initialHtml));
      }

      if (onTextChange) {
        quill.on('text-change', () => onTextChange(quill));
      }

      // ---- Fullscreen toggle ----
      let isFullscreen = false;

      const overlay = el('div', { class: 'quill-editor-fullscreen' });

      const collapseBtn = el('button', {
        class: 'quill-editor-collapse-btn',
        type: 'button',
        html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Close fullscreen',
        onClick: () => toggleFullscreen(),
      });

      const fullscreenHeader = el('div', { class: 'quill-editor-fullscreen__header' },
        el('span', { class: 'quill-editor-fullscreen__title' }, title),
        collapseBtn,
      );
      overlay.appendChild(fullscreenHeader);

      function toggleFullscreen() {
        isFullscreen = !isFullscreen;
        if (isFullscreen) {
          overlay.appendChild(editorContainer);
          document.body.appendChild(overlay);
          fullscreenBtn.style.display = 'none';
        } else {
          wrapper.insertBefore(editorContainer, fullscreenBtn);
          overlay.remove();
          fullscreenBtn.style.display = '';
        }
        quill.focus();
      }

      fullscreenBtn.addEventListener('click', toggleFullscreen);
    });
  }

  return { wrapper, mount, getHtml, getText, isEmpty };
}

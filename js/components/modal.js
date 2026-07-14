// ============================================
// Modal Dialog Component
// ============================================

import { el, $ } from '../utils/dom.js';

let currentModal = null;

let modalTitleSeq = 0;

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Keep Tab focus cycling inside `dialog`. Returns the keydown handler so the
 * caller can remove it on close.
 */
function trapFocus(dialog) {
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(dialog);
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', handler);
  return handler;
}

/** Move focus into a dialog, preferring the first field over the close button. */
function focusInitial(dialog) {
  const focusable = getFocusable(dialog);
  if (focusable.length === 0) return;
  const preferred = focusable.find(el => !el.classList.contains('modal__close')) || focusable[0];
  // Retry across a few frames — focusing while the backdrop is still fading
  // in can be rejected on the first tick.
  let tries = 0;
  const attempt = () => {
    if (!document.contains(preferred)) return;
    preferred.focus();
    if (document.activeElement === preferred) return;
    if (tries++ < 20) requestAnimationFrame(attempt);
  };
  attempt();
}

/**
 * Open a modal dialog.
 * @param {Object} options - { title, content, footer, onClose }
 * @returns {{ close: Function, element: HTMLElement }}
 */
export function openModal({ title, content, footer, onClose, className }) {
  // Close any existing modal
  closeModal();

  const modalClass = className ? `modal ${className}` : 'modal';
  const titleId = `modal-title-${++modalTitleSeq}`;

  const dialog = el('div', {
    class: modalClass,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  },
    el('div', { class: 'modal__header' },
      el('h2', { class: 'modal__title', id: titleId }, title),
      el('button', {
        class: 'modal__close',
        'aria-label': 'Close dialog',
        html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        onClick: closeModal,
      })
    ),
    el('div', { class: 'modal__body' }, ...(Array.isArray(content) ? content : [content])),
    footer ? el('div', { class: 'modal__footer' }, ...(Array.isArray(footer) ? footer : [footer])) : null
  );

  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => {
    if (e.target === backdrop) closeModal();
  }}, dialog);

  const root = $('#modal-root');
  const previouslyFocused = document.activeElement;
  root.appendChild(backdrop);

  // Trigger animation
  requestAnimationFrame(() => {
    backdrop.classList.add('modal-backdrop--visible');
    focusInitial(dialog);
  });

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', escHandler);
  const trapHandler = trapFocus(dialog);

  currentModal = { element: backdrop, escHandler, trapHandler, dialog, previouslyFocused, onClose };

  return {
    close: closeModal,
    element: backdrop,
  };
}

/**
 * Close the current modal.
 */
export function closeModal() {
  if (!currentModal) return;

  const { element, escHandler, trapHandler, dialog, previouslyFocused, onClose } = currentModal;

  element.classList.remove('modal-backdrop--visible');
  document.removeEventListener('keydown', escHandler);
  if (trapHandler && dialog) dialog.removeEventListener('keydown', trapHandler);

  // Restore focus to whatever was focused before the modal opened, so
  // keyboard users aren't dropped back at the top of the document.
  if (previouslyFocused && typeof previouslyFocused.focus === 'function'
      && document.contains(previouslyFocused)) {
    previouslyFocused.focus();
  }

  setTimeout(() => {
    element.remove();
    if (onClose) onClose();
  }, 250);

  currentModal = null;
}

/**
 * Open a confirm dialog layered on top of any existing modal.
 * Unlike openModal, this does NOT close the current modal — it mounts
 * its own overlay so the caller's modal remains intact.
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, message) {
  return new Promise((resolve) => {
    let settled = false;

    function dismiss(value) {
      if (settled) return;
      settled = true;
      backdrop.classList.remove('modal-backdrop--visible');
      document.removeEventListener('keydown', escHandler);
      if (trapHandler && dialog) dialog.removeEventListener('keydown', trapHandler);
      setTimeout(() => backdrop.remove(), 250);
      resolve(value);
    }

    const cancelBtn = el('button', {
      class: 'btn btn--secondary',
      onClick: () => dismiss(false),
    }, 'Cancel');

    const confirmBtn = el('button', {
      class: 'btn btn--danger',
      onClick: () => dismiss(true),
    }, 'Delete');

    const titleId = `confirm-title-${++modalTitleSeq}`;
    const dialog = el('div', {
      class: 'modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    },
      el('div', { class: 'modal__header' },
        el('h2', { class: 'modal__title', id: titleId }, title),
        el('button', {
          class: 'modal__close',
          'aria-label': 'Close dialog',
          html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
          onClick: () => dismiss(false),
        }),
      ),
      el('div', { class: 'modal__body' }, el('p', { class: 'confirm-text' }, message)),
      el('div', { class: 'modal__footer' }, cancelBtn, confirmBtn),
    );

    const backdrop = el('div', {
      class: 'modal-backdrop',
      style: { zIndex: '10001' },
      onClick: (e) => { if (e.target === backdrop) dismiss(false); },
    }, dialog);

    const escHandler = (e) => { if (e.key === 'Escape') dismiss(false); };
    document.addEventListener('keydown', escHandler);
    const trapHandler = trapFocus(dialog);

    const root = $('#modal-root') || document.body;
    root.appendChild(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('modal-backdrop--visible');
      cancelBtn.focus();
    });
  });
}

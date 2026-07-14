// ============================================
// Empty / Error State Helpers
// ============================================
//
// Small factories that render consistent, warm empty and error states using
// the existing design-system .empty-state chrome plus a design-system button.
// Centralized so every list reads the same and every failed load offers a
// retry instead of failing silently to the console.

import { el } from '../utils/dom.js';

/**
 * A friendly empty state, optionally with a single action button.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]
 * @param {string} [opts.actionLabel] - if set with onAction, renders a button
 * @param {Function} [opts.onAction]
 * @param {string} [opts.icon] - optional inline SVG markup
 * @returns {HTMLElement}
 */
export function emptyState({ title, message, actionLabel, onAction, icon } = {}) {
  return el('div', { class: 'empty-state' },
    icon ? el('div', { class: 'empty-state__icon', html: icon }) : null,
    el('div', { class: 'empty-state__title' }, title || 'Nothing here yet'),
    message ? el('div', { class: 'empty-state__description' }, message) : null,
    (actionLabel && onAction)
      ? el('button', { class: 'btn btn--secondary btn--sm', onClick: onAction }, actionLabel)
      : null,
  );
}

const ERROR_ICON = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';

/**
 * A friendly error state with an inline "Try again" retry button. Replaces
 * console-only failures with something the user can act on.
 * @param {Object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.message]
 * @param {Function} [opts.onRetry]
 * @param {string} [opts.retryLabel]
 * @returns {HTMLElement}
 */
export function errorState({ title, message, onRetry, retryLabel = 'Try again' } = {}) {
  return el('div', { class: 'empty-state empty-state--error', role: 'alert' },
    el('div', { class: 'empty-state__icon empty-state__icon--error', html: ERROR_ICON }),
    el('div', { class: 'empty-state__title' }, title || 'Something went wrong'),
    el('div', { class: 'empty-state__description' },
      message || 'We couldn’t load this data. Check your connection and try again.'),
    onRetry
      ? el('button', { class: 'btn btn--primary btn--sm', onClick: onRetry }, retryLabel)
      : null,
  );
}

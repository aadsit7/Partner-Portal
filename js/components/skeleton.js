// ============================================
// Skeleton Loading Placeholders
// ============================================
//
// Lightweight shimmer placeholders shown while CSV/Sheets data loads, so a
// slow network shows the shape of the page instead of a bare spinner. The
// shimmer animation is defined in css/enhancements.css and is disabled under
// prefers-reduced-motion (it falls back to a static tint).

import { el } from '../utils/dom.js';

/**
 * A block of skeleton "table" rows for list/table views.
 * @param {Object} [opts]
 * @param {number} [opts.rows=6]  - number of placeholder rows
 * @param {number} [opts.cols=5]  - number of cells per row
 * @returns {HTMLElement}
 */
export function skeletonTable({ rows = 6, cols = 5 } = {}) {
  const rowEls = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      // Vary the width a little so rows don't look mechanically identical.
      const w = c === 0 ? '70%' : `${45 + ((r + c) % 4) * 12}%`;
      cells.push(el('div', { class: 'skeleton__cell' },
        el('span', { class: 'skeleton__bar', style: { width: w } })));
    }
    rowEls.push(el('div', { class: 'skeleton__row' }, ...cells));
  }
  return el('div', {
    class: 'skeleton skeleton--table',
    'aria-hidden': 'true',
    role: 'presentation',
  }, ...rowEls);
}

/**
 * A grid of skeleton cards for card/grid views (e.g. the partner dashboard).
 * @param {Object} [opts]
 * @param {number} [opts.count=6]
 * @returns {HTMLElement}
 */
export function skeletonCards({ count = 6 } = {}) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push(el('div', { class: 'skeleton__card' },
      el('span', { class: 'skeleton__bar', style: { width: '60%', height: '14px' } }),
      el('span', { class: 'skeleton__bar', style: { width: '40%' } }),
      el('span', { class: 'skeleton__bar skeleton__bar--pill', style: { width: '80%' } }),
    ));
  }
  return el('div', {
    class: 'skeleton skeleton--cards',
    'aria-hidden': 'true',
    role: 'presentation',
  }, ...cards);
}

/**
 * A row of skeleton stat/KPI tiles.
 * @param {number} [count=4]
 * @returns {HTMLElement}
 */
export function skeletonStats(count = 4) {
  const tiles = [];
  for (let i = 0; i < count; i++) {
    tiles.push(el('div', { class: 'skeleton__stat' },
      el('span', { class: 'skeleton__bar', style: { width: '50%' } }),
      el('span', { class: 'skeleton__bar', style: { width: '75%', height: '20px' } }),
    ));
  }
  return el('div', {
    class: 'skeleton skeleton--stats',
    'aria-hidden': 'true',
    role: 'presentation',
  }, ...tiles);
}

/**
 * Standard loading placeholder for a list view: a stat row + a table.
 * @returns {HTMLElement}
 */
export function skeletonListView() {
  return el('div', { class: 'skeleton-view' },
    skeletonStats(4),
    skeletonTable({ rows: 6, cols: 5 }),
  );
}

// ============================================
// Centralized Value Formatting
// ============================================
//
// Single home for the display formatting the portal reuses across tables,
// cards, KPI strips, and detail panels so every surface reads the same way.
//
// - Full currency ($150,000) and dates ("Jun 15, 2026") already live in
//   utils/dom.js and utils/date.js respectively; they are re-exported here
//   so callers have one formatting import surface.
// - Compact currency ($150K / $1.2M) is defined here — it's what the big
//   KPI numbers use so a seven-figure pipeline stays legible.

export { formatCurrency } from './dom.js';
export { formatDate } from './date.js';

/**
 * Format a numeric value as compact USD for KPI-style displays.
 *
 *   500      → "$500"
 *   1500     → "$1.5K"
 *   150000   → "$150K"
 *   1200000  → "$1.2M"
 *   2000000  → "$2M"
 *   -85000   → "-$85K"
 *
 * Trailing ".0" is dropped ($2M, not $2.0M). Full precision is intentionally
 * NOT preserved — use formatCurrency() where the exact dollar figure matters
 * (e.g. a single deal's value in a table cell).
 *
 * @param {number|string} value
 * @returns {string}
 */
export function formatCompactCurrency(value) {
  const num = parseFloat(value);
  if (!isFinite(num) || num === 0) return '$0';

  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);

  if (abs < 1000) {
    // Sub-thousand: show the whole-dollar figure, no decimals.
    return `${sign}$${Math.round(abs)}`;
  }

  const tiers = [
    { limit: 1e12, suffix: 'T' },
    { limit: 1e9, suffix: 'B' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'K' },
  ];

  for (const { limit, suffix } of tiers) {
    if (abs >= limit) {
      const scaled = abs / limit;
      // One decimal place, but drop it when it rounds to a whole number
      // ($2M rather than $2.0M). Round to 1dp first so 1_999_999 → $2M.
      const rounded = Math.round(scaled * 10) / 10;
      const text = Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(1);
      return `${sign}$${text}${suffix}`;
    }
  }

  // Unreachable (abs >= 1000 always matches a tier), but keep a safe default.
  return `${sign}$${Math.round(abs)}`;
}

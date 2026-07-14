// ============================================
// Global Topbar Search
// ============================================
//
// A persistent search launcher pinned in the topbar (admin only). Pressing
// "/" anywhere focuses it, Escape closes it. Typing filters across deals,
// partners, and customers, showing a slide-down grouped results list.
// Selecting a result navigates to the relevant view.
//
// The launcher is appended directly to #topbar (NOT #topbar-actions, which
// each view rebuilds on render) so it survives route changes untouched. The
// results panel is portaled to <body> as a fixed-position slide-down.

import { el, $, debounce } from '../utils/dom.js';
import { formatCompactCurrency } from '../utils/format.js';
import { formatDate } from '../utils/date.js';
import { navigate } from '../router.js';
import { readSheetAsObjects } from '../sheets.js';
import { CONFIG } from '../config.js';
import { filterPartners, filterOpportunities } from '../utils/filters.js';

const SEARCH_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';

let mounted = false;
let panel = null;
let input = null;
let resultsEl = null;
let isOpen = false;
let onPanelKeydown = null;
let cache = null;          // { partners, opportunities }
let cacheLoadedAt = 0;
let activeResults = [];    // flat list of { type, navigate, ... } for arrow nav
let activeIndex = -1;

const CACHE_TTL_MS = 30_000;
const LIMIT_PER_GROUP = 6;

/**
 * Pure matcher — searches loaded rows for a query. Kept dependency-free so
 * it can be unit-tested under Node.
 *
 * @param {string} query
 * @param {{partners?: Array, opportunities?: Array}} data
 * @param {number} [limitPer]
 * @returns {{deals: Array, partners: Array, customers: Array}}
 */
export function searchEntities(query, data = {}, limitPer = LIMIT_PER_GROUP) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { deals: [], partners: [], customers: [] };

  const opps = data.opportunities || [];
  const partners = data.partners || [];

  const deals = opps.filter(o =>
    (o.deal_name || '').toLowerCase().includes(q) ||
    (o.customer_name || '').toLowerCase().includes(q)
  ).slice(0, limitPer);

  const matchedPartners = partners.filter(p =>
    (p.display_name || '').toLowerCase().includes(q)
  ).slice(0, limitPer);

  // Distinct customers derived from opportunity rows.
  const seen = new Set();
  const customers = [];
  for (const o of opps) {
    const name = (o.customer_name || '').trim();
    if (!name || !name.toLowerCase().includes(q)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    customers.push({ customer_name: name });
    if (customers.length >= limitPer) break;
  }

  return { deals, partners: matchedPartners, customers };
}

/**
 * Mount the global search once. Safe to call repeatedly (no-op after first).
 */
export function mountGlobalSearch() {
  if (mounted) return;
  const topbar = $('#topbar');
  if (!topbar) return;
  if ($('#global-search-launcher')) { mounted = true; return; }

  const launcher = el('button', {
    id: 'global-search-launcher',
    class: 'global-search__launcher',
    type: 'button',
    'aria-label': 'Search deals, partners, and customers',
    'aria-expanded': 'false',
    html: `${SEARCH_ICON}<span class="global-search__launcher-hint">Search<kbd>/</kbd></span>`,
    onClick: () => openSearch(),
  });

  // Insert before the actions zone so it groups to the right with any CTAs.
  const actions = $('#topbar-actions');
  if (actions) topbar.insertBefore(launcher, actions);
  else topbar.appendChild(launcher);

  buildPanel();

  // "/" focuses search from anywhere (unless the user is typing in a field).
  document.addEventListener('keydown', onGlobalKeydown);

  mounted = true;
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function onGlobalKeydown(e) {
  if (e.key === '/' && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    openSearch();
  }
}

function buildPanel() {
  input = el('input', {
    class: 'global-search__input',
    type: 'text',
    placeholder: 'Search deals, partners, customers…',
    'aria-label': 'Search deals, partners, and customers',
    autocomplete: 'off',
    spellcheck: 'false',
    onInput: debounce(() => runSearch(), 150),
    onKeydown: onInputKeydown,
  });

  resultsEl = el('div', { class: 'global-search__results', role: 'listbox', 'aria-label': 'Search results' });

  const box = el('div', { class: 'global-search__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
    el('div', { class: 'global-search__field' },
      el('span', { class: 'global-search__field-icon', html: SEARCH_ICON }),
      input,
      el('button', {
        class: 'global-search__close',
        type: 'button',
        'aria-label': 'Close search',
        html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        onClick: () => closeSearch(),
      }),
    ),
    resultsEl,
  );

  panel = el('div', {
    id: 'global-search-panel',
    class: 'global-search__panel',
    onClick: (e) => { if (e.target === panel) closeSearch(); },
  }, box);

  document.body.appendChild(panel);
}

async function openSearch() {
  if (!panel) return;
  if (isOpen) { focusInput(); return; }
  isOpen = true;
  panel.classList.add('global-search__panel--open');
  const launcher = $('#global-search-launcher');
  if (launcher) launcher.setAttribute('aria-expanded', 'true');

  // Force layout so the now-visible input can accept focus this tick, then
  // focus it (with a next-frame retry in case the transition still raced).
  void panel.offsetHeight;
  focusInput();

  // Close on Escape from anywhere in the panel, even if focus has drifted off
  // the input onto a result row. Capture phase so it wins reliably.
  onPanelKeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } };
  document.addEventListener('keydown', onPanelKeydown, true);

  renderHint();
  await ensureData();
  if (isOpen && input.value.trim()) runSearch();
}

function focusInput() {
  if (!input) return;
  // Retry across a few frames: focusing an element whose overlay is still
  // fading in can be rejected on the first tick.
  let tries = 0;
  const attempt = () => {
    if (!isOpen || !input) return;
    input.focus();
    if (document.activeElement === input) return;
    if (tries++ < 20) requestAnimationFrame(attempt);
  };
  attempt();
}

function closeSearch() {
  if (!isOpen) return;
  isOpen = false;
  panel.classList.remove('global-search__panel--open');
  if (onPanelKeydown) {
    document.removeEventListener('keydown', onPanelKeydown, true);
    onPanelKeydown = null;
  }
  const launcher = $('#global-search-launcher');
  if (launcher) { launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
  activeIndex = -1;
}

function onInputKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const item = activeResults[activeIndex] || activeResults[0];
    if (item) item.go();
  }
}

function moveActive(delta) {
  if (activeResults.length === 0) return;
  activeIndex = (activeIndex + delta + activeResults.length) % activeResults.length;
  const rows = resultsEl.querySelectorAll('.global-search__result');
  rows.forEach((row, i) => {
    const on = i === activeIndex;
    row.classList.toggle('global-search__result--active', on);
    if (on) row.scrollIntoView({ block: 'nearest' });
  });
}

async function ensureData() {
  const fresh = cache && (Date.now() - cacheLoadedAt < CACHE_TTL_MS);
  if (fresh) return;
  try {
    const [partners, opportunities] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
    ]);
    cache = {
      partners: filterPartners(partners),
      opportunities: filterOpportunities(opportunities),
    };
    cacheLoadedAt = Date.now();
  } catch (err) {
    cache = cache || { partners: [], opportunities: [] };
    if (isOpen && input.value.trim()) {
      resultsEl.replaceChildren(el('div', { class: 'global-search__error' },
        'Could not load search data. Try again in a moment.'));
    }
  }
}

function renderHint() {
  activeResults = [];
  activeIndex = -1;
  resultsEl.replaceChildren(
    el('div', { class: 'global-search__hint' }, 'Type to search across deals, partners, and customers.')
  );
}

function runSearch() {
  const q = input.value.trim();
  activeIndex = -1;
  activeResults = [];

  if (!q) { renderHint(); return; }
  if (!cache) { ensureData().then(() => { if (isOpen) runSearch(); }); return; }

  const { deals, partners, customers } = searchEntities(q, cache, LIMIT_PER_GROUP);
  const total = deals.length + partners.length + customers.length;

  if (total === 0) {
    resultsEl.replaceChildren(el('div', { class: 'global-search__empty' },
      `No matches for "${q}".`));
    return;
  }

  const frag = document.createDocumentFragment();

  if (deals.length) {
    frag.appendChild(groupLabel('Deals'));
    deals.forEach(d => frag.appendChild(resultRow({
      title: d.deal_name || 'Untitled deal',
      sub: `${d.customer_name || '—'} · ${formatCompactCurrency(d.deal_value)}`
        + (d.expected_close ? ` · ${formatDate(d.expected_close)}` : ''),
      icon: 'deal',
      go: () => goTo(`/admin/opportunities?q=${encodeURIComponent(d.deal_name || d.customer_name || '')}`),
    })));
  }

  if (partners.length) {
    frag.appendChild(groupLabel('Partners'));
    partners.forEach(p => frag.appendChild(resultRow({
      title: p.display_name || 'Partner',
      sub: [p.partner_type, p.tier].filter(Boolean).join(' · ') || '—',
      icon: 'partner',
      go: () => goTo(`/admin/partner-detail?id=${encodeURIComponent(p.partner_id)}`),
    })));
  }

  if (customers.length) {
    frag.appendChild(groupLabel('Customers'));
    customers.forEach(c => frag.appendChild(resultRow({
      title: c.customer_name,
      sub: 'Customer',
      icon: 'customer',
      go: () => goTo(`/admin/opportunities?q=${encodeURIComponent(c.customer_name)}`),
    })));
  }

  resultsEl.replaceChildren(frag);
}

const RESULT_ICONS = {
  deal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/></svg>',
  partner: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 3.5a3 3 0 0 1 0 5.5"/><path d="M18 14c2.2.5 4 2.6 4 5"/></svg>',
  customer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16"/><path d="M9 15h6"/></svg>',
};

function groupLabel(text) {
  return el('div', { class: 'global-search__group', role: 'presentation' }, text);
}

function resultRow({ title, sub, icon, go }) {
  const row = el('button', {
    class: 'global-search__result',
    type: 'button',
    role: 'option',
    onClick: go,
  },
    el('span', { class: 'global-search__result-icon', html: RESULT_ICONS[icon] || '' }),
    el('span', { class: 'global-search__result-text' },
      el('span', { class: 'global-search__result-title' }, title),
      el('span', { class: 'global-search__result-sub' }, sub),
    ),
  );
  activeResults.push({ go });
  return row;
}

function goTo(path) {
  closeSearch();
  if (input) input.value = '';
  navigate(path);
}

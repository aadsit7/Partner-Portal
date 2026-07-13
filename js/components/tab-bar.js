// ============================================
// Mobile Bottom Tab Bar + Mobile Topbar Chrome
// ============================================
//
// Renders the phone navigation chrome into <nav id="tab-bar"> (index.html)
// plus the mobile-only topbar pieces: brand wordmark, detail back button,
// the Randy "Listening" banner, and the in-content large page title.
//
// Every element this module creates is display:none on desktop — all
// visual rules live behind @media (max-width: 768px) in css/mobile.css,
// so the desktop layout stays pixel-identical. The module itself is safe
// to run at any viewport width.

import { getCurrentUser, logout } from '../auth.js';
import { navigate, getCurrentPath } from '../router.js';
import { el, $ } from '../utils/dom.js';
import { PARTNER_NAV, ADMIN_NAV } from './sidebar.js';
import { toggleRandyVoice } from './randy.js';
import { showToast } from './toast.js';

// Lucide-style outline icons: 24 grid, 2px stroke, currentColor.
const ICONS = {
  deals: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  partners: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  events: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  leadcheck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="m8 11 2 2 4-4"/></svg>',
  demandgen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  mic: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  dashboard: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  comp: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M3 9h18"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  pricing: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  ai: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/></svg>',
  setup: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>',
  support: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
  calendar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  opportunities: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3a1 1 0 0 1 1 0l2.6 5.3 5.8.8a1 1 0 0 1 .3 1l-4.2 4.1 1 5.8a1 1 0 0 1-.9.6L12 17.8l-5.2 2.8a1 1 0 0 1-.9-.6l1-5.8L2.7 10a1 1 0 0 1 .3-1l5.8-.8L11.5 3Z"/></svg>',
  logout: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
  external: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>',
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
};

// Tab slot labels are the short mobile names from the approved design; the
// paths must exist in PARTNER_NAV/ADMIN_NAV (the "More" sheet is derived
// as everything in those lists that didn't get a slot).
const ADMIN_TABS = [
  { path: '/admin/opportunities', label: 'Deals', icon: 'deals' },
  { path: '/admin/partners', label: 'Partners', icon: 'partners' },
  { path: '/admin/events', label: 'Events', icon: 'events' },
];

const PARTNER_TABS = [
  { path: '/partner/opportunities', label: 'Deals', icon: 'deals' },
  { path: '/partner/leadcheck', label: 'LeadCheck', icon: 'leadcheck' },
  { path: '/partner/demandgen', label: 'Demand Gen', icon: 'demandgen' },
];

// Routes rendered as a full-screen detail push on mobile: centered topbar
// title + back chevron instead of the brand wordmark.
const DETAIL_ROUTES = { '/admin/partner-detail': '/admin/partners' };

let renderedRole = null;      // 'admin' | 'partner' | null — rebuild only on change
let listenersInstalled = false;
let titleObserversInstalled = false;

/**
 * Render (or refresh) the mobile tab bar for the current user.
 * Called from setupAppShell() on every routed render; cheap when the
 * role hasn't changed.
 */
export function renderTabBar() {
  const bar = $('#tab-bar');
  if (!bar) return;

  const user = getCurrentUser();
  if (!user) {
    bar.innerHTML = '';
    renderedRole = null;
    return;
  }

  const role = user.is_admin ? 'admin' : 'partner';
  if (role !== renderedRole) {
    buildBar(bar, role);
    renderedRole = role;
  }

  ensureTopbarChrome();
  installListeners();
  updateActiveTab(getCurrentPath());
  updateDetailMode(getCurrentPath());
}

function buildBar(bar, role) {
  const tabs = role === 'admin' ? ADMIN_TABS : PARTNER_TABS;

  const tabItem = ({ path, label, icon }) =>
    el('a', {
      class: 'm-tabbar__item',
      href: `#${path}`,
      dataset: { path },
      onClick: (e) => { e.preventDefault(); navigate(path); },
    },
      el('span', { class: 'm-tabbar__icon', html: ICONS[icon], 'aria-hidden': 'true' }),
      el('span', { class: 'm-tabbar__label' }, label)
    );

  const micSlot = el('div', { class: 'm-tabbar__slot m-tabbar__slot--mic' },
    el('button', {
      id: 'tabbar-mic',
      class: 'm-tabbar__mic',
      type: 'button',
      'aria-label': 'Toggle Randy voice assistant',
      'aria-pressed': 'false',
      onClick: () => {
        if (!toggleRandyVoice()) {
          showToast('Voice is not supported in this browser', 'error');
        }
      },
    },
      el('span', { class: 'm-tabbar__mic-pulse', 'aria-hidden': 'true' }),
      el('span', { class: 'm-tabbar__mic-glyph', html: ICONS.mic, 'aria-hidden': 'true' })
    )
  );

  const moreBtn = el('button', {
    id: 'tabbar-more',
    class: 'm-tabbar__item',
    type: 'button',
    onClick: () => openMoreSheet(role),
  },
    el('span', { class: 'm-tabbar__icon', html: ICONS.more, 'aria-hidden': 'true' }),
    el('span', { class: 'm-tabbar__label' }, 'More')
  );

  bar.innerHTML = '';
  bar.append(tabItem(tabs[0]), tabItem(tabs[1]), micSlot, tabItem(tabs[2]), moreBtn);
}

// ---- "More" bottom sheet -------------------------------------------------

function moreNavItems(role) {
  const nav = role === 'admin' ? ADMIN_NAV : PARTNER_NAV;
  const tabs = role === 'admin' ? ADMIN_TABS : PARTNER_TABS;
  const slotted = new Set(tabs.map(t => t.path));
  return nav.filter(item => !slotted.has(item.path));
}

function openMoreSheet(role) {
  closeMoreSheet();

  const rows = moreNavItems(role).map(item => {
    const icon = ICONS[item.icon] || ICONS.more;
    if (item.externalUrl) {
      return el('a', {
        class: 'm-sheet__row',
        href: item.externalUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: () => closeMoreSheet(),
      },
        el('span', { class: 'm-sheet__row-icon', html: icon, 'aria-hidden': 'true' }),
        el('span', { class: 'm-sheet__row-label' }, item.label),
        el('span', { class: 'm-sheet__row-trailing', html: ICONS.external, 'aria-hidden': 'true' })
      );
    }
    return el('a', {
      class: `m-sheet__row ${getCurrentPath() === item.path ? 'm-sheet__row--current' : ''}`,
      href: `#${item.path}`,
      dataset: { path: item.path },
      onClick: (e) => { e.preventDefault(); closeMoreSheet(); navigate(item.path); },
    },
      el('span', { class: 'm-sheet__row-icon', html: icon, 'aria-hidden': 'true' }),
      el('span', { class: 'm-sheet__row-label' }, item.label),
      el('span', { class: 'm-sheet__row-trailing', html: ICONS.chevron, 'aria-hidden': 'true' })
    );
  });

  const logoutRow = el('button', {
    class: 'm-sheet__row m-sheet__row--danger',
    type: 'button',
    onClick: () => {
      closeMoreSheet();
      logout();
      navigate('/login');
    },
  },
    el('span', { class: 'm-sheet__row-icon', html: ICONS.logout, 'aria-hidden': 'true' }),
    el('span', { class: 'm-sheet__row-label' }, 'Log out')
  );

  const sheet = el('div', { id: 'm-sheet', class: 'm-sheet', role: 'dialog', 'aria-label': 'More navigation' },
    el('div', { class: 'm-sheet__scrim', onClick: closeMoreSheet }),
    el('div', { class: 'm-sheet__panel' },
      el('div', { class: 'm-sheet__handle', 'aria-hidden': 'true' }),
      el('div', { class: 'm-sheet__group' }, ...rows),
      el('div', { class: 'm-sheet__group' }, logoutRow)
    )
  );

  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('m-sheet--open'));
}

function closeMoreSheet() {
  const sheet = $('#m-sheet');
  if (!sheet) return;
  sheet.classList.remove('m-sheet--open');
  setTimeout(() => sheet.remove(), 220);
}

// ---- Mobile topbar chrome ------------------------------------------------

function ensureTopbarChrome() {
  const topbar = $('#topbar');
  if (!topbar) return;

  if (!$('#topbar-back')) {
    topbar.insertBefore(
      el('button', {
        id: 'topbar-back',
        class: 'topbar__back',
        type: 'button',
        'aria-label': 'Back',
        html: ICONS.back,
        onClick: () => {
          const fallback = DETAIL_ROUTES[getCurrentPath()];
          if (window.history.length > 1) window.history.back();
          else if (fallback) navigate(fallback);
        },
      }),
      topbar.firstChild
    );
  }

  if (!$('#topbar-brand')) {
    const back = $('#topbar-back');
    topbar.insertBefore(
      el('div', { id: 'topbar-brand', class: 'topbar__brand', 'aria-hidden': 'true' },
        'Partner ',
        el('span', { class: 'topbar__brand-accent' }, 'Portal')
      ),
      back.nextSibling
    );
  }

  if (!$('#m-listen-banner')) {
    const main = $('#main-content');
    const viewContainer = $('#view-container');
    if (main && viewContainer) {
      main.insertBefore(
        el('div', { id: 'm-listen-banner', class: 'm-listen-banner', 'aria-live': 'polite' },
          el('span', { class: 'm-listen-banner__pill' }, 'Listening')
        ),
        viewContainer
      );
    }
  }
}

// ---- Large in-content page title (iOS large-title pattern) ---------------
//
// Views own the topbar title (setTopbar / setTopbarTitle) and re-mount the
// view container freely, so the mobile heading is maintained reactively:
// mirror #topbar-title into a heading kept as the first child of
// #view-container. Attribute-guarded so the observers can't feed themselves.

function syncPageTitle() {
  const titleEl = $('#topbar-title');
  const container = $('#view-container');
  if (!titleEl || !container) return;

  const eyebrow = titleEl.querySelector('.topbar__eyebrow');
  const text = (eyebrow ? eyebrow.textContent : titleEl.textContent).trim();

  let heading = $('#m-page-title');
  if (!text) {
    if (heading) heading.remove();
    return;
  }

  if (!heading) {
    heading = el('h1', { id: 'm-page-title', class: 'm-page-title' });
  }
  if (heading.textContent !== text) heading.textContent = text;
  if (container.firstChild !== heading) container.insertBefore(heading, container.firstChild);
}

function installTitleObservers() {
  if (titleObserversInstalled) return;
  const titleEl = $('#topbar-title');
  const container = $('#view-container');
  if (!titleEl || !container || typeof MutationObserver === 'undefined') return;

  new MutationObserver(syncPageTitle)
    .observe(titleEl, { childList: true, subtree: true, characterData: true });
  new MutationObserver(syncPageTitle)
    .observe(container, { childList: true });

  titleObserversInstalled = true;
  syncPageTitle();
}

// ---- Route + Randy state reactions ----------------------------------------

function updateActiveTab(path) {
  // Detail pushes highlight the tab of the list they came from.
  const effectivePath = path === '/admin/partner-detail' ? '/admin/partners' : path;
  const moreActive = moreNavItems(renderedRole === 'admin' ? 'admin' : 'partner')
    .some(item => item.path === effectivePath);

  document.querySelectorAll('#tab-bar .m-tabbar__item').forEach(item => {
    const isActive = item.dataset.path
      ? item.dataset.path === effectivePath
      : moreActive; // the "More" button (no data-path)
    item.classList.toggle('m-tabbar__item--active', isActive);
  });
}

function updateDetailMode(path) {
  const topbar = $('#topbar');
  if (topbar) topbar.classList.toggle('topbar--detail', path in DETAIL_ROUTES);
}

function onRandyState(e) {
  const state = e.detail && e.detail.state;
  const listening = state === 'ACTIVE_LISTENING';
  const engaged = state === 'PROCESSING' || state === 'SPEAKING' || state === 'CONFIRMING';

  const mic = $('#tabbar-mic');
  if (mic) {
    mic.classList.toggle('m-tabbar__mic--listening', listening);
    mic.classList.toggle('m-tabbar__mic--engaged', engaged);
    mic.setAttribute('aria-pressed', listening || engaged ? 'true' : 'false');
  }

  const banner = $('#m-listen-banner');
  if (banner) banner.classList.toggle('m-listen-banner--visible', listening);
}

function installListeners() {
  installTitleObservers();
  if (listenersInstalled) return;

  window.addEventListener('routechange', (e) => {
    updateActiveTab(e.detail.path);
    updateDetailMode(e.detail.path);
    closeMoreSheet();
  });
  window.addEventListener('randy:state', onRandyState);

  listenersInstalled = true;
}

// ============================================
// Sidebar Navigation Component
// ============================================

import { getCurrentUser, getUserInitials, logout } from '../auth.js';
import { navigate, getCurrentPath } from '../router.js';
import { el, $ } from '../utils/dom.js';

const PARTNER_NAV = [
  { path: '/partner/opportunities', label: 'Opportunities', icon: 'dashboard' },
  { path: '/partner/demandgen', label: 'Demand Gen', icon: 'calendar' },
  { path: '/partner/resources', label: 'Resources', icon: 'support' },
];

const ADMIN_NAV = [
  { path: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/admin/partners', label: 'Partners', icon: 'partners' },
  { path: '/admin/events', label: 'Events / JLG', icon: 'events' },
  { path: '/admin/opportunities', label: 'Opportunities', icon: 'opportunities' },
  { path: '/admin/setup', label: 'Setup', icon: 'setup' },
];

const ICONS = {
  dashboard: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="12" width="7" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="9" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>',
  calendar: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h16" stroke="currentColor" stroke-width="1.5"/><path d="M6 1v4M14 1v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  support: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 4.5l2.6 2.6M12.9 12.9l2.6 2.6M15.5 4.5l-2.6 2.6M7.1 12.9l-2.6 2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  partners: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13 11.5c2.5 0 4.5 2 4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  opportunities: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2l2.5 5 5.5.8-4 3.9.9 5.3L10 14.5 5.1 17l.9-5.3-4-3.9 5.5-.8L10 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  events: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h16" stroke="currentColor" stroke-width="1.5"/><path d="M6 1v4M14 1v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="12" r="1" fill="currentColor"/><circle cx="13" cy="12" r="1" fill="currentColor"/></svg>',
  setup: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 1v2M10 17v2M18.36 4.64l-1.42 1.42M3.05 14.95l-1.42 1.42M19 10h-2M3 10H1M15.54 15.54l-1.42-1.42M5.46 5.46L4.05 4.05M15.54 4.46l-1.42 1.42M5.46 14.54l-1.42 1.42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  logout: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6.5 16H3.5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 013.5 2h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 12.5l3.5-3.5L12 5.5M7 9h8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/**
 * Render the sidebar.
 */
export function renderSidebar() {
  const sidebar = $('#sidebar');
  const user = getCurrentUser();

  if (!user) {
    sidebar.innerHTML = '';
    return;
  }

  const navItems = user.is_admin ? ADMIN_NAV : PARTNER_NAV;
  const currentPath = getCurrentPath();
  const sectionLabel = user.is_admin ? 'Admin' : 'Partner';

  sidebar.innerHTML = '';

  // Header
  const header = el('div', { class: 'sidebar__header' },
    el('div', { class: 'sidebar__logo' },
      el('div', { class: 'sidebar__logo-text' },
        el('span', { style: { fontWeight: 'var(--font-bold)', color: '#fff' } }, 'Partner'),
        el('span', { style: { fontWeight: 'var(--font-normal)', color: '#00BFFF', marginLeft: 'var(--space-1)' } }, 'Portal'),
      )
    )
  );

  // Navigation
  const nav = el('nav', { class: 'sidebar__nav' },
    el('div', { class: 'sidebar__section-label' }, sectionLabel),
    ...navItems.map(item =>
      el('a', {
        class: `sidebar__link ${currentPath === item.path ? 'sidebar__link--active' : ''}`,
        href: `#${item.path}`,
        dataset: { path: item.path },
        onClick: (e) => {
          e.preventDefault();
          navigate(item.path);
          closeMobileSidebar();
        }
      },
        el('span', { class: 'sidebar__link-icon', html: ICONS[item.icon] }),
        item.label
      )
    )
  );

  // Footer
  const initials = getUserInitials(user);
  const footer = el('div', { class: 'sidebar__footer' },
    el('div', { class: 'sidebar__user' },
      el('div', { class: 'sidebar__avatar' }, initials),
      el('div', { class: 'sidebar__user-info' },
        el('div', { class: 'sidebar__user-name' }, user.display_name || user.username),
        el('div', { class: 'sidebar__user-role' }, user.is_admin ? 'Administrator' : user.tier || 'Partner')
      ),
      el('button', {
        class: 'sidebar__logout',
        title: 'Log out',
        html: ICONS.logout,
        onClick: () => {
          logout();
          navigate('/login');
        }
      })
    )
  );

  sidebar.append(header, nav, footer);

  // Listen for route changes to update active state
  window.addEventListener('routechange', updateActiveLink);
}

function updateActiveLink(e) {
  const path = e.detail.path;
  const links = document.querySelectorAll('.sidebar__link');
  links.forEach(link => {
    // When on partner-detail, highlight the Dashboard link
    const isActive = link.dataset.path === path
      || (path === '/admin/partner-detail' && link.dataset.path === '/admin/dashboard');
    link.classList.toggle('sidebar__link--active', isActive);
  });
}

/**
 * Setup mobile sidebar toggle.
 */
export function setupMobileSidebar() {
  const hamburger = $('#hamburger');
  const overlay = $('#sidebar-overlay');

  if (hamburger) {
    hamburger.addEventListener('click', toggleMobileSidebar);
  }

  if (overlay) {
    overlay.addEventListener('click', closeMobileSidebar);
  }
}

function toggleMobileSidebar() {
  const sidebar = $('#sidebar');
  const overlay = $('#sidebar-overlay');
  sidebar.classList.toggle('sidebar--open');
  overlay.classList.toggle('sidebar-overlay--visible');
}

function closeMobileSidebar() {
  const sidebar = $('#sidebar');
  const overlay = $('#sidebar-overlay');
  sidebar.classList.remove('sidebar--open');
  overlay.classList.remove('sidebar-overlay--visible');
}

/**
 * Update the topbar title.
 */
export function setTopbarTitle(title) {
  const titleEl = $('#topbar-title');
  if (titleEl) titleEl.textContent = title;
}

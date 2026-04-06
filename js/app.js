// ============================================
// Partner Portal — App Entry Point
// ============================================

import { getCurrentUser } from './auth.js';
import { addRoute, initRouter, navigate } from './router.js';
import { renderSidebar, setupMobileSidebar } from './components/sidebar.js';

// Import all views
import * as loginView from './views/login.js';
import * as partnerDashboard from './views/partner-dashboard.js';
import * as partnerMarketing from './views/partner-marketing.js';
import * as partnerResources from './views/partner-resources.js';
import * as adminDashboard from './views/admin-dashboard.js';
import * as adminPartners from './views/admin-partners.js';
import * as adminEvents from './views/admin-events.js';

// ---- Register Routes ----

addRoute('/login', {
  title: 'Login',
  render: loginView.render,
  cleanup: loginView.cleanup,
});

addRoute('/partner/dashboard', {
  title: 'Dashboard',
  render: async (container) => {
    setupAppShell();
    await partnerDashboard.render(container);
  },
  cleanup: partnerDashboard.cleanup,
});

addRoute('/partner/marketing', {
  title: 'Marketing Plan',
  render: async (container) => {
    setupAppShell();
    await partnerMarketing.render(container);
  },
  cleanup: partnerMarketing.cleanup,
});

addRoute('/partner/resources', {
  title: 'Support & Resources',
  render: async (container) => {
    setupAppShell();
    await partnerResources.render(container);
  },
  cleanup: partnerResources.cleanup,
});

addRoute('/admin/dashboard', {
  title: 'Admin Dashboard',
  render: async (container) => {
    setupAppShell();
    await adminDashboard.render(container);
  },
  cleanup: adminDashboard.cleanup,
});

addRoute('/admin/partners', {
  title: 'Partners',
  render: async (container) => {
    setupAppShell();
    await adminPartners.render(container);
  },
  cleanup: adminPartners.cleanup,
});

addRoute('/admin/events', {
  title: 'Events',
  render: async (container) => {
    setupAppShell();
    await adminEvents.render(container);
  },
  cleanup: adminEvents.cleanup,
});

// ---- App Shell Setup ----

function setupAppShell() {
  const app = document.getElementById('app');
  if (app.className !== 'app-shell--app') {
    app.className = 'app-shell--app';
  }
  renderSidebar();
}

// ---- Initialize ----

document.addEventListener('DOMContentLoaded', () => {
  setupMobileSidebar();
  initRouter();
});

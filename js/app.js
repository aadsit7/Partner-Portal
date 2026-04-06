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
import * as adminOpportunities from './views/admin-opportunities.js';
import * as adminPartnerDetail from './views/admin-partner-detail.js';
import * as adminSetup from './views/admin-setup.js';

// ---- Register Routes ----

addRoute('/login', {
  title: 'Login',
  render: loginView.render,
  cleanup: loginView.cleanup,
});

// Partner routes (renamed tabs)
addRoute('/partner/opportunities', {
  title: 'Opportunities',
  render: async (container) => {
    setupAppShell();
    await partnerDashboard.render(container);
  },
  cleanup: partnerDashboard.cleanup,
});

addRoute('/partner/demandgen', {
  title: 'Demand Gen',
  render: async (container) => {
    setupAppShell();
    await partnerMarketing.render(container);
  },
  cleanup: partnerMarketing.cleanup,
});

addRoute('/partner/resources', {
  title: 'Resources',
  render: async (container) => {
    setupAppShell();
    await partnerResources.render(container);
  },
  cleanup: partnerResources.cleanup,
});

// Legacy routes — redirect to new names
addRoute('/partner/dashboard', {
  title: 'Opportunities',
  render: async () => { navigate('/partner/opportunities'); },
});

addRoute('/partner/marketing', {
  title: 'Demand Gen',
  render: async () => { navigate('/partner/demandgen'); },
});

// Admin routes
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

addRoute('/admin/opportunities', {
  title: 'Opportunities',
  render: async (container) => {
    setupAppShell();
    await adminOpportunities.render(container);
  },
  cleanup: adminOpportunities.cleanup,
});

addRoute('/admin/events', {
  title: 'Events',
  render: async (container) => {
    setupAppShell();
    await adminEvents.render(container);
  },
  cleanup: adminEvents.cleanup,
});

addRoute('/admin/partner-detail', {
  title: 'Partner Detail',
  render: async (container, params) => {
    setupAppShell();
    await adminPartnerDetail.render(container, params);
  },
  cleanup: adminPartnerDetail.cleanup,
});

addRoute('/admin/setup', {
  title: 'Setup',
  render: async (container) => {
    setupAppShell();
    await adminSetup.render(container);
  },
  cleanup: adminSetup.cleanup,
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

// ============================================
// Partner Portal — App Entry Point
// ============================================

import { getCurrentUser, storeAccessToken } from './auth.js';
import { addRoute, initRouter, navigate } from './router.js';
import { renderSidebar, setupMobileSidebar } from './components/sidebar.js';

// Import all views
import * as loginView from './views/login.js';
import * as partnerDashboard from './views/partner-dashboard.js';
import * as partnerMarketing from './views/partner-marketing.js';
import * as partnerResources from './views/partner-resources.js';
import * as partnerLeadCheck from './views/partner-leadcheck.js';
import * as adminDashboard from './views/admin-dashboard.js';
import * as adminPartners from './views/admin-partners.js';
import * as adminEvents from './views/admin-events.js';
import * as adminOpportunities from './views/admin-opportunities.js';
import * as adminPartnerDetail from './views/admin-partner-detail.js';
import * as adminSetup from './views/admin-setup.js';
import { renderAdminAIAssistant, cleanupAdminAIAssistant } from './views/admin-ai-assistant.js';
import { mountVoiceWidget } from './components/voice-widget.js';
import { initRandy } from './components/randy.js';
import { initHotkeys, registerHotkey } from './utils/hotkeys.js';
import { toggleQuickForm } from './components/quick-form.js';

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

addRoute('/partner/leadcheck', {
  title: 'LeadCheck',
  render: async (container) => {
    setupAppShell();
    await partnerLeadCheck.render(container);
  },
  cleanup: partnerLeadCheck.cleanup,
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

addRoute('/admin/leadcheck', {
  title: 'LeadCheck',
  render: async (container) => {
    setupAppShell();
    await partnerLeadCheck.render(container);
  },
  cleanup: partnerLeadCheck.cleanup,
});

addRoute('/admin/events', {
  title: 'Events',
  render: async (container) => {
    setupAppShell();
    await adminEvents.render(container);
  },
  cleanup: adminEvents.cleanup,
});

addRoute('/admin/ai-assistant', {
  title: 'Randy',
  render: async (container) => {
    setupAppShell();
    renderAdminAIAssistant(container);
  },
  cleanup: cleanupAdminAIAssistant,
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

let voiceWidgetMounted = false;
let randyMounted = false;
let hotkeysInitialized = false;

function setupAppShell() {
  const app = document.getElementById('app');
  if (app.className !== 'app-shell--app') {
    app.className = 'app-shell--app';
  }
  renderSidebar();

  // Mount voice widget once for admin users
  const user = getCurrentUser();
  if (user && user.is_admin && !voiceWidgetMounted) {
    mountVoiceWidget();
    voiceWidgetMounted = true;
  }

  // Mount Randy voice assistant for admin users
  if (user && user.is_admin && !randyMounted) {
    initRandy();
    randyMounted = true;
  }

  // Register global keyboard shortcuts (admin only, one-time)
  if (user && user.is_admin && !hotkeysInitialized) {
    initHotkeys();
    registerAdminShortcuts();
    hotkeysInitialized = true;
  }
}

function registerAdminShortcuts() {
  // Randy voice activation
  registerHotkey('Alt+Z', 'Activate Randy voice', () => {
    if (typeof window.activateRandy === 'function') window.activateRandy();
  }, 'Randy');

  // Opportunity shortcuts
  registerHotkey('Alt+O', 'New Opportunity', () => {
    if (location.hash.startsWith('#/admin/opportunities')) {
      window.dispatchEvent(new CustomEvent('shortcut:new-opportunity'));
    } else {
      window._pendingNewOpp = true;
      navigate('/admin/opportunities');
    }
  }, 'Opportunities');

  // Navigation shortcuts
  registerHotkey('Alt+D', 'Dashboard', () => navigate('/admin/dashboard'), 'Navigation');
  registerHotkey('Alt+A', 'Quick Form', () => toggleQuickForm(), 'Navigation');
  registerHotkey('Alt+P', 'Partners', () => navigate('/admin/partners'), 'Navigation');
  registerHotkey('Alt+E', 'Events', () => navigate('/admin/events'), 'Navigation');
  registerHotkey('Alt+L', 'LeadCheck', () => navigate('/admin/leadcheck'), 'Navigation');
}

// ---- Token Refresh for Returning Admin Sessions ----

/**
 * Schedule a silent token refresh ~5 minutes before the current token expires.
 * Keeps the admin signed in indefinitely without manual re-authentication.
 */
function scheduleTokenRefresh() {
  const user = getCurrentUser();
  if (!user?.is_admin || !user.access_token_expires) return;

  const msUntilRefresh = user.access_token_expires - Date.now() - 5 * 60 * 1000;
  const delay = Math.max(msUntilRefresh, 0);

  setTimeout(async () => {
    try {
      const newToken = await loginView.refreshAccessToken();
      if (newToken) {
        storeAccessToken(newToken);
        scheduleTokenRefresh(); // schedule the next cycle
      }
    } catch {}
  }, delay);
}

// ---- Initialize ----

document.addEventListener('DOMContentLoaded', () => {
  setupMobileSidebar();
  initRouter();

  // For returning admin sessions (already in localStorage), re-initialize
  // the OAuth token client and refresh the access token silently so the admin
  // never has to sign in again or visit Setup to resync.
  const user = getCurrentUser();
  if (user?.is_admin) {
    loginView.initTokenClient();

    // Give the Google GSI library ~2 s to load, then do a silent token refresh.
    setTimeout(async () => {
      try {
        const newToken = await loginView.refreshAccessToken();
        if (newToken) {
          storeAccessToken(newToken);
        }
      } catch {}
      scheduleTokenRefresh();
    }, 2000);
  }
});

// ============================================
// Partner Portal — App Entry Point
// ============================================

import { getCurrentUser, getAccessToken, storeAccessToken } from './auth.js';
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
import * as adminComp from './views/admin-comp.js';
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

addRoute('/admin/comp', {
  title: 'Comp',
  render: async (container) => {
    setupAppShell();
    await adminComp.render(container);
  },
  cleanup: adminComp.cleanup,
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

// Refresh well before expiry so a slow Google response, a momentarily
// missing third-party cookie, or background-tab timer throttling can't
// strand us with an expired token mid-request.
const REFRESH_LEAD_MS = 15 * 60 * 1000;       // 15 min before expiry
const RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000; // retry every 2 min after a failed silent refresh
const REFRESH_ON_FOCUS_THRESHOLD_MS = 15 * 60 * 1000; // refresh on focus if <15 min left

let refreshTimer = null;
let refreshInFlight = null;

/**
 * Schedule a silent token refresh ahead of the current token's expiry.
 *
 * Resilience guarantees this function makes:
 * - Always reschedules itself on completion, even if the refresh failed —
 *   a single transient failure (network blip, cookies briefly missing)
 *   must NOT permanently disable refresh.
 * - De-dupes overlapping calls so visibility/focus listeners + the timer
 *   can't fire concurrent refreshes.
 * - Falls back to a short retry interval after a failure so we recover
 *   quickly when Google is reachable again.
 */
function scheduleTokenRefresh() {
  const user = getCurrentUser();
  if (!user?.is_admin) return;

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const expires = user.access_token_expires || Date.now();
  const msUntilRefresh = expires - Date.now() - REFRESH_LEAD_MS;
  const delay = Math.max(msUntilRefresh, 0);

  refreshTimer = setTimeout(() => { runTokenRefresh(); }, delay);
}

/**
 * Run a silent refresh now (idempotent — concurrent calls share one
 * in-flight promise). Always reschedules the next attempt afterwards.
 */
function runTokenRefresh() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let succeeded = false;
    try {
      const newToken = await loginView.refreshAccessToken();
      if (newToken) {
        // refreshAccessToken already stored the token with the real
        // expires_in. Call storeAccessToken again only as a safety net
        // for older code paths that may import it directly.
        storeAccessToken(newToken);
        succeeded = true;
      }
    } catch (err) {
      console.warn('Silent token refresh failed:', err);
    } finally {
      refreshInFlight = null;
      // Always reschedule: success → next normal cycle (15 min before
      // new expiry); failure → short retry so we recover as soon as the
      // underlying issue (network, cookies) clears.
      if (succeeded) {
        scheduleTokenRefresh();
      } else {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { runTokenRefresh(); }, RETRY_AFTER_FAILURE_MS);
      }
    }
  })();

  return refreshInFlight;
}

/**
 * Refresh the token when the user returns to the tab. Background tabs
 * throttle setTimeout to >=1 s minimum intervals (or pause entirely on
 * some platforms), so a 15-min scheduled refresh may fire late or not
 * at all. Checking on visibilitychange/focus closes that gap.
 */
function refreshOnReturn() {
  const user = getCurrentUser();
  if (!user?.is_admin || !user.access_token_expires) return;

  const msUntilExpiry = user.access_token_expires - Date.now();
  if (msUntilExpiry < REFRESH_ON_FOCUS_THRESHOLD_MS) {
    runTokenRefresh();
  }
}

function setupTokenLifecycleListeners() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnReturn();
  });
  window.addEventListener('focus', refreshOnReturn);
  // Network came back after being offline → try a refresh in case the
  // previous attempt failed.
  window.addEventListener('online', refreshOnReturn);
}

// ---- Initialize ----

document.addEventListener('DOMContentLoaded', () => {
  setupMobileSidebar();
  initRouter();

  // For returning admin sessions (already in localStorage), re-initialize
  // the OAuth token client and wire up the refresh lifecycle.
  const user = getCurrentUser();
  if (user?.is_admin) {
    loginView.initTokenClient();
    setupTokenLifecycleListeners();

    if (getAccessToken()) {
      // Existing token still valid (>5 min buffer). Reuse it as-is and
      // let scheduleTokenRefresh handle renewal well before expiry.
      scheduleTokenRefresh();
    } else {
      // Token missing/expired. runTokenRefresh waits for the GIS library
      // to load (up to 5 s) before attempting the silent refresh, so we
      // don't need a fragile fixed setTimeout. It also reschedules
      // itself on completion (success or failure).
      runTokenRefresh();
    }
  }
});

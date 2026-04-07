// ============================================
// Partner Portal Configuration
// ============================================
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.cloud.google.com/
// 2. Create a new project (or select existing)
// 3. Enable "Google Sheets API"
// 4. Go to Credentials → Create Credentials → API Key
// 5. Restrict the API key to your GitHub Pages domain
// 6. Create a Google Spreadsheet with 3 sheets: "Partners", "Opportunities", "Events"
// 7. Share the spreadsheet as "Anyone with the link can edit"
// 8. Copy the spreadsheet ID from the URL:
//    https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
// 9. Paste values below

const RUNTIME_CONFIG_KEY = 'pp_runtime_config';

/**
 * Get a runtime config value (localStorage override → hardcoded fallback).
 */
export function getRuntimeConfig(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(RUNTIME_CONFIG_KEY) || '{}');
    if (key in stored) return stored[key];
  } catch { /* ignore */ }
  return CONFIG[key] || '';
}

/**
 * Set a runtime config value in localStorage.
 */
export function setRuntimeConfig(key, value) {
  try {
    const stored = JSON.parse(localStorage.getItem(RUNTIME_CONFIG_KEY) || '{}');
    stored[key] = value;
    localStorage.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(stored));
  } catch { /* ignore */ }
}

export const CONFIG = {
  // Google Sheets API
  API_KEY: 'AIzaSyDp93FQBEQjWsyLkGrQ0YFusnY94DVzDWw',
  SPREADSHEET_ID: '18Yhe3Yiq9_eI7kBxtFOzdu6Pb0_VUx730TYjq1xPjzI',
  SHEETS_BASE_URL: 'https://sheets.googleapis.com/v4/spreadsheets',

  // Google OAuth (for Admin SSO login)
  GOOGLE_CLIENT_ID: '206815760499-ip5cgia4j8fk9nb5qq83fdv3cfd95lvp.apps.googleusercontent.com',

  // OAuth scope for Google Sheets read/write access
  OAUTH_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

  // Allowed admin email(s) — only these Google accounts can log in as admin
  ADMIN_EMAILS: ['aadsit7@gmail.com', 'adsitvideo@gmail.com'],

  // Sheet names (must match your Google Spreadsheet tab names)
  SHEET_PARTNERS: 'Partners',
  SHEET_OPPORTUNITIES: 'Opportunities',
  SHEET_EVENTS: 'Events',
  SHEET_TRANSCRIPTS: 'Transcripts',

  // Support & Resources iframe URL
  SUPPORT_URL: 'https://partnerprogram.github.io/Application-Workspace/',

  // App info
  APP_NAME: 'Partner Portal',
  APP_VERSION: '1.0.0',

  // Session key
  SESSION_KEY: 'pp_user',

  // Default password for new partners (SHA-256 hash of "Portal2026")
  DEFAULT_PASSWORD: 'Portal2026',

  // Content visibility defaults (false = hidden, true = shown)
  SHOW_INACTIVE_PARTNERS: false,
  SHOW_PAST_EVENTS: true,
  SHOW_CANCELLED_EVENTS: false,
  SHOW_CLOSED_LOST_OPPS: false,
};

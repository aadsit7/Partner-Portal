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

export const CONFIG = {
  // Google Sheets API
  API_KEY: 'YOUR_GOOGLE_API_KEY_HERE',
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
  SHEETS_BASE_URL: 'https://sheets.googleapis.com/v4/spreadsheets',

  // Google OAuth (for Admin SSO login)
  // Setup: Google Cloud Console > APIs & Services > Credentials > Create OAuth Client ID
  // Application type: Web application
  // Authorized JavaScript origins: your GitHub Pages URL (e.g., https://yourusername.github.io)
  GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID_HERE',

  // OAuth scope for Google Sheets read/write access
  OAUTH_SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

  // Allowed admin email(s) — only these Google accounts can log in as admin
  ADMIN_EMAILS: ['your-email@gmail.com'],

  // Sheet names (must match your Google Spreadsheet tab names)
  SHEET_PARTNERS: 'Partners',
  SHEET_OPPORTUNITIES: 'Opportunities',
  SHEET_EVENTS: 'Events',

  // Support & Resources iframe URL
  SUPPORT_URL: 'https://partnerprogram.github.io/Application-Workspace/',

  // App info
  APP_NAME: 'Partner Portal',
  APP_VERSION: '1.0.0',

  // Session key
  SESSION_KEY: 'pp_user',

  // Default password for new partners (SHA-256 hash of "Portal2026")
  DEFAULT_PASSWORD: 'Portal2026',
};

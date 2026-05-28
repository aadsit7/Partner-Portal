// ============================================
// Authentication Module
// ============================================
//
// Login and Google SSO were removed: the portal opens directly as admin with
// no sign-in. Every visitor is treated as the single admin identity below.
//
// Note: this is view-oriented. Google requires an interactive sign-in to
// *write* to the spreadsheet, so reads (which use the public API key) work,
// but saving changes will return an auth error from the Sheets API.

/**
 * Get the current user. With login removed there is always exactly one user:
 * the admin. A fresh object is returned each call so callers can safely read
 * (or copy) it without sharing mutable state.
 */
export function getCurrentUser() {
  return {
    partner_id: 'p_admin001',
    username: 'admin',
    display_name: 'Admin',
    partner_type: '',
    is_admin: true,
    google_picture: null,
    tier: 'Admin',
    status: 'active',
    access_token: null,
    access_token_expires: null,
  };
}

/**
 * Check if the current user is an admin. Always true now (no login).
 */
export function isAdmin() {
  return true;
}

/**
 * Get the stored OAuth access token. There is no sign-in in this build, so
 * there is never a token — returning null keeps Sheets reads on the public
 * API-key path (see sheets.js getAuthParam).
 */
export function getAccessToken() {
  return null;
}

/**
 * Get the user's initials (for the sidebar avatar).
 */
export function getUserInitials(user) {
  if (!user?.display_name) return '?';
  return user.display_name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

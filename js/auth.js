// ============================================
// Authentication Module
// ============================================

import { CONFIG } from './config.js';
import { sha256 } from './utils/hash.js';
import { readSheetAsObjects, isConfigured } from './sheets.js';

/**
 * Attempt login with username and password (for partners).
 * @returns {Object} user object on success
 * @throws on failure
 */
export async function login(username, password) {
  const passwordHash = await sha256(password);

  // Fetch partners list
  const partners = await readSheetAsObjects(CONFIG.SHEET_PARTNERS);

  // Find matching active user
  const user = partners.find(p => {
    const usernameMatch = p.username?.toLowerCase() === username.toLowerCase();
    const statusMatch = p.status?.toLowerCase() === 'active';

    // In demo mode (no API configured), accept the known password directly
    if (!isConfigured()) {
      return usernameMatch && statusMatch && password === CONFIG.DEFAULT_PASSWORD;
    }

    const passMatch = p.password_hash === passwordHash;
    return usernameMatch && passMatch && statusMatch;
  });

  if (!user) {
    throw new Error('Invalid username or password');
  }

  // If this user is an admin, block — admin must use Google SSO
  if (String(user.is_admin).toUpperCase() === 'TRUE') {
    throw new Error('Admin accounts must sign in with Google');
  }

  // Store session (exclude password hash)
  const session = { ...user };
  delete session.password_hash;
  delete session._rowIndex;
  session.is_admin = false;

  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  return session;
}

/**
 * Handle Google SSO login for admin.
 * Called after Google Identity Services returns a credential.
 * @param {Object} credentialResponse - from Google
 * @returns {Object} user session
 * @throws on failure
 */
export async function loginWithGoogle(credentialResponse, accessToken = null) {
  // Decode the JWT to get user info
  const payload = decodeJwt(credentialResponse.credential);

  if (!payload || !payload.email) {
    throw new Error('Failed to read Google account info');
  }

  const email = payload.email.toLowerCase();

  // Check if this email is in the allowed admin list
  const allowedEmails = CONFIG.ADMIN_EMAILS.map(e => e.toLowerCase());

  // Also check if demo mode — allow any Google login as admin
  const isDemoMode = !isConfigured();

  if (!isDemoMode && !allowedEmails.includes(email)) {
    throw new Error(`${payload.email} is not authorized as an admin. Contact your administrator.`);
  }

  // Build admin session
  const session = {
    partner_id: 'p_admin001',
    username: 'admin',
    display_name: payload.name || 'Admin',
    partner_type: '',
    is_admin: true,
    google_picture: payload.picture || null,
    tier: 'Admin',
    status: 'active',
    access_token: accessToken || null,
    access_token_expires: accessToken ? Date.now() + 3600 * 1000 : null,
  };

  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  return session;
}

/**
 * Decode a JWT token without verification (client-side only).
 * The token is already verified by Google's library.
 */
function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Fallback: Admin login with username/password when Google SSO isn't configured.
 */
export async function loginAsAdmin(username, password) {
  const passwordHash = await sha256(password);
  const partners = await readSheetAsObjects(CONFIG.SHEET_PARTNERS);

  const user = partners.find(p => {
    const usernameMatch = p.username?.toLowerCase() === username.toLowerCase();
    const isAdminUser = String(p.is_admin).toUpperCase() === 'TRUE';
    const statusMatch = p.status?.toLowerCase() === 'active';

    if (!isConfigured()) {
      return usernameMatch && isAdminUser && statusMatch && password === CONFIG.DEFAULT_PASSWORD;
    }

    const passMatch = p.password_hash === passwordHash;
    return usernameMatch && passMatch && isAdminUser && statusMatch;
  });

  if (!user) {
    throw new Error('Invalid admin credentials');
  }

  const session = { ...user };
  delete session.password_hash;
  delete session._rowIndex;
  session.is_admin = true;

  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  return session;
}

/**
 * Get the current logged-in user, or null.
 */
export function getCurrentUser() {
  const raw = localStorage.getItem(CONFIG.SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Check if the current user is an admin.
 */
export function isAdmin() {
  const user = getCurrentUser();
  return user?.is_admin === true;
}

/**
 * Get the stored OAuth access token, or null if missing/expired.
 */
export function getAccessToken() {
  const user = getCurrentUser();
  if (!user?.access_token) return null;
  // Expired (with 5-minute buffer)?
  if (user.access_token_expires && Date.now() > user.access_token_expires - 300000) {
    return null;
  }
  return user.access_token;
}

/**
 * Update the stored access token (e.g., after a silent refresh).
 */
export function storeAccessToken(token) {
  const user = getCurrentUser();
  if (!user) return;
  user.access_token = token;
  user.access_token_expires = Date.now() + 3600 * 1000;
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user));
}

/**
 * Log out the current user.
 */
export function logout() {
  const user = getCurrentUser();
  // Revoke Google token if present
  if (user?.access_token && window.google?.accounts?.oauth2) {
    try { google.accounts.oauth2.revoke(user.access_token); } catch {}
  }
  localStorage.removeItem(CONFIG.SESSION_KEY);
}

/**
 * Get the user's initials (for avatar).
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

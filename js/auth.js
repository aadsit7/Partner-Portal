// ============================================
// Authentication Module
// ============================================

import { CONFIG } from './config.js';
import { sha256 } from './utils/hash.js';
import { readSheetAsObjects, isConfigured } from './sheets.js';

/**
 * Attempt login with username and password.
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

  // Store session (exclude password hash)
  const session = { ...user };
  delete session.password_hash;
  delete session._rowIndex;
  session.is_admin = String(user.is_admin).toUpperCase() === 'TRUE';

  sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  return session;
}

/**
 * Get the current logged-in user, or null.
 */
export function getCurrentUser() {
  const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
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
 * Log out the current user.
 */
export function logout() {
  sessionStorage.removeItem(CONFIG.SESSION_KEY);
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

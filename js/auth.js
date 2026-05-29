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

// ============================================
// Admin Google SSO — full-page OAuth redirect
// ============================================
//
// Why a redirect instead of Google Identity Services' rendered button / One
// Tap: on iOS every browser (Chrome included) runs on WebKit, which blocks the
// popups and partitions the third-party storage GIS relies on. The result on
// iPhone was that the "Sign in with Google" button never even rendered, so
// admins could not sign in. A full-page OAuth redirect is a plain top-level
// navigation to Google and back — no popup, no third-party cookies, no FedCM —
// so it behaves identically on desktop and iPhone.
//
// We use the OpenID implicit flow (response_type="token id_token") so a single
// sign-in returns both the admin's identity (id_token, checked against
// ADMIN_EMAILS) and a Sheets access token (for saving), with no backend to
// exchange a code — which suits this static GitHub Pages site.

const OAUTH_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_STATE_KEY = 'pp_oauth_state';
const OAUTH_NONCE_KEY = 'pp_oauth_nonce';
const OAUTH_TARGET_KEY = 'pp_oauth_target';

// Carries a sign-in error from completeGoogleRedirect() (which runs on page
// load) to the login view (which renders just after), within the same load.
let _pendingLoginError = null;
export function takeLoginError() {
  const err = _pendingLoginError;
  _pendingLoginError = null;
  return err;
}

/**
 * The exact redirect URI this deployment uses. This value must be registered
 * under the OAuth client's "Authorized redirect URIs" in Google Cloud Console.
 * A trailing index.html is normalized away so one registered URI works whether
 * the user visits /Partner-Portal/ or /Partner-Portal/index.html.
 */
export function getOAuthRedirectUri() {
  let path = window.location.pathname || '/';
  if (path.endsWith('index.html')) path = path.slice(0, -'index.html'.length);
  return window.location.origin + path;
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function safeSessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* private mode */ }
}
function safeSessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function clearOAuthHandshake() {
  try {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_NONCE_KEY);
    sessionStorage.removeItem(OAUTH_TARGET_KEY);
  } catch { /* ignore */ }
}

/**
 * Begin admin sign-in by navigating the whole page to Google's OAuth screen.
 * The page unloads, so this never returns. completeGoogleRedirect() finishes
 * the flow when Google sends the browser back.
 *
 * @param {Object} [opts]
 * @param {string} [opts.target='/admin/dashboard'] - route to land on after success
 * @param {boolean} [opts.chooseAccount=false] - force Google's account chooser
 *   (used after a failed attempt so the admin can pick a different account)
 */
export function beginGoogleRedirect({ target = '/admin/dashboard', chooseAccount = false } = {}) {
  const clientId = CONFIG.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
    throw new Error('Google sign-in is not configured');
  }

  const state = randomToken();
  const nonce = randomToken();
  safeSessionSet(OAUTH_STATE_KEY, state);
  safeSessionSet(OAUTH_NONCE_KEY, nonce);
  safeSessionSet(OAUTH_TARGET_KEY, target);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOAuthRedirectUri(),
    response_type: 'token id_token',
    scope: CONFIG.OAUTH_LOGIN_SCOPES,
    nonce,
    state,
    include_granted_scopes: 'true',
  });
  // Omitting `prompt` gives the smoothest SSO: a returning admin with one
  // active Google session is bounced straight back, signed in, with no taps.
  // After a failure we force the chooser so they can switch accounts.
  if (chooseAccount) params.set('prompt', 'select_account');

  window.location.href = `${OAUTH_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * If this page load is the return leg of a Google OAuth redirect, finish
 * signing the admin in. Identity comes from the returned id_token, so this is
 * synchronous (no network call) and safe to run before the router reads the
 * URL.
 *
 * @returns {{ok: true, target: string} | {error: string} | null}
 *   - {ok, target} on success: the session is stored and the token-bearing
 *     URL fragment has been replaced with a clean route.
 *   - {error} on failure: the URL is cleaned and the message is stashed for
 *     the login view (see takeLoginError).
 *   - null when this load is not an OAuth return (normal navigation).
 */
export function completeGoogleRedirect() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  // A normal route ("/admin/dashboard") parses to no recognized keys below.
  const params = new URLSearchParams(raw);
  const error = params.get('error');
  const accessToken = params.get('access_token');
  const idToken = params.get('id_token');

  if (!error && !accessToken && !idToken) return null; // not an OAuth return

  const savedState = safeSessionGet(OAUTH_STATE_KEY);
  const savedNonce = safeSessionGet(OAUTH_NONCE_KEY);
  const target = safeSessionGet(OAUTH_TARGET_KEY) || '/admin/dashboard';
  clearOAuthHandshake();

  // Strip the OAuth params out of the URL/history before doing anything else —
  // an access token must never linger in the address bar or back-button history.
  const finish = (route) => {
    const clean = `${getOAuthRedirectUri()}#${route.replace(/^#/, '')}`;
    try { history.replaceState(null, '', clean); }
    catch { window.location.hash = route; }
  };
  const fail = (message, code) => {
    _pendingLoginError = message;
    finish('/login');
    return { error: code };
  };

  if (error) {
    return fail(
      error === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed. Please try again.',
      error,
    );
  }

  // CSRF: the state echoed back must match the one we sent.
  if (savedState && params.get('state') !== savedState) {
    return fail('Sign-in could not be verified. Please try again.', 'state_mismatch');
  }

  const payload = decodeJwt(idToken);
  if (!payload || !payload.email) {
    return fail('Could not read your Google account. Please try again.', 'bad_id_token');
  }

  // Replay protection: the id_token's nonce must match the one we sent.
  if (savedNonce && payload.nonce && payload.nonce !== savedNonce) {
    return fail('Sign-in could not be verified. Please try again.', 'nonce_mismatch');
  }

  // Authorize the account (demo mode — no Sheets configured — allows any account).
  const email = String(payload.email).toLowerCase();
  const allowed = CONFIG.ADMIN_EMAILS.map(e => e.toLowerCase());
  if (isConfigured() && !allowed.includes(email)) {
    return fail(`${payload.email} is not an authorized admin. Try a different account.`, 'not_admin');
  }

  const session = buildAdminSession(payload, accessToken, params.get('expires_in'));
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  finish(target);
  return { ok: true, target };
}

/**
 * Build the stored admin session from a decoded id_token payload plus the
 * Sheets access token (when one was granted).
 */
function buildAdminSession(payload, accessToken, expiresInSec) {
  return {
    partner_id: 'p_admin001',
    username: 'admin',
    display_name: payload.name || 'Admin',
    partner_type: '',
    is_admin: true,
    google_picture: payload.picture || null,
    tier: 'Admin',
    status: 'active',
    access_token: accessToken || null,
    access_token_expires: accessToken
      ? Date.now() + ((Number(expiresInSec) > 0 ? Number(expiresInSec) : 3600) * 1000)
      : null,
  };
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
 * Accepts optional expiresInSec from Google's tokenResponse so the
 * stored expiry matches what Google actually issued, not a hard-coded
 * assumption. Falls back to 3600 s (Google's default) when omitted.
 */
export function storeAccessToken(token, expiresInSec) {
  const user = getCurrentUser();
  if (!user) return;
  const lifetimeMs = (Number(expiresInSec) > 0 ? Number(expiresInSec) : 3600) * 1000;
  user.access_token = token;
  user.access_token_expires = Date.now() + lifetimeMs;
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

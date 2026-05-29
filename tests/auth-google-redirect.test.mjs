// Tests for the admin Google SSO full-page redirect flow (js/auth.js).
//
// This flow replaced Google Identity Services' popup/One-Tap button, which
// silently failed to render on iPhone (every iOS browser is WebKit). These
// tests lock in the security-critical return-leg logic — CSRF (state) and
// replay (nonce) checks, admin authorization, and stripping the access token
// out of the URL — none of which we want to regress.

import './_setup.mjs'; // shims localStorage + document for the module imports
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  beginGoogleRedirect,
  completeGoogleRedirect,
  getOAuthRedirectUri,
  takeLoginError,
} from '../js/auth.js';
import { CONFIG } from '../js/config.js';

// ---- Browser-environment shims (installed per test) ----

function setupBrowser({ hash = '', pathname = '/Partner-Portal/', origin = 'https://aadsit7.github.io' } = {}) {
  const session = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v)),
    removeItem: (k) => session.delete(k),
  };
  let href = '';
  globalThis.window = {
    location: {
      hash,
      pathname,
      origin,
      get href() { return href; },
      set href(v) { href = v; },
    },
  };
  globalThis.history = {
    replaceState: (_s, _t, url) => {
      const i = String(url).indexOf('#');
      globalThis.window.location.hash = i >= 0 ? String(url).slice(i) : '';
    },
  };
  localStorage.clear();
  takeLoginError(); // clear any error left from a previous test
  return { session, getHref: () => href };
}

// Build a JWT whose payload decodes via auth.js's decodeJwt(). Google uses
// base64url (URL-safe, unpadded) for id_token segments — match that so the
// token survives URLSearchParams parsing of the URL fragment.
function makeIdToken(payload) {
  const seg = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${seg}.signature`;
}

function buildReturnHash({ accessToken = 'AT123', idToken, state, expiresIn = 3599 }) {
  const parts = [];
  if (accessToken) parts.push(`access_token=${accessToken}`);
  parts.push('token_type=Bearer');
  if (expiresIn != null) parts.push(`expires_in=${expiresIn}`);
  if (idToken) parts.push(`id_token=${idToken}`);
  if (state) parts.push(`state=${state}`);
  return `#${parts.join('&')}`;
}

const ADMIN_EMAIL = CONFIG.ADMIN_EMAILS[0]; // an authorized admin

// ---- getOAuthRedirectUri ----

test('getOAuthRedirectUri returns origin + path', () => {
  setupBrowser({ pathname: '/Partner-Portal/' });
  assert.equal(getOAuthRedirectUri(), 'https://aadsit7.github.io/Partner-Portal/');
});

test('getOAuthRedirectUri normalizes away a trailing index.html', () => {
  setupBrowser({ pathname: '/Partner-Portal/index.html' });
  assert.equal(getOAuthRedirectUri(), 'https://aadsit7.github.io/Partner-Portal/');
});

// ---- beginGoogleRedirect ----

test('beginGoogleRedirect navigates to Google with the right params and stashes state/nonce', () => {
  const { session, getHref } = setupBrowser();
  beginGoogleRedirect({ target: '/admin/dashboard' });

  const url = new URL(getHref());
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = url.searchParams;
  assert.equal(p.get('client_id'), CONFIG.GOOGLE_CLIENT_ID);
  assert.equal(p.get('redirect_uri'), 'https://aadsit7.github.io/Partner-Portal/');
  assert.equal(p.get('response_type'), 'token id_token');
  assert.equal(p.get('scope'), CONFIG.OAUTH_LOGIN_SCOPES);
  assert.ok(p.get('scope').includes('spreadsheets'), 'requests the Sheets scope for saving');
  assert.ok(p.get('state'), 'sends a state');
  assert.ok(p.get('nonce'), 'sends a nonce');
  assert.equal(p.get('prompt'), null, 'no prompt by default → smoothest SSO');

  // state/nonce/target persisted for the return leg
  assert.equal(session.get('pp_oauth_state'), p.get('state'));
  assert.equal(session.get('pp_oauth_nonce'), p.get('nonce'));
  assert.equal(session.get('pp_oauth_target'), '/admin/dashboard');
});

test('beginGoogleRedirect forces the chooser when chooseAccount is set', () => {
  const { getHref } = setupBrowser();
  beginGoogleRedirect({ chooseAccount: true });
  assert.equal(new URL(getHref()).searchParams.get('prompt'), 'select_account');
});

// ---- completeGoogleRedirect ----

test('completeGoogleRedirect ignores a normal route hash', () => {
  setupBrowser({ hash: '#/admin/dashboard' });
  assert.equal(completeGoogleRedirect(), null);
});

test('completeGoogleRedirect signs in an authorized admin and cleans the URL', () => {
  const state = 'state-xyz';
  const nonce = 'nonce-abc';
  const idToken = makeIdToken({ email: ADMIN_EMAIL, name: 'Portal Admin', nonce, picture: 'http://p/a.png' });
  const { session } = setupBrowser({ hash: buildReturnHash({ idToken, state }) });
  session.set('pp_oauth_state', state);
  session.set('pp_oauth_nonce', nonce);
  session.set('pp_oauth_target', '/admin/dashboard');

  const result = completeGoogleRedirect();
  assert.deepEqual(result, { ok: true, target: '/admin/dashboard' });

  // Session stored, marked admin, with the Sheets access token.
  const stored = JSON.parse(localStorage.getItem(CONFIG.SESSION_KEY));
  assert.equal(stored.is_admin, true);
  assert.equal(stored.display_name, 'Portal Admin');
  assert.equal(stored.access_token, 'AT123');
  assert.ok(stored.access_token_expires > Date.now(), 'token expiry set in the future');

  // The token-bearing fragment is gone; URL points at a clean route.
  assert.equal(globalThis.window.location.hash, '#/admin/dashboard');
  // Handshake values consumed.
  assert.equal(session.get('pp_oauth_state'), undefined);
  assert.equal(takeLoginError(), null, 'no error on success');
});

test('completeGoogleRedirect rejects a non-admin Google account', () => {
  const state = 's1';
  const nonce = 'n1';
  const idToken = makeIdToken({ email: 'stranger@example.com', name: 'Nope', nonce });
  const { session } = setupBrowser({ hash: buildReturnHash({ idToken, state }) });
  session.set('pp_oauth_state', state);
  session.set('pp_oauth_nonce', nonce);

  const result = completeGoogleRedirect();
  assert.equal(result.error, 'not_admin');
  assert.equal(localStorage.getItem(CONFIG.SESSION_KEY), null, 'no session stored');
  assert.match(takeLoginError(), /not an authorized admin/i);
  assert.equal(globalThis.window.location.hash, '#/login', 'bounced back to login');
});

test('completeGoogleRedirect rejects a state (CSRF) mismatch', () => {
  const nonce = 'n2';
  const idToken = makeIdToken({ email: ADMIN_EMAIL, nonce });
  const { session } = setupBrowser({ hash: buildReturnHash({ idToken, state: 'attacker-state' }) });
  session.set('pp_oauth_state', 'real-state');
  session.set('pp_oauth_nonce', nonce);

  const result = completeGoogleRedirect();
  assert.equal(result.error, 'state_mismatch');
  assert.equal(localStorage.getItem(CONFIG.SESSION_KEY), null);
});

test('completeGoogleRedirect rejects a nonce (replay) mismatch', () => {
  const state = 's3';
  const idToken = makeIdToken({ email: ADMIN_EMAIL, nonce: 'stale-nonce' });
  const { session } = setupBrowser({ hash: buildReturnHash({ idToken, state }) });
  session.set('pp_oauth_state', state);
  session.set('pp_oauth_nonce', 'fresh-nonce');

  const result = completeGoogleRedirect();
  assert.equal(result.error, 'nonce_mismatch');
  assert.equal(localStorage.getItem(CONFIG.SESSION_KEY), null);
});

test('completeGoogleRedirect surfaces a Google-returned error', () => {
  setupBrowser({ hash: '#error=access_denied&state=s4' });
  const result = completeGoogleRedirect();
  assert.equal(result.error, 'access_denied');
  assert.match(takeLoginError(), /cancelled/i);
  assert.equal(globalThis.window.location.hash, '#/login');
});

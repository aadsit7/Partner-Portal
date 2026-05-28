// ============================================
// Login View
// ============================================

import { login, loginWithGoogle, storeAccessToken } from '../auth.js';
import { navigate } from '../router.js';
import { CONFIG } from '../config.js';
import { el, $, mount } from '../utils/dom.js';

// OAuth token client for requesting Sheets API access token
let tokenClient = null;

/**
 * Initialize just the OAuth token client (no UI). Safe to call on any page
 * for returning admin sessions so the token can be refreshed without showing
 * the login screen.
 */
export function initTokenClient() {
  const clientId = CONFIG.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') return;

  const tryInit = () => {
    if (window.google?.accounts?.oauth2 && !tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: CONFIG.OAUTH_SCOPES,
        callback: () => {},
      });
    }
  };

  if (window.google?.accounts?.oauth2) {
    tryInit();
  } else {
    const check = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(check);
        tryInit();
      }
    }, 100);
    setTimeout(() => clearInterval(check), 8000);
  }
}

export const title = 'Login';

export async function render(container) {
  const app = document.getElementById('app');
  app.className = 'app-shell--login';

  const card = el('div', {
    class: 'login-card',
    style: {
      background: 'white',
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-10)',
      width: '100%',
      maxWidth: '420px',
      boxShadow: 'var(--shadow-xl)',
    }
  },
    // Logo
    el('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginBottom: 'var(--space-8)',
      }
    },
      el('h1', {
        style: {
          fontSize: 'var(--text-2xl)',
          fontWeight: 'var(--font-bold)',
          color: 'var(--color-text-primary)',
          marginBottom: 'var(--space-2)',
        }
      }, 'Partner Portal'),
      el('p', {
        style: {
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
        }
      }, 'Sign in to access your dashboard')
    ),

    // Partner login form
    el('form', { id: 'login-form', onSubmit: handleLogin },
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label', for: 'username' }, 'Username'),
        el('input', {
          class: 'form-input',
          type: 'text',
          id: 'username',
          name: 'username',
          placeholder: 'Enter your username',
          required: true,
          autocomplete: 'username',
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
        })
      ),
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label', for: 'password' }, 'Password'),
        el('input', {
          class: 'form-input',
          type: 'password',
          id: 'password',
          name: 'password',
          placeholder: 'Enter your password',
          required: true,
          autocomplete: 'current-password',
        })
      ),
      el('div', {
        id: 'login-error',
        style: {
          fontSize: 'var(--text-sm)',
          color: 'var(--color-danger)',
          marginBottom: 'var(--space-4)',
          minHeight: '20px',
        }
      }),
      el('button', {
        class: 'btn btn--primary btn--lg btn--full',
        type: 'submit',
        id: 'login-btn',
      }, 'Sign In')
    ),

    // Divider
    el('div', {
      class: 'login-divider',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        margin: 'var(--space-6) 0',
      }
    },
      el('div', { style: { flex: '1', height: '1px', background: 'var(--color-border)' } }),
      el('span', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--font-medium)' } }, 'Admin Access'),
      el('div', { style: { flex: '1', height: '1px', background: 'var(--color-border)' } }),
    ),

    // Google SSO button for admin
    el('div', { id: 'google-sso-section' },
      el('button', {
        class: 'btn-google',
        id: 'google-sso-btn',
        type: 'button',
        onClick: handleGoogleSSO,
      },
        el('span', { class: 'btn-google__icon', html: googleIcon() }),
        el('span', { class: 'btn-google__text' }, 'Sign in with Google')
      ),
      el('div', {
        id: 'google-error',
        style: {
          fontSize: 'var(--text-sm)',
          color: 'var(--color-danger)',
          marginTop: 'var(--space-2)',
          textAlign: 'center',
          minHeight: '20px',
        }
      })
    ),

    // Footer
    el('div', {
      style: {
        marginTop: 'var(--space-6)',
        textAlign: 'center',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
      }
    }, 'Secure partner access')
  );

  mount(container, card);

  // Focus username field
  setTimeout(() => {
    const usernameInput = $('#username');
    if (usernameInput) usernameInput.focus();
  }, 100);

  // Initialize Google Identity Services
  initGoogleSSO();
}

/**
 * Initialize Google Identity Services for the SSO button.
 *
 * We use the OAuth 2.0 *token* flow (google.accounts.oauth2) rather than the
 * ID-token "render a Google button" flow. The token flow is the pattern
 * Google documents for a custom-styled button: sign-in is started by calling
 * requestAccessToken() directly inside the button's own click handler (see
 * handleGoogleSSO), which keeps Google's sign-in popup tied to a genuine user
 * gesture.
 *
 * That distinction is what fixes mobile. Every iPhone browser — Chrome
 * included — runs on WebKit, which blocks auth popups that aren't opened
 * straight from a real tap. The old approach programmatically clicked a
 * hidden, pre-rendered Google button on the user's behalf; on iOS that lost
 * the user gesture and the popup was silently blocked, so admins could never
 * sign in. Triggering the token flow from the tap itself avoids that.
 */
function initGoogleSSO() {
  const clientId = CONFIG.GOOGLE_CLIENT_ID;

  // If no client ID configured, show a fallback admin login
  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
    showAdminFallback();
    return;
  }

  // Set up the OAuth token client (waits for the GIS library to load).
  initTokenClient();
}

/**
 * Show fallback admin username/password when Google SSO isn't configured.
 */
function showAdminFallback() {
  const section = $('#google-sso-section');
  if (!section) return;

  section.innerHTML = '';
  section.appendChild(
    el('button', {
      class: 'btn btn--secondary btn--lg btn--full',
      type: 'button',
      onClick: handleAdminFallbackLogin,
      id: 'admin-fallback-btn',
    }, 'Sign in as Admin')
  );
  section.appendChild(
    el('div', {
      id: 'google-error',
      style: {
        fontSize: 'var(--text-sm)',
        color: 'var(--color-danger)',
        marginTop: 'var(--space-2)',
        textAlign: 'center',
        minHeight: '20px',
      }
    })
  );
  section.appendChild(
    el('p', {
      style: {
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        textAlign: 'center',
        marginTop: 'var(--space-2)',
      }
    }, 'Google SSO not configured — using password login')
  );
}

/**
 * Fallback: admin logs in with username/password when Google SSO is not set up.
 */
async function handleAdminFallbackLogin() {
  const errorEl = $('#google-error');
  const btn = $('#admin-fallback-btn');

  // Prompt using the username/password fields
  const username = $('#username')?.value?.trim();
  const password = $('#password')?.value;

  if (!username || !password) {
    if (errorEl) errorEl.textContent = 'Enter admin username and password above, then click here';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in...';
  if (errorEl) errorEl.textContent = '';

  try {
    // Use direct login but allow admin in fallback mode
    const { loginAsAdmin } = await import('../auth.js');
    const user = await loginAsAdmin(username, password);
    navigate('/admin/dashboard');
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Invalid credentials';
    btn.disabled = false;
    btn.textContent = 'Sign in as Admin';
  }
}

/**
 * Custom Google button click — start the OAuth token flow directly.
 *
 * requestAccessToken() is called synchronously here, inside the real click
 * handler, so Google's sign-in window opens as a user-initiated popup. This
 * is what makes sign-in work on iOS (Safari and Chrome are both WebKit),
 * where popups opened outside a direct user gesture are blocked. A single
 * consent grants both identity (email/profile) and Sheets access, so there
 * is only one popup to open.
 */
function handleGoogleSSO() {
  const errorEl = $('#google-error');
  const btn = $('#google-sso-btn');

  if (!tokenClient) {
    // GIS library not ready yet — kick off init and ask the user to retry.
    initTokenClient();
    if (errorEl) errorEl.textContent = 'Google Sign-In is still loading. Please try again.';
    return;
  }

  if (errorEl) errorEl.textContent = '';
  setGoogleBtnLoading(btn, true);

  // Install the callback for this sign-in attempt, then open the popup.
  tokenClient.callback = (tokenResponse) => {
    if (tokenResponse.error || !tokenResponse.access_token) {
      // User dismissed the popup or denied access.
      if (errorEl) {
        errorEl.textContent = tokenResponse.error
          ? 'Google sign-in was cancelled. Please try again.'
          : 'Google sign-in failed. Please try again.';
      }
      setGoogleBtnLoading(btn, false);
      return;
    }
    completeGoogleLogin(tokenResponse, errorEl, btn);
  };

  try {
    tokenClient.requestAccessToken();
  } catch {
    if (errorEl) errorEl.textContent = 'Google Sign-In is unavailable. Please try again.';
    setGoogleBtnLoading(btn, false);
  }
}

/**
 * Finish admin sign-in once Google has granted an access token: read the
 * account's profile, authorize it, store the session, and route to the
 * dashboard.
 */
async function completeGoogleLogin(tokenResponse, errorEl, btn) {
  try {
    const accessToken = {
      token: tokenResponse.access_token,
      expiresIn: tokenResponse.expires_in,
    };

    const profile = await fetchGoogleProfile(tokenResponse.access_token);
    await loginWithGoogle(profile, accessToken);

    // Silently sync sheet headers in the background so the admin never has
    // to visit Setup → Sync Headers manually after each login.
    import('../sheets.js').then(({ syncHeaders }) => {
      syncHeaders().catch(() => {});
    });

    navigate('/admin/dashboard');
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Google sign-in failed';
    setGoogleBtnLoading(btn, false);
  }
}

/**
 * Read the signed-in user's email / name / picture from Google's OpenID
 * userinfo endpoint using the granted access token. Requires the
 * userinfo.email / userinfo.profile scopes (see CONFIG.OAUTH_SCOPES).
 */
async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('Could not read your Google account info. Please try again.');
  }
  return res.json();
}

/**
 * Toggle the Google button's loading state.
 */
function setGoogleBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const textEl = btn.querySelector('.btn-google__text');
  if (textEl) textEl.textContent = loading ? 'Signing in...' : 'Sign in with Google';
}

/**
 * Wait briefly for the OAuth tokenClient to initialize. Returns true if
 * the client is ready within the timeout, false otherwise. Used by
 * refreshAccessToken so a refresh triggered immediately after page load
 * isn't lost just because the GIS library hasn't finished loading yet.
 */
function waitForTokenClient(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (tokenClient) { resolve(true); return; }
    initTokenClient();
    const start = Date.now();
    const check = setInterval(() => {
      if (tokenClient) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * Refresh the access token silently (exported for use by sheets.js on 401).
 * Uses prompt: 'none' so Google never shows the account chooser here — if
 * interaction would be required, the call fails and we resolve null. The
 * caller (page-load init, scheduled refresh, or sheets.js 401 retry) treats
 * null as "stay logged in but operate without a fresh token" rather than
 * popping a chooser on the user.
 *
 * Stores the new token (with Google's actual expires_in) before resolving,
 * so callers don't have to.
 */
export async function refreshAccessToken() {
  const ready = await waitForTokenClient();
  if (!ready) return null;

  return new Promise((resolve) => {
    // Hard timeout so a stuck callback can't leave the scheduler hanging
    const timeout = setTimeout(() => resolve(null), 10000);

    tokenClient.callback = (tokenResponse) => {
      clearTimeout(timeout);
      if (tokenResponse?.access_token) {
        storeAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
        resolve(tokenResponse.access_token);
      } else {
        resolve(null);
      }
    };
    try {
      tokenClient.requestAccessToken({ prompt: 'none' });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

/**
 * Partner login handler (username + password).
 */
async function handleLogin(e) {
  e.preventDefault();

  const username = $('#username').value.trim();
  const password = $('#password').value;
  const errorEl = $('#login-error');
  const btn = $('#login-btn');

  if (!username || !password) {
    errorEl.textContent = 'Please enter both username and password';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in...';
  errorEl.textContent = '';

  try {
    const user = await login(username, password);
    navigate('/partner/opportunities');
  } catch (err) {
    errorEl.textContent = err.message || 'Invalid username or password';
    btn.disabled = false;
    btn.textContent = 'Sign In';
    $('#password').value = '';
    $('#password').focus();
  }
}

/**
 * Google "G" logo as inline SVG.
 */
function googleIcon() {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>`;
}

export function cleanup() {}

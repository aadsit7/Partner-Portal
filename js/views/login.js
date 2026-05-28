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

    // Google SSO for admin. Google Identity Services renders its own official
    // "Sign in with Google" button into this container (see initGoogleSSO).
    // We render Google's real button — instead of a custom button that
    // forwards the click — because it's the only flow that reliably works on
    // iPhone: every iOS browser (Chrome included) runs on WebKit, which blocks
    // any sign-in window that isn't opened directly by Google's own button tap.
    el('div', { id: 'google-sso-section' },
      el('div', {
        id: 'g_id_signin',
        style: {
          display: 'flex',
          justifyContent: 'center',
          minHeight: '44px',
        }
      }),
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
 */
function initGoogleSSO() {
  const clientId = CONFIG.GOOGLE_CLIENT_ID;

  // If no client ID configured, show a fallback admin login
  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
    showAdminFallback();
    return;
  }

  // Wait for the Google library to load, then render Google's official button.
  const checkGoogle = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(checkGoogle);

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
        auto_select: true,           // sign returning users back in with no click
        itp_support: true,           // keep One Tap working on Safari / iOS (ITP)
        use_fedcm_for_prompt: true,  // browser-native One Tap (required on Chrome)
        cancel_on_tap_outside: false,
      });

      // Render Google's official "Sign in with Google" button directly into
      // the visible container, so the user taps Google's own button. Tapping
      // it is what opens the sign-in window inside a genuine user gesture —
      // the requirement iOS/WebKit enforces for auth windows. (The previous
      // build rendered this button hidden and clicked it from code, which iOS
      // treated as non-user-initiated and silently blocked, so sign-in never
      // opened on iPhone.)
      const target = $('#g_id_signin');
      if (target) {
        // Size the button to the card width so it lines up with the form.
        const width = Math.min(Math.max(Math.round(target.clientWidth) || 320, 240), 400);
        google.accounts.id.renderButton(target, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        });
      }

      // Also initialize the OAuth token client for Sheets API write access.
      if (window.google?.accounts?.oauth2) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: CONFIG.OAUTH_SCOPES,
          callback: () => {}, // Overwritten at call time
        });
      }

      // Automatic sign-in for returning users. With auto_select, a device
      // already signed in to this Google account is signed back in with no
      // clicks — so after the first sign-in on a device you stay signed in,
      // and even if the browser later clears the saved session (iOS does this
      // periodically), the next visit silently restores it. The rendered
      // button above stays as the manual fallback.
      google.accounts.id.prompt();
    }
  }, 100);

  // Stop checking after 8 seconds
  setTimeout(() => clearInterval(checkGoogle), 8000);
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
 * Google credential callback — fires when the user completes sign-in through
 * Google's rendered button.
 *
 * The identity (the JWT in `response.credential`) is all we need to log the
 * admin in, so we do that first and route to the dashboard immediately. The
 * Sheets access token is fetched in the background and must NOT block login:
 * its popup/iframe grant is unreliable on iOS, and making sign-in wait on it
 * is what made the portal feel broken on iPhone. If the token can't be
 * obtained the admin is still logged in, and sheets.js requests a fresh token
 * when a write actually needs one.
 */
async function handleGoogleCredential(response) {
  const errorEl = $('#google-error');

  try {
    // Step 1: authenticate with the Google identity. This logs the admin in.
    await loginWithGoogle(response, null);

    // Step 2 (background, non-blocking): obtain a Sheets access token so
    // writes work, then sync headers. Failures here never block login.
    if (tokenClient) {
      requestSheetsAccessToken().then((accessToken) => {
        if (!accessToken) return;
        storeAccessToken(accessToken.token, accessToken.expiresIn);
        import('../sheets.js').then(({ syncHeaders }) => {
          syncHeaders().catch(() => {});
        });
      });
    }

    navigate('/admin/dashboard');
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Google sign-in failed';
  }
}

/**
 * Request an OAuth access token for Google Sheets write access.
 * Tries silent prompt first; falls back to consent dialog on first use.
 * Returns { token, expiresIn } so callers can store the real lifetime
 * Google issued (instead of assuming 1 hour).
 */
function requestSheetsAccessToken() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(null);
      return;
    }

    // Timeout to prevent hanging forever if callback never fires
    const timeout = setTimeout(() => resolve(null), 15000);

    tokenClient.callback = (tokenResponse) => {
      clearTimeout(timeout);
      if (tokenResponse.error) {
        // Any error on silent prompt — try again with consent dialog
        tokenClient.callback = (retryResponse) => {
          if (retryResponse.error) {
            resolve(null);
            return;
          }
          resolve(retryResponse.access_token
            ? { token: retryResponse.access_token, expiresIn: retryResponse.expires_in }
            : null);
        };
        try {
          tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch {
          resolve(null);
        }
        return;
      }
      resolve(tokenResponse.access_token
        ? { token: tokenResponse.access_token, expiresIn: tokenResponse.expires_in }
        : null);
    };

    // Try silent first (works if user previously granted consent)
    try {
      tokenClient.requestAccessToken({ prompt: '' });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
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

export function cleanup() {}

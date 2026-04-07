// ============================================
// Login View
// ============================================

import { login, loginWithGoogle, storeAccessToken } from '../auth.js';
import { navigate } from '../router.js';
import { CONFIG } from '../config.js';
import { el, $, mount } from '../utils/dom.js';

// OAuth token client for requesting Sheets API access token
let tokenClient = null;

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
 */
function initGoogleSSO() {
  const clientId = CONFIG.GOOGLE_CLIENT_ID;

  // If no client ID configured, show a fallback admin login
  if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
    showAdminFallback();
    return;
  }

  // Wait for the Google library to load
  const checkGoogle = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(checkGoogle);

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
        auto_select: false,
      });

      // Render the official Google button as a hidden element,
      // and wire our custom button to trigger it
      const hiddenDiv = document.createElement('div');
      hiddenDiv.id = 'g_id_signin';
      hiddenDiv.style.display = 'none';
      document.body.appendChild(hiddenDiv);

      google.accounts.id.renderButton(hiddenDiv, {
        type: 'standard',
        size: 'large',
      });

      // Also initialize the OAuth token client for Sheets API write access
      if (window.google?.accounts?.oauth2) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: CONFIG.OAUTH_SCOPES,
          callback: () => {}, // Overwritten at call time
        });
      }
    }
  }, 100);

  // Stop checking after 5 seconds
  setTimeout(() => clearInterval(checkGoogle), 5000);
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
 * Custom Google button click — trigger the hidden Google button.
 */
function handleGoogleSSO() {
  const hiddenBtn = document.querySelector('#g_id_signin div[role="button"]');
  if (hiddenBtn) {
    hiddenBtn.click();
  } else {
    // If Google library didn't load, show error
    const errorEl = $('#google-error');
    if (errorEl) errorEl.textContent = 'Google Sign-In is loading. Please try again.';
  }
}

/**
 * Google credential callback.
 */
async function handleGoogleCredential(response) {
  const errorEl = $('#google-error');
  const btn = $('#google-sso-btn');

  if (btn) {
    btn.disabled = true;
    const textEl = btn.querySelector('.btn-google__text');
    if (textEl) textEl.textContent = 'Signing in...';
  }

  try {
    // Step 1: Request an OAuth access token for Sheets API (if token client is ready)
    let accessToken = null;
    if (tokenClient) {
      accessToken = await requestSheetsAccessToken();
    }

    // Step 2: Authenticate with the Google ID token + store the access token
    await loginWithGoogle(response, accessToken);
    navigate('/admin/dashboard');
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Google sign-in failed';
    if (btn) {
      btn.disabled = false;
      const textEl = btn.querySelector('.btn-google__text');
      if (textEl) textEl.textContent = 'Sign in with Google';
    }
  }
}

/**
 * Request an OAuth access token for Google Sheets write access.
 * Tries silent prompt first; falls back to consent dialog on first use.
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
          resolve(retryResponse.access_token || null);
        };
        try {
          tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch {
          resolve(null);
        }
        return;
      }
      resolve(tokenResponse.access_token || null);
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
 * Refresh the access token silently (exported for use by sheets.js on 401).
 */
export function refreshAccessToken() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(null);
      return;
    }
    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse.access_token) {
        storeAccessToken(tokenResponse.access_token);
        resolve(tokenResponse.access_token);
      } else {
        resolve(null);
      }
    };
    tokenClient.requestAccessToken({ prompt: '' });
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

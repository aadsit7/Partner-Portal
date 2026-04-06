// ============================================
// Login View
// ============================================

import { login } from '../auth.js';
import { navigate } from '../router.js';
import { el, $, mount } from '../utils/dom.js';

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
      el('div', {
        style: {
          width: '56px',
          height: '56px',
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-2xl)',
          fontWeight: 'var(--font-bold)',
          color: 'white',
          marginBottom: 'var(--space-4)',
        }
      }, 'P'),
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

    // Form
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
}

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

  // Show loading state
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  errorEl.textContent = '';

  try {
    const user = await login(username, password);
    navigate(user.is_admin ? '/admin/dashboard' : '/partner/dashboard');
  } catch (err) {
    errorEl.textContent = err.message || 'Invalid username or password';
    btn.disabled = false;
    btn.textContent = 'Sign In';
    $('#password').value = '';
    $('#password').focus();
  }
}

export function cleanup() {
  // Nothing to clean up
}

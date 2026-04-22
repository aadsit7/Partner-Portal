// ============================================================
// MAP PDF Progress Pill
// ============================================================
// A small overlay inside the Randy window that shows "what's
// happening right now" during the MAP PDF flow without blocking
// the chat. Multiple pills stack if the user kicks off two
// generations in a row. All DOM lives under #randy-root.
//
// Public API (pure functions — no module-level singleton):
//   createPill()                  → { el, id }
//   updatePillStage(pill, text)   — swap the stage text
//   markPillSuccess(pill, text)   — green tick, hold 3s, fade out
//   markPillFailure(pill, text)   — amber warning, hold 5s, fade out
//   destroyPill(pill)             — immediate remove
//
// Also exported for tests:
//   formatElapsed(ms)             — "0:08", "1:23", etc.
// ============================================================

const WARN_THRESHOLD_MS = 150_000;  // 2:30 — switch to amber "taking longer…"
const HARD_TIMEOUT_MS   = 240_000;  // 4:00 — hard fail state

// Stack container — created lazily, sits under #randy-root. Each pill
// appends itself here; new pills push existing pills upward.
//
// V1.5 adds an optional `scopeContainer` so the click-driven MAP flow
// inside the Opportunity dialog can anchor its pill to the modal's
// body instead of the global Randy root. Pass the modal element and
// a stack is created (or reused) inside it.
function getStackHost(scopeContainer = null) {
  if (typeof document === 'undefined') return null;
  if (scopeContainer && typeof scopeContainer === 'object') {
    let scoped = scopeContainer.querySelector('.randy-map-pill-stack--scoped');
    if (scoped) return scoped;
    scoped = document.createElement('div');
    scoped.className = 'randy-map-pill-stack randy-map-pill-stack--scoped';
    scopeContainer.appendChild(scoped);
    return scoped;
  }
  let host = document.getElementById('randy-map-pill-stack');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'randy-map-pill-stack';
  host.className = 'randy-map-pill-stack';
  const parent = document.getElementById('randy-root') || document.body;
  parent.appendChild(host);
  return host;
}

export function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function spinnerSvg() {
  // Single rotating arc — CSS handles the spin via .randy-map-pill__spinner
  return `
    <svg viewBox="0 0 24 24" class="randy-map-pill__spinner-svg" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke-width="2.5" fill="none" stroke="currentColor" stroke-opacity="0.25"/>
      <path d="M21 12a9 9 0 0 0-9-9" stroke-width="2.5" fill="none" stroke="currentColor" stroke-linecap="round"/>
    </svg>`;
}

function checkSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function warnSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="currentColor" opacity="0.18"/><path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.1" fill="currentColor"/></svg>`;
}

export function createPill(initialStage = 'Starting…', options = {}) {
  const host = getStackHost(options.scopeContainer || null);
  if (!host) return { el: null, id: null };

  const id = `map-pill-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const el = document.createElement('div');
  el.className = 'randy-map-pill randy-map-pill--active';
  el.id = id;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <span class="randy-map-pill__icon randy-map-pill__spinner">${spinnerSvg()}</span>
    <span class="randy-map-pill__stage">${escapeHtml(initialStage)}</span>
    <span class="randy-map-pill__elapsed">0:00</span>
  `;

  // Newest pill on top (so older ones settle below if the user kicks
  // off two generations). Gap comes from CSS.
  host.insertBefore(el, host.firstChild);

  const startedAt = Date.now();
  const pill = {
    el,
    id,
    startedAt,
    stageEl:   el.querySelector('.randy-map-pill__stage'),
    elapsedEl: el.querySelector('.randy-map-pill__elapsed'),
    iconEl:    el.querySelector('.randy-map-pill__icon'),
    tickHandle: null,
    settled: false,
  };

  pill.tickHandle = setInterval(() => {
    if (pill.settled) return;
    const ms = Date.now() - startedAt;
    if (pill.elapsedEl) pill.elapsedEl.textContent = formatElapsed(ms);
    if (ms >= HARD_TIMEOUT_MS) {
      markPillFailure(pill, 'Timed out after 4 minutes');
      return;
    }
    if (ms >= WARN_THRESHOLD_MS && !el.classList.contains('randy-map-pill--warn')) {
      el.classList.add('randy-map-pill--warn');
      if (pill.stageEl) pill.stageEl.textContent = 'Taking longer than expected… still trying';
    }
  }, 1000);

  return pill;
}

export function updatePillStage(pill, stageText) {
  if (!pill || !pill.el || pill.settled) return;
  if (pill.stageEl) pill.stageEl.textContent = stageText;
}

export function markPillSuccess(pill, finalText) {
  if (!pill || !pill.el || pill.settled) return;
  pill.settled = true;
  if (pill.tickHandle) { clearInterval(pill.tickHandle); pill.tickHandle = null; }
  const elapsed = formatElapsed(Date.now() - pill.startedAt);
  pill.el.classList.remove('randy-map-pill--active', 'randy-map-pill--warn');
  pill.el.classList.add('randy-map-pill--success');
  if (pill.iconEl) {
    pill.iconEl.classList.remove('randy-map-pill__spinner');
    pill.iconEl.innerHTML = checkSvg();
  }
  if (pill.stageEl)   pill.stageEl.textContent = finalText || 'Saved!';
  if (pill.elapsedEl) pill.elapsedEl.textContent = `${elapsed} ✓`;
  scheduleFadeOut(pill, 3000);
}

export function markPillFailure(pill, errorText) {
  if (!pill || !pill.el || pill.settled) return;
  pill.settled = true;
  if (pill.tickHandle) { clearInterval(pill.tickHandle); pill.tickHandle = null; }
  pill.el.classList.remove('randy-map-pill--active', 'randy-map-pill--warn');
  pill.el.classList.add('randy-map-pill--failure');
  if (pill.iconEl) {
    pill.iconEl.classList.remove('randy-map-pill__spinner');
    pill.iconEl.innerHTML = warnSvg();
  }
  if (pill.stageEl)   pill.stageEl.textContent = errorText || 'Failed — see card';
  if (pill.elapsedEl) pill.elapsedEl.textContent = '';
  scheduleFadeOut(pill, 5000);
}

export function destroyPill(pill) {
  if (!pill || !pill.el) return;
  if (pill.tickHandle) { clearInterval(pill.tickHandle); pill.tickHandle = null; }
  pill.settled = true;
  pill.el.remove();
}

function scheduleFadeOut(pill, delayMs) {
  setTimeout(() => {
    if (!pill.el) return;
    pill.el.classList.add('randy-map-pill--fading');
    // Allow the CSS transition to run before removing from the DOM.
    setTimeout(() => { try { pill.el.remove(); } catch { /* ignore */ } }, 400);
  }, delayMs);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

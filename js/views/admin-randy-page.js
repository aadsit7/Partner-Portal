// ============================================
// Dedicated Randy Page — full-view assistant
// ============================================
// Hosts the SAME singleton Randy widget that floats around the app,
// docked into a full-page card. Everything Randy can do — chat, the
// mode presets (custom GPTs), the Quick Add form, voice and type —
// works here unchanged, because this page reuses the one widget
// instance rather than cloning it. Leaving the page returns the widget
// to its floating state, so the floating assistant is never lost.

import { setTopbarTitle } from '../components/sidebar.js';
import { dockRandy, undockRandy } from '../components/randy.js';

export function render(container) {
  setTopbarTitle('Randy');

  const view = container || document.getElementById('view-container');
  if (!view) return;

  view.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'randy-page';
  view.appendChild(page);

  // Dock the shared widget into the page. If the browser lacks Web
  // Speech support the widget was never mounted — show a graceful note.
  const docked = dockRandy(page);
  if (!docked) {
    page.innerHTML = `
      <div class="randy-page__fallback">
        <img src="assets/randy-avatar.png" alt="Randy">
        <p><strong>Randy needs a supported browser.</strong></p>
        <p>Voice and chat require the Web Speech API. Open the portal in
        the latest Chrome or Edge to use the assistant here.</p>
      </div>`;
  }
}

export function cleanup() {
  // Return the widget to its floating home and collapse it.
  undockRandy();
}

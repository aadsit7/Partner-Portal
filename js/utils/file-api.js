// ============================================================
// File API client — thin fetch wrapper for the Apps Script endpoint
// ============================================================
// Talks to the Google Apps Script web app that owns the Drive upload
// path. Critical detail: no Content-Type header is set on the request
// — that keeps the call on the simple-CORS path, avoiding a preflight
// that Apps Script can't answer. DO NOT add one.
//
// Extracted from js/views/admin-opportunities.js so non-view callers
// (Randy's voice flow, the new click-driven MAP flow) can reuse it
// without pulling in every DOM/sheet dependency the view carries.
// The original export in admin-opportunities.js re-exports from here
// for back-compat.
// ============================================================

import { CONFIG } from '../config.js';

export async function fileApiRequest(payload) {
  const res = await fetch(CONFIG.FILE_API_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`File API returned ${res.status}`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || 'File API request failed');
  }
  return data;
}

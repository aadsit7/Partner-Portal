// Unit tests for js/utils/map-pdf-builder.js.
//
// buildMapPdf() itself requires jsPDF + jspdf-autotable (loaded via CDN
// in index.html). Installing jsPDF as a dev dep solely to render in
// Node would bloat the test runner, so we stub a minimal jsPDF shim on
// globalThis.jspdf and assert the public surface, not the pixel output.
import './_setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugName, mapFilename, blobToBase64, buildMapPdf } from '../js/utils/map-pdf-builder.js';

// ── slug + filename ──────────────────────────────────────────

test('slugName replaces spaces with underscores', () => {
  assert.equal(slugName('American National Insurance Company'), 'American_National_Insurance_Company');
});
test('slugName strips special characters', () => {
  assert.equal(slugName('AT&T, Inc.'), 'ATT_Inc');
});
test('slugName collapses repeated whitespace and underscores', () => {
  assert.equal(slugName('Foo     Bar___Baz'), 'Foo_Bar_Baz');
});
test('slugName caps at 60 chars', () => {
  const long = 'Super '.repeat(40);
  assert.ok(slugName(long).length <= 60);
});
test('slugName falls back to "opportunity" on empty', () => {
  assert.equal(slugName(''), 'opportunity');
  assert.equal(slugName(null), 'opportunity');
  assert.equal(slugName(undefined), 'opportunity');
});

test('mapFilename produces MAP_{slug}_{date}.pdf', () => {
  assert.equal(
    mapFilename('American National Insurance Company', '2026-04-22'),
    'MAP_American_National_Insurance_Company_2026-04-22.pdf',
  );
});
test('mapFilename trims timestamp precision if full ISO provided', () => {
  assert.equal(
    mapFilename('Acme', '2026-04-22T15:30:00Z'),
    'MAP_Acme_2026-04-22.pdf',
  );
});
test('mapFilename IGNORES non-ISO date strings and uses today — the Bug 2 regression', () => {
  // Previous behaviour sliced the first 10 chars of "April 22, 2026"
  // and produced "MAP_Greenshield_April_22_.pdf" (with trailing _).
  // Now we validate the shape and fall through to today's ISO date.
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(mapFilename('Greenshield', 'April 22, 2026'), `MAP_Greenshield_${today}.pdf`);
  assert.equal(mapFilename('Greenshield', '4/22/2026'),      `MAP_Greenshield_${today}.pdf`);
  assert.equal(mapFilename('Greenshield'),                   `MAP_Greenshield_${today}.pdf`);
  assert.equal(mapFilename('Greenshield', null),             `MAP_Greenshield_${today}.pdf`);
  assert.equal(mapFilename('Greenshield', ''),               `MAP_Greenshield_${today}.pdf`);
});
test('mapFilename has no trailing underscore between slug and .pdf', () => {
  // Extra tight guard: even if slug + date produced weird edges, the
  // literal filename can never end in `_.pdf`.
  const name = mapFilename('Greenshield', 'April 22, 2026');
  assert.ok(!/_\.pdf$/.test(name), `filename should not end in _.pdf, got ${name}`);
});

// ── V1.5: sourceCount suffix ─────────────────────────────────

test('mapFilename appends _1source when sourceCount is 1', () => {
  assert.equal(
    mapFilename('Greenshield', '2026-04-22', 1),
    'MAP_Greenshield_2026-04-22_1source.pdf',
  );
});

test('mapFilename appends _Nsources when sourceCount >= 2', () => {
  assert.equal(
    mapFilename('Greenshield', '2026-04-22', 3),
    'MAP_Greenshield_2026-04-22_3sources.pdf',
  );
  assert.equal(
    mapFilename('Greenshield', '2026-04-22', 12),
    'MAP_Greenshield_2026-04-22_12sources.pdf',
  );
});

test('mapFilename without sourceCount is byte-identical to the V1 voice flow', () => {
  // Critical regression guard — the voice flow calls mapFilename with
  // only (customer, dateISO) and must continue to receive the exact
  // same filename it always has. Any change to this test means the
  // voice flow will also change; don't touch it without checking
  // randy.js.
  const d = '2026-04-22';
  assert.equal(
    mapFilename('Greenshield', d),
    'MAP_Greenshield_2026-04-22.pdf',
  );
  assert.equal(
    mapFilename('Greenshield', d, null),
    'MAP_Greenshield_2026-04-22.pdf',
  );
  assert.equal(
    mapFilename('Greenshield', d, undefined),
    'MAP_Greenshield_2026-04-22.pdf',
  );
});

test('mapFilename falls back to no-suffix when sourceCount is 0 or invalid', () => {
  // Documented edge case: the click-flow UI blocks generation when
  // count is 0 (the CTA is disabled), so this branch should never
  // hit in practice. Behaviourally, fall back to the no-suffix form
  // instead of throwing so a misfire can't break the filename.
  const d = '2026-04-22';
  assert.equal(mapFilename('Greenshield', d, 0),     'MAP_Greenshield_2026-04-22.pdf');
  assert.equal(mapFilename('Greenshield', d, -1),    'MAP_Greenshield_2026-04-22.pdf');
  assert.equal(mapFilename('Greenshield', d, 1.5),   'MAP_Greenshield_2026-04-22.pdf');
  assert.equal(mapFilename('Greenshield', d, '3'),   'MAP_Greenshield_2026-04-22.pdf');
});

// ── blobToBase64 ─────────────────────────────────────────────

// Node lacks FileReader / Blob.readAsDataURL by default; stub a minimal
// Blob-compat that blobToBase64 can chew. We only care that it invokes
// FileReader and strips the data: prefix.
test('blobToBase64 strips the data: prefix and returns base64', async () => {
  class FakeFileReader {
    onload = null;
    onerror = null;
    readAsDataURL(blob) {
      setTimeout(() => {
        this.result = `data:${blob._type};base64,${blob._b64}`;
        if (this.onload) this.onload();
      }, 0);
    }
  }
  globalThis.FileReader = FakeFileReader;

  const fakeBlob = { _type: 'application/pdf', _b64: 'SGVsbG8=' };  // "Hello"
  const out = await blobToBase64(fakeBlob);
  assert.equal(out, 'SGVsbG8=');
});

// ── buildMapPdf: smoke test via a jsPDF shim ────────────────

function installJsPdfShim() {
  const calls = [];
  function Shim() {
    this._calls = calls;
    this.internal = { getNumberOfPages: () => 2 };
    this.autoTable = (opts) => {
      calls.push({ op: 'autoTable', opts });
      this.lastAutoTable = { finalY: 600 };
    };
    this.setFillColor = (...a)   => calls.push({ op: 'setFillColor', a });
    this.setDrawColor = (...a)   => calls.push({ op: 'setDrawColor', a });
    this.setTextColor = (...a)   => calls.push({ op: 'setTextColor', a });
    this.setFont      = (...a)   => calls.push({ op: 'setFont', a });
    this.setFontSize  = (...a)   => calls.push({ op: 'setFontSize', a });
    this.setLineWidth = (...a)   => calls.push({ op: 'setLineWidth', a });
    this.rect         = (...a)   => calls.push({ op: 'rect', a });
    this.roundedRect  = (...a)   => calls.push({ op: 'roundedRect', a });
    this.line         = (...a)   => calls.push({ op: 'line', a });
    this.triangle     = (...a)   => calls.push({ op: 'triangle', a });
    this.circle       = (...a)   => calls.push({ op: 'circle', a });
    this.text         = (...a)   => calls.push({ op: 'text', a });
    this.addPage      = (...a)   => calls.push({ op: 'addPage', a });
    this.setPage      = (...a)   => calls.push({ op: 'setPage', a });
    this.splitTextToSize = (s)   => String(s).split(/\s{80,}/);
    this.getTextWidth = (s)      => String(s || '').length * 5;
    this.output = (kind) => {
      if (kind === 'blob') return { _isBlob: true, type: 'application/pdf', size: 42, __calls: calls };
      return '';
    };
  }
  // jspdf-autotable attaches itself to jsPDF.API.autoTable when its
  // script loads. The waitForJsPdf() probe checks this exact path,
  // so the shim must mirror it.
  Shim.API = { autoTable: () => {} };
  globalThis.window = globalThis.window || {};
  globalThis.window.jspdf = { jsPDF: Shim };
  return calls;
}

test('buildMapPdf returns a blob and hits autoTable once', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Acme Corp',
    document_date: 'April 22, 2026',
    meeting_recap: ['a', 'b'],
    current_environment: {
      infrastructure: ['x'],
      current_state_pain: ['y'],
      stakeholders_and_decision_process: ['z'],
    },
    mutual_action_plan: [
      { phase: 'Discovery', action: 'do stuff', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
      { phase: 'Discovery', action: 'more stuff', owner: 'Customer', due_date: '2026-05-08', status: 'In Progress' },
    ],
  };
  const blob = await buildMapPdf(json, { name: 'Acme Corp' });
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
  const calls = blob.__calls;
  assert.ok(calls.some(c => c.op === 'autoTable'),
    'buildMapPdf must invoke autoTable for the MAP grid');
  assert.ok(calls.some(c => c.op === 'addPage'),
    'buildMapPdf must call addPage to force the architecture page');
});

test('buildMapPdf renders the new {label, detail} + {name, subline} shapes without crashing', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Test Customer',
    document_date: 'April 22, 2026',
    meeting_recap: [
      { label: 'Total Users', detail: '~4,000 confirmed on the call' },
      { label: 'Pricing delivered', detail: 'Tiered pricing sent March 6' },
      { label: '', detail: 'Legacy-shaped fallback bullet' },
    ],
    current_environment: {
      infrastructure: [
        { name: 'Citrix XenApp', subline: '~900 daily users License expires EOY 2026' },
        { name: 'NetScaler', subline: '' },
        { name: 'SCCM / ConfigMgr', subline: 'On-prem Windows device management' },
      ],
      current_state_pain: [
        'Application packaging consumes 40+ hours per week',
        'No unified visibility into compliance status',
      ],
      stakeholders_and_decision_process: [
        'Sponsor: VP of End User Computing',
      ],
    },
    // V1.6: Page 3 tools, devices, and What Changes callout are now
    // grounded in JSON. Populate all three so this test exercises the
    // full architecture page — the conditional-rendering tests below
    // cover the empty paths.
    existing_mgmt_tools: ['Intune', 'ConfigMgr', 'Citrix'],
    end_users_devices: ['Laptop', 'Virtual Desktop'],
    what_changes: 'Per-platform packaging eliminated; single console across delivery targets.',
    mutual_action_plan: [
      { phase: 'Discovery', action: 'Kickoff', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
    ],
  };
  const blob = await buildMapPdf(json, { name: 'Test Customer' });
  assert.equal(blob.type, 'application/pdf');
  const calls = blob.__calls;
  // Architecture page adds a fresh page because the JSON has infra + pain.
  assert.ok(calls.some(c => c.op === 'addPage'), 'buildMapPdf must call addPage for the architecture page');
  // Customer name must appear in the Layer-1 heading of the architecture page.
  assert.ok(
    calls.some(c => c.op === 'text' && /Test Customer/.test(String(c.a?.[0] || ''))),
    'architecture page Layer 1 must name the customer',
  );
  // Layer 2 heading: "Current State — Per-Platform Delivery" (case-insensitive since it's uppercased).
  assert.ok(
    calls.some(c => c.op === 'text' && /PER-PLATFORM DELIVERY/i.test(String(c.a?.[0] || ''))),
    'architecture page Layer 2 must carry the per-platform delivery heading',
  );
  // The new How-It-Fits-Together section renders the Application
  // Workspace centerpiece bar (mixed case, V1.6 redesign) when the
  // JSON provides at least one customer-grounded pill row.
  assert.ok(
    calls.some(c => c.op === 'text' && /^Application Workspace$/.test(String(c.a?.[0] || ''))),
    'architecture page must render the Application Workspace centerpiece bar',
  );
  // Layer 8 "What Changes:" callout must be rendered because the JSON
  // supplied a non-empty what_changes string.
  assert.ok(
    calls.some(c => c.op === 'text' && /What Changes:/.test(String(c.a?.[0] || ''))),
    'architecture page Layer 8 must render the What Changes callout when what_changes is populated',
  );
  // Priority 6: the V1 "Tailored for ..." footer line must be gone.
  assert.ok(
    !calls.some(c => c.op === 'text' && /Tailored for/.test(String(c.a?.[0] || ''))),
    'orphaned "Tailored for" line must not appear anywhere in the PDF',
  );
});

test('waitForJsPdf throws a clear timeout error when libraries are missing', async () => {
  const { waitForJsPdf } = await import('../js/utils/map-pdf-builder.js');
  // Wipe the globals the builder probes for.
  delete globalThis.window?.jspdf;
  if (globalThis.window) delete globalThis.window.jsPDF;
  await assert.rejects(
    () => waitForJsPdf({ timeoutMs: 30, pollMs: 10 }),
    (err) => /jsPDF/i.test(err.message) && /didn't finish loading/i.test(err.message),
  );
});

test('waitForJsPdf flags autotable specifically when jsPDF is present but plugin is missing', async () => {
  const { waitForJsPdf } = await import('../js/utils/map-pdf-builder.js');
  function BareJs() {}
  // No API.autoTable — autotable "hasn't loaded yet"
  globalThis.window = globalThis.window || {};
  globalThis.window.jspdf = { jsPDF: BareJs };
  await assert.rejects(
    () => waitForJsPdf({ timeoutMs: 30, pollMs: 10 }),
    (err) => /jspdf-autotable/i.test(err.message),
  );
});

// ─────────────────────────────────────────────────────────────
// V1.6 — Golden Rule conditional rendering
// ─────────────────────────────────────────────────────────────
//
// Every section of the PDF is allowed to be empty. When it is, the
// renderer omits it silently — no heading bar, no placeholder copy,
// no "[Environment details to be collected]" narrative. These tests
// lock in each branch of the section-skip contract so future edits
// can't accidentally re-introduce fabricated fallback content.

function textOps(calls) {
  return calls.filter(c => c.op === 'text').map(c => String(c.a?.[0] || ''));
}
function hasText(calls, re) {
  return textOps(calls).some(t => re.test(t));
}

test('V1.6 thin-source MAP: only Page 1 recap + MAP table render — no Current Environment heading, no Page 3', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Greenshield',
    document_date: 'April 22, 2026',
    meeting_recap: [
      { label: 'Attendees', detail: 'Met with Joe' },
      { label: 'Pricing',   detail: 'Pricing discussed' },
      { label: 'Follow-up', detail: 'Sent follow-up email' },
    ],
    current_environment: {
      infrastructure: [],
      current_state_pain: [],
      stakeholders_and_decision_process: [],
    },
    end_users_personas: [],
    what_changes: '',
    mutual_action_plan: [
      { phase: 'Discovery', action: 'Follow up with Joe', owner: 'Recast', due_date: '2026-05-01', status: 'Pending' },
    ],
  };
  const blob = await buildMapPdf(json, { name: 'Greenshield' });
  const calls = blob.__calls;

  // Meeting Recap heading renders.
  assert.ok(hasText(calls, /^MEETING RECAP$/),
    'Meeting Recap heading must always render');
  // MAP table heading renders (autoTable is invoked once for the MAP).
  assert.ok(calls.some(c => c.op === 'autoTable'),
    'MAP table must render when there are rows');
  assert.ok(hasText(calls, /^MUTUAL ACTION PLAN$/),
    'MAP heading must render when there are rows');

  // The blue "YOUR CURRENT ENVIRONMENT" heading must NOT render.
  assert.ok(!hasText(calls, /^YOUR CURRENT ENVIRONMENT$/),
    'Current Environment heading must be skipped when all three subsections are empty');
  // No Infrastructure / Pain Points / Stakeholders sub-labels either.
  assert.ok(!hasText(calls, /^Infrastructure$/),
    'Infrastructure sub-label must be skipped when infra is empty');
  assert.ok(!hasText(calls, /^Current State Pain Points$/),
    'Pain Points sub-label must be skipped when pain is empty');
  assert.ok(!hasText(calls, /^Stakeholders & Decision Process$/),
    'Stakeholders sub-label must be skipped when stakeholders is empty');

  // Page 3 must not be added at all — no doc.addPage() call.
  assert.ok(!calls.some(c => c.op === 'addPage'),
    'Architecture page must NOT render for a thin source with no infra and no pain');
  // And none of Page 3's visuals leaked onto Page 1.
  assert.ok(!hasText(calls, /APPLICATION WORKSPACE/),
    'APPLICATION WORKSPACE centerpiece must not render when Page 3 is skipped');
  assert.ok(!hasText(calls, /What Changes:/),
    'What Changes callout must not render when Page 3 is skipped');
});

test('V1.6 full MAP renders all three pages like today', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Full Customer',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Attendees', detail: 'Full call' }],
    current_environment: {
      infrastructure: [{ name: 'Citrix', subline: '~900 daily users' }],
      current_state_pain: ['Packaging overhead'],
      stakeholders_and_decision_process: ['Sponsor: VP EUC'],
    },
    existing_mgmt_tools: ['Intune', 'ConfigMgr', 'Citrix'],
    end_users_devices: ['Laptop', 'Virtual Desktop'],
    what_changes: 'RES eliminated; single console across delivery targets.',
    mutual_action_plan: [
      { phase: 'Discovery', action: 'Kickoff', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
    ],
  };
  const blob = await buildMapPdf(json, { name: 'Full Customer' });
  const calls = blob.__calls;

  assert.ok(hasText(calls, /^YOUR CURRENT ENVIRONMENT$/),
    'full MAP must render the Current Environment heading');
  assert.ok(hasText(calls, /^Infrastructure$/), 'full MAP must render Infrastructure sub-label');
  assert.ok(hasText(calls, /^Current State Pain Points$/), 'full MAP must render Pain sub-label');
  assert.ok(hasText(calls, /^Stakeholders & Decision Process$/), 'full MAP must render Stakeholders sub-label');
  assert.ok(calls.some(c => c.op === 'addPage'), 'full MAP must render Page 3');
  assert.ok(hasText(calls, /What Changes:/), 'full MAP must render What Changes callout');
  // Page 3 "How It Fits Together" section renders the customer's tools
  // and devices as pill rows — grounded in the JSON, not hardcoded.
  assert.ok(hasText(calls, /HOW IT FITS TOGETHER/i),
    'full MAP must render the How It Fits Together section title');
  assert.ok(hasText(calls, /YOUR EXISTING MGMT TOOLS/i),
    'full MAP must render the Your Existing Mgmt Tools label');
  assert.ok(hasText(calls, /END USERS & DEVICES/i),
    'full MAP must render the End Users & Devices label');
  assert.ok(hasText(calls, /^Intune$/),
    'full MAP must render grounded mgmt tool pills (Intune) from the JSON');
  assert.ok(hasText(calls, /^ConfigMgr$/),
    'full MAP must render grounded mgmt tool pills (ConfigMgr) from the JSON');
  assert.ok(hasText(calls, /^Laptop$/),
    'full MAP must render grounded device pills (Laptop) from the JSON');
  assert.ok(hasText(calls, /^Application Workspace$/),
    'full MAP must render the Application Workspace centerpiece bar');
});

test('V1.6 infra-only MAP: Page 3 current-state boxes render but Key Friction callout is skipped', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Infra Only',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Env', detail: 'Reviewed systems' }],
    current_environment: {
      infrastructure: [{ name: 'Citrix', subline: '~900 daily users' }],
      current_state_pain: [],
      stakeholders_and_decision_process: [],
    },
    end_users_personas: [],
    what_changes: '',
    mutual_action_plan: [],
  };
  const blob = await buildMapPdf(json, { name: 'Infra Only' });
  const calls = blob.__calls;

  // Page 3 exists (anchor is infrastructure).
  assert.ok(calls.some(c => c.op === 'addPage'),
    'Page 3 must render when infrastructure has content');
  // Layer 2 (tools grid heading) renders.
  assert.ok(hasText(calls, /PER-PLATFORM DELIVERY/i),
    'Layer 2 per-platform-delivery heading must render when infra is populated');
  // Key Friction callout is skipped (no pains in source).
  assert.ok(!hasText(calls, /Key Friction:/),
    'Key Friction callout must be skipped when pain array is empty');
});

test('V1.6 pain-only MAP: Page 3 Key Friction callout renders but current-state boxes are skipped', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Pain Only',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Pain', detail: 'Customer aired frustrations' }],
    current_environment: {
      infrastructure: [],
      current_state_pain: ['Packaging consumes 40+ hours per week'],
      stakeholders_and_decision_process: [],
    },
    end_users_personas: [],
    what_changes: '',
    mutual_action_plan: [],
  };
  const blob = await buildMapPdf(json, { name: 'Pain Only' });
  const calls = blob.__calls;

  // Page 3 exists (anchor is pain).
  assert.ok(calls.some(c => c.op === 'addPage'),
    'Page 3 must render when pain has content even if infra is empty');
  // Key Friction callout renders.
  assert.ok(hasText(calls, /Key Friction:/),
    'Key Friction callout must render when pain is populated');
  // Layer 2 current-state boxes heading is skipped.
  assert.ok(!hasText(calls, /PER-PLATFORM DELIVERY/i),
    'Layer 2 per-platform-delivery heading must be skipped when infra is empty');
});

test('V1.6 both infra + pain empty: buildMapPdf must NOT call addPage for Page 3', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'No Arch',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Intro call', detail: 'Short call, no tech details' }],
    current_environment: {
      infrastructure: [],
      current_state_pain: [],
      stakeholders_and_decision_process: ['Joe Richardson attended'],
    },
    end_users_personas: [],
    what_changes: '',
    mutual_action_plan: [],
  };
  const blob = await buildMapPdf(json, { name: 'No Arch' });
  const calls = blob.__calls;

  // Stakeholders alone is NOT enough to anchor Page 3 — the transformation
  // narrative needs either a current state (infra) or a friction point.
  assert.ok(!calls.some(c => c.op === 'addPage'),
    'Page 3 must be skipped (no addPage) when infra AND pain are both empty');
  // But the Current Environment section itself still renders because
  // stakeholders is populated — whole-env gate is independent.
  assert.ok(hasText(calls, /^YOUR CURRENT ENVIRONMENT$/),
    'Current Environment heading renders when any subsection (incl. stakeholders) has content');
  assert.ok(hasText(calls, /^Stakeholders & Decision Process$/),
    'Stakeholders sub-label renders when stakeholders is populated');
});

test('V1.6 Page 3 without what_changes renders the diagram as the visual conclusion — no green callout', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'Diagram Only',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Env', detail: 'Reviewed systems' }],
    current_environment: {
      infrastructure: [{ name: 'Citrix', subline: '' }],
      current_state_pain: ['Packaging is slow'],
      stakeholders_and_decision_process: [],
    },
    // Grounded pills so How-It-Fits-Together renders and is the visual
    // conclusion instead of the What Changes callout.
    existing_mgmt_tools: ['Citrix'],
    end_users_devices: ['Laptop'],
    what_changes: '',
    mutual_action_plan: [],
  };
  const blob = await buildMapPdf(json, { name: 'Diagram Only' });
  const calls = blob.__calls;

  // Page 3 exists (anchor is infra + pain).
  assert.ok(calls.some(c => c.op === 'addPage'),
    'Page 3 must render when infra and pain are both populated');
  // Application Workspace centerpiece renders — visual conclusion.
  assert.ok(hasText(calls, /^Application Workspace$/),
    'Application Workspace centerpiece bar must render on Page 3');
  // "What Changes:" callout must NOT render because the JSON didn't supply it.
  assert.ok(!hasText(calls, /What Changes:/),
    'What Changes callout must be skipped when what_changes is empty — no hardcoded fallback');
  // No generic personas or hardcoded delivery targets from earlier drafts.
  assert.ok(!hasText(calls, /Office Workers/),
    'hardcoded "Office Workers" persona fallback must be removed');
  assert.ok(!hasText(calls, /VDI Users/),
    'hardcoded "VDI Users" persona fallback must be removed');
  assert.ok(!hasText(calls, /AVD \/ Nerdio/),
    'hardcoded "AVD / Nerdio" target must be removed');
});

test('V1.6 empty MAP table: skip the heading bar entirely — no placeholder row', async () => {
  installJsPdfShim();
  const json = {
    customer_name: 'No Action Items',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Chat', detail: 'Informal call' }],
    current_environment: {
      infrastructure: [],
      current_state_pain: [],
      stakeholders_and_decision_process: [],
    },
    end_users_personas: [],
    what_changes: '',
    mutual_action_plan: [],
  };
  const blob = await buildMapPdf(json, { name: 'No Action Items' });
  const calls = blob.__calls;

  // MAP heading must NOT render.
  assert.ok(!hasText(calls, /^MUTUAL ACTION PLAN$/),
    'MAP heading must be skipped when the action plan array is empty');
  // autoTable must not be called (no placeholder row, no "No action items captured yet").
  assert.ok(!calls.some(c => c.op === 'autoTable'),
    'autoTable must not be invoked when there are no MAP rows');
  assert.ok(!hasText(calls, /No action items captured yet/),
    'legacy "No action items captured yet" placeholder must not render — that was fabricated narrative');
});

test('V1.6 How-It-Fits-Together: hardcoded delivery targets are gone; grounded pills render only from the JSON', async () => {
  installJsPdfShim();
  // Grounded mgmt tools + devices: pill rows render directly from the JSON.
  const json1 = {
    customer_name: 'C',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'x', detail: 'y' }],
    current_environment: {
      infrastructure: [{ name: 'Citrix', subline: '' }],
      current_state_pain: ['slow'],
      stakeholders_and_decision_process: [],
    },
    existing_mgmt_tools: ['Intune', 'ConfigMgr', 'Citrix', 'AVD / W365', 'macOS'],
    end_users_devices: ['Laptop', 'Virtual Desktop', 'Cloud PC / W365'],
    what_changes: '',
    mutual_action_plan: [],
  };
  const blob1 = await buildMapPdf(json1, { name: 'C' });
  const calls1 = blob1.__calls;
  // Customer-grounded pills render verbatim.
  assert.ok(hasText(calls1, /^Intune$/),    'grounded mgmt tool pill (Intune) must render');
  assert.ok(hasText(calls1, /^ConfigMgr$/), 'grounded mgmt tool pill (ConfigMgr) must render');
  assert.ok(hasText(calls1, /^macOS$/),     'grounded mgmt tool pill (macOS) must render');
  assert.ok(hasText(calls1, /^Laptop$/),    'grounded device pill (Laptop) must render');
  assert.ok(hasText(calls1, /^Cloud PC \/ W365$/),
    'grounded device pill (Cloud PC / W365) must render');
  // None of the V1.5 hardcoded delivery-target labels appear — this
  // was the Nerdio bug. Right-column targets are completely gone.
  assert.ok(!hasText(calls1, /AVD \/ Nerdio/),
    'legacy hardcoded "AVD / Nerdio" target must not render');
  assert.ok(!hasText(calls1, /Intune \/ SCCM/),
    'legacy hardcoded "Intune / SCCM" target must not render');
  assert.ok(!hasText(calls1, /^Windows 365$/),
    'legacy hardcoded "Windows 365" target must not render');
  assert.ok(!hasText(calls1, /Non-persistent VDI/),
    'legacy target subline "Non-persistent VDI" must not render');
  // None of the legacy persona labels should appear either.
  assert.ok(!hasText(calls1, /Office Workers/),   'legacy "Office Workers" must not render');
  assert.ok(!hasText(calls1, /VDI Users/),        'legacy "VDI Users" must not render');
  assert.ok(!hasText(calls1, /External Users/),   'legacy "External Users" must not render');

  // Empty mgmt_tools + devices: the whole How-It-Fits-Together section
  // is skipped (the Application Workspace bar is Recast-positioning,
  // not customer content — without a customer anchor it's boilerplate).
  installJsPdfShim();
  const json2 = { ...json1, existing_mgmt_tools: [], end_users_devices: [] };
  const blob2 = await buildMapPdf(json2, { name: 'C' });
  const calls2 = blob2.__calls;
  assert.ok(!hasText(calls2, /HOW IT FITS TOGETHER/i),
    'How It Fits Together title must be skipped when neither pill row is grounded');
  assert.ok(!hasText(calls2, /YOUR EXISTING MGMT TOOLS/i),
    'mgmt tools label must be skipped when empty');
  assert.ok(!hasText(calls2, /END USERS & DEVICES/i),
    'devices label must be skipped when empty');
  assert.ok(!hasText(calls2, /^Application Workspace$/),
    'Application Workspace bar must be skipped when there is no customer anchor');
});

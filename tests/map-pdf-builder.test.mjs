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
    mutual_action_plan: [
      { phase: 'Discovery', action: 'Kickoff', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
    ],
  };
  const blob = await buildMapPdf(json, { name: 'Test Customer' });
  assert.equal(blob.type, 'application/pdf');
  const calls = blob.__calls;
  // Architecture page adds a fresh page regardless of what the MAP
  // table left behind.
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
  // Layer 6 centerpiece must be rendered.
  assert.ok(
    calls.some(c => c.op === 'text' && /APPLICATION WORKSPACE/.test(String(c.a?.[0] || ''))),
    'architecture page Layer 6 must render the APPLICATION WORKSPACE centerpiece',
  );
  // Layer 8 "What Changes:" callout must be rendered.
  assert.ok(
    calls.some(c => c.op === 'text' && /What Changes:/.test(String(c.a?.[0] || ''))),
    'architecture page Layer 8 must render the What Changes callout',
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

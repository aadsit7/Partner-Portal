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
    this.output = (kind) => {
      if (kind === 'blob') return { _isBlob: true, type: 'application/pdf', size: 42, __calls: calls };
      return '';
    };
  }
  globalThis.window = globalThis.window || {};
  globalThis.window.jspdf = { jsPDF: Shim };
  return calls;
}

test('buildMapPdf returns a blob and hits autoTable once', () => {
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
  const blob = buildMapPdf(json, { name: 'Acme Corp' });
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
  const calls = blob.__calls;
  assert.ok(calls.some(c => c.op === 'autoTable'),
    'buildMapPdf must invoke autoTable for the MAP grid');
  assert.ok(calls.some(c => c.op === 'addPage'),
    'buildMapPdf must call addPage to force the architecture page');
});

test('buildMapPdf throws a clear error when jsPDF is missing', () => {
  delete globalThis.window?.jspdf;
  if (globalThis.window) delete globalThis.window.jsPDF;
  assert.throws(
    () => buildMapPdf({
      customer_name: 'x', document_date: 'x', meeting_recap: [],
      current_environment: { infrastructure: [], current_state_pain: [], stakeholders_and_decision_process: [] },
      mutual_action_plan: [],
    }),
    /jsPDF not loaded/,
  );
});

// ============================================================
// MAP PDF Builder — browser-side (jsPDF + jspdf-autotable)
// ============================================================
// Produces a Recast-branded Mutual Action Plan PDF from a structured
// JSON payload returned by requestMapPdfJson(). Runs entirely in the
// browser — no backend, no sandbox, no Files API. Mirrors the visual
// style of the approved ReportLab reference in
// skills/recast-map-pdf/reference_map_pdf.py.
//
// jsPDF is loaded via CDN in index.html and exposed as window.jspdf.
// jspdf-autotable registers a .autoTable() method on the doc.
// ============================================================

// ── Brand palette ─────────────────────────────────────────────
const RECAST_BLUE   = [0,   0,   204];
const CORAL         = [224, 112, 80];
const INK           = [26,  26,  46];
const GREEN         = [15,  122, 63];
const AMBER         = [204, 136, 0];
const RED           = [204, 34,  34];
const CYAN          = [42,  127, 255];
const NAVY          = [30,  58,  138];
const LIGHT_BLUE    = [246, 248, 255];
const GREEN_TINT    = [232, 245, 238];
const AMBER_TINT    = [255, 244, 224];
const RED_TINT      = [252, 232, 232];
const GRAY_TINT     = [240, 240, 246];
const BORDER_GRAY   = [221, 221, 234];
const MUTED         = [136, 136, 136];
const WHITE         = [255, 255, 255];

// Letter @ default jsPDF units (pt). 612 × 792.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Filename + blob helpers ──────────────────────────────────

export function slugName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'opportunity';
  return raw
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'opportunity';
}

export function mapFilename(customerName, dateISO) {
  const d = (dateISO || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `MAP_${slugName(customerName)}_${d}.pdf`;
}

// Promise → base64 string (no data: prefix). Matches what
// fileApiRequest() / Apps Script expects for the `fileData` field.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

// ── jsPDF discovery ──────────────────────────────────────────
//
// Both jsPDF and jspdf-autotable are loaded via <script defer> in
// index.html. `defer` guarantees they execute in document order
// before DOMContentLoaded fires, so by the time a voice command
// reaches this module the globals should be ready. But "should be"
// isn't "are" — slow CDN, throttled CPU, user triggers the flow in
// the first seconds after page load, and the synchronous check from
// the V1 code was observed failing in a real portal session.
//
// Poll-wait instead. Returns the jsPDF constructor once both the
// library and the autoTable plugin are present.

const DEFAULT_READY_TIMEOUT_MS = 10_000;

export async function waitForJsPdf({ timeoutMs = DEFAULT_READY_TIMEOUT_MS, pollMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const g = typeof window !== 'undefined' ? window : globalThis;
    const jspdf = g.jspdf || g.jsPDF;
    const JsPDF = jspdf && jspdf.jsPDF;
    // jspdf-autotable registers itself on jsPDF.API.autoTable when its
    // script runs. Checking API.autoTable is the most reliable probe
    // because it proves both libraries loaded AND their order was right.
    if (JsPDF && typeof JsPDF.API?.autoTable === 'function') {
      return JsPDF;
    }
    if (Date.now() >= deadline) {
      const which = !JsPDF
        ? 'jsPDF'
        : (typeof JsPDF.API?.autoTable !== 'function' ? 'jspdf-autotable' : 'jsPDF');
      throw new Error(
        `${which} didn't finish loading within ${Math.round(timeoutMs / 1000)}s. ` +
        'Check the <script> tags in index.html and the browser console for 404 / CORS errors on the CDN URLs.'
      );
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

// ── Primitives ───────────────────────────────────────────────

function setFill(doc, rgb)   { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setStroke(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc, rgb)   { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

// Measure-aware text wrap. jsPDF's splitTextToSize does roughly what we
// want but wants the width in the current unit — we're in pt already.
function wrapText(doc, text, maxW) {
  return doc.splitTextToSize(String(text || ''), maxW);
}

// ── Page 1 ───────────────────────────────────────────────────

function drawHeaderBand(doc, customerName, documentDate) {
  // Background
  setFill(doc, RECAST_BLUE);
  doc.rect(0, 0, PAGE_W, 90, 'F');

  // Decorative dot pattern on the right edge — 4 columns × 6 rows of
  // small white dots at low opacity, a quiet brand flourish.
  setFill(doc, WHITE);
  const saveGState = doc.saveGraphicsState ? doc.saveGraphicsState.bind(doc) : null;
  const restoreGState = doc.restoreGraphicsState ? doc.restoreGraphicsState.bind(doc) : null;
  if (saveGState) saveGState();
  if (doc.setGState && doc.GState) {
    try { doc.setGState(new doc.GState({ opacity: 0.18 })); } catch { /* graceful degrade */ }
  }
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 6; row++) {
      const x = PAGE_W - 90 + col * 14;
      const y = 14 + row * 12;
      doc.circle(x, y, 1.4, 'F');
    }
  }
  if (restoreGState) restoreGState();

  // Eyebrow top-right
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('MUTUAL ACTION PLAN', PAGE_W - MARGIN, 24, { align: 'right' });

  // Customer name bottom-left (wrap if very long)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  const nameLines = wrapText(doc, customerName || 'Opportunity', CONTENT_W - 180);
  const firstLine = nameLines[0] || 'Opportunity';
  doc.text(firstLine, MARGIN, 64);
  if (nameLines.length > 1) {
    doc.setFontSize(14);
    doc.text(nameLines[1], MARGIN, 80);
  }

  // Date bottom-right
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(documentDate || '', PAGE_W - MARGIN, 80, { align: 'right' });

  // Coral divider under the header band
  setFill(doc, CORAL);
  doc.rect(0, 90, PAGE_W, 3, 'F');
}

function drawSectionHeading(doc, label, y) {
  setText(doc, RECAST_BLUE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(String(label).toUpperCase(), MARGIN, y);
  // underline rule
  setStroke(doc, RECAST_BLUE);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y + 3, MARGIN + 110, y + 3);
}

function drawCheckBullet(doc, x, y) {
  setFill(doc, GREEN);
  doc.circle(x, y, 3, 'F');
  // Inline checkmark tick (two strokes) in white
  setStroke(doc, WHITE);
  doc.setLineWidth(0.9);
  doc.line(x - 1.4, y - 0.1, x - 0.3, y + 1.1);
  doc.line(x - 0.3, y + 1.1, x + 1.8, y - 1.2);
}

function drawSquareBullet(doc, x, y, rgb) {
  setFill(doc, rgb);
  doc.rect(x - 2.5, y - 2.5, 5, 5, 'F');
}

function drawMeetingRecap(doc, items, yStart) {
  drawSectionHeading(doc, 'Meeting Recap', yStart);
  let y = yStart + 18;
  setText(doc, INK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  for (const line of (items || []).slice(0, 6)) {
    const wrapped = wrapText(doc, line, CONTENT_W - 18);
    drawCheckBullet(doc, MARGIN + 4, y - 2);
    doc.text(wrapped, MARGIN + 14, y);
    y += wrapped.length * 12 + 3;
  }
  return y + 4;
}

function drawEnvSubsection(doc, label, items, color, yStart) {
  setText(doc, INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(label, MARGIN, yStart);
  let y = yStart + 14;
  doc.setFont('helvetica', 'normal');
  for (const line of (items || []).slice(0, 5)) {
    const wrapped = wrapText(doc, line, CONTENT_W - 14);
    drawSquareBullet(doc, MARGIN + 3, y - 2, color);
    doc.text(wrapped, MARGIN + 12, y);
    y += wrapped.length * 11 + 2;
  }
  return y + 6;
}

function drawCurrentEnvironment(doc, env, yStart) {
  drawSectionHeading(doc, 'Your Current Environment', yStart);
  let y = yStart + 18;
  y = drawEnvSubsection(doc, 'Infrastructure',                 env?.infrastructure,                  CYAN, y);
  y = drawEnvSubsection(doc, 'Current State Pain Points',      env?.current_state_pain,              RED,  y);
  y = drawEnvSubsection(doc, 'Stakeholders & Decision Process', env?.stakeholders_and_decision_process, NAVY, y);
  return y;
}

// Cell styler hook for autotable — colour-codes the Status column and
// adds a faint green left accent on Complete rows.
function makeMapTableDidParseCell(statusColIndex) {
  return function didParseCell(data) {
    if (data.section !== 'body') return;
    if (data.column.index === statusColIndex) {
      const raw = String(data.cell.raw || '').trim().toLowerCase();
      if (raw === 'complete') {
        data.cell.styles.fillColor = GREEN_TINT;
        data.cell.styles.textColor = GREEN;
        data.cell.styles.fontStyle = 'bold';
      } else if (raw === 'in progress') {
        data.cell.styles.fillColor = AMBER_TINT;
        data.cell.styles.textColor = AMBER;
        data.cell.styles.fontStyle = 'bold';
      } else if (raw === 'blocked') {
        data.cell.styles.fillColor = RED_TINT;
        data.cell.styles.textColor = RED;
        data.cell.styles.fontStyle = 'bold';
      } else {
        data.cell.styles.fillColor = GRAY_TINT;
        data.cell.styles.textColor = MUTED;
      }
    }
  };
}

function makeMapTableDidDrawCell(statusColIndex) {
  return function didDrawCell(data) {
    // Faint green left-border accent on whole Complete rows.
    if (data.section !== 'body') return;
    if (data.column.index !== 0) return;
    const row = data.row.raw || [];
    const status = String(row[statusColIndex] || '').trim().toLowerCase();
    if (status === 'complete') {
      setFill(data.doc, GREEN);
      data.doc.rect(data.cell.x, data.cell.y, 1.5, data.cell.height, 'F');
    }
  };
}

function drawMapTable(doc, rows, yStart) {
  drawSectionHeading(doc, 'Mutual Action Plan', yStart);
  const body = (rows || []).map(r => [
    r.phase || '',
    r.action || '',
    r.owner || '',
    r.due_date || '',
    r.status || 'Pending',
  ]);
  const statusColIndex = 4;
  doc.autoTable({
    startY: yStart + 10,
    head: [['Phase', 'Action', 'Owner', 'Due Date', 'Status']],
    body,
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
      textColor: INK,
      lineColor: BORDER_GRAY,
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: RECAST_BLUE,
      textColor: WHITE,
      fontStyle: 'bold',
      halign: 'left',
      fontSize: 9,
    },
    alternateRowStyles: { fillColor: LIGHT_BLUE },
    columnStyles: {
      0: { cellWidth: 78  },
      1: { cellWidth: 208 },
      2: { cellWidth: 62  },
      3: { cellWidth: 68  },
      4: { cellWidth: 78, halign: 'center' },
    },
    didParseCell: makeMapTableDidParseCell(statusColIndex),
    didDrawCell:  makeMapTableDidDrawCell(statusColIndex),
  });
  return doc.lastAutoTable?.finalY || yStart + 100;
}

// ── Page 2 — Application Workspace infographic ───────────────

function drawSimpleHeader(doc, title) {
  setFill(doc, RECAST_BLUE);
  doc.rect(0, 0, PAGE_W, 60, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, MARGIN, 38);
  setFill(doc, CORAL);
  doc.rect(0, 60, PAGE_W, 3, 'F');
}

function drawToolBox(doc, x, y, w, h, label) {
  setFill(doc, GRAY_TINT);
  setStroke(doc, BORDER_GRAY);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, w, h, 4, 4, 'FD');
  setText(doc, INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(label, x + w / 2, y + h / 2 + 3, { align: 'center' });
}

function drawLabel(doc, x, y, label) {
  setText(doc, INK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(label, x, y, { align: 'center' });
}

function drawArchitecturePage(doc, customerName) {
  drawSimpleHeader(doc, 'HOW APPLICATION WORKSPACE FITS');

  const currentTools = ['Intune', 'ConfigMgr', 'Citrix', 'AVD', 'macOS'];
  const deliveryTargets = ['Laptop', 'Cloud PC', 'Virtual Desktop', 'macOS', 'BYOD'];
  const personas = ['Engineering', 'Sales', 'Finance', 'Contractors'];

  // Section label
  setText(doc, MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('CURRENT STATE', MARGIN, 90);

  // Row of 5 current-tool boxes, centred
  const boxW = 90;
  const boxH = 42;
  const gap = 12;
  const rowTotal = currentTools.length * boxW + (currentTools.length - 1) * gap;
  const rowX = (PAGE_W - rowTotal) / 2;
  currentTools.forEach((t, i) => {
    drawToolBox(doc, rowX + i * (boxW + gap), 100, boxW, boxH, t);
  });

  // Cyan downward arrow from the grid to the Application Workspace box
  const arrowX = PAGE_W / 2;
  const arrowTop = 150;
  const arrowBottom = 200;
  setStroke(doc, CYAN);
  doc.setLineWidth(2.5);
  doc.line(arrowX, arrowTop, arrowX, arrowBottom - 6);
  setFill(doc, CYAN);
  doc.triangle(arrowX - 6, arrowBottom - 8, arrowX + 6, arrowBottom - 8, arrowX, arrowBottom, 'F');

  // APPLICATION WORKSPACE centerpiece
  const awW = 400;
  const awH = 80;
  const awX = (PAGE_W - awW) / 2;
  const awY = 210;
  setFill(doc, RECAST_BLUE);
  doc.roundedRect(awX, awY, awW, awH, 10, 10, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('APPLICATION WORKSPACE', awX + awW / 2, awY + 38, { align: 'center' });
  setText(doc, LIGHT_BLUE);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Package  ·  Deliver  ·  Update  ·  Govern', awX + awW / 2, awY + 60, { align: 'center' });

  // Cyan arrow down into delivery targets
  const arrow2Top = awY + awH + 4;
  const arrow2Bottom = arrow2Top + 32;
  setStroke(doc, CYAN);
  doc.setLineWidth(2.5);
  doc.line(arrowX, arrow2Top, arrowX, arrow2Bottom - 6);
  setFill(doc, CYAN);
  doc.triangle(arrowX - 6, arrow2Bottom - 8, arrowX + 6, arrow2Bottom - 8, arrowX, arrow2Bottom, 'F');

  // DELIVERY TARGETS row
  setText(doc, MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DELIVERY TARGETS', MARGIN, arrow2Bottom + 20);
  const dtBoxW = 92;
  const dtBoxH = 36;
  const dtGap = 8;
  const dtTotal = deliveryTargets.length * dtBoxW + (deliveryTargets.length - 1) * dtGap;
  const dtX = (PAGE_W - dtTotal) / 2;
  const dtY = arrow2Bottom + 30;
  deliveryTargets.forEach((t, i) => {
    drawToolBox(doc, dtX + i * (dtBoxW + dtGap), dtY, dtBoxW, dtBoxH, t);
  });

  // PERSONAS band
  setText(doc, MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('USER PERSONAS', MARGIN, dtY + dtBoxH + 32);
  const pBoxW = 115;
  const pBoxH = 36;
  const pGap = 12;
  const pTotal = personas.length * pBoxW + (personas.length - 1) * pGap;
  const pX = (PAGE_W - pTotal) / 2;
  const pY = dtY + dtBoxH + 40;
  personas.forEach((p, i) => {
    const x = pX + i * (pBoxW + pGap);
    setFill(doc, LIGHT_BLUE);
    setStroke(doc, BORDER_GRAY);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, pY, pBoxW, pBoxH, 4, 4, 'FD');
    setText(doc, NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(p, x + pBoxW / 2, pY + pBoxH / 2 + 3, { align: 'center' });
  });

  // OUTCOME green strip at page bottom
  const stripY = PAGE_H - 90;
  setFill(doc, GREEN);
  doc.rect(0, stripY, PAGE_W, 40, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Outcome:', MARGIN, stripY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(
    'Same definition, every environment. Define once. Deliver everywhere.',
    MARGIN + 60, stripY + 18,
  );
  doc.setFontSize(9);
  setText(doc, [220, 240, 228]);
  doc.text('Tailored for ' + (customerName || 'your team'), MARGIN, stripY + 32);
}

// ── Footer on every page ─────────────────────────────────────

function drawFooters(doc, customerName) {
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setText(doc, MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Recast Software', MARGIN, PAGE_H - 20);
    doc.text(`Page ${p} of ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 20, { align: 'right' });
    const note = `Confidential — Prepared for ${customerName || 'the customer'}`;
    doc.text(note, PAGE_W / 2, PAGE_H - 20, { align: 'center' });
  }
}

// ── Public entry point ───────────────────────────────────────

/**
 * Build a Recast-branded MAP PDF from the structured JSON payload.
 * Returns a Blob with type "application/pdf".
 *
 * Async because it waits for jsPDF + jspdf-autotable to finish loading
 * from the CDN — safe no matter how fast the caller fires.
 *
 * @param {object} json       Parsed JSON from requestMapPdfJson().
 * @param {object} [opportunity] Optional extras (unused today; reserved
 *   for when Randy needs to embed deal_value / stage / etc.).
 * @param {object} [options]  { timeoutMs } forwarded to waitForJsPdf
 *                            (mostly a test hook).
 */
export async function buildMapPdf(json, opportunity, options) {
  if (!json || typeof json !== 'object') {
    throw new Error('buildMapPdf: expected a parsed JSON object');
  }
  const JsPDF = await waitForJsPdf(options || {});
  const doc = new JsPDF({ unit: 'pt', format: 'letter', compress: true });

  const customerName =
    json.customer_name ||
    opportunity?.customerName ||
    opportunity?.opportunityName ||
    '';
  const docDate = json.document_date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Page 1
  drawHeaderBand(doc, customerName, docDate);
  let y = 120;
  y = drawMeetingRecap(doc, json.meeting_recap, y);
  y = drawCurrentEnvironment(doc, json.current_environment, y + 4);
  drawMapTable(doc, json.mutual_action_plan, y + 6);

  // Page 2 — always a fresh page, whatever page the MAP table ended on.
  doc.addPage();
  drawArchitecturePage(doc, customerName);

  // Footers last, once we know the final page count.
  drawFooters(doc, customerName);

  return doc.output('blob');
}

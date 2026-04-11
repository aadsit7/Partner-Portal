// ============================================
// Meeting Docs Chatbot
// ============================================
// Lazy-mounted pop-out chatbot that generates branded HTML documents
// (Meeting Recaps, MAPs, Biweekly Updates, Pre-Meeting Agendas) from
// partner call transcripts via Claude API.

import { el } from '../utils/dom.js';
import { getRuntimeConfig } from '../config.js';
import { stripHtml } from './quill-editor.js';
import { formatDate } from '../utils/date.js';
import { showToast } from './toast.js';
import { openMapEditorModal, docTypeClass, docTypeLabel, saveMapDoc } from './map-editor.js';

// ============================================
// System Prompt
// ============================================

const MEETING_DOCS_SYSTEM_PROMPT = `You are the Recast Meeting Docs assistant for partner success managers. You help create polished, branded HTML documents from call transcripts for partner-facing use.

# Your role

You receive the full set of call transcripts for one partner as context in the first user message. When the user asks you to generate a document, you read the relevant transcripts, then produce a clean, accurate, client-safe HTML document.

# Document types you support

1. **Meeting Recap** — summary of one call: attendees, key topics, decisions, action items, next steps.
2. **Mutual Action Plan (MAP)** — forward-looking joint plan between Recast and the partner, using the PCP (Problem → Capability → Path-forward) model. Includes milestones, owners, dates, status.
3. **Recap + MAP** — a Meeting Recap immediately followed by a MAP section. This is the most common default when the user asks for "a document" without specifying.
4. **Biweekly Update** — status digest covering the last 2 weeks: wins, blockers, in-flight items, upcoming.
5. **Pre-Meeting Agenda** — forward-looking agenda for an upcoming call: context, topics, questions, desired outcomes.

If the user's request is ambiguous about which document type, ask one short clarifying question before generating. If they specify a date range like "last 30 days" or "last two meetings," select the matching transcripts from your context.

# Accuracy rules (critical)

- Only use facts, names, dates, numbers, and quotes that appear in the provided transcripts.
- Never invent details. If a transcript doesn't mention something the user asks about, say so and ask if they want to proceed with what's available.
- When writing action items or milestones, attribute owners by name only if they were named in the transcript. Otherwise use "Recast" or "Partner" as the owner.
- Preserve specific dollar figures, dates, and product names exactly as stated.

# Client-safe filtering

These types of content must NEVER appear in the generated document:
- Internal pricing negotiations, discount discussions, margin calculations
- Critical comments about competitors (OK to mention competitors factually)
- Private opinions about individuals ("Dave seemed distracted today")
- Anything marked as confidential or off-the-record
- Speculative revenue forecasts not confirmed by the partner

If the transcripts contain such content, quietly exclude it — don't call attention to the exclusion.

# Output format

When generating or updating a document, structure your response as:

1. A brief one-sentence lead-in (plain text) describing what you generated.
2. Then the full document wrapped in a :::HTML code block like this:

:::HTML
<div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 720px; margin: 0 auto; color: #1A1A2E;">
  <!-- For Meeting Recap / Biweekly Update / Pre-Meeting Agenda: simple flat layout with h1/h2 headers. -->
  <!-- For Mutual Action Plan (MAP) and Recap + MAP: branded header bar → CSS-only tab bar → four tab panels → branded footer bar. See "MAP-specific standardized output" below. -->
  <h1 style="color: #0000CC; font-size: 24px; margin: 0 0 8px 0;">Document Title</h1>
  <!-- ... rest of document ... -->
</div>
:::

3. A short closing line offering follow-ups (e.g., "Let me know if you want to adjust the milestones or add more context.")

# HTML styling requirements (general — applies to all document types)

- Use inline styles for everything, with ONE scoped exception: the MAP document type is allowed a single <style> block solely to power CSS-only tab switching (see the MAP section below). No external CSS, no <link> tags in any document.
- No <script> tags. No external images. No iframes. Tab switching is CSS-only because the preview is rendered in a sandboxed iframe with no script privileges.
- Recast brand colors: primary #0000CC (deep blue), accent #00BFFF (cyan), text #1A1A2E, muted #6B7280.
- Font stack: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif.
- Single root <div> with max-width: 720px and margin: 0 auto.

## Per-document-type layout

- **Meeting Recap**, **Biweekly Update**, **Pre-Meeting Agenda**: keep the simple flat layout — <h1> title in #0000CC, <h2> section headers with border-bottom: 2px solid #00BFFF, <h3> subsections, inline-styled paragraphs and lists, small footer line "Generated by Recast Partner Portal · {today's date}". Do NOT use the tabbed MAP structure for these types.
- **Mutual Action Plan (MAP)** and **Recap + MAP**: use the standardized branded-tabbed output described below. This is the new required format for MAPs.

# MAP-specific standardized output (Mutual Action Plan & Recap + MAP only)

When generating a MAP or Recap + MAP, produce the document inside the root <div> in this exact top-to-bottom order: (1) branded header bar, (2) content tab bar, (3) four tab panels, (4) branded footer bar.

## Brand system (use these tokens via inline styles)

| Token | Hex | Primary usage |
|---|---|---|
| Primary Blue | #0000CC | Header/footer bars, section headers, AW box bg |
| Accent Cyan | #00BFFF | Bullet markers, tab active indicator, decorative "+" |
| White | #FFFFFF | Text on blue surfaces, card backgrounds |
| Dark Text | #1A1A2E | Headlines, bold labels on light backgrounds |
| Medium Gray | #4A4A5A | Body text, descriptions |
| Muted Blue | #AABBEE | Footer text, subtitle text on blue surfaces |
| Light Gray | #F0F0F6 | Section header backgrounds, table header rows |
| Row Tint | #FAFAFE | Alternating table rows |
| Green | #0F7A3F | Completed items, checkmarks, confirmed details |
| Warn Amber | #CC8800 | In-progress, scheduled, pending items |
| Coral | #E07050 | Decorative 1px divider below header (one instance) |
| Decorator Blue | #2222DD | "+" symbols on header surface only |
| Complete Row BG | #F0FFF0 | Completed MAP rows |
| Amber Tint | #FFF8EE | Infrastructure boxes flagged with friction |
| Blue Tint | #EEF0FF | Highlighted callout areas |

## Typography

- Section headers: bold, #0000CC, 14px.
- Subsection headers: bold, #1A1A2E, 12px.
- Body text: regular, #4A4A5A, 11px.
- Table cells: regular, #1A1A2E, 10px.
- Metadata / footer captions: regular, #AABBEE or #4A4A5A, 9px.

## Branded header bar (inside the root div, first child)

- Full-width div, background #0000CC, height ~56px, padding 14px 20px, position: relative.
- Left side: "Recast" in #FFFFFF bold 18px, followed by "Software" in #00BFFF 10px, uppercase tracking optional. Text-only, no images.
- Right side (float right or flex end): "Meeting Recap & Mutual Action Plan" in #FFFFFF bold 13px, with a subtitle line immediately below showing "{{partner_name}} | {{date}}" in #AABBEE 9px.
- 2–3 decorative "+" characters in #2222DD scattered asymmetrically on the blue surface (use absolutely positioned spans with different top/left/font-size values).
- 1px bottom border in #E07050 (border-bottom: 1px solid #E07050).

## Content tab bar — CSS-only (radio + label trick)

This is the one place where a <style> block is allowed. Put it immediately inside the root <div>, before the header bar. Implement the tabs like this:

1. Four hidden radio inputs at the top of the content div, all with name="maptab", first one checked:
   <input type="radio" name="maptab" id="maptab-recap" checked style="position:absolute;left:-9999px;">
   <input type="radio" name="maptab" id="maptab-map" style="position:absolute;left:-9999px;">
   <input type="radio" name="maptab" id="maptab-agenda" style="position:absolute;left:-9999px;">
   <input type="radio" name="maptab" id="maptab-arch" style="position:absolute;left:-9999px;">

2. A horizontal tab row of <label> elements sitting directly below the branded header. Each label uses for="maptab-..." and contains the tab title text. Tab labels in order: "Meeting Recap", "Mutual Action Plan", "Proposed Agenda", "Architecture".

3. Four <section class="map-panel"> blocks after the tab row, one per tab. They must appear as siblings of the radio inputs (or at least reachable by the ~ general sibling combinator from each input) so CSS can toggle them.

4. A single <style> block that defines, at minimum:
   - .map-tabs { display: flex; gap: 4px; background: #FFFFFF; border-bottom: 1px solid #DDDDEE; padding: 0 16px; }
   - .map-tabs label { padding: 10px 16px; font: 600 12px Inter, sans-serif; color: #1A1A2E; cursor: pointer; border-radius: 6px 6px 0 0; }
   - .map-tabs label:hover { background: #F0F0F6; }
   - .map-panel { display: none; padding: 24px; }
   - #maptab-recap:checked ~ .map-tabs label[for="maptab-recap"],
     #maptab-map:checked ~ .map-tabs label[for="maptab-map"],
     #maptab-agenda:checked ~ .map-tabs label[for="maptab-agenda"],
     #maptab-arch:checked ~ .map-tabs label[for="maptab-arch"] { background: #0000CC; color: #FFFFFF; border-bottom: 2px solid #00BFFF; }
   - #maptab-recap:checked ~ .map-panel.panel-recap,
     #maptab-map:checked ~ .map-panel.panel-map,
     #maptab-agenda:checked ~ .map-panel.panel-agenda,
     #maptab-arch:checked ~ .map-panel.panel-arch { display: block; }

Default visible tab = Meeting Recap. Only one panel visible at a time. Absolutely NO <script> — if you add JS-based handlers, the preview iframe will silently drop them.

## Tab 1 — Meeting Recap (<section class="map-panel panel-recap">)

Sections in order:

1. **Meeting Metadata** — compact inline block with bold labels:
   "Date: {{date}}   Duration: {{duration}}   Format: {{format}}"
   "Recast: {{recast_attendees}}   {{partner_name}}: {{partner_attendees}}"
2. **Summary** — 2–3 sentence past-tense collaborative paragraph. No sales terminology.
3. **Confirmed Details** — vertical bullet list. Each bullet prefixed with a green ✔ in #0F7A3F. These items carry forward across sessions; new items append, nothing removes.
4. **Discussion Summary** — organized into subsections. Each subsection has a bold #1A1A2E 12px header. Bullets within each subsection use a cyan ● in #00BFFF. When a bullet traces to a specific person's question, attribute parenthetically: "(per {{name}}'s question)". Pick only the subsections that actually apply to the call from this approved set:
   - Technical Deep-Dive Results
   - Key Technical Questions Addressed
   - Seller Enablement / Positioning
   - Licensing & Business Model (label as "carried forward from prior sessions" when unchanged)
   - Early Deployment Opportunities

## Semantic bullet markers (use across ALL tabs)

| Marker | Char | Color | Meaning |
|---|---|---|---|
| Info | ● | #00BFFF | Standard fact, discussion point |
| Confirmed | ✔ | #0F7A3F | Validated agreement, completed item |
| Caution | ⚠ | #CC8800 | Pending confirmation, scheduling in progress |
| Action | ▶ | #00BFFF | Next step, action item |

## Tab 2 — Mutual Action Plan (<section class="map-panel panel-map">)

The accountability table. Carries forward across every session.

Columns (use a <table> with explicit width:100%, border-collapse:collapse):

| Column | Width | Content |
|---|---|---|
| Checkbox | 24px | ☑ in #0F7A3F for complete, ☐ in #999999 for open |
| Milestone | ~42% | Description — bold for upcoming/active, regular weight for completed |
| Owner | ~16% | "Recast", "{{partner_name}}", "{{partner_name}} ({{contact}})", or "Both Teams" |
| Target Date | ~20% | Specific date or relative phrase ("Post deep-dive", "This week") |
| Status | ~14% | Complete, In Progress, Next, Scheduled, or Pending |

Status badge colors (bold span inside the cell):
- Complete → color:#0F7A3F
- In Progress → color:#CC8800
- Next → color:#CC8800
- Scheduled → color:#CC8800
- Pending → color:#1A1A2E

Row styling:
- Completed rows: background #F0FFF0.
- Open rows: alternating #FFFFFF / #FAFAFE.
- Grid lines: 1px solid #DDDDEE.
- Header row: background #F0F0F6, bold #0000CC text.

Data model rules (enforce these when updating an existing MAP):
- Completed items stay in the table permanently (visual progress history).
- New milestones append as conversations reveal new approval gates.
- Sequence milestones in the order they will actually occur.
- Every approval gate the partner describes is a SEPARATE row. Do not combine them.

## Tab 3 — Proposed Agenda (<section class="map-panel panel-agenda">)

Each upcoming session is a subsection. Format:

- Bold #1A1A2E 12px header: "{{Session Name}} ({{date/time if known}})" or "{{Session Name}} (TBD)".
- Underneath each header, a list of ▶ bullets in #00BFFF describing the planned topics for that session.

## Tab 4 — Architecture (<section class="map-panel panel-arch">)

Two-block visual layout showing current state → proposed state.

**Current State Block:**
- Primary Blue label bar (background #0000CC, white text, padding 10px 16px): "CURRENT STATE — {{partner_name}} Managed Services: Per-Platform Application Delivery".
- Row of 3–5 infrastructure boxes. Default box: background #F0F0F6, border 1px solid #DDDDEE, padding 12px, text #1A1A2E 11px. Boxes flagged with known friction: background #FFF8EE, border 1px solid #CC8800.
- Optional second row of supporting-tool boxes (same styling rules).
- Bottom friction bar: background #FFF8EE, border 1px solid #CC8800, padding 10px 14px, starting with "⚠ Key Friction:" in #CC8800 bold followed by bullet-separated pain points.

**Transition:** Three cyan ▼ arrows in #00BFFF, centered between the two blocks, e.g. a div with style="text-align:center;color:#00BFFF;font-size:16px;margin:12px 0;" containing "▼ ▼ ▼".

**Proposed State Block:**
- Primary Blue label bar: "PROPOSED STATE — Application Workspace as the Unified Delivery Layer".
- Flow: Client Apps box → arrow → Application Workspace box (background #0000CC, white text, border 1px solid #00BFFF, contains a bulleted capability list) → arrow → Delivery Target boxes (background #F0F0F6) → arrow → End-user persona boxes (background #0000CC, white text).
- Bottom outcome bar: background #F0FFF0, border 1px solid #0F7A3F, padding 10px 14px, starting with "✔ What Changes:" in #0F7A3F bold followed by bullet-separated outcomes.

Content rules for Tab 4:
- AW capabilities must map to what was actually demonstrated or discussed — no generic filler.
- Delivery targets must reflect the partner's actual environment.
- Every friction bar item should have a corresponding outcome bar item (1:1 pairing).

## Branded footer bar (last child of the root div)

- Full-width div, background #0000CC, padding 12px 20px, text-align: center.
- Text: "Generated by Recast Partner Portal · {{today}}" in #AABBEE 9px.

## MAP tone and carry-forward rules

- Collaborative tone ONLY. These words must NEVER appear in MAP output: prospect, pipeline, close, deal, blocker, objection.
- Factual only. Every claim traces to a transcript or confirmed discussion. No speculation.
- Attribution: when someone specific asked a question, note it parenthetically.
- Carry-forward: Confirmed Details (Tab 1 §3), the MAP table (Tab 2), and the Architecture section (Tab 4) persist across sessions. New items append. Changed items update. Nothing disappears silently.
- Client-safe by default: no internal deal assessments, competitor pricing, other partner commitments, or informal verbal approvals.

## MAP variable placeholders

Populate these from the transcript context when generating. If a value is genuinely unknown, use "TBD" rather than inventing one: {{partner_name}}, {{date}}, {{duration}}, {{format}}, {{recast_attendees}}, {{partner_attendees}}, {{today}}, session names/times for Tab 3, and any {{contact}} names referenced in the MAP table Owner column.

# Updating existing documents

When asked to update a document, always emit the FULL replacement HTML block, not a diff. Preserve sections the user didn't ask to change.

# Conversation style

Be concise and collaborative. Don't over-explain. Acknowledge the request briefly, then deliver. If you need clarification, ask one question — don't pepper the user with multiple.`;

// ============================================
// Module State
// ============================================

const state = {
  mounted: false,
  containerEl: null,
  windowEl: null,
  chatEl: null,
  textareaEl: null,
  sendBtnEl: null,
  headerTitleEl: null,
  headerSubtitleEl: null,

  conversationHistory: [], // [{ role, content }]
  currentPartner: null,
  currentTranscripts: [],
  currentMode: 'create', // 'create' | 'update'
  currentDoc: null, // { _rowIndex, document_id, ... } in update mode
  onSavedCb: null,

  abortController: null,
  isBusy: false,
  isOpen: false,
  sessionId: 0, // Bumped on open/close so in-flight responses from a prior session can be discarded
};

// Background generation jobs whose owning popup has been closed before the
// response arrived. Each job carries its own captured context (partner,
// mode, onSaved callback, history snapshot) so a fresh openMeetingDocs()
// call for a different partner cannot disturb it. The job's promise keeps
// running until the API responds, then auto-saves to Partner_Documents.
const backgroundJobs = new Set();

// ============================================
// Public API
// ============================================

/**
 * Open the Meeting Docs chatbot.
 * @param {Object} opts
 * @param {Object} opts.partner - Partner object (partner_id, display_name, ...)
 * @param {Array} opts.transcripts - Full list of transcript objects for this partner
 * @param {'create'|'update'} opts.mode
 * @param {Object} [opts.existingDoc] - Required when mode === 'update'
 * @param {Function} [opts.onSaved] - Called after a successful save
 */
export function openMeetingDocs({ partner, transcripts = [], mode = 'create', existingDoc = null, onSaved = null }) {
  ensureMounted();

  // Check API key up front for a clean UX
  const apiKey = getRuntimeConfig('ANTHROPIC_API_KEY');
  if (!apiKey) {
    showToast('Anthropic API key not set. Configure it on the Setup page first.', 'error');
    return;
  }

  // Invalidate any in-flight request from a previous session (e.g. the user
  // opened the chatbot for another partner without closing it first).
  state.sessionId++;
  if (state.abortController) {
    try { state.abortController.abort(); } catch { /* ignore */ }
    state.abortController = null;
  }
  state.isBusy = false;
  if (state.sendBtnEl) {
    state.sendBtnEl.disabled = false;
    state.sendBtnEl.textContent = 'Send';
  }

  state.currentPartner = partner;
  state.currentTranscripts = transcripts;
  state.currentMode = mode;
  state.currentDoc = existingDoc;
  state.onSavedCb = onSaved;

  // Update header
  state.headerTitleEl.textContent = `Meeting Docs — ${partner.display_name || 'Partner'}`;
  state.headerSubtitleEl.textContent = mode === 'update'
    ? `Updating: ${existingDoc?.title || 'document'}`
    : `${transcripts.length} transcript${transcripts.length === 1 ? '' : 's'} in context`;

  // Reset chat UI and conversation
  state.chatEl.innerHTML = '';
  state.conversationHistory = [];

  // Reset textarea state so stale text / expanded height from a previous
  // session doesn't carry over.
  state.textareaEl.value = '';
  state.textareaEl.style.height = 'auto';

  // Seed context: first message is a hidden user turn with all transcripts
  const contextMessage = buildTranscriptContextMessage(partner, transcripts);
  state.conversationHistory.push({ role: 'user', content: contextMessage });

  if (mode === 'create') {
    // Seed assistant greeting (stored in history and rendered)
    const greeting = `Hi — I have ${transcripts.length} transcript${transcripts.length === 1 ? '' : 's'} for ${partner.display_name} loaded. I can generate a Meeting Recap, Mutual Action Plan, Recap + MAP, Biweekly Update, or Pre-Meeting Agenda. What would you like?\n\nTry things like: "Create a Recap + MAP from the most recent call" or "Build a biweekly update from the last 2 weeks".`;
    state.conversationHistory.push({ role: 'assistant', content: greeting });
    renderAssistantBubble(greeting);
  } else if (mode === 'update' && existingDoc) {
    // Combine "here is current doc" + greeting into a single assistant turn
    // so the history alternates user/assistant correctly for the API.
    const combinedContext = `Here is the current saved document titled "${existingDoc.title}" (${existingDoc.doc_type}). I'll preserve this as the baseline and apply whatever changes you request.\n\n:::HTML\n${existingDoc.html_content}\n:::\n\nWhat would you like to change?`;
    state.conversationHistory.push({ role: 'assistant', content: combinedContext });
    // Render a friendlier version in the UI (hide the raw HTML from the user)
    const uiGreeting = `I've loaded "${existingDoc.title}". What changes would you like to make? You can describe updates in plain language — e.g., "Mark milestone 2 as complete" or "Add a section about the POC timeline".`;
    renderAssistantBubble(uiGreeting);
  }

  openPopup();
  setTimeout(() => state.textareaEl?.focus(), 50);
}

// ============================================
// DOM Mount (lazy)
// ============================================

function ensureMounted() {
  if (state.mounted) return;

  const closeBtn = el('button', {
    class: 'meeting-docs__close',
    title: 'Close',
    html: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    onClick: closePopup,
  });

  state.headerTitleEl = el('div', { class: 'meeting-docs__header-title' }, 'Meeting Docs');
  state.headerSubtitleEl = el('div', { class: 'meeting-docs__header-subtitle' }, '');

  const header = el('div', { class: 'meeting-docs__header' },
    el('div', {},
      state.headerTitleEl,
      state.headerSubtitleEl,
    ),
    closeBtn,
  );

  state.chatEl = el('div', { class: 'meeting-docs__chat' });

  state.textareaEl = el('textarea', {
    class: 'meeting-docs__textarea',
    placeholder: 'Describe the document you want…',
    rows: '1',
    onKeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    onInput: (e) => {
      // Auto-grow
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
    },
  });

  state.sendBtnEl = el('button', {
    class: 'btn btn--primary btn--sm meeting-docs__send',
    onClick: handleSend,
  }, 'Send');

  const inputRow = el('div', { class: 'meeting-docs__input-row' },
    state.textareaEl,
    state.sendBtnEl,
  );

  state.windowEl = el('div', { class: 'meeting-docs__window' },
    header,
    state.chatEl,
    inputRow,
  );

  state.containerEl = el('div', { class: 'meeting-docs meeting-docs--hidden' }, state.windowEl);
  document.body.appendChild(state.containerEl);

  state.mounted = true;
}

function openPopup() {
  state.containerEl.classList.remove('meeting-docs--hidden');
  state.isOpen = true;
  // Hide Randy and any other bottom-right-anchored widgets while this
  // popup is visible so they don't overlap the Send button (CSS rule in
  // meeting-docs.css keys off body.meeting-docs-open).
  document.body.classList.add('meeting-docs-open');
}

function closePopup() {
  // If a request is in flight, hand it off to run in the background instead
  // of aborting. The job was created in handleSend() and already captured
  // all the context it needs; here we just flip a sentinel on the controller
  // so handleSend knows to take the background-save path when the API
  // responds. See `backgroundJobs` for lifecycle.
  if (state.isBusy && state.abortController) {
    const detaching = state.abortController;
    detaching._detachRequested = true;
    backgroundJobs.add(detaching);
    showToast(
      `Generating document in background — it'll appear on ${state.currentPartner?.display_name || 'the partner'} shortly.`,
      'success',
      5000,
    );
    // Detach from foreground state without aborting. A subsequent
    // openMeetingDocs() will reset state.sessionId/abortController cleanly
    // without clobbering the background promise because it no longer
    // references these fields.
    state.abortController = null;
    state.isBusy = false;
    if (state.sendBtnEl) {
      state.sendBtnEl.disabled = false;
      state.sendBtnEl.textContent = 'Send';
    }
    state.containerEl.classList.add('meeting-docs--hidden');
    state.isOpen = false;
    document.body.classList.remove('meeting-docs-open');
    return;
  }

  // Not busy: invalidate any in-flight request so its late-arriving response is discarded.
  state.sessionId++;
  if (state.abortController) {
    try { state.abortController.abort(); } catch { /* ignore */ }
    state.abortController = null;
  }
  state.isBusy = false;
  if (state.sendBtnEl) {
    state.sendBtnEl.disabled = false;
    state.sendBtnEl.textContent = 'Send';
  }
  state.containerEl.classList.add('meeting-docs--hidden');
  state.isOpen = false;
  document.body.classList.remove('meeting-docs-open');
}

// ============================================
// Conversation Helpers
// ============================================

function buildTranscriptContextMessage(partner, transcripts) {
  const sorted = [...transcripts].sort((a, b) =>
    new Date(b.conversation_date || b.created_at) - new Date(a.conversation_date || a.created_at)
  );

  let ctx = `# Partner Context\n\nPartner: ${partner.display_name || 'Unknown'}\n`;
  if (partner.partner_type) ctx += `Type: ${partner.partner_type}\n`;
  if (partner.tier) ctx += `Tier: ${partner.tier}\n`;
  if (partner.region) ctx += `Region: ${partner.region}\n`;
  ctx += `\n# Call Transcripts (${sorted.length})\n\n`;

  if (sorted.length === 0) {
    ctx += '_No transcripts have been recorded for this partner yet._\n';
  } else {
    sorted.forEach((t, i) => {
      const date = formatDate(t.conversation_date) || formatDate(t.created_at) || 'Undated';
      const text = htmlToPlainText(t.transcript_text || '').trim();
      ctx += `## Transcript ${i + 1} — ${date}\n\n${text}\n\n---\n\n`;
    });
  }

  ctx += `\n_The above is background context. I'll send my actual request in the next message._`;
  return ctx;
}

/**
 * Convert rich HTML (e.g. Quill output) to plain text while preserving
 * paragraph and line breaks. `stripHtml` uses textContent which concatenates
 * block elements without whitespace, so "<p>A</p><p>B</p>" becomes "AB" —
 * unusable as LLM context. This helper injects line breaks at block
 * boundaries first, then strips remaining tags.
 */
function htmlToPlainText(html) {
  if (!html) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<\/ul>|<\/ol>/gi, '\n');
  // Now strip remaining tags and decode entities via a detached element.
  const text = stripHtml(withBreaks);
  // Collapse runs of 3+ newlines to 2 for readability.
  return text.replace(/\n{3,}/g, '\n\n');
}

async function handleSend() {
  if (state.isBusy) return;
  const text = state.textareaEl.value.trim();
  if (!text) return;

  state.textareaEl.value = '';
  state.textareaEl.style.height = 'auto';

  // Render user bubble
  renderUserBubble(text);

  // Append to history
  state.conversationHistory.push({ role: 'user', content: text });

  // Capture everything we might need if the user closes the popup before
  // the response arrives. On close-while-busy, closePopup() marks the
  // abortController's `_detachRequested` sentinel; this handler then takes
  // the background-save path instead of rendering into a (possibly reset)
  // popup. The job owns its own context so a fresh openMeetingDocs() call
  // for another partner cannot corrupt it.
  const job = {
    partner: state.currentPartner,
    mode: state.currentMode,
    existingDoc: state.currentDoc,
    onSavedCb: state.onSavedCb,
    historySnapshot: state.conversationHistory.slice(),
    sessionId: state.sessionId,
    abortController: new AbortController(),
    detached: false,
    pendingCardEl: null,
  };

  // Inject a "Generating…" placeholder into the partner detail page's MAP
  // panel so the user sees immediate feedback. For background jobs the
  // placeholder stays until the auto-save triggers safeReRender; for
  // foreground jobs we remove it once the response arrives (user then sees
  // the real card in the chat and saves manually).
  job.pendingCardEl = injectPendingMapCard(job.partner, text, job.mode, job.existingDoc);

  state.abortController = job.abortController;
  state.isBusy = true;
  state.sendBtnEl.disabled = true;
  state.sendBtnEl.textContent = '…';
  const typingEl = renderTypingIndicator();

  try {
    const response = await callMeetingDocsAPI(job.historySnapshot, job.abortController.signal);

    // Did the user close the popup while we were waiting? If so, take the
    // background-save path rather than rendering into the popup.
    if (job.abortController._detachRequested) {
      job.detached = true;
      backgroundJobs.delete(job.abortController);
      await handleBackgroundResponse(job, response);
      return;
    }

    // Foreground: stale-session check still applies (e.g. user reopened
    // the popup for a different partner without closing first — rare, but
    // the original sessionId guard remains).
    if (job.sessionId !== state.sessionId) {
      // Pending card is orphaned (user reopened for someone else); drop it.
      removePendingMapCard(job.pendingCardEl);
      return;
    }
    typingEl.remove();

    state.conversationHistory.push({ role: 'assistant', content: response });

    const { prose, htmlBlocks } = parseHtmlBlocks(response);
    if (prose) renderAssistantBubble(prose);
    htmlBlocks.forEach(html => renderDocCard(html));

    // Foreground generation is done — the user now sees the real card in
    // the chat and will save manually. Drop the pending placeholder so the
    // MAP panel reflects the "waiting on user" state truthfully.
    removePendingMapCard(job.pendingCardEl);

    scrollChatToBottom();
  } catch (err) {
    if (job.abortController._detachRequested) {
      job.detached = true;
      backgroundJobs.delete(job.abortController);
      // Error path for background jobs — pending card is stale.
      removePendingMapCard(job.pendingCardEl);
      handleBackgroundError(job, err);
      return;
    }
    if (job.sessionId !== state.sessionId) {
      removePendingMapCard(job.pendingCardEl);
      return; // Stale — ignore (popup closed / reopened)
    }
    typingEl.remove();
    removePendingMapCard(job.pendingCardEl);
    if (err.name === 'AbortError') {
      // Silent — user closed popup
    } else {
      renderErrorBubble(err.message || 'Request failed');
    }
  } finally {
    // Only reset busy/controller state if we're still the current session
    // AND the job wasn't detached into the background. A detached job has
    // already released ownership of state.abortController in closePopup(),
    // so we must not touch it here.
    if (!job.detached && job.sessionId === state.sessionId) {
      state.abortController = null;
      state.isBusy = false;
      state.sendBtnEl.disabled = false;
      state.sendBtnEl.textContent = 'Send';
    }
  }
}

// ============================================
// Pending MAP Card Injection (partner detail page)
// ============================================
// These helpers reach directly into the partner detail DOM to show a
// "Generating…" placeholder the instant the user clicks Send. The real
// card replaces it when safeReRender runs after save; on error paths we
// remove the placeholder explicitly.

function injectPendingMapCard(partner, requestText, mode, existingDoc) {
  if (!partner?.partner_id) return null;
  const listEl = document.querySelector(`.map-list[data-partner-id="${partner.partner_id}"]`);
  if (!listEl) return null;

  const docType = mode === 'update' && existingDoc?.doc_type
    ? existingDoc.doc_type
    : inferDocType([{ role: 'user', content: requestText }], '');

  const preview = requestText.length > 140 ? requestText.slice(0, 140) + '…' : requestText;
  const label = mode === 'update' ? 'Updating…' : 'Generating…';

  const card = el('div', { class: 'map-card map-card--pending' },
    el('div', { class: 'map-card__row' },
      el('div', { class: 'map-card__title' },
        el('span', { class: 'map-card__spinner' }),
        label,
      ),
      el('span', { class: `doc-type-badge doc-type-badge--${docTypeClass(docType)}` }, docTypeLabel(docType)),
    ),
    el('div', { class: 'map-card__meta' },
      el('span', { class: 'map-card__meta-item' }, preview),
    ),
  );

  listEl.insertBefore(card, listEl.firstChild);

  // Hide the empty-state copy (if present) and bump the count badge so
  // the panel header stays accurate while the placeholder is visible.
  const panel = listEl.closest('.partner-bottom-panel--map');
  if (panel) {
    const emptyState = panel.querySelector('.map-list__empty');
    if (emptyState) emptyState.style.display = 'none';

    const countBadge = panel.querySelector('.partner-bottom-panel__count');
    if (countBadge) {
      const current = parseInt(countBadge.textContent, 10) || 0;
      countBadge.textContent = String(current + 1);
    }
  }

  return card;
}

function removePendingMapCard(cardEl) {
  if (!cardEl || !cardEl.parentNode) return;
  const panel = cardEl.closest('.partner-bottom-panel--map');
  cardEl.remove();

  if (panel) {
    // If there are no more cards at all, show the empty state again.
    const listEl = panel.querySelector('.map-list');
    const emptyState = panel.querySelector('.map-list__empty');
    if (listEl && emptyState && listEl.children.length === 0) {
      emptyState.style.display = '';
    }

    // Decrement the count badge. Guard against negative values.
    const countBadge = panel.querySelector('.partner-bottom-panel__count');
    if (countBadge) {
      const current = parseInt(countBadge.textContent, 10) || 0;
      countBadge.textContent = String(Math.max(0, current - 1));
    }
  }
}

// ============================================
// Background Job Handlers
// ============================================

async function handleBackgroundResponse(job, response) {
  const { prose, htmlBlocks } = parseHtmlBlocks(response);

  if (htmlBlocks.length === 0) {
    // Clarifying question — no HTML to save. User must reopen the chat to
    // continue the conversation. We don't restore state because the user
    // may have moved on to a different partner.
    showToast(
      `Assistant asked a follow-up for ${job.partner?.display_name || 'the partner'}. Reopen Meeting Docs to continue.`,
      'warning',
      6000,
    );
    return;
  }

  const latestHtml = htmlBlocks[htmlBlocks.length - 1];
  const title = extractTitle(latestHtml) || 'Generated Document';
  // Use the captured history snapshot (plus the new assistant turn) for
  // doc-type inference so a concurrent openMeetingDocs() can't poison it.
  const docType = inferDocType(
    [...job.historySnapshot, { role: 'assistant', content: prose || '' }],
    latestHtml,
  );

  // Build the doc object the same way openCompactCardInEditor does so
  // create-mode appends a new row and update-mode updates the existing row.
  const baseDoc = {
    partner_id: job.partner.partner_id,
    partner_name: job.partner.display_name,
    title,
    doc_type: docType,
    html_content: latestHtml,
  };
  const docForSave = (job.mode === 'update' && job.existingDoc)
    ? {
        ...baseDoc,
        document_id: job.existingDoc.document_id,
        _rowIndex: job.existingDoc._rowIndex,
        status: job.existingDoc.status,
        created_at: job.existingDoc.created_at,
        updated_at: job.existingDoc.updated_at,
      }
    : baseDoc;

  try {
    await saveMapDoc({ partner: job.partner, doc: docForSave, html: latestHtml, title });
    showToast(
      job.mode === 'update'
        ? `Updated MAP for ${job.partner.display_name}`
        : `MAP saved to ${job.partner.display_name}`,
      'success',
    );
    if (job.onSavedCb) { try { job.onSavedCb(); } catch { /* ignore */ } }
  } catch (err) {
    showToast(
      `Failed to auto-save MAP for ${job.partner?.display_name || 'partner'}: ${err.message || 'unknown error'}`,
      'error',
      8000,
    );
  }
}

function handleBackgroundError(job, err) {
  if (err.name === 'AbortError') return; // silent (shouldn't normally hit this path for background jobs)
  showToast(
    `MAP generation failed for ${job.partner?.display_name || 'partner'}: ${err.message || 'unknown error'}`,
    'error',
    8000,
  );
}

// ============================================
// Claude API Call
// ============================================

async function callMeetingDocsAPI(messages, signal) {
  const apiKey = getRuntimeConfig('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('API key not set. Configure it on the Setup page.');
  }

  // Filter out assistant-only "seed" messages that shouldn't be sent as actual
  // assistant turns (API requires messages to alternate user/assistant).
  // Our conversationHistory is already built to alternate correctly.
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: MEETING_DOCS_SYSTEM_PROMPT,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// ============================================
// Response Parsing
// ============================================

function parseHtmlBlocks(text) {
  // Tolerate any (or no) whitespace between the fence and the HTML so that
  // responses like "</div>:::" or "</div> :::" still match.
  const htmlBlocks = [];
  const prose = text.replace(/:::HTML\s*([\s\S]*?)\s*:::/g, (_, html) => {
    htmlBlocks.push(html.trim());
    return '';
  }).trim();
  return { prose, htmlBlocks };
}

// ============================================
// Rendering
// ============================================

function renderUserBubble(text) {
  const bubble = el('div', { class: 'meeting-docs__bubble' }, text);
  const msg = el('div', { class: 'meeting-docs__msg meeting-docs__msg--user' }, bubble);
  state.chatEl.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

function renderAssistantBubble(text) {
  const bubble = el('div', { class: 'meeting-docs__bubble' }, text);
  const msg = el('div', { class: 'meeting-docs__msg meeting-docs__msg--assistant' }, bubble);
  state.chatEl.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

function renderErrorBubble(message) {
  const bubble = el('div', { class: 'meeting-docs__error' }, `Error: ${message}`);
  const msg = el('div', { class: 'meeting-docs__msg meeting-docs__msg--assistant' }, bubble);
  state.chatEl.appendChild(msg);
  scrollChatToBottom();
}

function renderTypingIndicator() {
  const typing = el('div', { class: 'meeting-docs__typing' },
    el('span', {}),
    el('span', {}),
    el('span', {}),
  );
  const bubble = el('div', { class: 'meeting-docs__bubble' }, typing);
  const msg = el('div', { class: 'meeting-docs__msg meeting-docs__msg--assistant' }, bubble);
  state.chatEl.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

function renderDocCard(html) {
  // Compact clickable card (like a transcript header). Clicking opens the
  // shared editable pop-out (map-editor.js). Save happens inside the pop-out,
  // so there is exactly one canonical save path.
  const title = extractTitle(html) || 'Generated Document';
  const docType = inferDocType(state.conversationHistory, html);
  const plain = stripHtml(html).replace(/\s+/g, ' ').trim();
  const preview = plain.slice(0, 140) + (plain.length > 140 ? '…' : '');

  const card = el('div', {
    class: 'meeting-docs-doc-card meeting-docs-doc-card--compact',
    onClick: () => openCompactCardInEditor(html, title, docType),
  },
    el('div', { class: 'meeting-docs-doc-card__row' },
      el('span', { class: `doc-type-badge doc-type-badge--${docTypeClass(docType)}` }, docTypeLabel(docType)),
      el('div', { class: 'meeting-docs-doc-card__title' }, title),
    ),
    preview ? el('div', { class: 'meeting-docs-doc-card__preview' }, preview) : null,
    el('div', { class: 'meeting-docs-doc-card__hint' },
      el('span', { html: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7M6 2.5l3.5 3.5L6 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      'Click to view or edit',
    ),
  );

  state.chatEl.appendChild(card);
  scrollChatToBottom();
  return card;
}

function openCompactCardInEditor(html, title, docType) {
  if (!state.currentPartner) return;

  // Build a doc object matching what openMapEditorModal expects. In update
  // mode we carry the existing row info so Save updates that row; in create
  // mode we omit _rowIndex so Save appends.
  const partner = state.currentPartner;
  const baseDoc = {
    partner_id: partner.partner_id,
    partner_name: partner.display_name,
    title,
    doc_type: docType,
    html_content: html,
  };

  const doc = (state.currentMode === 'update' && state.currentDoc)
    ? {
        ...baseDoc,
        document_id: state.currentDoc.document_id,
        _rowIndex: state.currentDoc._rowIndex,
        status: state.currentDoc.status,
        created_at: state.currentDoc.created_at,
        updated_at: state.currentDoc.updated_at,
      }
    : baseDoc;

  openMapEditorModal({
    partner,
    doc,
    transcripts: state.currentTranscripts,
    onSaved: () => {
      // In update mode, keep state.currentDoc in sync so subsequent saves
      // target the same row without requiring a full page reRender.
      if (state.currentMode === 'update' && state.currentDoc) {
        state.currentDoc = { ...state.currentDoc, html_content: html, title };
      }
      if (state.onSavedCb) { try { state.onSavedCb(); } catch { /* ignore */ } }
    },
    // No onAskAssistant here — user is already chatting with the assistant.
    // Leaving it undefined hides the "Ask Assistant" button in the pop-out.
  });
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    state.chatEl.scrollTop = state.chatEl.scrollHeight;
  });
}

// ============================================
// Title / Type Inference
// ============================================
// Saving is handled inside openMapEditorModal, not here. The chatbot just
// renders a compact card that hands off to the editor pop-out on click.

function extractTitle(html) {
  // Try <h1> first, then <h2>, then fall back to first heading-ish line
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return stripHtml(h1Match[1]).trim().slice(0, 120);
  const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2Match) return stripHtml(h2Match[1]).trim().slice(0, 120);
  return '';
}

function inferDocType(history, html) {
  // Strategy: the user's recent request is the authoritative signal. Only
  // fall back to HTML-content keywords when the user said nothing specific,
  // because HTML content for any doc type is likely to contain generic
  // words like "agenda" or "recap" in headers that would cause misclassification.
  const recentUserText = history
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content.toLowerCase())
    .join(' ');

  // Priority 1: explicit user intent (check most specific patterns first)
  if (/\brecap\s*\+\s*map\b|\brecap and map\b/.test(recentUserText)) return 'map';
  if (/\bpre[-\s]?meeting\b|\bpre[-\s]?meeting\s+agenda\b/.test(recentUserText)) return 'pre-meeting';
  if (/\bbiweekly\b|\bbi-weekly\b|\bbi weekly\b/.test(recentUserText)) return 'biweekly';
  if (/\bmutual action plan\b|\bmap\b/.test(recentUserText)) return 'map';
  if (/\bagenda\b/.test(recentUserText)) return 'pre-meeting';
  if (/\brecap\b|\bmeeting recap\b/.test(recentUserText)) return 'recap';

  // Priority 2: only unambiguous phrases in HTML content as fallback.
  // Using multi-word phrases avoids false positives from generic header text.
  const htmlLower = (html || '').toLowerCase();
  if (/\bmutual action plan\b/.test(htmlLower)) return 'map';
  if (/\bbiweekly update\b/.test(htmlLower)) return 'biweekly';
  if (/\bpre[-\s]?meeting agenda\b/.test(htmlLower)) return 'pre-meeting';
  if (/\bmeeting recap\b/.test(htmlLower)) return 'recap';

  return 'recap';
}

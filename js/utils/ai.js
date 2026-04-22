// ============================================
// Shared AI Service — Claude API + Sheet Data
// ============================================
// Used by both the AI Assistant chat view and the voice widget

import { CONFIG, getRuntimeConfig } from '../config.js';
import { readSheetAsObjects } from '../sheets.js';
import { stripHtml } from '../components/quill-editor.js';

// ── Cache State ────────────────────────────────────────────────────
let cachedSheetData = null;
let cacheTimestamp = 0;
// 60s TTL — short enough that external sheet edits surface quickly,
// long enough that consecutive turns in a conversation reuse the
// cached payload (and thus also hit Anthropic's prompt cache).
const CACHE_TTL = 60 * 1000;

export function invalidateSheetCache() { cacheTimestamp = 0; }

// Fire-and-forget warmer. Used by Randy on wake-word detection so the
// sheet fetch overlaps with the user's utterance instead of blocking
// the LLM call that follows it. Safe to call repeatedly; loadSheetData
// returns the cached value if it's fresh.
let warmInFlight = null;
export function warmSheetData() {
  if (warmInFlight) return warmInFlight;
  warmInFlight = loadSheetData().catch(err => {
    console.warn('warmSheetData failed:', err?.message);
    return null;
  }).finally(() => { warmInFlight = null; });
  return warmInFlight;
}

// ── System Prompt ──────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You are a world-class AI assistant for Recast Software's Partner Portal — operating at the highest level of analytical intelligence. You answer questions about partners, deals, events, meetings, and partnership activity using the database context provided in each message.

ACCURACY IS NON-NEGOTIABLE: 100% accuracy is the absolute top priority — above brevity, above tone, above formatting. You MUST:
- Search ALL available data in the DATA CONTEXT before answering. Never answer from memory or assumptions.
- Only state facts that are explicitly present in the provided data.
- If a piece of information is not found in the DATA CONTEXT, say so clearly ("I don't see that in the data") rather than guessing or inferring.
- Never fabricate names, dates, amounts, statuses, contacts, or action items.
- If you are uncertain, say what you checked and what was or wasn't found.

## ADVANCED REASONING PROTOCOL — MANDATORY ON EVERY REQUEST

Apply this multi-step analytical framework before formulating any response, regardless of how simple the question appears:

**Step 1 — Query Decomposition**
Break the user's request into atomic sub-questions. Identify which tables and fields are needed to answer each part. Consider what related data might provide crucial context even if not explicitly asked for.

**Step 2 — Exhaustive Data Search**
Scan ALL relevant tables systematically — never stop at the first matching record. Check every partner, every opportunity, every transcript and description note that could be relevant. Cross-reference partner_id, opportunity_id, and event_id across all tables. When a question mentions a partner, sweep Opportunities, Events, Transcripts, Meeting_Index, and Partner_Documents for that partner before answering.

**Step 3 — Evidence Synthesis & Pattern Recognition**
Merge and reconcile findings across all data sources. When multiple records touch the same entity (e.g., multiple description notes for one opportunity, multiple transcripts for one partner), synthesize across ALL of them to surface the complete picture. Identify trends, contradictions, or data gaps — surface them explicitly rather than silently picking one interpretation. Extract insights that span multiple tables or time periods.

**Step 4 — Accuracy Verification**
Before composing your response, verify every claim you intend to make:
- Every name, date, dollar amount, stage, and status is explicitly present in the data
- All cross-references are fully resolved (partner_id → display_name, event_id → event title, lead_source → resolved name)
- Nothing is inferred, estimated, or fabricated to fill gaps — gaps are stated as gaps
- Amounts match the database exactly with no rounding or approximation

**Step 5 — Precision Response Delivery**
Deliver your synthesized findings in the mandated format. The Summary must be independently complete and voice-friendly. Detail sections provide depth without contradicting the Summary. Flag any data inconsistencies you discovered during analysis.

This protocol applies to EVERY request without exception — simple greeting, single-field lookup, or complex multi-partner analysis. The depth of visible output may vary, but the internal analytical rigor is always maximum.

The full database contents are included in each message under DATA CONTEXT. Use ONLY this data to answer questions.

DATABASE SCHEMA & FIELD NOTES:

PARTNERS — Master list of partner organizations
- partner_id (PK), display_name, partner_type, tier, region, status (active/inactive), hq_location
- password_hash → NEVER SURFACE THIS FIELD
- Default: only show active partners unless asked

OPPORTUNITIES — Deals and pipeline
- opportunity_id (PK), partner_id (FK→Partners), deal_name, customer_name, deal_value (USD), status (In Progress/Won/Lost), stage (Qualified/Proposal/Negotiation/Closed Won/Closed Lost), expected_close
- description → LONG field with full meeting recaps, executive summaries, technical assessments
- notes → JSON array string, "[]" means empty

EVENTS — Marketing events, webinars, roundtables
- event_id (PK), title, description, event_date, end_date, event_type, location, status, partner_id (FK→Partners)

MEETING_INDEX — Structured index of individual meetings extracted from Transcripts
- meeting_id (PK), transcript_id (FK→Transcripts), partner_id, partner_name, meeting_date, meeting_title, attendees, summary, key_decisions, topics_discussed
- Use this FIRST for meeting questions — it's structured and fast

TRANSCRIPTS — Raw meeting transcripts (LARGE — only included when relevant)
- transcript_id (PK), partner_id, partner_name, conversation_date, transcript_text (5,000-15,000+ words each)
- Only search these if Meeting_Index doesn't have enough detail

QUERY ROUTING:
1. Partner info → PARTNERS
2. Deal/pipeline/revenue → OPPORTUNITIES (join to PARTNERS for names via partner_id)
3. Events → EVENTS
4. Meeting/conversation questions → MEETING_INDEX first, then TRANSCRIPTS if needed
5. People/contacts → MEETING_INDEX.attendees first, then TRANSCRIPTS
6. Technical environment → OPPORTUNITIES.description
7. Action items/next steps → MEETING_INDEX.key_decisions
8. "Status update on X" → sweep PARTNERS + OPPORTUNITIES + MEETING_INDEX

DATA RULES:
- All monetary values are USD — always label ($XXX,XXX)
- Partial name matching OK ("Rubix" → "GetRubix")
- Default to most recent meeting when multiple exist
- If not confident, say what you checked and what's missing
- Keep responses concise unless asked for detail
- Include meeting dates and attendees when citing meetings

WRITE OPERATIONS:
When the user asks you to create, update, or delete data, respond with your normal conversational answer AND include structured action block(s) at the end of your response in this exact format:

:::ACTION
{
  "type": "update" | "create" | "delete",
  "sheet": "Partners" | "Opportunities" | "Events" | "Transcripts" | "Meeting_Index" | "AI_Conversations",
  "row_match": { "field": "value" },
  "changes": { "field": "new_value" },
  "summary": "human-readable description of the change"
}
:::

RULES:
- NEVER modify password_hash or is_admin fields
- NEVER delete from Partners sheet — only status changes allowed
- All other sheets (Opportunities, Events, Transcripts, Meeting_Index, AI_Conversations) can be deleted if the user confirms
- For ambiguous requests, ask for clarification instead of guessing
- Always describe the change in your response text before the action block
- You may include MULTIPLE :::ACTION blocks when a single user request requires writes to multiple sheets (e.g., logging a transcript also creates a Meeting_Index entry)
- For updates, row_match should use a unique identifier like partner_id, opportunity_id, or event_id
- For creates, row_match should be empty {} and all required fields go in changes

ADDING A TRANSCRIPT:
When the user wants to log a conversation, meeting update, call notes, email summary, or any interaction with a partner:
Required (ask if not provided):
- Which partner? (must match an existing partner display_name)
- What happened? (capture what the user says and format it as transcript_text)
Auto-generated fields in changes:
- transcript_id: "trn_" + random 8-char alphanumeric string
- partner_id: looked up from the partner's display_name in PARTNERS data
- partner_name: the partner's display_name
- conversation_date: today's date (YYYY-MM-DD) unless user specifies otherwise
- created_at: current ISO timestamp
Ask brief follow-up questions to capture useful detail ("Who was in the meeting?", "Any key decisions?", "Next steps?") but keep it conversational. If the user gives a quick update, format what they gave and confirm.
When creating a new transcript, ALSO create a corresponding Meeting_Index entry in a second :::ACTION block:
- meeting_id: "mtg_" + random 8-char alphanumeric string
- transcript_id: same as the transcript above
- partner_id and partner_name: same as above
- meeting_date: same as conversation_date
- meeting_title: generate a short descriptive title from the content (e.g., "Monthly Sync — New CRO Hire")
- attendees: names mentioned by the user
- summary: 2-3 sentence summary of what the user described
- key_decisions: any decisions mentioned (or empty string if none)
- topics_discussed: comma-separated topic tags inferred from the content

UPDATING A TRANSCRIPT:
When the user says "add to the X notes" or "update the X transcript":
- Find the most recent transcript for that partner (by conversation_date)
- Use type "update" with row_match on transcript_id
- APPEND the new content to the existing transcript_text (do not replace it)
- Add a separator before the appended text: "\\n\\n--- Update [today's date] ---\\n" followed by the new content

APPEND NOTE TO OPPORTUNITY:
The notes field on Opportunities is a JSON array stored as a string. When the user says "add a note to the X deal":
- Read the current notes value from the data context
- Parse the JSON array (or start with [] if it is "[]" or empty)
- Append a new object: {"text": "the note content", "date": "ISO timestamp", "author": "current user"}
- Set changes.notes to the full stringified JSON array including the new entry
- Use type "update" with row_match on the opportunity identifier

UPDATE EVENT CHECKLIST:
The checklist field on Events is a JSON array of {"text": "item", "done": false} objects. When the user says "mark X as done on the Y event":
- Read the current checklist value from the data context
- Parse the JSON array
- Find the matching item by text (partial match OK)
- Set its "done" field to true
- Set changes.checklist to the full stringified updated JSON array
When the user says "add a checklist item to the Y event":
- Parse the current JSON array (or start with [])
- Append {"text": "new item", "done": false}
- Set changes.checklist to the stringified array

## Response Format — MANDATORY

You deliver every response as clean markdown text. NEVER use HTML tags, <details>, <summary>, <div>, or inline style attributes. Use only markdown formatting: **bold**, ### headers, bullet lists (- item), and --- horizontal rules.

CRITICAL RULE: Only state facts that exist in the database. If a field is empty or a record doesn't exist, do NOT fabricate it. Say "No data recorded" or omit the section. Accuracy is more important than completeness. Never invent dates, names, amounts, or statuses.

### Core Structure

ALWAYS start with a **Summary** section (voice reads ONLY this). Then use --- separators and ### section headers to organize detail.

### Summary — ALWAYS FIRST

**Summary**
Your 2-3 sentence answer here. Must stand alone — user gets the full answer without reading any sections below.

---

Then add detail sections as needed using this pattern:

### Section Template

### EMOJI Section Title — STATUS
**Label:** Value
**Label:** Value
Description or bullet points here.

---

Voice ONLY reads the **Summary** text. All ### sections below are visual-only detail.

### Emoji Conventions for Section Titles

- 📊 Info (general, overview, profile)
- ✅ Success (won, completed, on track, active)
- ⚠️ Warning (at risk, pending, in progress, upcoming)
- 🔴 Critical (lost, blocked, overdue, inactive)
- 🔧 Technical (config, system, integration)
- 📝 Neutral (history, notes)
- 💰 Financial (deals, pipeline, value)
- 📅 Events / calendar
- 💬 Conversations / transcripts

## DATABASE SCHEMA — YOUR ONLY SOURCE OF TRUTH

You have access to 5 tables. The data in these tables is DYNAMIC — partners, opportunities, events, transcripts, and documents are added, updated, and removed over time. Query the actual data at the time of the request. ONLY reference fields listed below. NEVER invent fields that aren't in the schema.

### TABLE: Partners
Primary key: partner_id (can be integer or string format)
Fields:
- partner_id — unique identifier (links to all other tables)
- username — login username
- display_name — the partner's display name (ALWAYS use this when referencing a partner)
- partner_type — classification (e.g., MSP/SI, OEM, Technology, Regional Distributor)
- tier — partnership level (e.g., Value/Preferred, Premier/Strategic)
- region — geographic region (e.g., North America, MENA)
- created_at — when the partner record was created
- is_admin — boolean admin flag
- status — current relationship status (active, inactive, etc.)
- hq_location — headquarters city/region/country

### TABLE: Opportunities
Primary key: opportunity_id
Foreign key: partner_id → Partners.partner_id
Fields:
- opportunity_id — unique identifier
- partner_id — links to Partners table
- deal_name — name of the deal
- customer_name — end customer
- deal_value — dollar amount (integer)
- status — current status (e.g., In Progress, Won, Lost)
- stage — sales stage (e.g., Qualified, Proposal, Closed)
- expected_close — target close date
- description — detailed context (often very long — can be 1000+ words of meeting context, environment details, migration plans). ALWAYS summarize in 2-4 sentences when presenting, never skip this field.
- created_at — record creation timestamp
- updated_at — last update timestamp
- notes — additional notes
- lead_source — where the deal originated. Can be: a partner_id (referral from another partner), an event_id (generated from an event in the Events table), or a text value like "salesperson". Always resolve IDs to their display names when presenting.

### TABLE: Events
Primary key: event_id (can be integer or string format)
Foreign key: partner_id → Partners.partner_id
Fields:
- event_id — unique identifier
- title — event name
- description — event details and outcomes
- event_date — start date
- end_date — end date (same as event_date for single-day events)
- event_type — category (e.g., Webinar, Roundtable, Conference, Happy Hour)
- location — where (e.g., Virtual, In-Person with city)
- url — event URL (may be empty)
- created_by — who created the record
- created_at — record creation timestamp
- status — current status (Completed, Upcoming, In Progress)
- partner_id — links to Partners table
- checklist — preparation checklist (may be empty)

### TABLE: Transcripts
Primary key: transcript_id
Foreign key: partner_id → Partners.partner_id
Fields:
- transcript_id — unique identifier
- partner_id — links to Partners table
- partner_name — denormalized partner name for convenience
- conversation_date — date of the conversation
- transcript_text — FULL transcript content (rich structured text, typically 300-18000+ characters)
- created_at — record creation timestamp

IMPORTANT NOTES ABOUT TRANSCRIPTS:
- transcript_text contains structured meeting recaps with embedded sections. Common sections found in transcripts include: Key Takeaways, Discussion Summary, People (with names/titles/companies/emails), Action Items (with owner/timing/status), Next Steps, Current Environment details, and email threads.
- Some transcripts contain MULTIPLE meeting recaps in a single record (separated by dates or headings within the text). When this happens, break them into SEPARATE cards — one per meeting date found in the text.
- Some transcripts are plain text with bullet points, others contain HTML markup. Handle both formats.
- Transcript lengths vary dramatically — from a few hundred characters (quick notes, team rosters, links) to 18000+ characters (detailed multi-meeting recaps with full environment assessments). Adjust card detail accordingly: short transcripts get brief cards, long transcripts get comprehensive cards.
- When summarizing, extract the actual content from the text — do not generalize or assume beyond what the transcript says.

### TABLE: Partner_Documents
Primary key: document_id
Foreign key: partner_id → Partners.partner_id
Fields:
- document_id — unique identifier
- partner_id — links to Partners table
- partner_name — denormalized partner name
- title — document title
- doc_type — document type (e.g., map, biweekly, report)
- html_content — full HTML content of the document
- status — document status (active, archived, etc.)
- created_at — record creation timestamp
- updated_at — last update timestamp

### CROSS-TABLE RELATIONSHIPS

All tables connect through partner_id:
- Partners ← Opportunities (one partner can have many opportunities)
- Partners ← Events (one partner can have many events)
- Partners ← Transcripts (one partner can have many transcripts)
- Partners ← Partner_Documents (one partner can have many documents)
- Opportunities.lead_source can reference Events.event_id or Partners.partner_id — always resolve to display names when presenting

When answering questions, ALWAYS join across tables to provide complete context. If a user asks about a partner, check ALL related tables for data. If a user asks about an opportunity, resolve the partner_id to show the partner display_name. If a lead_source is an event_id, resolve it to the event title from Events table.

## INTELLIGENT SECTION MAPPING — HOW TO PRESENT DATA

Apply this reasoning to EVERY response: "What distinct entities exist in my answer that a user would want to see separately?" If yes → give it a ### section. If no → fold into summary or parent section.

### When user asks about a PARTNER

**Summary**: relationship status, tier, what's currently active.

Then show sections based on what data EXISTS for that partner (skip any category with zero records):

### 📊 Partner Profile — [Status]
**Type:** [partner_type]
**Tier:** [tier]
**Region:** [region]
**HQ:** [hq_location]

### 💬 [Date] — [Meeting topic] (one section PER transcript, chronological oldest first)
Extract from transcript_text: meeting date, attendees, key takeaways, action items.
If a single transcript contains multiple meeting recaps, create SEPARATE sections per meeting.

### 💰 [Deal Name] — [Stage] (one section PER opportunity)
**Customer:** [customer_name]
**Value:** [deal_value formatted as currency]
**Status:** [status]
**Expected Close:** [expected_close]
Description summary in 2-4 sentences.

### 📅 [Event Title] — [Date] (one section PER event)
**Type:** [event_type]
**Location:** [location]
**Status:** [status]
Description.

### 🔧 Documents (if partner_documents exist)
**Title:** [title]
**Type:** [doc_type]

### ⚠️ Action Items (ONLY if transcripts contain action items)
Extract from transcript_text. Show: task, owner, timing, status. Sort: overdue first, pending next, complete last.

### When user asks about CALLS / TRANSCRIPTS

**Summary**: how many calls found, date range, key themes.

One section PER CALL — extract from transcript_text:

### 💬 [Meeting Date] — [Partner Name]
- **Attendees:** (names and companies from transcript)
- **Key Takeaways:** (bulleted takeaways from text)
- **Decisions Made:** (if present)
- **Action Items:** (with owner and timing)
- **Next Steps:** (if present)

Remember: some transcripts contain MULTIPLE meetings — split into separate sections per meeting date.

### When user asks about OPPORTUNITIES / PIPELINE

**Summary**: total pipeline value, active deal count, nearest close dates.

One section PER OPPORTUNITY sorted by expected_close (soonest active first, closed deals last):

### 💰 [Deal Name] — [Stage]
- **Partner:** [resolve partner_id to display_name]
- **Customer:** [customer_name]
- **Value:** [deal_value formatted as currency]
- **Status:** [status]
- **Expected Close:** [expected_close]
- **Lead Source:** [resolve to display name if it is a partner_id or event_id]
- **Description:** [2-4 sentence summary of description field]

### When user asks about EVENTS

**Summary**: upcoming vs completed count, next event date.

One section PER EVENT — upcoming first, then completed:

### 📅 [Event Title] — [Status]
- **Date:** [event_date to end_date if multi-day]
- **Type:** [event_type]
- **Location:** [location]
- **Partner:** [resolve partner_id to display_name]
- **Description:** [description]

### When user asks about ACTION ITEMS / FOLLOW-UPS

**Summary**: count of pending items across partners.

Extract action items from transcript_text across relevant transcripts. Group by partner:

### ⚠️ [Partner Name] — Action Items
- Each: task, owner, timing, status
- Sort: overdue first, pending next, complete last

### When user asks a CROSS-CUTTING question ("Full update" / "What's happening across partners")

**Summary**: active partner count, total pipeline, upcoming events count.

One section PER ACTIVE PARTNER:
- Latest call: date + 1-sentence summary
- Active opportunities: deal name + value + stage
- Upcoming events if any
- Pending action items if any

Limit 10 sections max. Skip partners with no recent activity unless specifically asked.

### When user asks a SIMPLE QUESTION (greetings, general knowledge, how-to)

**Summary** only. No detail sections needed.

## Section Content Formatting Rules

Inside every section:
- **Label:** Value pattern for structured data
- Bullet lists (- item) for multi-item data
- Use --- between sections for visual separation
- Keep text concise — no filler words or unnecessary repetition

## ACCURACY RULES — NON-NEGOTIABLE

1. NEVER fabricate data. If a field is null/empty, say "No data recorded" or omit it entirely.
2. NEVER invent meeting dates, attendee names, deal amounts, or action items not found in the database.
3. When summarizing transcripts, use the actual content — don't generalize beyond what the text says.
4. If asked about a partner with no transcripts/opportunities/events, explicitly state "No [data type] currently recorded for [partner name]."
5. Deal values must match the database exactly. Do not round, estimate, or approximate.
6. Always use display_name from the Partners table when referencing partners — never show raw partner_id values to the user.
7. Present transcripts in chronological order (oldest first).
8. Always resolve cross-references: partner_id to display_name, event_id in lead_source to event title from Events table.
9. If data seems inconsistent or contradictory across tables, present what the database says and note the discrepancy — don't silently pick one interpretation.
10. If a query returns zero results from the database, say so clearly. Do not fill the gap with assumptions or general knowledge.

## Limits
- Maximum 12 sections per response
- Minimum 0 sections (summary-only for simple queries)
- Sweet spot: 3-7 sections
- Don't create sections with only one sentence of content — fold into summary or another section

## Decision Logic — When to Add Sections

Not every response needs detail sections. Follow this logic:

- Simple greeting / chitchat: **Summary** only. No sections.
- Single fact answer: **Summary** only. No sections.
- Multi-part explanation: **Summary** + 3-5 sections.
- How-to / instructions: **Summary** + step sections.
- Comparison / analysis: **Summary** + 4-7 sections.
- Error / troubleshooting: **Summary** + 2-4 sections.
- List of recommendations: **Summary** + 1 section per item.

Rule: If the answer fits in 2-3 sentences, **Summary** only. If it needs depth, add 3-7 sections with --- separators between them.`;

// ── Sheet Data Loading ─────────────────────────────────────────────

async function safeRead(sheetName) {
  try {
    return await readSheetAsObjects(sheetName);
  } catch (err) {
    console.warn(`Sheet "${sheetName}" not available:`, err.message);
    return [];
  }
}

export async function loadSheetData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSheetData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedSheetData;
  }

  const [partners, opportunities, events, meetingIndex, transcripts, oppDescriptions] = await Promise.all([
    safeRead(CONFIG.SHEET_PARTNERS),
    safeRead(CONFIG.SHEET_OPPORTUNITIES),
    safeRead(CONFIG.SHEET_EVENTS),
    safeRead(CONFIG.SHEET_MEETING_INDEX),
    safeRead(CONFIG.SHEET_TRANSCRIPTS),
    safeRead(CONFIG.SHEET_OPP_DESCRIPTIONS)
  ]);

  if (partners.length === 0) {
    throw new Error('Could not read Google Sheets. Check your connection on the Setup page.');
  }

  const sanitizedPartners = partners.map(p => {
    const { password_hash, is_admin, ...safe } = p;
    return safe;
  });

  const transcriptIndex = transcripts.map(t => ({
    transcript_id: t.transcript_id,
    partner_id: t.partner_id,
    partner_name: t.partner_name,
    conversation_date: t.conversation_date,
    preview: (t.transcript_text || '').substring(0, 300) + '...'
  }));

  // Opportunity_Descriptions stores the full history of description
  // entries per opportunity. The Opportunities row only carries the
  // latest in opp.description — the rest of the history lives here.
  // Randy is expected to analyze ALL of these when asked about an opp.
  const oppDescriptionIndex = oppDescriptions.map(d => ({
    description_id: d.description_id,
    opportunity_id: d.opportunity_id,
    deal_name: d.deal_name,
    description_date: d.description_date,
    created_at: d.created_at,
    preview: stripHtml(d.description_text || '').substring(0, 200) + '...'
  }));

  cachedSheetData = {
    partners: sanitizedPartners,
    opportunities: opportunities,
    events: events,
    meetingIndex: meetingIndex,
    transcriptIndex: transcriptIndex,
    fullTranscripts: transcripts,
    oppDescriptionIndex: oppDescriptionIndex,
    fullOppDescriptions: oppDescriptions
  };
  cacheTimestamp = now;
  return cachedSheetData;
}

// ── Build Context for API Call ─────────────────────────────────────
//
// The context is split into two parts so Anthropic's prompt caching
// can reuse the bulk of it across turns:
//
//   1. STABLE block  — the full corpus at a default truncation level
//      (partners, opportunity index with 1500-char descriptions, events,
//      meeting_index, transcript previews). Identical across turns as
//      long as the underlying sheet cache hasn't refreshed, so it hits
//      Anthropic's ephemeral cache on the second turn onward.
//
//   2. QUERY block   — only the expansions the current question needs
//      (full 4000-char descriptions for a mentioned partner, or full
//      transcripts for that partner). Typically empty. Never cached.
//
// The old buildDataContext() is kept as a convenience wrapper that
// concatenates the two, for callers (like admin-ai-assistant) that
// don't go through callClaudeStream.

export function buildStableContext(data) {
  const opps = data.opportunities.map(o => ({
    ...o,
    description: stripHtml(o.description || '').substring(0, 1500),
  }));

  return `DATA CONTEXT:

PARTNERS (${data.partners.length} records):
${JSON.stringify(data.partners, null, 2)}

OPPORTUNITIES (${opps.length} records):
${JSON.stringify(opps, null, 2)}

EVENTS (${data.events.length} records):
${JSON.stringify(data.events, null, 2)}

MEETING_INDEX (${data.meetingIndex.length} records):
${JSON.stringify(data.meetingIndex, null, 2)}

TRANSCRIPT PREVIEWS (${data.transcriptIndex.length} transcripts available — full text is added only when a question asks for it):
${JSON.stringify(data.transcriptIndex, null, 2)}

OPPORTUNITY DESCRIPTION INDEX (${(data.oppDescriptionIndex || []).length} description notes across all opportunities — full text for a specific opportunity is added when that opportunity is mentioned):
${JSON.stringify(data.oppDescriptionIndex || [], null, 2)}`;
}

function findMentionedPartner(partners, userMessage) {
  const msg = userMessage.toLowerCase();
  return partners.find(p => {
    const name = (p.display_name || '').toLowerCase();
    if (!name) return false;
    return msg.includes(name) || msg.includes(name.replace(/\s+/g, ''));
  }) || null;
}

function findMentionedOpportunity(opportunities, userMessage) {
  const msg = userMessage.toLowerCase();
  return opportunities.find(o => {
    const deal = (o.deal_name || '').toLowerCase();
    const cust = (o.customer_name || '').toLowerCase();
    if (deal && (msg.includes(deal) || msg.includes(deal.replace(/\s+/g, '')))) return true;
    if (cust && (msg.includes(cust) || msg.includes(cust.replace(/\s+/g, '')))) return true;
    return false;
  }) || null;
}

function buildFullDescriptionsFor(data, opportunityId) {
  const list = (data.fullOppDescriptions || [])
    .filter(d => String(d.opportunity_id) === String(opportunityId))
    .sort((a, b) =>
      new Date(b.description_date || b.created_at || 0) -
      new Date(a.description_date || a.created_at || 0)
    )
    .map(d => ({
      description_id: d.description_id,
      opportunity_id: d.opportunity_id,
      deal_name: d.deal_name,
      description_date: d.description_date,
      created_at: d.created_at,
      description_text: stripHtml(d.description_text || '').substring(0, 4000)
    }));
  return list;
}

export function buildQueryContext(data, userMessage) {
  const needsTranscripts = /transcript|full detail|full history|exact|verbatim|what did .+ say|tell me everything|deep dive|email|contract|agreement/i.test(userMessage);
  const needsFullDescriptions = /environment|platform|citrix|intune|sccm|avd|technical|architecture|current state|migration|deal|pipeline|status|update|detail|description|summary|recap|meeting|close|revenue|forecast|note|opportunity|opp\b/i.test(userMessage);

  const sections = [];
  const mentionedOpp = findMentionedOpportunity(data.opportunities || [], userMessage);

  // If the user named a specific opportunity, always pull ALL of its
  // description notes so Randy can analyze the full history (per the
  // opportunity-analysis contract in RANDY_PERSONALITY).
  if (mentionedOpp) {
    const opp = {
      ...mentionedOpp,
      description: stripHtml(mentionedOpp.description || '').substring(0, 4000)
    };
    sections.push(`MENTIONED OPPORTUNITY (${mentionedOpp.deal_name}):\n${JSON.stringify(opp, null, 2)}`);

    const allDescriptions = buildFullDescriptionsFor(data, mentionedOpp.opportunity_id);
    if (allDescriptions.length > 0) {
      sections.push(`FULL DESCRIPTION HISTORY for opportunity "${mentionedOpp.deal_name}" (${allDescriptions.length} entries, newest first — analyze ALL of these unless user asks otherwise):\n${JSON.stringify(allDescriptions, null, 2)}`);
    }
  }

  if (!needsTranscripts && !needsFullDescriptions) {
    return sections.length ? `\n\n${sections.join('\n\n')}` : '';
  }

  const partner = findMentionedPartner(data.partners, userMessage);
  if (!partner) {
    return sections.length ? `\n\n${sections.join('\n\n')}` : '';
  }

  if (needsFullDescriptions) {
    const partnerOpps = data.opportunities
      .filter(o => String(o.partner_id) === String(partner.partner_id))
      .map(o => ({ ...o, description: stripHtml(o.description || '').substring(0, 4000) }));
    if (partnerOpps.length > 0) {
      sections.push(`FULL OPPORTUNITY DETAILS (for ${partner.display_name}):\n${JSON.stringify(partnerOpps, null, 2)}`);
    }

    // Also surface all description-note history for every opportunity
    // belonging to this partner — Randy should analyze them all.
    const partnerOppIds = new Set(partnerOpps.map(o => String(o.opportunity_id)));
    const partnerDescriptions = (data.fullOppDescriptions || [])
      .filter(d => partnerOppIds.has(String(d.opportunity_id)))
      .map(d => ({
        description_id: d.description_id,
        opportunity_id: d.opportunity_id,
        deal_name: d.deal_name,
        description_date: d.description_date,
        created_at: d.created_at,
        description_text: stripHtml(d.description_text || '').substring(0, 4000)
      }));
    if (partnerDescriptions.length > 0) {
      sections.push(`FULL DESCRIPTION HISTORY (for ${partner.display_name}'s opportunities — analyze ALL entries):\n${JSON.stringify(partnerDescriptions, null, 2)}`);
    }
  }

  if (needsTranscripts) {
    const partnerTranscripts = data.fullTranscripts
      .filter(t => String(t.partner_id) === String(partner.partner_id))
      .map(t => ({
        transcript_id: t.transcript_id,
        partner_name: t.partner_name,
        conversation_date: t.conversation_date,
        transcript_text: (t.transcript_text || '').substring(0, 8000),
      }));
    if (partnerTranscripts.length > 0) {
      sections.push(`FULL TRANSCRIPTS (for ${partner.display_name}):\n${JSON.stringify(partnerTranscripts, null, 2)}`);
    }
  }

  return sections.length ? `\n\n${sections.join('\n\n')}` : '';
}

// Back-compat: single-string form used by non-streaming callers.
export function buildDataContext(data, userMessage) {
  return buildStableContext(data) + buildQueryContext(data, userMessage);
}

// ── API Call ────────────────────────────────────────────────────────
//
// Both entry points below build the same structured request:
//   • system        — array with one cached text block (the system
//                     prompt is stable for a whole conversation).
//   • messages      — the last user turn is converted to an array of
//                     content blocks so we can mark the stable data
//                     context as cached and leave the user's actual
//                     question + any query-specific expansions
//                     uncached at the tail.
//
// After the first turn this means ~60–80 KB of input tokens read from
// Anthropic's ephemeral cache instead of being re-processed, which
// drops time-to-first-token dramatically and cuts input cost ~90%.

function buildRequestBody(messages, sheetData, userMessage, systemPrompt, { stream }) {
  const stableContext = buildStableContext(sheetData);
  const queryContext = buildQueryContext(sheetData, userMessage);

  const augmentedMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user') {
      // Split the final user turn into cached + uncached blocks.
      return {
        role: 'user',
        content: [
          {
            type: 'text',
            text: stableContext,
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: queryContext
              ? `${m.content}\n\n---${queryContext}`
              : m.content,
          },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  return {
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: [
      {
        type: 'text',
        text: systemPrompt || SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: augmentedMessages,
    ...(stream ? { stream: true } : {}),
  };
}

// Combine a caller-supplied AbortSignal with a 90-second hard timeout so a
// hung network connection never leaves the UI frozen indefinitely.
function withTimeout(signal, ms = 90_000) {
  const timeoutSignal = typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : (() => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('Request timed out', 'TimeoutError')), ms); return c.signal; })();
  if (!signal) return timeoutSignal;
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeoutSignal])
    : signal;
}

function buildRequestHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function requireApiKey() {
  const apiKey = getRuntimeConfig('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('API key not set. Configure it on the Setup page or click the 🔑 icon in AI Assistant.');
  }
  return apiKey;
}

/**
 * Stream a Claude response. Invokes onChunk(text) for each text delta
 * as it arrives. Returns the full accumulated text when the stream
 * completes. Aborts cleanly when the supplied AbortSignal fires.
 */
export async function callClaudeStream(messages, sheetData, userMessage, signal, systemPrompt, onChunk) {
  const apiKey = requireApiKey();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: buildRequestHeaders(apiKey),
    body: JSON.stringify(buildRequestBody(messages, sheetData, userMessage, systemPrompt, { stream: true })),
    signal: withTimeout(signal),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events — each event ends with a blank line.
      let eventEnd;
      while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        // Only care about the data: line. Anthropic sends one per event.
        const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text = evt.delta.text || '';
          if (text) {
            full += text;
            if (onChunk) onChunk(text, full);
          }
        } else if (evt.type === 'message_delta' && evt.usage) {
          // Log cache hit info once per response so we can verify caching
          // is working in dev without spamming.
          const u = evt.usage;
          if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
            console.log(`[Claude cache] read=${u.cache_read_input_tokens || 0} created=${u.cache_creation_input_tokens || 0}`);
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ok */ }
  }

  return full;
}

/**
 * Non-streaming convenience wrapper. Kept for the admin AI Assistant
 * view and any other caller that expects a single awaited string.
 * Uses the same prompt-cached request body as callClaudeStream so it
 * benefits from caching even without the SSE machinery.
 */
export async function callClaude(messages, sheetData, userMessage, signal, systemPrompt) {
  const apiKey = requireApiKey();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: buildRequestHeaders(apiKey),
    body: JSON.stringify(buildRequestBody(messages, sheetData, userMessage, systemPrompt, { stream: false })),
    signal: withTimeout(signal),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.usage && (data.usage.cache_read_input_tokens || data.usage.cache_creation_input_tokens)) {
    console.log(`[Claude cache] read=${data.usage.cache_read_input_tokens || 0} created=${data.usage.cache_creation_input_tokens || 0}`);
  }
  return data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// ── MAP PDF helpers ────────────────────────────────────────────────
//
// These support the voice-triggered MAP PDF feature. They deliberately
// sit alongside the other AI helpers so they can reuse loadSheetData()
// and stripHtml without a second Sheets read path.

const MAP_PDF_BETA_HEADER = 'code-execution-2025-08-25,skills-2025-10-02,files-api-2025-04-14';
const MAP_PDF_MODEL = 'claude-opus-4-7';
const MAP_PDF_TIMEOUT_MS = 120_000;
// Opus 4.7 supports up to 32K output tokens. We need runway for both
// the skill's internal P.C.P. analysis and the Python that writes the
// PDF. 8K was too tight — the model burned the budget on analysis and
// never got to executing the script.
const MAP_PDF_MAX_TOKENS = 32_000;
const MAP_PDF_MAX_PAUSE_ITERATIONS = 10;

function acronymOf(name) {
  return String(name || '')
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(w => w.length > 0)
    .map(w => w[0].toUpperCase())
    .join('');
}

function sharesPrefix(a, b, minLen = 3) {
  if (!a || !b) return false;
  const len = Math.min(a.length, b.length);
  if (len < minLen) return false;
  return a.slice(0, len) === b.slice(0, len);
}

// Three-pass match: exact → partial includes → acronym. Each pass short-
// circuits the moment it returns any results. Runs only over the cached
// opportunities array — no network cost.
function findOpportunityMatches(opportunities, hint) {
  const h = String(hint || '').toLowerCase().trim();
  if (!h) return [];

  const exact = opportunities.filter(o =>
    (o.customer_name || '').toLowerCase() === h ||
    (o.deal_name || '').toLowerCase() === h
  );
  if (exact.length > 0) return exact;

  const partial = opportunities.filter(o =>
    (o.customer_name || '').toLowerCase().includes(h) ||
    (o.deal_name || '').toLowerCase().includes(h)
  );
  if (partial.length > 0) return partial;

  const hintUpper = h.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (hintUpper.length < 2) return [];
  return opportunities.filter(o => {
    const names = [o.customer_name, o.deal_name].filter(Boolean);
    return names.some(n => sharesPrefix(hintUpper, acronymOf(n), 3));
  });
}

/**
 * Look up an opportunity and its full dated description history by a
 * loose name hint the user spoke aloud ("ANICO", "American National",
 * "Fabrikam deal", etc).
 *
 * Matching order: exact → partial includes → acronym prefix.
 *
 * Returns `matchCount: 0` when no opportunity matches, `matchCount: n`
 * with a `matches` array when multiple do (caller should disambiguate),
 * and a populated record when exactly one matches. `allDescriptions` is
 * sorted newest-first; it may be empty if the opportunity has no rows
 * in the Opportunity_Descriptions sheet — in that case the caller
 * should refuse rather than fall back to the summary field.
 *
 * @param {string} opportunityHint
 */
export async function getOpportunityDescription(opportunityHint) {
  if (!opportunityHint || typeof opportunityHint !== 'string') {
    return { matchCount: 0, matches: [] };
  }

  const data = await loadSheetData();
  const opportunities = data.opportunities || [];
  const fullDescriptions = data.fullOppDescriptions || [];

  const matches = findOpportunityMatches(opportunities, opportunityHint);

  if (matches.length === 0) {
    return { matchCount: 0, matches: [] };
  }

  if (matches.length > 1) {
    return {
      matchCount: matches.length,
      matches: matches.map(o => ({
        opportunityId: o.opportunity_id,
        opportunityName: o.customer_name || o.deal_name || '(unnamed opportunity)',
        dealName: o.deal_name || '',
        customerName: o.customer_name || '',
      })),
    };
  }

  const opp = matches[0];
  const opportunityName = opp.customer_name || opp.deal_name || '(unnamed opportunity)';

  const allDescriptions = fullDescriptions
    .filter(d => String(d.opportunity_id) === String(opp.opportunity_id))
    .map(d => ({
      date: d.description_date || d.created_at || '',
      text: stripHtml(d.description_text || '').trim(),
    }))
    .filter(d => d.text.length > 0)
    .sort((a, b) => {
      const ad = Date.parse(a.date) || 0;
      const bd = Date.parse(b.date) || 0;
      return bd - ad;
    });

  const latest = allDescriptions[0];

  return {
    matchCount: 1,
    opportunityId: opp.opportunity_id,
    opportunityName,
    dealName: opp.deal_name || '',
    customerName: opp.customer_name || '',
    latestDescription: latest?.text || '',
    descriptionDate: latest?.date || '',
    allDescriptions,
  };
}

// Exported for the unit tests, which feed in a synthetic opportunities
// array instead of hitting the Sheets cache.
export const __mapPdfInternals = {
  findOpportunityMatches,
  acronymOf,
  sharesPrefix,
};

function slugifyForFilename(s) {
  return String(s || 'opportunity')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'opportunity';
}

function buildMapPdfPrompt(opportunityName, descriptionText, descriptionDate, priorEntries) {
  // Prior entries are appended as a short context block when present
  // — deliberately NOT called out as "analyze this deeply", since the
  // previous prompt did that and the model burned all its tokens on
  // the P.C.P. walkthrough instead of running the Python.
  const priorBlock = (priorEntries && priorEntries.length > 0)
    ? `\n\nPrior context (for reference only):\n${priorEntries.map(e => `• ${e.date}: ${e.text}`).join('\n')}`
    : '';

  return `Generate a Recast-branded MAP PDF for this opportunity using the recast-map-pdf skill.

Opportunity: ${opportunityName}
Description Date: ${descriptionDate}

Source content:
---
${descriptionText}
---${priorBlock}

EXECUTE THE PYTHON SCRIPT in reference_map_pdf.py from the skill. Adapt the CONTENT constants at the top to this opportunity, then call build_pdf() to write the file. Return the generated PDF file. Do not narrate the P.C.P. analysis in text — apply it silently and produce the file. Skip explanatory text blocks unless flagging genuine ambiguities.`;
}

// Walk the Anthropic response and pull out: (a) any PDF file that was
// produced via code_execution, (b) the AMBIGUITY FLAGS operator hint.
//
// Skills + code_execution responses have shipped under multiple shapes
// as the beta evolves — file IDs have appeared inside
// `code_execution_tool_result.content[]`, `bash_code_execution_tool_result.content[]`,
// as standalone `container_upload` blocks, and as entries on
// `response.container.files[]` / `response.generated_files[]`. Rather
// than enumerate every known shape (which bit-rots the next time the
// beta ships a tweak), we deep-walk the entire response object and
// collect anything that looks like `{ file_id, filename? }`, then
// prefer PDF filenames if present.
function extractPdfAndFlags(response) {
  const textChunks = [];
  const candidates = [];
  const visited = new WeakSet();

  function walk(node) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);

    if (typeof node.type === 'string' && node.type === 'text' && typeof node.text === 'string') {
      textChunks.push(node.text);
    }

    // Any object that carries a file_id is a candidate. The filename
    // hint lives under several keys across schema versions — take
    // whichever we can find, prefer explicit .pdf matches.
    const fid =
      (typeof node.file_id === 'string' && node.file_id) ||
      (node.file && typeof node.file.file_id === 'string' && node.file.file_id) ||
      (node.file && typeof node.file.id === 'string' && node.file.id) ||
      null;
    if (fid) {
      const nm =
        node.filename ||
        node.file?.filename ||
        node.file?.name ||
        node.name ||
        null;
      candidates.push({ fileId: fid, filename: nm });
    }

    // Recurse into arrays and nested objects — but skip primitives.
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) walk(item);
      } else if (val && typeof val === 'object') {
        walk(val);
      }
    }
  }

  walk(response);

  // Prefer a candidate whose filename ends in .pdf; otherwise take the
  // first one we found. This handles the case where the PDF's filename
  // is embedded alongside, say, an intermediate log file.
  const pdf = candidates.find(c => /\.pdf$/i.test(c.filename || ''));
  const pick = pdf || candidates[0] || null;

  const joined = textChunks.join('\n');
  const flagMatch = joined.match(/AMBIGUITY FLAGS:\s*([\s\S]+?)(?:\n\n|$)/i);
  const ambiguityFlags = flagMatch ? flagMatch[1].trim() : '';

  return {
    fileId: pick?.fileId || null,
    filename: pick?.filename || null,
    ambiguityFlags,
    // Surfaced on the error path for console diagnostics.
    candidateCount: candidates.length,
  };
}

/**
 * Generate a Recast-branded MAP PDF for the given opportunity by invoking
 * the recast-map-pdf skill in the sandbox. This is a NON-streaming call —
 * streaming + code_execution don't mix with Randy's text-delta flow.
 *
 * Steps:
 *   1. POST to /v1/messages with container.skills + code_execution tool.
 *   2. Follow pause_turn hops up to MAP_PDF_MAX_PAUSE_ITERATIONS times,
 *      reusing the container across hops so files persist.
 *   3. Walk the final response for a PDF file_id, download via Files API.
 *   4. Return the PDF as a Blob plus a download filename.
 *
 * Caller supplies the skill ID — this function throws a clearly-tagged
 * error when the caller hasn't set it up yet so the UI can show the
 * "run the upload script" message instead of a raw 400.
 *
 * @param {object} opts
 * @param {string} opts.skillId
 * @param {string} opts.opportunityName
 * @param {string} opts.descriptionText
 * @param {string} opts.descriptionDate
 * @param {Array<{date: string, text: string}>} [opts.priorDescriptions]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ pdfBlob: Blob, filename: string, ambiguityFlags: string }>}
 */
export async function callClaudePdfGeneration({
  skillId,
  opportunityName,
  descriptionText,
  descriptionDate,
  priorDescriptions = [],
  signal,
} = {}) {
  if (!skillId || skillId === 'PASTE_SKILL_ID_HERE') {
    const err = new Error('MAP skill not configured');
    err.code = 'MAP_SKILL_NOT_CONFIGURED';
    throw err;
  }
  if (!opportunityName) throw new Error('opportunityName is required');
  if (!descriptionText) throw new Error('descriptionText is required');

  const apiKey = requireApiKey();
  const headers = {
    ...buildRequestHeaders(apiKey),
    'anthropic-beta': MAP_PDF_BETA_HEADER,
  };

  const userText = buildMapPdfPrompt(
    opportunityName,
    descriptionText,
    descriptionDate || '',
    priorDescriptions
  );

  const conversation = [{ role: 'user', content: userText }];
  let container = {
    skills: [
      { type: 'custom', skill_id: skillId, version: 'latest' },
      { type: 'anthropic', skill_id: 'pdf', version: 'latest' },
    ],
  };

  // First request gets a 2-minute timeout; subsequent pause_turn hops
  // reuse the same AbortSignal-composed timeout window so a stuck
  // generation doesn't loop forever.
  const composedSignal = withTimeout(signal, MAP_PDF_TIMEOUT_MS);

  let lastResponse = null;
  for (let hop = 0; hop <= MAP_PDF_MAX_PAUSE_ITERATIONS; hop++) {
    const body = {
      model: MAP_PDF_MODEL,
      max_tokens: MAP_PDF_MAX_TOKENS,
      container,
      tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
      messages: conversation,
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: composedSignal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody.error?.message || `API error: ${response.status}`;
      console.error(`[MAP PDF] hop ${hop} HTTP error`, { status: response.status, body: errBody });
      const err = new Error(msg);
      err.status = response.status;
      if (/skill/i.test(msg)) err.code = 'MAP_SKILL_ERROR';
      throw err;
    }

    lastResponse = await response.json();

    // Reuse the returned container on subsequent hops so files survive.
    if (lastResponse.container?.id) {
      container = { id: lastResponse.container.id };
    }

    // Per-hop diagnostics. stop_reason and output_tokens are the two
    // things we need to see when the generation fails to produce a PDF.
    console.log(`[MAP PDF] hop ${hop}`, {
      stop_reason: lastResponse.stop_reason,
      output_tokens: lastResponse.usage?.output_tokens,
      input_tokens: lastResponse.usage?.input_tokens,
      cache_read: lastResponse.usage?.cache_read_input_tokens,
      content_blocks: Array.isArray(lastResponse.content) ? lastResponse.content.length : 0,
      content_types: Array.isArray(lastResponse.content)
        ? lastResponse.content.map(b => b?.type).join(',')
        : '(none)',
    });

    // Only end_turn means "Claude is done". Anything else — pause_turn,
    // max_tokens, tool_use, stop_sequence — we continue the loop with
    // the assistant's partial turn appended to messages and the same
    // container reused. That gives the skill room to finish executing
    // the Python across multiple hops if it hits the per-turn budget.
    if (lastResponse.stop_reason === 'end_turn') break;

    if (hop === MAP_PDF_MAX_PAUSE_ITERATIONS) {
      console.warn(`[MAP PDF] hit pause-turn hop limit (${MAP_PDF_MAX_PAUSE_ITERATIONS}) — last stop_reason=${lastResponse.stop_reason}`);
      throw new Error(`MAP PDF generation exceeded the pause-turn loop limit. Last stop_reason=${lastResponse.stop_reason}`);
    }

    // Append the assistant turn so the next request carries what the
    // model produced so far.
    conversation.push({ role: 'assistant', content: lastResponse.content });
    // pause_turn is a server-side resumption signal — the API expects
    // the assistant turn echoed back and will continue tool execution
    // from where it left off. No user turn needed.
    //
    // For any other non-end_turn reason (max_tokens, tool_use, etc.)
    // the model stopped mid-thought, so we nudge it forward with an
    // explicit continuation prompt.
    if (lastResponse.stop_reason !== 'pause_turn') {
      conversation.push({
        role: 'user',
        content: 'Continue. Execute the Python script and produce the PDF file.',
      });
    }
  }

  const { fileId, filename: apiFilename, ambiguityFlags, candidateCount } = extractPdfAndFlags(lastResponse);

  if (!fileId) {
    // Dump the full response shape so we can see exactly what Anthropic
    // returned. Paste this back into the bug report if this ever fires.
    console.log('[MAP PDF] no file_id extracted — candidates found:', candidateCount);
    console.log('[MAP PDF] Full PDF generation response:', JSON.stringify(lastResponse, null, 2));
    const err = new Error('Claude did not return a PDF file in its response.');
    err.code = 'MAP_PDF_MISSING';
    err.rawResponse = lastResponse;
    throw err;
  }

  const fileResp = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(fileId)}/content`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': MAP_PDF_BETA_HEADER,
    },
    signal: composedSignal,
  });
  if (!fileResp.ok) {
    // Capture the response body so we can tell apart 404 (missing file)
    // from 403 (auth/scope) from 400 (bad beta header) etc. Do NOT blow
    // up if the body can't be read.
    let errorBody = '';
    try { errorBody = await fileResp.text(); } catch { /* ignore */ }
    console.error('[MAP PDF] File download failed', {
      fileId,
      status: fileResp.status,
      statusText: fileResp.statusText,
      body: errorBody.slice(0, 2000),
    });
    const err = new Error(`Failed to download PDF (HTTP ${fileResp.status}).`);
    err.code = 'MAP_PDF_DOWNLOAD_FAILED';
    err.status = fileResp.status;
    err.responseBody = errorBody;
    throw err;
  }
  const pdfBlob = await fileResp.blob();

  const datePart = (descriptionDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const filename = apiFilename && /\.pdf$/i.test(apiFilename)
    ? apiFilename
    : `recast-map-${slugifyForFilename(opportunityName)}-${datePart}.pdf`;

  return { pdfBlob, filename, ambiguityFlags };
}

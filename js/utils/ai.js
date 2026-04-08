// ============================================
// Shared AI Service — Claude API + Sheet Data
// ============================================
// Used by both the AI Assistant chat view and the voice widget

import { CONFIG, getRuntimeConfig } from '../config.js';
import { readSheetAsObjects } from '../sheets.js';

// ── Cache State ────────────────────────────────────────────────────
let cachedSheetData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function invalidateSheetCache() { cacheTimestamp = 0; }

// ── System Prompt ──────────────────────────────────────────────────
export const SYSTEM_PROMPT = `You are an AI assistant for Recast Software's Partner Portal. You answer questions about partners, deals, events, meetings, and partnership activity using the database context provided in each message.

IMPORTANT: The full database contents are included in each message under DATA CONTEXT. Use ONLY this data to answer questions. Do not make up information.

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
When the user asks you to create, update, or delete data, respond with your normal conversational answer AND include a structured action block at the end of your response in this exact format:

:::ACTION
{
  "type": "update" | "create" | "delete",
  "sheet": "Partners" | "Opportunities" | "Events",
  "row_match": { "field": "value" },
  "changes": { "field": "new_value" },
  "summary": "human-readable description of the change"
}
:::

RULES:
- NEVER modify password_hash or is_admin fields
- NEVER delete from Partners sheet — only status changes allowed
- For ambiguous requests, ask for clarification instead of guessing
- Always describe the change in your response text before the action block
- Only include ONE action block per response
- For updates, row_match should use a unique identifier like partner_id, opportunity_id, or event_id
- For creates, row_match should be empty {} and all required fields go in changes`;

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

  const [partners, opportunities, events, meetingIndex, transcripts] = await Promise.all([
    safeRead(CONFIG.SHEET_PARTNERS),
    safeRead(CONFIG.SHEET_OPPORTUNITIES),
    safeRead(CONFIG.SHEET_EVENTS),
    safeRead(CONFIG.SHEET_MEETING_INDEX),
    safeRead(CONFIG.SHEET_TRANSCRIPTS)
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

  cachedSheetData = {
    partners: sanitizedPartners,
    opportunities: opportunities,
    events: events,
    meetingIndex: meetingIndex,
    transcriptIndex: transcriptIndex,
    fullTranscripts: transcripts
  };
  cacheTimestamp = now;
  return cachedSheetData;
}

// ── Build Context for API Call ─────────────────────────────────────

export function buildDataContext(data, userMessage) {
  const msg = userMessage.toLowerCase();

  let transcriptContext = '';
  const needsTranscripts = /transcript|full detail|full history|exact|verbatim|what did .+ say|tell me everything|deep dive|email|contract|agreement/i.test(userMessage);

  if (needsTranscripts) {
    const partnerMatch = data.partners.find(p =>
      msg.includes(p.display_name.toLowerCase()) ||
      msg.includes(p.display_name.toLowerCase().replace(/\s+/g, ''))
    );

    if (partnerMatch) {
      const relevantTranscripts = data.fullTranscripts
        .filter(t => String(t.partner_id) === String(partnerMatch.partner_id))
        .map(t => ({
          transcript_id: t.transcript_id,
          partner_name: t.partner_name,
          conversation_date: t.conversation_date,
          transcript_text: (t.transcript_text || '').substring(0, 8000)
        }));

      if (relevantTranscripts.length > 0) {
        transcriptContext = `\n\nFULL TRANSCRIPTS (for ${partnerMatch.display_name}):\n${JSON.stringify(relevantTranscripts, null, 2)}`;
      }
    } else {
      transcriptContext = `\n\nTRANSCRIPT PREVIEWS (ask about a specific partner for full text):\n${JSON.stringify(data.transcriptIndex, null, 2)}`;
    }
  } else {
    transcriptContext = `\n\nTRANSCRIPT PREVIEWS (${data.transcriptIndex.length} transcripts available — ask about a specific partner for full text):\n${JSON.stringify(data.transcriptIndex, null, 2)}`;
  }

  const needsFullDescriptions = /environment|platform|citrix|intune|sccm|avd|technical|architecture|current state|migration/i.test(userMessage);

  const opps = data.opportunities.map(o => {
    if (needsFullDescriptions) {
      return { ...o, description: (o.description || '').substring(0, 4000) };
    }
    return { ...o, description: (o.description || '').substring(0, 500) + '...' };
  });

  return `DATA CONTEXT:

PARTNERS (${data.partners.length} records):
${JSON.stringify(data.partners, null, 2)}

OPPORTUNITIES (${opps.length} records):
${JSON.stringify(opps, null, 2)}

EVENTS (${data.events.length} records):
${JSON.stringify(data.events, null, 2)}

MEETING_INDEX (${data.meetingIndex.length} records):
${JSON.stringify(data.meetingIndex, null, 2)}${transcriptContext}`;
}

// ── API Call ────────────────────────────────────────────────────────

export async function callClaude(messages, sheetData, userMessage, signal) {
  const apiKey = getRuntimeConfig('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('API key not set. Configure it on the Setup page or click the 🔑 icon in AI Assistant.');
  }

  const dataContext = buildDataContext(sheetData, userMessage);
  const augmentedMessages = messages.map((m, i) => {
    const msg = { role: m.role, content: m.content };
    if (i === messages.length - 1 && m.role === 'user') {
      msg.content = `${m.content}\n\n---\n${dataContext}`;
    }
    return msg;
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: augmentedMessages
    }),
    signal: signal || undefined
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

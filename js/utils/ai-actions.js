// ============================================
// Shared AI Action Execution — Write Operations
// ============================================
// Used by both the AI Assistant chat view and the Randy voice assistant

import { loadSheetData, invalidateSheetCache } from './ai.js';
import { appendRow, updateRow, deleteRow } from '../sheets.js';

// ── Sheet Headers (for write operations) ───────────────────────────
export const SHEET_HEADERS = {
  Partners: ['partner_id', 'username', 'display_name', 'partner_type', 'tier', 'region', 'created_at', 'is_admin', 'password_hash', 'status', 'hq_location'],
  Opportunities: ['opportunity_id', 'partner_id', 'deal_name', 'customer_name', 'deal_value', 'status', 'stage', 'expected_close', 'description', 'created_at', 'updated_at', 'notes', 'lead_source'],
  Events: ['event_id', 'title', 'description', 'event_date', 'end_date', 'event_type', 'location', 'url', 'created_by', 'created_at', 'status', 'partner_id', 'checklist'],
  Transcripts: ['transcript_id', 'partner_id', 'partner_name', 'conversation_date', 'transcript_text', 'created_at'],
  Meeting_Index: ['meeting_id', 'transcript_id', 'partner_id', 'partner_name', 'meeting_date', 'meeting_title', 'attendees', 'summary', 'key_decisions', 'topics_discussed'],
  AI_Conversations: ['conversation_id', 'user_id', 'started_at', 'title', 'messages', 'status'],
};
export const BLOCKED_FIELDS = ['password_hash', 'is_admin'];

// ── Action Parser ──────────────────────────────────────────────────
export function parseActions(responseText) {
  const actions = [];
  const cleanText = responseText.replace(/:::ACTION\n([\s\S]*?)\n:::/g, (_, json) => {
    try { actions.push(JSON.parse(json)); } catch (e) { console.error('Failed to parse action:', e); }
    return '';
  }).trim();
  return { cleanText, actions };
}

// ── Row Matching ───────────────────────────────────────────────────
export function findMatchingRow(rows, match) {
  return rows.find(row => {
    return Object.entries(match).every(([field, value]) => {
      const rowVal = String(row[field] || '').toLowerCase();
      const matchVal = String(value).toLowerCase();
      return rowVal === matchVal || rowVal.includes(matchVal);
    });
  });
}

// ── Action Execution ───────────────────────────────────────────────
export async function executeAction(action) {
  // Safety checks
  if (!action.sheet || !SHEET_HEADERS[action.sheet]) throw new Error(`Unknown sheet: ${action.sheet}`);
  if (action.type === 'delete' && action.sheet === 'Partners') throw new Error('Cannot delete Partners — use status change');
  if (action.changes) {
    for (const f of BLOCKED_FIELDS) {
      if (f in action.changes) throw new Error(`Cannot modify field: ${f}`);
    }
  }

  const sheetData = await loadSheetData();
  const headers = SHEET_HEADERS[action.sheet];
  const sheetKey = { Partners: 'partners', Opportunities: 'opportunities', Events: 'events', Transcripts: 'fullTranscripts', Meeting_Index: 'meetingIndex' }[action.sheet];
  const rows = (sheetKey && sheetData[sheetKey]) || [];

  console.log(`[AI Action] ${new Date().toISOString()} — ${action.type} on ${action.sheet}`, action);

  if (action.type === 'update') {
    if (!action.row_match || Object.keys(action.row_match).length === 0) throw new Error('No row_match specified');
    const row = findMatchingRow(rows, action.row_match);
    if (!row) throw new Error('No matching row found');
    const values = headers.map(h => {
      if (action.changes && h in action.changes) return action.changes[h];
      return row[h] || '';
    });
    await updateRow(action.sheet, row._rowIndex, values);
  } else if (action.type === 'create') {
    const values = headers.map(h => (action.changes && action.changes[h]) || '');
    await appendRow(action.sheet, values);
  } else if (action.type === 'delete') {
    if (!action.row_match || Object.keys(action.row_match).length === 0) throw new Error('No row_match specified');
    const row = findMatchingRow(rows, action.row_match);
    if (!row) throw new Error('No matching row found');
    await deleteRow(action.sheet, row._rowIndex);
  }

  invalidateSheetCache();
}

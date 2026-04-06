// ============================================
// Google Sheets API Integration
// ============================================

import { CONFIG } from './config.js';
import { getAccessToken } from './auth.js';

const BASE = `${CONFIG.SHEETS_BASE_URL}/${CONFIG.SPREADSHEET_ID}`;

/**
 * Build fetch headers — includes Bearer token when an OAuth access token is available.
 */
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Build the auth query parameter — use API key when no Bearer token is available.
 */
function getAuthParam() {
  const token = getAccessToken();
  return token ? '' : `key=${CONFIG.API_KEY}`;
}

/**
 * Check if Google Sheets is configured.
 */
export function isConfigured() {
  return CONFIG.API_KEY !== 'YOUR_GOOGLE_API_KEY_HERE'
    && CONFIG.SPREADSHEET_ID !== 'YOUR_SPREADSHEET_ID_HERE';
}

/**
 * Read all rows from a sheet.
 * Returns array of row arrays (first row = headers).
 */
export async function readSheet(sheetName) {
  if (!isConfigured()) return getDemoData(sheetName);

  const url = `${BASE}/values/${encodeURIComponent(sheetName)}?${getAuthParam()}`;
  const token = getAccessToken();
  const res = await fetch(url, token ? { headers: { 'Authorization': `Bearer ${token}` } } : undefined);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to read ${sheetName}`);
  }

  const data = await res.json();
  return data.values || [];
}

/**
 * Read rows and parse into objects using header row.
 */
export async function readSheetAsObjects(sheetName) {
  const rows = await readSheet(sheetName);
  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 }; // 1-indexed, skip header
    headers.forEach((h, i) => {
      obj[h] = row[i] || '';
    });
    return obj;
  });
}

/**
 * Append a row to a sheet.
 */
export async function appendRow(sheetName, values) {
  if (!isConfigured()) {
    console.log('[Demo] Would append to', sheetName, values);
    return { updates: { updatedRows: 1 } };
  }

  const authParam = getAuthParam();
  const url = `${BASE}/values/${encodeURIComponent(sheetName)}:append`
    + `?valueInputOption=USER_ENTERED${authParam ? '&' + authParam : ''}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to append to ${sheetName}`);
  }

  return res.json();
}

/**
 * Update a specific row.
 * @param {string} sheetName
 * @param {number} rowIndex - 1-based row number
 * @param {Array} values
 */
export async function updateRow(sheetName, rowIndex, values) {
  if (!isConfigured()) {
    console.log('[Demo] Would update', sheetName, `row ${rowIndex}`, values);
    return {};
  }

  const range = `${sheetName}!A${rowIndex}:${String.fromCharCode(64 + values.length)}${rowIndex}`;
  const authParam = getAuthParam();
  const url = `${BASE}/values/${encodeURIComponent(range)}`
    + `?valueInputOption=USER_ENTERED${authParam ? '&' + authParam : ''}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to update ${sheetName}`);
  }

  return res.json();
}

/**
 * Delete a row by index.
 * Requires knowing the numeric sheet ID (gid).
 */
export async function deleteRow(sheetName, rowIndex) {
  if (!isConfigured()) {
    console.log('[Demo] Would delete', sheetName, `row ${rowIndex}`);
    return {};
  }

  // First, get the sheet's numeric gid
  const authParam = getAuthParam();
  const metaUrl = `${BASE}?${authParam}&fields=sheets.properties`;
  const token = getAccessToken();
  const metaRes = await fetch(metaUrl, token ? { headers: { 'Authorization': `Bearer ${token}` } } : undefined);
  const meta = await metaRes.json();
  const sheet = meta.sheets?.find(s => s.properties.title === sheetName);

  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const sheetId = sheet.properties.sheetId;
  const url = `${BASE}:batchUpdate${authParam ? '?' + authParam : ''}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex - 1, // 0-based
            endIndex: rowIndex,
          }
        }
      }]
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to delete from ${sheetName}`);
  }

  return res.json();
}


// ============================================
// Demo data for when Google Sheets isn't configured
// ============================================

let demoPartners = [
  ['partner_id', 'username', 'display_name', 'partner_type', 'tier', 'region', 'created_at', 'is_admin', 'password_hash', 'status'],
  ['p_admin001', 'admin', 'Portal Admin', '', 'Gold', 'Global', '2026-01-01', 'TRUE', '', 'active'],
  ['p_nerdio1', 'nerdio', 'Nerdio', 'Technology', 'Gold', 'North America', '2026-01-15', 'FALSE', '', 'active'],
  ['p_ridgep1', 'ridgepoint', 'RidgePoint', 'MSP/SI', 'Silver', 'North America', '2026-02-01', 'FALSE', '', 'active'],
  ['p_insigh1', 'insight', 'Insight', 'MSP/SI', 'Gold', 'North America', '2026-02-10', 'FALSE', '', 'active'],
  ['p_syscd01', 'systemcenterdudes', 'System Center Dudes', 'Technology', 'Bronze', 'EMEA', '2026-02-20', 'FALSE', '', 'active'],
  ['p_gitrub1', 'gitrubix', 'GitRubix', 'Technology', 'Silver', 'APAC', '2026-03-01', 'FALSE', '', 'active'],
  ['p_qualc01', 'qualcomm', 'Qualcomm', 'Technology', 'Gold', 'North America', '2026-03-10', 'FALSE', '', 'active'],
];

let demoOpportunities = [
  ['opportunity_id', 'partner_id', 'deal_name', 'customer_name', 'deal_value', 'status', 'stage', 'expected_close', 'description', 'created_at', 'updated_at'],
  ['opp_001', 'p_nerdio1', 'Azure Virtual Desktop Rollout', 'TechCorp Industries', '150000', 'In Progress', 'Proposal', '2026-06-15', 'AVD deployment for 500-seat enterprise', '2026-03-01', '2026-04-01'],
  ['opp_002', 'p_nerdio1', 'Cloud Desktop Optimization', 'Metro Health Systems', '85000', 'Registered', 'Qualified', '2026-07-30', 'Cloud desktop optimization for healthcare provider', '2026-03-15', '2026-03-15'],
  ['opp_003', 'p_ridgep1', 'Managed Services Engagement', 'Global Retail Co', '200000', 'In Progress', 'Negotiation', '2026-05-20', 'Full managed services for 200 retail locations', '2026-02-10', '2026-03-28'],
  ['opp_004', 'p_ridgep1', 'Network Infrastructure Refresh', 'EuroBank AG', '120000', 'Won', 'Closed', '2026-03-15', 'Complete network infrastructure refresh', '2026-01-20', '2026-03-15'],
  ['opp_005', 'p_insigh1', 'Digital Workspace Transformation', 'Contoso Ltd', '275000', 'In Progress', 'Proposal', '2026-08-01', 'End-to-end digital workspace transformation', '2026-03-01', '2026-04-01'],
  ['opp_006', 'p_insigh1', 'Hybrid Cloud Migration', 'Woodgrove Bank', '180000', 'Registered', 'Qualified', '2026-09-15', 'Hybrid cloud migration for financial services', '2026-03-20', '2026-03-20'],
  ['opp_007', 'p_syscd01', 'SCCM to Intune Migration', 'Fabrikam Inc', '95000', 'In Progress', 'Negotiation', '2026-07-01', 'Migrate 10K endpoints from SCCM to Intune', '2026-02-15', '2026-03-28'],
  ['opp_008', 'p_gitrub1', 'DevOps Pipeline Modernization', 'Northwind Traders', '110000', 'Registered', 'Prospect', '2026-08-15', 'CI/CD pipeline modernization with GitHub Actions', '2026-04-01', '2026-04-01'],
  ['opp_009', 'p_qualc01', 'Edge Computing Platform', 'Adventure Works', '320000', 'In Progress', 'Proposal', '2026-09-30', 'Edge computing solution for manufacturing IoT', '2026-02-15', '2026-03-20'],
  ['opp_010', 'p_qualc01', 'AI Accelerator Deployment', 'Tailspin Toys', '75000', 'Won', 'Closed', '2026-03-01', 'AI inference accelerator deployment', '2026-01-10', '2026-03-01'],
  ['opp_011', 'p_nerdio1', 'Cost Optimization Assessment', 'Sunrise Media', '60000', 'Lost', 'Closed', '2026-02-28', 'Cloud cost optimization assessment', '2025-12-01', '2026-02-28'],
];

let demoEvents = [
  ['event_id', 'title', 'description', 'event_date', 'end_date', 'event_type', 'location', 'url', 'created_by', 'created_at', 'status', 'partner_id'],
  ['evt_001', 'Q2 Partner Kickoff Webinar', 'Quarterly partner kickoff covering new products, incentive programs, and roadmap updates.', '2026-04-10', '2026-04-10', 'Webinar', 'Virtual (Zoom)', 'https://zoom.us/example', 'p_admin001', '2026-03-01', 'Upcoming', ''],
  ['evt_002', 'Cloud Security Workshop', 'Hands-on workshop covering cloud security best practices and our security suite.', '2026-04-22', '2026-04-23', 'Workshop', 'San Francisco, CA', '', 'p_admin001', '2026-03-01', 'Upcoming', 'p_nerdio1'],
  ['evt_003', 'Partner Summit 2026', 'Annual partner summit with keynotes, breakouts, and networking.', '2026-05-15', '2026-05-17', 'Conference', 'Las Vegas, NV', '', 'p_admin001', '2026-03-15', 'Upcoming', ''],
  ['evt_004', 'Spring Campaign Launch', 'Joint marketing campaign for spring demand generation push.', '2026-04-01', '2026-04-30', 'Campaign', 'Digital', '', 'p_admin001', '2026-03-20', 'In Progress', 'p_ridgep1'],
  ['evt_005', 'Technical Certification Bootcamp', 'Two-day certification prep for partner technical staff.', '2026-05-05', '2026-05-06', 'Workshop', 'Virtual (Teams)', '', 'p_admin001', '2026-04-01', 'Upcoming', 'p_insigh1'],
  ['evt_006', 'EMEA Partner Roundtable', 'Regional partner discussion on EMEA market strategy.', '2026-04-18', '2026-04-18', 'Webinar', 'Virtual (Zoom)', '', 'p_admin001', '2026-04-01', 'Upcoming', 'p_syscd01'],
  ['evt_007', 'Summer Pipeline Blitz', 'Summer demand gen campaign focusing on pipeline acceleration.', '2026-06-01', '2026-06-30', 'Campaign', 'Digital', '', 'p_admin001', '2026-04-05', 'Upcoming', 'p_qualc01'],
];

// ============================================
// Demo data localStorage persistence
// ============================================

const DEMO_STORAGE_KEY = 'pp_demo_data';
const DEMO_SCHEMA_VERSION = 3; // Bump when demo data structure changes

function persistDemoData() {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({
      version: DEMO_SCHEMA_VERSION,
      partners: demoPartners,
      opportunities: demoOpportunities,
      events: demoEvents,
    }));
  } catch { /* quota exceeded — silently ignore */ }
}

function loadPersistedDemoData() {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Reject stale schema
    if (data.version !== DEMO_SCHEMA_VERSION) {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      return false;
    }
    if (data.partners) demoPartners = data.partners;
    if (data.opportunities) demoOpportunities = data.opportunities;
    if (data.events) demoEvents = data.events;
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear persisted demo data (useful for resetting to defaults).
 */
export function clearDemoData() {
  localStorage.removeItem(DEMO_STORAGE_KEY);
}

// On module init, restore persisted demo data if available
loadPersistedDemoData();

function getDemoData(sheetName) {
  switch (sheetName) {
    case CONFIG.SHEET_PARTNERS: return [...demoPartners.map(r => [...r])];
    case CONFIG.SHEET_OPPORTUNITIES: return [...demoOpportunities.map(r => [...r])];
    case CONFIG.SHEET_EVENTS: return [...demoEvents.map(r => [...r])];
    default: return [];
  }
}

/**
 * Add a row to demo data (for demo mode writes).
 */
export function addDemoRow(sheetName, values) {
  switch (sheetName) {
    case CONFIG.SHEET_PARTNERS: demoPartners.push(values); break;
    case CONFIG.SHEET_OPPORTUNITIES: demoOpportunities.push(values); break;
    case CONFIG.SHEET_EVENTS: demoEvents.push(values); break;
  }
  persistDemoData();
}

/**
 * Update a row in demo data.
 */
export function updateDemoRow(sheetName, rowIndex, values) {
  let data;
  switch (sheetName) {
    case CONFIG.SHEET_PARTNERS: data = demoPartners; break;
    case CONFIG.SHEET_OPPORTUNITIES: data = demoOpportunities; break;
    case CONFIG.SHEET_EVENTS: data = demoEvents; break;
    default: return;
  }
  if (data[rowIndex - 1]) {
    data[rowIndex - 1] = values;
  }
  persistDemoData();
}

/**
 * Delete a row from demo data.
 */
export function deleteDemoRow(sheetName, rowIndex) {
  let data;
  switch (sheetName) {
    case CONFIG.SHEET_PARTNERS: data = demoPartners; break;
    case CONFIG.SHEET_OPPORTUNITIES: data = demoOpportunities; break;
    case CONFIG.SHEET_EVENTS: data = demoEvents; break;
    default: return;
  }
  data.splice(rowIndex - 1, 1);
  persistDemoData();
}

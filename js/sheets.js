// ============================================
// Google Sheets API Integration
// ============================================

import { CONFIG, getRuntimeConfig } from './config.js';
import { getAccessToken } from './auth.js';

/**
 * Get the effective Spreadsheet ID (runtime override or hardcoded).
 */
function getSpreadsheetId() {
  return getRuntimeConfig('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID;
}

/**
 * Get the effective API key (runtime override or hardcoded).
 */
function getApiKey() {
  return getRuntimeConfig('API_KEY') || CONFIG.API_KEY;
}

/**
 * Build the base URL for Sheets API calls.
 */
function getBaseUrl() {
  return `${CONFIG.SHEETS_BASE_URL}/${getSpreadsheetId()}`;
}

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
  if (token) return '';
  const apiKey = getApiKey();
  return (apiKey && apiKey !== 'YOUR_GOOGLE_API_KEY_HERE') ? `key=${apiKey}` : '';
}

/**
 * Check if Google Sheets is configured.
 * Requires a real Spreadsheet ID. API key is optional if OAuth token is available.
 */
export function isConfigured() {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId || spreadsheetId === 'YOUR_SPREADSHEET_ID_HERE') return false;
  // Need either an API key or an OAuth token
  const apiKey = getApiKey();
  const token = getAccessToken();
  return !!token || (!!apiKey && apiKey !== 'YOUR_GOOGLE_API_KEY_HERE');
}

/**
 * Read all rows from a sheet.
 * Returns array of row arrays (first row = headers).
 */
export async function readSheet(sheetName) {
  if (!isConfigured()) return getDemoData(sheetName);

  const base = getBaseUrl();
  const authParam = getAuthParam();
  const url = `${base}/values/${encodeURIComponent(sheetName)}${authParam ? '?' + authParam : ''}`;
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

  const base = getBaseUrl();
  const authParam = getAuthParam();
  const url = `${base}/values/${encodeURIComponent(sheetName)}:append`
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

  const base = getBaseUrl();
  const range = `${sheetName}!A${rowIndex}:${String.fromCharCode(64 + values.length)}${rowIndex}`;
  const authParam = getAuthParam();
  const url = `${base}/values/${encodeURIComponent(range)}`
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

  const base = getBaseUrl();
  const authParam = getAuthParam();
  const token = getAccessToken();

  // First, get the sheet's numeric gid
  const metaUrl = `${base}?fields=sheets.properties${authParam ? '&' + authParam : ''}`;
  const metaRes = await fetch(metaUrl, token ? { headers: { 'Authorization': `Bearer ${token}` } } : undefined);
  const meta = await metaRes.json();
  const sheet = meta.sheets?.find(s => s.properties.title === sheetName);

  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const sheetId = sheet.properties.sheetId;
  const url = `${base}:batchUpdate${authParam ? '?' + authParam : ''}`;

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
// Sheet Initialization & Seeding
// ============================================

const SHEET_HEADERS = {
  [CONFIG.SHEET_PARTNERS]: ['partner_id', 'username', 'display_name', 'partner_type', 'tier', 'region', 'created_at', 'is_admin', 'password_hash', 'status', 'hq_location'],
  [CONFIG.SHEET_OPPORTUNITIES]: ['opportunity_id', 'partner_id', 'deal_name', 'customer_name', 'deal_value', 'status', 'stage', 'expected_close', 'description', 'created_at', 'updated_at'],
  [CONFIG.SHEET_EVENTS]: ['event_id', 'title', 'description', 'event_date', 'end_date', 'event_type', 'location', 'url', 'created_by', 'created_at', 'status', 'partner_id'],
  [CONFIG.SHEET_TRANSCRIPTS]: ['transcript_id', 'partner_id', 'partner_name', 'conversation_date', 'transcript_text', 'created_at'],
};

/**
 * Initialize the Google Sheet with the 3 required tabs and header rows.
 * Requires an OAuth token (admin must be logged in).
 */
export async function initializeSheet() {
  const base = getBaseUrl();
  const token = getAccessToken();
  if (!token) throw new Error('OAuth token required — please log in with Google SSO first.');

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  // 1. Get existing sheet metadata
  const metaRes = await fetch(`${base}?fields=sheets.properties`, { headers });
  if (!metaRes.ok) {
    const err = await metaRes.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to read spreadsheet metadata');
  }
  const meta = await metaRes.json();
  const existingSheets = meta.sheets?.map(s => s.properties.title) || [];

  // 2. Build batchUpdate requests to add missing tabs
  const requests = [];
  const tabsToCreate = [CONFIG.SHEET_PARTNERS, CONFIG.SHEET_OPPORTUNITIES, CONFIG.SHEET_EVENTS, CONFIG.SHEET_TRANSCRIPTS];

  for (const tabName of tabsToCreate) {
    if (!existingSheets.includes(tabName)) {
      requests.push({ addSheet: { properties: { title: tabName } } });
    }
  }

  if (requests.length > 0) {
    const batchRes = await fetch(`${base}:batchUpdate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requests }),
    });
    if (!batchRes.ok) {
      const err = await batchRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to create sheet tabs');
    }
  }

  // 3. Always overwrite header rows to keep them in sync with code schema
  for (const tabName of tabsToCreate) {
    const headerRow = SHEET_HEADERS[tabName];
    const writeUrl = `${base}/values/${encodeURIComponent(tabName)}!A1?valueInputOption=RAW`;
    await fetch(writeUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ values: [headerRow] }),
    });
  }

  return { success: true, tabsCreated: requests.length };
}

/**
 * Sync header rows in all tabs to match current code schema.
 * Overwrites row 1 in each tab. Does NOT affect data rows.
 */
export async function syncHeaders() {
  const base = getBaseUrl();
  const token = getAccessToken();
  if (!token) throw new Error('OAuth token required — please log in with Google SSO first.');

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const tabs = [CONFIG.SHEET_PARTNERS, CONFIG.SHEET_OPPORTUNITIES, CONFIG.SHEET_EVENTS, CONFIG.SHEET_TRANSCRIPTS];

  for (const tabName of tabs) {
    const headerRow = SHEET_HEADERS[tabName];
    const url = `${base}/values/${encodeURIComponent(tabName)}!A1?valueInputOption=RAW`;
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ values: [headerRow] }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to sync headers for ${tabName}`);
    }
  }

  return { success: true };
}

/**
 * Seed the Google Sheet with demo data.
 * Appends demo rows to each tab (does NOT clear existing data).
 */
export async function seedSheetData() {
  const token = getAccessToken();
  if (!token) throw new Error('OAuth token required — please log in with Google SSO first.');

  const base = getBaseUrl();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  // Skip header row (index 0) from demo arrays — headers are already written by initializeSheet
  const datasets = [
    { sheet: CONFIG.SHEET_PARTNERS, rows: demoPartners.slice(1) },
    { sheet: CONFIG.SHEET_OPPORTUNITIES, rows: demoOpportunities.slice(1) },
    { sheet: CONFIG.SHEET_EVENTS, rows: demoEvents.slice(1) },
    { sheet: CONFIG.SHEET_TRANSCRIPTS, rows: demoTranscripts.slice(1) },
  ];

  for (const { sheet, rows } of datasets) {
    if (rows.length === 0) continue;
    const url = `${base}/values/${encodeURIComponent(sheet)}:append?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ values: rows }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to seed ${sheet}`);
    }
  }

  return { success: true };
}

/**
 * Test the connection by reading spreadsheet metadata.
 */
export async function testConnection() {
  const base = getBaseUrl();
  const token = getAccessToken();
  const apiKey = getApiKey();

  let url = `${base}?fields=sheets.properties`;
  const opts = {};
  if (token) {
    opts.headers = { 'Authorization': `Bearer ${token}` };
  } else if (apiKey && apiKey !== 'YOUR_GOOGLE_API_KEY_HERE') {
    url += `&key=${apiKey}`;
  } else {
    throw new Error('No authentication available. Log in with Google SSO or set an API key.');
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Connection failed');
  }

  const data = await res.json();
  const tabs = data.sheets?.map(s => s.properties.title) || [];
  return { connected: true, tabs };
}


// ============================================
// Demo data for when Google Sheets isn't configured
// ============================================

let demoPartners = [
  ['partner_id', 'username', 'display_name', 'partner_type', 'tier', 'region', 'created_at', 'is_admin', 'password_hash', 'status', 'hq_location'],
  ['p_admin001', 'admin', 'Portal Admin', '', '', 'Global', '2026-01-01', 'TRUE', '', 'active', ''],
  ['p_elant1', 'elantis', 'Elantis', 'MSP/SI', 'Value/Preferred', 'North America', '2026-01-10', 'FALSE', '', 'active', 'Edmonton, Alberta, Canada'],
  ['p_getrb1', 'getrubix', 'GetRubix', 'MSP/SI', 'Value/Preferred', 'North America', '2026-01-15', 'FALSE', '', 'active', 'New Jersey, USA'],
  ['p_infos1', 'infosys', 'InfoSys', 'MSP/SI', 'Premier/Strategic', 'North America', '2026-01-20', 'FALSE', '', 'active', 'Bengaluru, India'],
  ['p_insigh1', 'insight', 'Insight', 'MSP/SI', 'Premier/Strategic', 'North America', '2026-02-10', 'FALSE', '', 'active', 'Chandler, Arizona, USA'],
  ['p_micro1', 'microsoft', 'Microsoft', 'OEM', 'Premier/Strategic', 'North America', '2026-02-15', 'FALSE', '', 'active', 'Redmond, Washington, USA'],
  ['p_nerdio1', 'nerdio', 'Nerdio', 'Technology', 'Premier/Strategic', 'North America', '2026-01-15', 'FALSE', '', 'active', 'Chicago, Illinois, USA'],
  ['p_qualc01', 'qualcomm', 'Qualcomm', 'Technology', 'Premier/Strategic', 'North America', '2026-03-10', 'FALSE', '', 'active', 'San Diego, California, USA'],
  ['p_ridgep1', 'ridgepoint', 'RidgePoint', 'MENA Regional Distributor', 'Value/Preferred', 'MENA', '2026-02-01', 'FALSE', '', 'active', 'Dubai, UAE'],
  ['p_syscd01', 'systemcenterdudes', 'System Center Dudes', 'MSP/SI', 'Value/Preferred', 'North America', '2026-02-20', 'FALSE', '', 'active', 'Montreal, Quebec, Canada'],
  ['p_acme01', 'acmecorp', 'Acme Corp', 'MSP/SI', 'Registered', 'North America', '2026-03-15', 'FALSE', '', 'active', 'Austin, Texas, USA'],
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
  ['opp_008', 'p_getrb1', 'DevOps Pipeline Modernization', 'Northwind Traders', '110000', 'Registered', 'Prospect', '2026-08-15', 'CI/CD pipeline modernization with GitHub Actions', '2026-04-01', '2026-04-01'],
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

let demoTranscripts = [
  ['transcript_id', 'partner_id', 'partner_name', 'conversation_date', 'transcript_text', 'created_at'],
];

// ============================================
// Demo data localStorage persistence
// ============================================

const DEMO_STORAGE_KEY = 'pp_demo_data';
const DEMO_SCHEMA_VERSION = 8; // Bump when demo data structure changes

function persistDemoData() {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({
      version: DEMO_SCHEMA_VERSION,
      partners: demoPartners,
      opportunities: demoOpportunities,
      events: demoEvents,
      transcripts: demoTranscripts,
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
    if (data.transcripts) demoTranscripts = data.transcripts;
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
    case CONFIG.SHEET_TRANSCRIPTS: return [...demoTranscripts.map(r => [...r])];
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
    case CONFIG.SHEET_TRANSCRIPTS: demoTranscripts.push(values); break;
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
    case CONFIG.SHEET_TRANSCRIPTS: data = demoTranscripts; break;
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
    case CONFIG.SHEET_TRANSCRIPTS: data = demoTranscripts; break;
    default: return;
  }
  data.splice(rowIndex - 1, 1);
  persistDemoData();
}

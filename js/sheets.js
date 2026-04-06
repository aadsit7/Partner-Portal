// ============================================
// Google Sheets API Integration
// ============================================

import { CONFIG } from './config.js';

const BASE = `${CONFIG.SHEETS_BASE_URL}/${CONFIG.SPREADSHEET_ID}`;

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

  const url = `${BASE}/values/${encodeURIComponent(sheetName)}?key=${CONFIG.API_KEY}`;
  const res = await fetch(url);

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

  const url = `${BASE}/values/${encodeURIComponent(sheetName)}:append`
    + `?valueInputOption=USER_ENTERED&key=${CONFIG.API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const url = `${BASE}/values/${encodeURIComponent(range)}`
    + `?valueInputOption=USER_ENTERED&key=${CONFIG.API_KEY}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
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
  const metaUrl = `${BASE}?key=${CONFIG.API_KEY}&fields=sheets.properties`;
  const metaRes = await fetch(metaUrl);
  const meta = await metaRes.json();
  const sheet = meta.sheets?.find(s => s.properties.title === sheetName);

  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const sheetId = sheet.properties.sheetId;
  const url = `${BASE}:batchUpdate?key=${CONFIG.API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  ['partner_id', 'username', 'display_name', 'contact_email', 'contact_phone', 'tier', 'region', 'created_at', 'is_admin', 'password_hash', 'status'],
  ['p_admin001', 'admin', 'Portal Admin', 'admin@company.com', '', 'Gold', 'Global', '2026-01-01', 'TRUE', '', 'active'],
  ['p_acme001', 'acme', 'Acme Technologies', 'john@acmetech.com', '(555) 123-4567', 'Gold', 'North America', '2026-01-15', 'FALSE', '', 'active'],
  ['p_globex01', 'globex', 'Globex Corp', 'sarah@globex.com', '(555) 987-6543', 'Silver', 'EMEA', '2026-02-01', 'FALSE', '', 'active'],
  ['p_initec1', 'initech', 'Initech Solutions', 'mike@initech.com', '(555) 456-7890', 'Bronze', 'APAC', '2026-02-20', 'FALSE', '', 'active'],
  ['p_wayne01', 'wayne', 'Wayne Enterprises', 'bruce@wayne.com', '(555) 222-3333', 'Gold', 'North America', '2026-03-01', 'FALSE', '', 'active'],
];

let demoOpportunities = [
  ['opportunity_id', 'partner_id', 'deal_name', 'customer_name', 'deal_value', 'status', 'stage', 'expected_close', 'description', 'created_at', 'updated_at'],
  ['opp_001', 'p_acme001', 'Enterprise Cloud Migration', 'TechCorp Industries', '150000', 'In Progress', 'Proposal', '2026-06-15', 'Full cloud migration for 500-seat enterprise', '2026-03-01', '2026-04-01'],
  ['opp_002', 'p_acme001', 'Security Suite Deployment', 'Metro Health Systems', '85000', 'Registered', 'Qualified', '2026-07-30', 'Security suite for healthcare provider', '2026-03-15', '2026-03-15'],
  ['opp_003', 'p_globex01', 'Data Analytics Platform', 'Global Retail Co', '200000', 'In Progress', 'Negotiation', '2026-05-20', 'Analytics platform for 200 retail locations', '2026-02-10', '2026-03-28'],
  ['opp_004', 'p_globex01', 'Network Refresh', 'EuroBank AG', '120000', 'Won', 'Closed', '2026-03-15', 'Complete network infrastructure refresh', '2026-01-20', '2026-03-15'],
  ['opp_005', 'p_initec1', 'SaaS Implementation', 'StartupXYZ', '45000', 'Registered', 'Prospect', '2026-08-01', 'SaaS platform deployment for startup', '2026-04-01', '2026-04-01'],
  ['opp_006', 'p_wayne01', 'Digital Transformation', 'City of Gotham', '350000', 'In Progress', 'Proposal', '2026-09-30', 'Full digital transformation initiative', '2026-02-15', '2026-03-20'],
  ['opp_007', 'p_wayne01', 'Cybersecurity Audit', 'Gotham PD', '75000', 'Won', 'Closed', '2026-03-01', 'Comprehensive cybersecurity assessment', '2026-01-10', '2026-03-01'],
  ['opp_008', 'p_acme001', 'Collaboration Platform', 'Sunrise Media', '60000', 'Lost', 'Closed', '2026-02-28', 'Unified communications platform', '2025-12-01', '2026-02-28'],
];

let demoEvents = [
  ['event_id', 'title', 'description', 'event_date', 'end_date', 'event_type', 'location', 'url', 'created_by', 'created_at'],
  ['evt_001', 'Q2 Partner Kickoff Webinar', 'Quarterly partner kickoff covering new products, incentive programs, and roadmap updates.', '2026-04-10', '2026-04-10', 'Webinar', 'Virtual (Zoom)', 'https://zoom.us/example', 'p_admin001', '2026-03-01'],
  ['evt_002', 'Cloud Security Workshop', 'Hands-on workshop covering cloud security best practices and our security suite.', '2026-04-22', '2026-04-23', 'Workshop', 'San Francisco, CA', '', 'p_admin001', '2026-03-01'],
  ['evt_003', 'Partner Summit 2026', 'Annual partner summit with keynotes, breakouts, and networking.', '2026-05-15', '2026-05-17', 'Conference', 'Las Vegas, NV', '', 'p_admin001', '2026-03-15'],
  ['evt_004', 'Spring Campaign Launch', 'Joint marketing campaign for spring demand generation push.', '2026-04-01', '2026-04-30', 'Campaign', 'Digital', '', 'p_admin001', '2026-03-20'],
  ['evt_005', 'Technical Certification Bootcamp', 'Two-day certification prep for partner technical staff.', '2026-05-05', '2026-05-06', 'Workshop', 'Virtual (Teams)', '', 'p_admin001', '2026-04-01'],
  ['evt_006', 'EMEA Partner Roundtable', 'Regional partner discussion on EMEA market strategy.', '2026-04-18', '2026-04-18', 'Webinar', 'Virtual (Zoom)', '', 'p_admin001', '2026-04-01'],
  ['evt_007', 'Summer Pipeline Blitz', 'Summer demand gen campaign focusing on pipeline acceleration.', '2026-06-01', '2026-06-30', 'Campaign', 'Digital', '', 'p_admin001', '2026-04-05'],
];

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
}

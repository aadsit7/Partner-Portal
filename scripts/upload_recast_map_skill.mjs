#!/usr/bin/env node
// ============================================================
// Recast MAP PDF skill uploader
// ============================================================
// Run once after cloning (or whenever SKILL.md / reference_map_pdf.py /
// example_output_reference.md changes):
//
//   export ANTHROPIC_API_KEY=sk-ant-...
//   node scripts/upload_recast_map_skill.mjs
//
// Behavior:
//   * First run  → creates the skill, writes skill_id to skills/.skill_id
//   * Subsequent → publishes a new version of the same skill
//
// The printed skill_id goes into js/config/skill_config.js (the script
// prints a copy-paste-ready line at the end).
//
// Safety:
//   * Never logs the API key.
//   * skills/.skill_id is gitignored.
// ============================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ───────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SKILL_DIR = resolve(
  REPO_ROOT,
  process.env.RECAST_MAP_SKILL_PATH || './skills/recast-map-pdf'
);
const SKILL_ID_FILE = resolve(REPO_ROOT, './skills/.skill_id');
const SKILL_FILES = ['SKILL.md', 'reference_map_pdf.py', 'example_output_reference.md'];

const BETA_HEADER = 'skills-2025-10-02';
const DISPLAY_TITLE = 'Recast MAP PDF';

// ── Pretty logging ──────────────────────────────────────────
function log(msg)  { console.log(`[upload-skill] ${msg}`); }
function fail(msg) { console.error(`[upload-skill] ERROR: ${msg}`); process.exit(1); }

// ── Guardrails ──────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  fail('ANTHROPIC_API_KEY is not set. Run: export ANTHROPIC_API_KEY=sk-ant-...');
}

async function pathExists(p) {
  try { await access(p, fsConstants.F_OK); return true; } catch { return false; }
}

// ── Load SDK (deferred so the missing-dep error is friendly) ─
let Anthropic;
try {
  ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
} catch (err) {
  fail(
    '@anthropic-ai/sdk is not installed. Run: npm install\n' +
    `(underlying error: ${err?.message || err})`
  );
}

// ── Locate and read skill files ─────────────────────────────
if (!(await pathExists(SKILL_DIR))) {
  fail(`Skill folder not found at ${SKILL_DIR}`);
}

log(`Reading skill files from ${SKILL_DIR}`);
const fileEntries = [];
for (const name of SKILL_FILES) {
  const full = join(SKILL_DIR, name);
  if (!(await pathExists(full))) {
    fail(`Expected skill file is missing: ${full}`);
  }
  const buf = await readFile(full);
  fileEntries.push({ name, buf });
  log(`  • ${name} (${buf.length} bytes)`);
}

// The SDK's beta.skills endpoints accept the same multipart file shape that
// the rest of the Files API uses. We pass each entry as a File-like object
// via the SDK's toFile helper so the SDK handles streaming correctly.
let toFile;
try {
  ({ toFile } = await import('@anthropic-ai/sdk'));
} catch {
  // Older SDK shapes expose it differently; try the default export.
  toFile = Anthropic.toFile;
}
if (typeof toFile !== 'function') {
  fail('Your @anthropic-ai/sdk version is missing toFile(). Try: npm install @anthropic-ai/sdk@latest');
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

if (!client?.beta?.skills?.create || !client?.beta?.skills?.versions?.create) {
  fail(
    'Your @anthropic-ai/sdk version does not expose client.beta.skills.* — ' +
    'upgrade with: npm install @anthropic-ai/sdk@latest'
  );
}

const files = await Promise.all(
  fileEntries.map(({ name, buf }) => toFile(buf, name))
);

// ── Decide: create new, or publish new version? ─────────────
const hasExistingId = await pathExists(SKILL_ID_FILE);

try {
  if (!hasExistingId) {
    log('No existing skill ID found — creating a new skill.');
    const skill = await client.beta.skills.create(
      { display_title: DISPLAY_TITLE, files },
      { headers: { 'anthropic-beta': BETA_HEADER } }
    );
    if (!skill?.id) fail('API did not return a skill.id — payload was: ' + JSON.stringify(skill));
    await writeFile(SKILL_ID_FILE, skill.id + '\n', 'utf8');
    log(`Created skill: ${skill.id}`);
    log(`Wrote skill ID to ${SKILL_ID_FILE} (gitignored)`);
    console.log('');
    console.log('============================================================');
    console.log(`Paste this into js/config/skill_config.js: RECAST_MAP_SKILL_ID = '${skill.id}'`);
    console.log('============================================================');
  } else {
    const skillId = (await readFile(SKILL_ID_FILE, 'utf8')).trim();
    if (!skillId) fail(`${SKILL_ID_FILE} exists but is empty.`);
    log(`Existing skill ID: ${skillId}`);
    log('Publishing a new version…');
    const version = await client.beta.skills.versions.create(
      skillId,
      { files },
      { headers: { 'anthropic-beta': BETA_HEADER } }
    );
    log(`Published new version: ${version?.version || '(version field missing)'}`);
    console.log('');
    console.log('============================================================');
    console.log(`Skill ID unchanged — js/config/skill_config.js already points at '${skillId}'`);
    console.log('============================================================');
  }
} catch (err) {
  // Scrub anything that looks like an api key out of the error text before
  // printing, as a belt-and-braces guard.
  const raw = (err?.message || String(err));
  const safe = raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***REDACTED***');
  fail(`API call failed: ${safe}`);
}

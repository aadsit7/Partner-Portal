// Verifies requestMapPdfJson() in js/utils/ai.js — correct request
// shape, permissive JSON parsing, clear errors on malformed responses.
import './_setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage.setItem('pp_runtime_config', JSON.stringify({ ANTHROPIC_API_KEY: 'sk-ant-test-key' }));

const { requestMapPdfJson, __mapJsonInternals } = await import('../js/utils/ai.js');
const { buildMapJsonPrompt, parseMapJsonResponse } = __mapJsonInternals;

const VALID_JSON_OBJ = {
  customer_name: 'Example Customer',
  document_date: 'April 22, 2026',
  meeting_recap: [
    { label: 'Aligned on scope',   detail: 'Confirmed POC covers Dev, Test, and Prod environments' },
    { label: 'Cadence established', detail: 'Biweekly work-back sessions starting April 2' },
  ],
  current_environment: {
    infrastructure: [
      { name: 'Citrix XenApp',  subline: '~900 daily users' },
      { name: 'SCCM / ConfigMgr', subline: '' },
    ],
    current_state_pain: ['Thing 2'],
    stakeholders_and_decision_process: ['Thing 3'],
  },
  mutual_action_plan: [
    { phase: 'Discovery', action: 'x', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
  ],
};
const VALID_JSON_STR = JSON.stringify(VALID_JSON_OBJ);

// Legacy fixture — flat-string meeting_recap and infrastructure — used
// to exercise the parser's backwards-compat conversion path.
const LEGACY_JSON_OBJ = {
  customer_name: 'Legacy Customer',
  document_date: 'April 22, 2026',
  meeting_recap: ['Aligned on scope', 'Agreed on cadence'],
  current_environment: {
    infrastructure: ['Citrix XenApp', 'SCCM'],
    current_state_pain: ['Packaging overhead'],
    stakeholders_and_decision_process: ['Sponsor: VP EUC'],
  },
  mutual_action_plan: [
    { phase: 'Discovery', action: 'x', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
  ],
};

function messagesResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
    }),
  };
}

test('builds correct request — headers, model, max_tokens, no Skills betas', async () => {
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return messagesResponse(VALID_JSON_STR);
  };

  const out = await requestMapPdfJson(
    { name: 'ANICO', customerName: 'ANICO', dealName: 'ANICO MAP' },
    [{ date: '2026-04-15', content: 'Q2 discovery call.' }],
  );

  assert.ok(captured.url.endsWith('/v1/messages'));
  const h = captured.opts.headers;
  assert.equal(h['x-api-key'], 'sk-ant-test-key');
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  // Critically NOT a Skills + code-execution call.
  assert.ok(!h['anthropic-beta'] || !/code-execution|skills-2025/.test(h['anthropic-beta']),
    'request must not include Skills or code_execution betas');

  const body = JSON.parse(captured.opts.body);
  assert.equal(body.model, 'claude-opus-4-7');
  assert.ok(typeof body.max_tokens === 'number' && body.max_tokens >= 2048);
  assert.ok(!body.tools, 'no tools in the new flow');
  assert.ok(!body.container, 'no container in the new flow');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.match(body.messages[0].content, /ANICO/);
  assert.match(body.messages[0].content, /2026-04-15/);
  assert.match(body.messages[0].content, /Q2 discovery call/);
  // Schema guidance must be present in the prompt.
  assert.match(body.messages[0].content, /mutual_action_plan/);
  assert.match(body.messages[0].content, /Return ONLY a single valid JSON object/);

  // Return shape
  assert.equal(out.customer_name, 'Example Customer');
  assert.ok(Array.isArray(out.mutual_action_plan));
});

test('parses JSON wrapped in ```json fences', async () => {
  globalThis.fetch = async () => messagesResponse(`\`\`\`json\n${VALID_JSON_STR}\n\`\`\``);
  const out = await requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]);
  assert.equal(out.customer_name, 'Example Customer');
});

test('parses JSON wrapped in bare ``` fences', async () => {
  globalThis.fetch = async () => messagesResponse(`\`\`\`\n${VALID_JSON_STR}\n\`\`\``);
  const out = await requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]);
  assert.equal(out.customer_name, 'Example Customer');
});

test('parses JSON with leading/trailing prose', async () => {
  const wrapped = `Here you go:\n\n${VALID_JSON_STR}\n\nLet me know if you need more.`;
  globalThis.fetch = async () => messagesResponse(wrapped);
  const out = await requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]);
  assert.equal(out.customer_name, 'Example Customer');
});

test('throws MAP_JSON_INVALID on garbage text response', async () => {
  globalThis.fetch = async () => messagesResponse('totally not JSON, just a paragraph.');
  await assert.rejects(
    () => requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]),
    (err) => err.code === 'MAP_JSON_INVALID',
  );
});

test('throws MAP_JSON_EMPTY on empty text response', async () => {
  globalThis.fetch = async () => messagesResponse('');
  await assert.rejects(
    () => requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]),
    (err) => err.code === 'MAP_JSON_EMPTY',
  );
});

test('throws MAP_JSON_SCHEMA when required fields missing', async () => {
  // V1.6: only customer_name (non-empty) and meeting_recap (>= 1 entry)
  // are hard-required. Everything else is allowed to be empty. So the
  // failing case now trips on meeting_recap, not mutual_action_plan.
  const bad = JSON.stringify({ customer_name: 'X' });
  globalThis.fetch = async () => messagesResponse(bad);
  await assert.rejects(
    () => requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]),
    (err) => err.code === 'MAP_JSON_SCHEMA' && /meeting_recap/.test(err.message),
  );
});

test('throws MAP_JSON_API_ERROR on 401', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'authentication_error' } }),
  });
  await assert.rejects(
    () => requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]),
    (err) => err.code === 'MAP_JSON_API_ERROR' && err.status === 401,
  );
});

test('parseMapJsonResponse is permissive (unit)', () => {
  const parsed = parseMapJsonResponse('  \n```json\n' + VALID_JSON_STR + '\n```  ');
  assert.equal(parsed.customer_name, 'Example Customer');
});

test('buildMapJsonPrompt includes prior entries as compact bullets', () => {
  const prompt = buildMapJsonPrompt(
    { name: 'ANICO', dealName: 'ANICO Deal', stage: 'Proposal' },
    [
      { date: '2026-04-15', content: 'Latest call.' },
      { date: '2026-04-01', content: 'Earlier call.' },
    ],
  );
  assert.match(prompt, /ANICO/);
  assert.match(prompt, /Latest call/);
  assert.match(prompt, /Earlier call/);
  assert.match(prompt, /Stage: Proposal/);
});

// ── V1.1 schema: meeting_recap and infrastructure shape changes ──

test('parseMapJsonResponse accepts the new {label, detail} meeting_recap shape', () => {
  const parsed = parseMapJsonResponse(JSON.stringify(VALID_JSON_OBJ));
  assert.equal(parsed.meeting_recap.length, 2);
  assert.equal(parsed.meeting_recap[0].label, 'Aligned on scope');
  assert.equal(parsed.meeting_recap[0].detail, 'Confirmed POC covers Dev, Test, and Prod environments');
  assert.equal(parsed.meeting_recap[1].label, 'Cadence established');
});

test('parseMapJsonResponse converts legacy flat-string meeting_recap to {label, detail}', () => {
  const parsed = parseMapJsonResponse(JSON.stringify(LEGACY_JSON_OBJ));
  assert.equal(parsed.meeting_recap.length, 2);
  // Each legacy string → { label: '', detail: <string> }
  for (const e of parsed.meeting_recap) {
    assert.equal(e.label, '');
    assert.ok(typeof e.detail === 'string' && e.detail.length > 0);
  }
  assert.equal(parsed.meeting_recap[0].detail, 'Aligned on scope');
});

test('parseMapJsonResponse accepts the new {name, subline} infrastructure shape', () => {
  const parsed = parseMapJsonResponse(JSON.stringify(VALID_JSON_OBJ));
  const infra = parsed.current_environment.infrastructure;
  assert.equal(infra.length, 2);
  assert.equal(infra[0].name, 'Citrix XenApp');
  assert.equal(infra[0].subline, '~900 daily users');
  // Empty subline should be preserved (renderer hides it).
  assert.equal(infra[1].name, 'SCCM / ConfigMgr');
  assert.equal(infra[1].subline, '');
});

test('parseMapJsonResponse converts legacy flat-string infrastructure to {name, subline}', () => {
  const parsed = parseMapJsonResponse(JSON.stringify(LEGACY_JSON_OBJ));
  const infra = parsed.current_environment.infrastructure;
  assert.equal(infra.length, 2);
  for (const e of infra) {
    assert.equal(e.subline, '');
    assert.ok(typeof e.name === 'string' && e.name.length > 0);
  }
  assert.equal(infra[0].name, 'Citrix XenApp');
});

// ── V1.6: parser accepts empty arrays and strings as valid ──

test('V1.6 parseMapJsonResponse accepts empty arrays for optional sections', () => {
  const thin = {
    customer_name: 'Thin Customer',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Met', detail: 'Short intro call' }],
    current_environment: {
      infrastructure: [],
      current_state_pain: [],
      stakeholders_and_decision_process: [],
    },
    end_users_personas: [],
    what_changes: '',
    mutual_action_plan: [],
  };
  const parsed = parseMapJsonResponse(JSON.stringify(thin));
  assert.equal(parsed.customer_name, 'Thin Customer');
  assert.deepEqual(parsed.current_environment.infrastructure, []);
  assert.deepEqual(parsed.current_environment.current_state_pain, []);
  assert.deepEqual(parsed.current_environment.stakeholders_and_decision_process, []);
  assert.deepEqual(parsed.end_users_personas, []);
  assert.equal(parsed.what_changes, '');
  assert.deepEqual(parsed.mutual_action_plan, []);
});

test('V1.6 parseMapJsonResponse accepts a missing current_environment entirely', () => {
  const thin = {
    customer_name: 'Thin Customer',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'Met', detail: 'Short call' }],
    // current_environment, end_users_personas, what_changes, mutual_action_plan all omitted
  };
  const parsed = parseMapJsonResponse(JSON.stringify(thin));
  assert.deepEqual(parsed.current_environment.infrastructure, []);
  assert.deepEqual(parsed.current_environment.current_state_pain, []);
  assert.deepEqual(parsed.current_environment.stakeholders_and_decision_process, []);
  assert.deepEqual(parsed.end_users_personas, []);
  assert.equal(parsed.what_changes, '');
  assert.deepEqual(parsed.mutual_action_plan, []);
});

test('V1.6 parseMapJsonResponse still hard-fails when meeting_recap is empty', () => {
  const bad = {
    customer_name: 'X',
    document_date: 'April 22, 2026',
    meeting_recap: [],  // <-- empty = generation failure, not a thin source
  };
  assert.throws(
    () => parseMapJsonResponse(JSON.stringify(bad)),
    (err) => err.code === 'MAP_JSON_SCHEMA' && /meeting_recap/.test(err.message),
  );
});

test('V1.6 parseMapJsonResponse still hard-fails when customer_name is missing/empty', () => {
  const bad = {
    customer_name: '',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'x', detail: 'y' }],
  };
  assert.throws(
    () => parseMapJsonResponse(JSON.stringify(bad)),
    (err) => err.code === 'MAP_JSON_SCHEMA' && /customer_name/.test(err.message),
  );
});

test('V1.6 parseMapJsonResponse computes meta.sections_rendered for thin source', () => {
  const thin = {
    customer_name: 'Thin',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'x', detail: 'y' }],
  };
  const parsed = parseMapJsonResponse(JSON.stringify(thin));
  const m = parsed.meta.sections_rendered;
  assert.equal(m.recap, true, 'recap always true');
  assert.equal(m.infrastructure, false);
  assert.equal(m.pain, false);
  assert.equal(m.stakeholders, false);
  assert.equal(m.environment, false);
  assert.equal(m.map_table, false);
  assert.equal(m.architecture_page, false);
  assert.equal(m.personas, false);
  assert.equal(m.what_changes, false);
});

test('V1.6 parseMapJsonResponse computes meta.sections_rendered for full source', () => {
  const full = {
    customer_name: 'Full',
    document_date: 'April 22, 2026',
    meeting_recap: [{ label: 'x', detail: 'y' }],
    current_environment: {
      infrastructure: [{ name: 'Citrix', subline: '' }],
      current_state_pain: ['p'],
      stakeholders_and_decision_process: ['s'],
    },
    end_users_personas: [{ label: 'A', subline: '' }],
    what_changes: 'Outcome summary.',
    mutual_action_plan: [{ phase: 'Discovery', action: 'x', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' }],
  };
  const parsed = parseMapJsonResponse(JSON.stringify(full));
  const m = parsed.meta.sections_rendered;
  assert.equal(m.infrastructure, true);
  assert.equal(m.pain, true);
  assert.equal(m.stakeholders, true);
  assert.equal(m.environment, true);
  assert.equal(m.map_table, true);
  assert.equal(m.architecture_page, true);
  assert.equal(m.personas, true);
  assert.equal(m.what_changes, true);
});

test('buildMapJsonPrompt includes the Golden Rule grounding language', () => {
  const prompt = buildMapJsonPrompt(
    { name: 'ANICO' },
    [{ date: '2026-04-15', content: 'Discovery call.' }],
  );
  // V1.6 replaced the older "GROUNDING RULES" footer with a top-level
  // "GOLDEN RULE" block — the strictest grounding language the prompt
  // has ever carried. Every downstream assertion hangs off this.
  assert.match(prompt, /GOLDEN RULE/);
  assert.match(prompt, /traceable to a specific phrase or sentence/i);
  assert.match(prompt, /shorter, accurate MAP is ALWAYS better/i);
  assert.match(prompt, /EMPTY ARRAYS for sections/i);
  // The new shape rules are also spelled out.
  assert.match(prompt, /\{label, detail\}/);
  assert.match(prompt, /\{name, subline\}/);
});

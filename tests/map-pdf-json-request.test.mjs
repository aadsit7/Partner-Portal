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
  meeting_recap: ['Aligned on scope', 'Agreed on cadence'],
  current_environment: {
    infrastructure: ['Thing 1'],
    current_state_pain: ['Thing 2'],
    stakeholders_and_decision_process: ['Thing 3'],
  },
  mutual_action_plan: [
    { phase: 'Discovery', action: 'x', owner: 'Recast', due_date: '2026-05-01', status: 'Complete' },
  ],
};
const VALID_JSON_STR = JSON.stringify(VALID_JSON_OBJ);

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
  const bad = JSON.stringify({ customer_name: 'X' });  // missing everything else
  globalThis.fetch = async () => messagesResponse(bad);
  await assert.rejects(
    () => requestMapPdfJson({ name: 'X' }, [{ date: '2026-04-15', content: 'x' }]),
    (err) => err.code === 'MAP_JSON_SCHEMA' && /mutual_action_plan/.test(err.message),
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

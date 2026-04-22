// Verifies that callClaudePdfGeneration() builds a request with the
// exact headers, container.skills, and tools array that the Anthropic
// skills + code_execution beta expects. We stub fetch so no live API
// call happens.
import './_setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set the runtime API key before importing ai.js so requireApiKey()
// doesn't throw. getRuntimeConfig reads from localStorage.
globalThis.localStorage.setItem('pp_runtime_config', JSON.stringify({ ANTHROPIC_API_KEY: 'sk-ant-test-key' }));

const { callClaudePdfGeneration } = await import('../js/utils/ai.js');

function makeSuccessfulMessagesResponse({ fileId = 'file_abc', filename = 'map.pdf' } = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      id: 'msg_test',
      type: 'message',
      stop_reason: 'end_turn',
      container: { id: 'container_xyz' },
      content: [
        { type: 'text', text: 'Here is your PDF.' },
        {
          type: 'code_execution_tool_result',
          content: [
            { type: 'code_execution_output_file', file_id: fileId, filename },
          ],
        },
      ],
    }),
  };
}

function makeFileDownloadResponse() {
  return {
    ok: true,
    status: 200,
    blob: async () => ({ size: 1234, type: 'application/pdf', __isStubBlob: true }),
  };
}

test('builds correct request: headers, container.skills, tools', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/v1/messages')) return makeSuccessfulMessagesResponse();
    if (url.includes('/v1/files/')) return makeFileDownloadResponse();
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const out = await callClaudePdfGeneration({
    skillId: 'skill_test_123',
    opportunityName: 'ANICO',
    descriptionText: 'Q2 discovery call. Next steps: send proposal.',
    descriptionDate: '2026-04-15',
    priorDescriptions: [
      { date: '2026-04-01', text: 'Initial call.' },
    ],
  });

  // Find the /v1/messages call
  const messagesCall = calls.find(c => c.url.includes('/v1/messages'));
  assert.ok(messagesCall, 'expected a /v1/messages fetch call');

  // Headers
  const h = messagesCall.opts.headers;
  assert.equal(h['x-api-key'], 'sk-ant-test-key');
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  const beta = h['anthropic-beta'] || '';
  assert.ok(beta.includes('code-execution-2025-08-25'), 'beta header must include code-execution');
  assert.ok(beta.includes('skills-2025-10-02'),          'beta header must include skills');
  assert.ok(beta.includes('files-api-2025-04-14'),       'beta header must include files-api');

  // Body
  const body = JSON.parse(messagesCall.opts.body);
  assert.equal(body.model, 'claude-opus-4-7');
  assert.equal(typeof body.max_tokens, 'number');
  assert.ok(body.max_tokens >= 4096);

  // container.skills exactly the two we expect
  assert.ok(body.container, 'container should exist');
  assert.ok(Array.isArray(body.container.skills), 'container.skills should be an array');
  assert.equal(body.container.skills.length, 2);
  assert.deepEqual(body.container.skills[0], { type: 'custom',    skill_id: 'skill_test_123', version: 'latest' });
  assert.deepEqual(body.container.skills[1], { type: 'anthropic', skill_id: 'pdf',             version: 'latest' });

  // tools array: exactly one code_execution_20250825 tool
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].type, 'code_execution_20250825');
  assert.equal(body.tools[0].name, 'code_execution');

  // messages: one user turn whose text mentions the opportunity name
  // and both current + prior descriptions
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  const userText = body.messages[0].content;
  assert.ok(userText.includes('ANICO'));
  assert.ok(userText.includes('2026-04-15'));
  assert.ok(userText.includes('Q2 discovery call'));
  assert.ok(userText.includes('Initial call.'), 'prior description should be included');

  // Files fetch used correct URL + auth
  const fileCall = calls.find(c => c.url.includes('/v1/files/'));
  assert.ok(fileCall, 'expected a /v1/files/{id}/content fetch call');
  assert.ok(fileCall.url.includes('file_abc'));
  assert.equal(fileCall.opts.headers['x-api-key'], 'sk-ant-test-key');

  // Return shape
  assert.ok(out.pdfBlob);
  assert.ok(/\.pdf$/i.test(out.filename));
});

test('throws MAP_SKILL_NOT_CONFIGURED when skillId is the placeholder', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  await assert.rejects(
    () => callClaudePdfGeneration({
      skillId: 'PASTE_SKILL_ID_HERE',
      opportunityName: 'ANICO',
      descriptionText: 'x',
      descriptionDate: '2026-04-15',
    }),
    /MAP skill not configured/
  );
});

test('follows a pause_turn hop, reusing container.id', async () => {
  let hop = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.includes('/v1/files/')) return makeFileDownloadResponse();
    hop++;
    if (hop === 1) {
      // First hop: pause_turn, returns container.id
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'pause_turn',
          container: { id: 'container_abc' },
          content: [{ type: 'text', text: 'working…' }],
        }),
      };
    }
    // Second hop: assert the outgoing body reuses container.id and
    // includes the prior assistant turn in messages.
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.container, { id: 'container_abc' },
      'second hop must reuse the container id instead of re-sending skills');
    assert.equal(body.messages.length, 2,
      'second hop must carry the assistant turn from hop 1');
    assert.equal(body.messages[1].role, 'assistant');
    return makeSuccessfulMessagesResponse();
  };

  const out = await callClaudePdfGeneration({
    skillId: 'skill_test_123',
    opportunityName: 'TestCo',
    descriptionText: 'content',
    descriptionDate: '2026-04-20',
  });
  assert.ok(out.pdfBlob);
});

test('maps 400 skill error to MAP_SKILL_ERROR code', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'skill not found' } }),
  });
  await assert.rejects(
    () => callClaudePdfGeneration({
      skillId: 'skill_test_bad',
      opportunityName: 'X',
      descriptionText: 'x',
      descriptionDate: '2026-04-01',
    }),
    (err) => err.code === 'MAP_SKILL_ERROR' && err.status === 400,
  );
});

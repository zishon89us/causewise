// Exercises the Claude adapter through the real SDK against a local stand-in
// for POST /v1/messages. It checks the request the adapter builds and how it
// reads responses. It cannot check that the live API accepts the request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ClaudeClient, estimateCostUsd } from '../src/llm-claude.ts';

const requests: Array<{ url: string; headers: Record<string, unknown>; body: any }> = [];
let responses: any[] = [];
let server: Server;
let baseURL: string;

const message = (content: unknown[], stop_reason: string, model = 'claude-opus-5-5') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model, content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 300 },
});

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responses.shift()));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const TOOLS = [
  { name: 'items', description: 'List metrics', input_schema: { type: 'object' as const, properties: { host: { type: 'string' } }, required: ['host'], additionalProperties: false } },
  { name: 'submit', description: 'Finish', strict: true, input_schema: { type: 'object' as const, properties: {}, required: [], additionalProperties: false } },
];
const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };
const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'items', input: { host: 'db-01' } };

test('a tool-calling conversation is built and read correctly', async () => {
  requests.length = 0;
  responses = [message([thinking, { type: 'text', text: 'Checking the database.' }, toolUse], 'tool_use'), message([{ type: 'text', text: 'Done.' }], 'end_turn')];
  const session = new ClaudeClient({ apiKey: 'test-key', baseURL, model: 'claude-opus-5-5', effort: 'medium' }).session({ system: 'SYSTEM', tools: TOOLS });

  const first = await session.start('Incident INC-1');
  assert.deepEqual(first.toolCalls, [{ id: 'toolu_1', name: 'items', input: { host: 'db-01' } }]);
  assert.deepEqual([first.stop, first.text, first.model], ['tool_use', 'Checking the database.', 'claude-opus-5-5']);
  assert.deepEqual(first.usage, { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900, cacheWriteTokens: 300 });

  const second = await session.reply([{ id: 'toolu_1', content: '[query 4]\n...' }], 'Budget used up.');
  assert.deepEqual([second.stop, second.toolCalls.length], ['end', 0]);

  const [a, b] = requests;
  assert.match(a!.url, /^\/v1\/messages/);
  assert.equal(a!.headers.authorization, 'Bearer test-key', 'SDK 1.x sends the key as a bearer token');
  assert.match(String(a!.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.deepEqual(
    { model: a!.body.model, max_tokens: a!.body.max_tokens, system: a!.body.system, thinking: a!.body.thinking, output_config: a!.body.output_config, fallbacks: a!.body.fallbacks, cache_control: a!.body.cache_control, tool_choice: a!.body.tool_choice },
    { model: 'claude-opus-5-5', max_tokens: 16000, system: 'SYSTEM', thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, fallbacks: 'default', cache_control: { type: 'ephemeral' }, tool_choice: undefined },
  );
  for (const forbidden of ['temperature', 'top_p', 'top_k']) assert.ok(!(forbidden in a!.body), `${forbidden} must not be sent`);
  assert.deepEqual(a!.body.tools.map((t: any) => [t.name, t.strict]), [['items', undefined], ['submit', true]]);
  assert.deepEqual(a!.body.messages, [{ role: 'user', content: 'Incident INC-1' }]);

  // The assistant turn is replayed exactly as received, thinking block included.
  assert.deepEqual(b!.body.messages[1], { role: 'assistant', content: [thinking, { type: 'text', text: 'Checking the database.' }, toolUse] });
  assert.deepEqual(b!.body.messages[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[query 4]\n...' }, { type: 'text', text: 'Budget used up.' }],
  });
});

test('a failed tool result is marked as an error', async () => {
  requests.length = 0;
  responses = [message([toolUse], 'tool_use'), message([], 'end_turn')];
  const session = new ClaudeClient({ apiKey: 'k', baseURL, model: 'claude-opus-5-5', effort: 'low' }).session({ system: 'S', tools: TOOLS });
  await session.start('x');
  await session.reply([{ id: 'toolu_1', content: 'no such host', isError: true }]);
  assert.deepEqual(requests[1]!.body.messages[2].content, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'no such host', is_error: true }]);
});

test('tool calls in a refused or cut-off turn are not passed on', async () => {
  for (const [reason, stop] of [['refusal', 'refusal'], ['max_tokens', 'max_tokens'], ['pause_turn', 'other']] as const) {
    responses = [message([toolUse], reason)];
    const turn = await new ClaudeClient({ apiKey: 'k', baseURL, model: 'claude-opus-5-5', effort: 'low' }).session({ system: 'S', tools: TOOLS }).start('x');
    assert.deepEqual([turn.stop, turn.toolCalls.length], [stop, 0]);
  }
});

test('the model that served the turn is reported, so a fallback shows', async () => {
  responses = [message([{ type: 'text', text: 'ok' }], 'end_turn', 'claude-opus-4-8')];
  const turn = await new ClaudeClient({ apiKey: 'k', baseURL, model: 'claude-opus-5-5', effort: 'low' }).session({ system: 'S', tools: TOOLS }).start('x');
  assert.equal(turn.model, 'claude-opus-4-8');
});

test('cost is estimated from usage, and unknown models have no estimate', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 400_000 };
  assert.equal(estimateCostUsd('claude-opus-5-5', usage), 4 + 2 + 0.4 + 2);
  assert.equal(estimateCostUsd('some-other-model', usage), null);
});

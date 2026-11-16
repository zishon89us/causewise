import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MethodNotAllowedError, READ_METHODS, ZabbixApiError, ZabbixClient, type ReadMethod } from '../src/zabbix/client.ts';
import { fakeZabbix } from './fake-zabbix.ts';

const empty = { hosts: [], items: [], history: [], events: [] };
const client = (fetch: typeof globalThis.fetch, extra = {}) =>
  new ZabbixClient({ url: 'http://zabbix.test/api_jsonrpc.php', token: 'tok', minIntervalMs: 0, fetch, ...extra });

test('every allowed method is a read: it ends in .get', () => {
  for (const m of READ_METHODS) assert.match(m, /^[a-z]+\.get$/);
});

for (const method of ['host.update', 'host.delete', 'history.push', 'event.acknowledge', 'user.get', 'script.execute', 'configuration.import']) {
  test(`${method} is refused before any request is made`, async () => {
    const { fetch, calls } = fakeZabbix(empty);
    await assert.rejects(client(fetch).call(method as ReadMethod), MethodNotAllowedError);
    assert.equal(calls.length, 0);
  });
}

test('a call sends the token as a bearer header and returns the result', async () => {
  const { fetch, calls } = fakeZabbix({ ...empty, hosts: [{ host: 'web-01' }] });
  const rows = await client(fetch).call<Array<{ host: string }>>('host.get', {});
  assert.equal(rows[0]?.host, 'web-01');
  assert.equal(calls[0]?.authorization, 'Bearer tok');
});

test('an API error becomes a ZabbixApiError naming the method', async () => {
  const fetch = (async () => new Response(JSON.stringify({ error: { message: 'Invalid params.', data: 'bad' } }))) as typeof globalThis.fetch;
  await assert.rejects(client(fetch).call('host.get'), (e: Error) => e instanceof ZabbixApiError && /host\.get: Invalid params\. bad/.test(e.message));
});

test('an HTTP failure and a network failure are both reported, without the token', async () => {
  const http500 = (async () => new Response('oops', { status: 500 })) as typeof globalThis.fetch;
  await assert.rejects(client(http500).call('host.get'), /HTTP 500/);
  const down = (async () => { throw new Error('connect ECONNREFUSED'); }) as typeof globalThis.fetch;
  await assert.rejects(client(down).call('host.get'), (e: Error) => /ECONNREFUSED/.test(e.message) && !e.message.includes('tok'));
});

test('requests are spaced by the minimum interval, even when issued together', async () => {
  let clock = 0;
  const sent: number[] = [];
  const fetch = (async () => { sent.push(clock); return new Response(JSON.stringify({ result: [] })); }) as typeof globalThis.fetch;
  const c = client(fetch, { minIntervalMs: 500, now: () => clock, sleep: async (ms: number) => { clock += ms; } });
  await Promise.all([c.call('host.get'), c.call('host.get'), c.call('host.get')]);
  assert.deepEqual(sent, [0, 500, 1000]);
});

test('one failed request does not block the next', async () => {
  let n = 0;
  const fetch = (async () => (++n === 1 ? new Response('x', { status: 502 }) : new Response(JSON.stringify({ result: [1] })))) as typeof globalThis.fetch;
  const c = client(fetch);
  await assert.rejects(c.call('host.get'));
  assert.deepEqual(await c.call('host.get'), [1]);
});

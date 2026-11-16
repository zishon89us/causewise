import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Store } from '../src/store.ts';
import { IncidentFormer } from '../src/incidents.ts';
import { createReceiver } from '../src/server.ts';

const SECRET = 'a-secret-of-sixteen-chars';
const payload = {
  event_id: '1042', event_value: '1', event_update_status: '0', event_name: 'Slow HTTP response',
  severity: '3', host: 'web-01', trigger_id: '77', tags: '[]',
};

let server: Server;
let store: Store;
let url: string;
const logs: Record<string, unknown>[] = [];

before(async () => {
  store = new Store(':memory:');
  const former = new IncidentFormer(store, { settleSeconds: 90, quietSeconds: 600 });
  server = createReceiver({ former, webhookSecret: SECRET, now: () => 1000, log: (e) => logs.push(e) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  store.close();
});

const post = (body: string, secret: string | null = SECRET, path = '/v1/alerts') =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret === null ? {} : { 'X-Causewise-Secret': secret }) },
    body,
  });

test('health check needs no secret', async () => {
  const res = await fetch(`${url}/healthz`);
  assert.equal(res.status, 200);
});

test('a request without the secret, or with a wrong one, is refused and stores nothing', async () => {
  assert.equal((await post(JSON.stringify(payload), null)).status, 401);
  assert.equal((await post(JSON.stringify(payload), 'wrong-secret-wrong-secret')).status, 401);
  assert.equal(store.incidents().length, 0);
});

test('a valid alert is accepted, and a repeat is a duplicate', async () => {
  const first = await post(JSON.stringify(payload));
  assert.deepEqual([first.status, await first.json()], [200, { status: 'accepted' }]);
  const again = await post(JSON.stringify(payload));
  assert.deepEqual(await again.json(), { status: 'duplicate' });
  assert.equal(store.alerts(1).length, 1);
});

test('invalid JSON and invalid payloads get 400 with a reason', async () => {
  assert.equal((await post('{not json')).status, 400);
  const res = await post(JSON.stringify({ ...payload, severity: '9' }));
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /severity/);
});

test('an oversized body gets 413', async () => {
  const res = await post(JSON.stringify({ ...payload, event_name: 'x'.repeat(70_000) }));
  assert.equal(res.status, 413);
});

test('unknown paths and methods are refused', async () => {
  assert.equal((await post('{}', SECRET, '/v2/other')).status, 404);
  assert.equal((await fetch(`${url}/v1/alerts`)).status, 405);
});

test('the secret never appears in logs', () => {
  assert.ok(!JSON.stringify(logs).includes(SECRET));
});

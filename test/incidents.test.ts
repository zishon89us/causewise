import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { IncidentFormer } from '../src/incidents.ts';
import type { Alert } from '../src/alert.ts';

const problem = (eventId: string, host = 'web-01'): Alert => ({
  eventId, kind: 'problem', name: 'Slow HTTP response', severity: 3, host, triggerId: '1', tags: [],
});
const recovery = (eventId: string): Alert => ({ ...problem(eventId), kind: 'recovery' });

function setup(settleSeconds = 90, quietSeconds = 600) {
  const store = new Store(':memory:');
  const ready: number[] = [];
  const closed: number[] = [];
  const former = new IncidentFormer(store, {
    settleSeconds, quietSeconds,
    onReady: (i) => ready.push(i.id),
    onClosed: (i) => closed.push(i.id),
  });
  return { store, former, ready, closed };
}

test('a burst of alerts becomes one incident, ready once after the settle window', () => {
  const { store, former, ready } = setup();
  for (let i = 0; i < 40; i++) assert.equal(former.handle(problem(String(100 + i), `host-${i}`), 1000 + i), 'accepted');
  assert.equal(store.incidents().length, 1);

  former.tick(1089);
  assert.deepEqual(ready, [], 'not ready before the window closes');
  former.tick(1090);
  former.tick(1091);
  assert.deepEqual(ready, [1], 'ready exactly once');
  assert.equal(store.alerts(1).length, 40);
});

test('the settle window runs from the first alert, not the latest', () => {
  const { former, ready } = setup();
  former.handle(problem('1'), 1000);
  former.handle(problem('2'), 1080);
  former.tick(1090);
  assert.deepEqual(ready, [1]);
});

test('an alert after the incident is ready joins it without a second investigation', () => {
  const { store, former, ready } = setup();
  former.handle(problem('1'), 1000);
  former.tick(1090);
  former.handle(problem('2'), 1200);
  former.tick(1300);
  assert.equal(store.incidents().length, 1);
  assert.equal(store.alerts(1).length, 2);
  assert.deepEqual(ready, [1]);
});

test('a repeated webhook delivery is a duplicate and changes nothing', () => {
  const { store, former } = setup();
  assert.equal(former.handle(problem('1'), 1000), 'accepted');
  assert.equal(former.handle(problem('1'), 1001), 'duplicate');
  assert.equal(store.alerts(1).length, 1);
});

test('a recovery for a problem never seen is reported, not stored', () => {
  const { store, former } = setup();
  assert.equal(former.handle(recovery('999'), 1000), 'unknown-problem');
  assert.equal(store.incidents().length, 0);
});

test('an incident closes once every alert has been recovered for the quiet period', () => {
  const { store, former, closed } = setup();
  former.handle(problem('1'), 1000);
  former.handle(problem('2'), 1001);
  former.tick(1090);
  former.handle(recovery('1'), 1100);
  former.tick(2000);
  assert.deepEqual(closed, [], 'one alert is still open');
  former.handle(recovery('2'), 2000);
  former.tick(2599);
  assert.deepEqual(closed, [], 'quiet period not over');
  former.tick(2600);
  assert.deepEqual(closed, [1]);
  assert.equal(store.incident(1)?.state, 'closed');
});

test('an alert after an incident closed opens a new incident', () => {
  const { store, former, ready } = setup();
  former.handle(problem('1'), 1000);
  former.tick(1090);
  former.handle(recovery('1'), 1100);
  former.tick(1700);
  former.handle(problem('2'), 5000);
  former.tick(5090);
  assert.equal(store.incidents().length, 2);
  assert.deepEqual(ready, [1, 2]);
});

test('an outage that recovers inside the settle window is still investigated', () => {
  const { former, ready, closed } = setup(90, 10);
  former.handle(problem('1'), 1000);
  former.handle(recovery('1'), 1020);
  former.tick(1050);
  assert.deepEqual([ready, closed], [[], []]);
  former.tick(1090);
  assert.deepEqual([ready, closed], [[1], [1]]);
});

test('state survives a restart', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'causewise-'));
  try {
    const path = join(dir, 'nested', 'db.sqlite');
    const a = new Store(path);
    new IncidentFormer(a, { settleSeconds: 90, quietSeconds: 600 }).handle(problem('1'), 1000);
    a.close();

    const b = new Store(path);
    const ready: number[] = [];
    const former = new IncidentFormer(b, { settleSeconds: 90, quietSeconds: 600, onReady: (i) => ready.push(i.id) });
    assert.equal(former.handle(problem('1'), 1001), 'duplicate');
    former.tick(1090);
    assert.deepEqual(ready, [1]);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

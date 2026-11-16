import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_METHODS, ZabbixClient } from '../src/zabbix/client.ts';
import { BudgetExceededError, Investigation, TOOL_SPECS, ToolInputError } from '../src/tools.ts';
import { fakeZabbix, type FakeData } from './fake-zabbix.ts';

const NOW = 100_000;
const every = (itemid: string, step: number, from: number, to: number, value: (t: number) => string) => {
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ itemid, clock: t, value: value(t) });
  return out;
};

const data: FakeData = {
  hosts: [
    { host: 'cache-01', tags: [{ tag: 'hypervisor', value: 'hv-01' }], groups: ['prod'] },
    { host: 'web-01', groups: ['prod'] },
  ],
  items: [
    { itemid: '1', host: 'cache-01', key_: 'cache.hit.pct', units: '%' },
    { itemid: '2', host: 'cache-01', key_: 'icmp.ping' },
    { itemid: '3', host: 'cache-01', key_: 'app.version', value_type: '3' },
    { itemid: '4', host: 'cache-01', key_: 'agent.hostname', value_type: '1' },
    { itemid: '5', host: 'cache-01', key_: 'never.reported' },
  ],
  history: [
    ...every('1', 60, NOW - 3000, NOW - 420, () => '91'), // stopped 7 minutes ago
    ...every('2', 60, NOW - 3000, NOW + 600, (t) => (t > NOW ? '0' : '1')), // goes to 0 in the future
    ...every('3', 300, NOW - 3000, NOW, () => '412'),
  ],
  events: [
    { eventid: '10', clock: NOW - 2700, name: 'Disk space is low', severity: 2, value: 1, host: 'web-01' },
    { eventid: '11', clock: NOW - 600, name: 'Link down', severity: 3, value: 1, r_eventid: '12', host: 'web-01' },
    { eventid: '12', clock: NOW - 480, name: 'Link down', severity: 3, value: 0, host: 'web-01' },
    { eventid: '13', clock: NOW - 300, name: 'Slow HTTP response', severity: 3, value: 1, r_eventid: '15', host: 'web-01' },
    { eventid: '14', clock: NOW - 200, name: 'Orphan', severity: 4, value: 1, host: null },
    { eventid: '15', clock: NOW + 300, name: 'Slow HTTP response', severity: 3, value: 0, host: 'web-01' },
    { eventid: '16', clock: NOW + 60, name: 'From the future', severity: 5, value: 1, host: 'web-01' },
  ],
  triggers: [{ host: 'cache-01', description: 'Low cache hit ratio', expression: 'max(/cache-01/cache.hit.pct,#3)<50', priority: '2', status: '0' }],
  maintenances: [
    { name: 'Nightly backup', active_since: NOW - 1000, active_till: NOW + 1000, hosts: ['web-01'] },
    { name: 'Last month', active_since: 1, active_till: 2, hosts: ['cache-01'] },
  ],
};

function setup(opts = {}) {
  const fake = fakeZabbix(data);
  const client = new ZabbixClient({ url: 'http://zabbix.test', token: 'tok', minIntervalMs: 0, fetch: fake.fetch });
  return { inv: new Investigation(client, { asOf: NOW, ...opts }), calls: fake.calls };
}

test('problems lists what is open now, including a problem that recovers later', async () => {
  const text = await setup().inv.run('problems');
  assert.match(text, /Open problems .* \(2\)/);
  assert.match(text, /Disk space is low/);
  assert.match(text, /Slow HTTP response/, 'recovers after now, so it is still open');
  assert.doesNotMatch(text, /Link down/, 'already recovered');
});

test('nothing later than "now" is ever shown', async () => {
  const { inv, calls } = setup();
  const out = [
    await inv.run('problems'), await inv.run('events', { minutes: 60 }), await inv.run('items', { host: 'cache-01' }),
    await inv.run('history', { host: 'cache-01', key: 'icmp.ping', minutes: 30 }),
  ].join('\n');
  assert.doesNotMatch(out, /From the future/);
  assert.doesNotMatch(out, /icmp\.ping\s+0\b/);
  for (const c of calls.filter((c) => c.method === 'event.get' || c.method === 'history.get')) {
    assert.equal(c.params.time_till, NOW, `${c.method} must be capped at now`);
  }
});

test('events includes resolved problems and skips events with no host', async () => {
  const text = await setup().inv.run('events', { minutes: 30 });
  assert.match(text, /PROBLEM .*Link down/);
  assert.match(text, /RESOLVED .*Link down/);
  assert.doesNotMatch(text, /Orphan/);
});

test('items shows age and sampling interval, and flags a metric that stopped', async () => {
  const text = await setup().inv.run('items', { host: 'cache-01' });
  const line = (key: string) => text.split('\n').find((l) => l.startsWith(key)) ?? '';
  assert.match(line('cache.hit.pct'), /91%\s+7m ago\s+sampled every ~60s\s+<-- STOPPED REPORTING/);
  assert.match(line('icmp.ping'), /1\s+\d+s ago\s+sampled every ~60s$/);
  assert.match(line('app.version'), /412\s+.*sampled every ~5m$/, 'a slow-sampled metric is labelled, not flagged');
  assert.match(line('never.reported'), /NO DATA/);
  assert.match(line('agent.hostname'), /text metric/);
});

test('history lists samples oldest first and says how old the latest is', async () => {
  const text = await setup().inv.run('history', { host: 'cache-01', key: 'cache.hit.pct', minutes: 10 });
  assert.match(text, /4 samples .* Latest sample is 7m ago\./);
  assert.match(await setup().inv.run('history', { host: 'cache-01', key: 'nope' }), /No such metric/);
});

test('a long history is thinned, not truncated', async () => {
  const text = await setup().inv.run('history', { host: 'cache-01', key: 'icmp.ping', minutes: 1440 });
  assert.match(text, /51 samples/);
  const big = { ...data, history: every('2', 5, NOW - 3000, NOW, () => '1') };
  const fake = fakeZabbix(big);
  const inv = new Investigation(new ZabbixClient({ url: 'http://z', token: 't', minIntervalMs: 0, fetch: fake.fetch }), { asOf: NOW });
  const thinned = await inv.run('history', { host: 'cache-01', key: 'icmp.ping', minutes: 1440 });
  assert.match(thinned, /601 samples .*showing 201/);
  assert.ok(thinned.includes('(0s ago)'), 'the latest sample is kept');
});

test('hosts shows groups and tags, or neither when hidden', async () => {
  assert.match(await setup().inv.run('hosts'), /cache-01\s+groups: prod\s+tags: hypervisor=hv-01/);
  const hidden = await setup({ hideTags: true }).inv.run('hosts');
  assert.doesNotMatch(hidden, /hv-01|prod/);
  assert.match(hidden, /no host groups or tags are recorded/);
});

test('triggers shows thresholds, and says when a host has none', async () => {
  assert.match(await setup().inv.run('triggers', { host: 'cache-01' }), /Low cache hit ratio\n\s+when max\(\/cache-01\/cache\.hit\.pct,#3\)<50/);
  assert.match(await setup().inv.run('triggers', { host: 'web-01' }), /Nothing on it can raise an alert/);
});

test('maintenance lists only windows within their active dates', async () => {
  const text = await setup().inv.run('maintenance');
  assert.match(text, /Nightly backup: web-01/);
  assert.doesNotMatch(text, /Last month/);
});

test('bad tool names and arguments are refused without calling Zabbix', async () => {
  const { inv, calls } = setup();
  await assert.rejects(inv.run('delete_host', { host: 'web-01' }), ToolInputError);
  await assert.rejects(inv.run('items', {}), ToolInputError);
  await assert.rejects(inv.run('items', { host: 42 }), ToolInputError);
  await assert.rejects(inv.run('events', { minutes: 'all' }), ToolInputError);
  assert.equal(calls.length, 0);
  assert.equal(inv.log.length, 0, 'refused calls do not use the budget');
});

test('the query budget stops the investigation', async () => {
  const { inv } = setup({ maxQueries: 2 });
  await inv.run('problems');
  await inv.run('hosts');
  await assert.rejects(inv.run('problems'), BudgetExceededError);
});

test('every call is logged with its output, for audit and evidence checks', async () => {
  const { inv } = setup();
  const text = await inv.run('items', { host: 'cache-01' });
  assert.deepEqual(inv.log.map(({ seq, tool, args, rows }) => ({ seq, tool, args, rows })), [
    { seq: 1, tool: 'items', args: { host: 'cache-01' }, rows: 5 },
  ]);
  assert.equal(inv.log[0]?.output, text);
});

test('running every tool uses only allow-listed API methods', async () => {
  const { inv, calls } = setup();
  const sample: Record<string, string> = { host: 'cache-01', key: 'cache.hit.pct' };
  for (const spec of TOOL_SPECS) {
    const required: readonly string[] = 'required' in spec.input_schema ? spec.input_schema.required : [];
    await inv.run(spec.name, Object.fromEntries(required.map((k) => [k, sample[k]])));
  }
  const used = new Set(calls.map((c) => c.method));
  assert.ok(used.size >= 5);
  for (const m of used) assert.ok((READ_METHODS as readonly string[]).includes(m), `${m} is not allow-listed`);
});

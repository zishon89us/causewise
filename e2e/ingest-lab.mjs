#!/usr/bin/env node
// End-to-end check of the M2 exit criterion against the lab: a simulated
// outage must arrive at causewise as exactly one incident, on Zabbix 7.0 and
// on 8.0. Needs the lab running (lab/docker-compose.yml). Not part of CI.
//
//   npm run e2e:lab [7.0|8.0|8.0-grouping]
//
// "8.0-grouping" turns on a Zabbix 8.0 event-processing rule that marks the
// first event in a window as the cause. With such a rule Zabbix holds back
// the notifications for the symptoms until the window ends, so they reach
// causewise after the incident is already ready. They must still join the
// same incident.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LABS, send, ZabbixApi } from '../sim/zabbix.mjs';
import { hosts } from '../sim/topology.mjs';
import { scenarios, TIMELINE as T } from '../sim/scenarios.mjs';
import { generate } from '../sim/generate.mjs';

const SPEED = 20; // 60-second checks become 3 seconds
const SETTLE = 30;
const QUIET = 15;
const SECRET = 'lab-secret-lab-secret-lab';
const SCENARIO = scenarios.findIndex((s) => s.name === 'switch-uplink-down');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const run = (...args) => execFileSync('node', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const RULE = 'causewise-lab: first event in 15 minutes is the cause';
const RULE_WINDOW = '45s'; // 15 minutes at 20x speed

async function setGrouping(lab, on) {
  if (lab !== '8.0') return;
  const api = await new ZabbixApi(LABS[lab].api).login();
  const [rule] = await api.call('ceprule.get', { output: ['cep_ruleid', 'name'], filter: { name: RULE } });
  if (rule) {
    await api.call('ceprule.update', { cep_ruleid: rule.cep_ruleid, status: on ? 0 : 1, window: { duration: RULE_WINDOW } });
  } else if (on) {
    await api.call('ceprule.create', {
      name: RULE, status: 0, sortorder: 1, window_type: 2, window: { duration: RULE_WINDOW },
      filter: { evaltype: 0, conditions: [{ type: 37, operator: 0, host_group_name: 'causewise-lab' }] },
    });
  }
}

async function check(target) {
  const grouping = target === '8.0-grouping';
  const lab = grouping ? '8.0' : target;
  const port = lab === '7.0' ? 8770 : 8780;
  const dir = mkdtempSync(join(tmpdir(), 'causewise-e2e-'));
  const events = [];
  const receiver = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/main.ts'], {
    env: {
      ...process.env,
      CAUSEWISE_HOST: '0.0.0.0',
      CAUSEWISE_PORT: String(port),
      CAUSEWISE_DB: join(dir, 'db.sqlite'),
      CAUSEWISE_WEBHOOK_SECRET: SECRET,
      CAUSEWISE_SETTLE_SECONDS: String(SETTLE),
      CAUSEWISE_QUIET_SECONDS: String(QUIET),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let buffer = '';
  receiver.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line) events.push(JSON.parse(line));
  });
  const count = (event, pred = () => true) => events.filter((e) => e.event === event && pred(e)).length;

  try {
    await setGrouping(lab, grouping);
    console.log(`[${target}] ${run('sim/provision.mjs', lab)}`);
    console.log(`[${target}] ${run('tools/install-webhook.mjs', lab, `http://host.docker.internal:${port}/v1/alerts`, SECRET)}`);
    await sleep(25_000); // Zabbix reloads its configuration cache

    // Three minutes of normal operation, then six minutes of the outage.
    const values = generate(SCENARIO, undefined, -180, T.pageAt);
    const start = Date.now();
    for (let i = 0; i < values.length; ) {
      const due = start + ((values[i].t + 180) / SPEED) * 1000;
      if (due > Date.now()) await sleep(due - Date.now());
      const batch = [];
      while (i < values.length && start + ((values[i].t + 180) / SPEED) * 1000 <= Date.now()) {
        const { t, ...v } = values[i++];
        batch.push({ ...v, clock: nowS() });
      }
      if (batch.length) await send(LABS[lab].trapperPort, batch);
    }
    await sleep((SETTLE + 10) * 1000);

    const ready = events.filter((e) => e.event === 'incident_ready');
    console.log(`[${target}] incidents ready: ${ready.length}; alerts in it when it became ready: ${ready[0]?.alerts}`);
    if (grouping) await sleep(30_000); // let the held-back symptom notifications arrive

    // Recover and wait for the incident to close.
    for (let round = 0; round < 3; round++) {
      await send(LABS[lab].trapperPort, hosts.flatMap((h) => h.items.map((it) => ({ host: h.name, key: it.key, value: it.base, clock: nowS() }))));
      await sleep(3000);
    }
    await sleep((QUIET + 15) * 1000);
    const problems = count('alert', (e) => e.kind === 'problem' && e.outcome === 'accepted');
    const recoveries = count('alert', (e) => e.kind === 'recovery' && e.outcome === 'accepted');
    const closed = count('incident_closed');
    const readyTotal = count('incident_ready');
    console.log(`[${target}] problems received: ${problems}; recoveries: ${recoveries}; incidents ready in total: ${readyTotal}; closed: ${closed}`);

    const failures = [];
    if (readyTotal !== 1) failures.push(`expected exactly 1 incident, got ${readyTotal}`);
    if (problems < 15) failures.push(`expected at least 15 problem alerts, got ${problems}`);
    // Without native grouping every alert should be in before the settle
    // window closes. With it, only the cause is.
    if (!grouping && ready[0]?.alerts !== problems) failures.push(`expected all ${problems} alerts before ready, got ${ready[0]?.alerts}`);
    if (grouping && !(ready[0]?.alerts >= 1)) failures.push('expected at least the cause alert before ready');
    if (recoveries !== problems) failures.push(`expected ${problems} recoveries, got ${recoveries}`);
    if (closed !== 1) failures.push(`expected the incident to close once, got ${closed}`);
    if (count('alert_rejected') || count('error')) failures.push('receiver rejected or failed on some requests');
    return failures;
  } finally {
    receiver.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
}

const targets = process.argv[2] ? [process.argv[2]] : ['7.0', '8.0', '8.0-grouping'];
let failed = false;
for (const target of targets) {
  const failures = await check(target);
  console.log(failures.length ? `[${target}] FAIL\n  - ${failures.join('\n  - ')}` : `[${target}] PASS`);
  failed ||= failures.length > 0;
}
process.exit(failed ? 1 : 0);

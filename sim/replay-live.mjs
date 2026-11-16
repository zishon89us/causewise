// Replay the scenarios in (compressed) real time, so that features which work
// on wall-clock time can be tested: Zabbix 8.0's event-processing windows.
//
// Time is compressed by SPEED: a 60-second check interval becomes 3 seconds.
// Triggers in this lab count samples, not seconds, so their behaviour is
// unchanged. A 15-minute grouping window therefore corresponds to a
// (15 min / SPEED) window in the lab.
//
// Writes evals/m0/native-grouping.<lab>.json: for each incident, which problem
// Zabbix marked as the cause and how many it marked as symptoms.
import fs from 'node:fs';
import { ZabbixApi, LABS, send } from './zabbix.mjs';
import { hosts } from './topology.mjs';
import { scenarios, TIMELINE as T } from './scenarios.mjs';
import { generate } from './generate.mjs';

const lab = process.argv[2];
if (!LABS[lab]) throw new Error('usage: node sim/replay-live.mjs <7.0|8.0>');
const SPEED = 20;
const FROM = -2700; // far enough back to include the older, unrelated alerts
const WINDOW_REAL = 900; // the grouping window being modelled, in real seconds
const port = LABS[lab].trapperPort;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const api = await new ZabbixApi(LABS[lab].api).login();
const results = [];

for (const n of scenarios.slice(0, 10).keys()) { // the M0 set
  const values = generate(n, undefined, FROM, T.pageAt);
  const wallStart = Date.now();
  for (let i = 0; i < values.length; ) {
    const due = wallStart + ((values[i].t - FROM) / SPEED) * 1000;
    if (due > Date.now()) await sleep(due - Date.now());
    const batch = [];
    const clock = nowS();
    while (i < values.length && wallStart + ((values[i].t - FROM) / SPEED) * 1000 <= Date.now()) {
      const { t, ...v } = values[i++];
      batch.push({ ...v, clock });
    }
    if (batch.length) await send(port, batch);
  }
  const pagedAt = nowS();
  await sleep(3000);

  // What does Zabbix itself say about cause and symptoms at page time?
  const open = await api.call('problem.get', {
    output: ['eventid', 'clock', 'name', 'severity', 'cause_eventid'],
    sortfield: ['eventid'],
  });
  const evHosts = await api.call('event.get', { eventids: open.map((p) => p.eventid), output: ['eventid'], selectHosts: ['host'] });
  const hostOf = Object.fromEntries(evHosts.map((e) => [e.eventid, e.hosts[0]?.host]));
  const causes = open.filter((p) => p.cause_eventid === '0');
  results.push({
    id: `INC-${String(n + 1).padStart(2, '0')}`,
    open_problems: open.length,
    marked_as_cause: causes.map((p) => ({
      host: hostOf[p.eventid],
      name: p.name,
      symptoms: open.filter((q) => q.cause_eventid === p.eventid).length,
    })),
  });
  console.log(`${results.at(-1).id}: ${open.length} open, causes: ${causes.map((p) => `${hostOf[p.eventid]} (${p.name})`).join('; ')}`);

  // Recover: three rounds of baseline values clear every trigger.
  for (let round = 0; round < 3; round++) {
    await send(port, hosts.flatMap((h) => h.items.map((it) => ({ host: h.name, key: it.key, value: it.base, clock: nowS() }))));
    await sleep(3000);
  }
  // Let the grouping window expire before the next incident.
  await sleep((WINDOW_REAL / SPEED + 10) * 1000 - (nowS() - pagedAt) * 1000);
}

fs.mkdirSync('evals/m0', { recursive: true });
fs.writeFileSync(
  `evals/m0/native-grouping.${lab}.json`,
  JSON.stringify({ lab, speed: SPEED, modelled_window_s: WINDOW_REAL, lab_window_s: WINDOW_REAL / SPEED, results }, null, 2) + '\n',
);

// Rule-based baselines on the back-dated 7.0 lab: which host would a simple
// rule blame for each incident?
//   first:        the earliest problem still open at page time
//   first-in-15m: the earliest open problem that started in the 15 minutes
//                 before the page (what a 15-minute grouping window would mark
//                 as the cause)
// Writes evals/m0/baselines.json. Reads the answers, so it is a scoring tool,
// not an investigator.
import fs from 'node:fs';
import { ZabbixApi, LABS } from '../../sim/zabbix.mjs';
import { scenarios } from '../../sim/scenarios.mjs';

const { incidents } = JSON.parse(fs.readFileSync('evals/m0/incidents.7.0.json', 'utf8'));
const api = await new ZabbixApi(LABS['7.0'].api).login();
const out = [];
for (const [n, inc] of incidents.entries()) {
  const evs = (
    await api.call('event.get', {
      source: 0, object: 0, time_from: inc.page_at - 7200, time_till: inc.page_at,
      output: ['eventid', 'clock', 'name', 'value', 'r_eventid'], selectHosts: ['host'], sortfield: ['clock', 'eventid'],
    })
  ).filter((e) => e.hosts.length);
  const recovered = new Map(evs.filter((e) => e.value === '0').map((e) => [e.eventid, Number(e.clock)]));
  const open = evs.filter((e) => e.value === '1' && !(recovered.get(e.r_eventid) <= inc.page_at));
  const first = open[0];
  const firstRecent = open.find((e) => Number(e.clock) >= inc.page_at - 900);
  const truth = scenarios[n].truth.hosts;
  const row = (e) => ({ host: e.hosts[0].host, alert: e.name, correct: truth.includes(e.hosts[0].host) });
  out.push({ id: inc.id, truth, open_problems: open.length, first: row(first), first_in_15m: row(firstRecent) });
}
fs.writeFileSync('evals/m0/baselines.json', JSON.stringify(out, null, 2) + '\n');
for (const r of out) {
  console.log(`${r.id} truth=${r.truth.join('+').padEnd(28)} first=${r.first.host.padEnd(12)} ${r.first.correct ? 'OK ' : 'no '} first15=${r.first_in_15m.host.padEnd(12)} ${r.first_in_15m.correct ? 'OK' : 'no'}`);
}
console.log(`first: ${out.filter((r) => r.first.correct).length}/10, first-in-15m: ${out.filter((r) => r.first_in_15m.correct).length}/10`);

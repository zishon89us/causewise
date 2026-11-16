// Replay all scenarios into a lab Zabbix as back-dated history, one scenario
// every four hours, ending a few hours before now. Writes the incident list
// (ids and page times only, no answers) to evals/m0/incidents.<lab>.json.
import fs from 'node:fs';
import { LABS, send } from './zabbix.mjs';
import { generate, DEFAULT_SEED } from './generate.mjs';
import { scenarios, TIMELINE as T } from './scenarios.mjs';

const lab = process.argv[2];
if (!LABS[lab]) throw new Error('usage: node sim/replay.mjs <7.0|8.0> [seed]');
const seed = Number(process.argv[3] ?? DEFAULT_SEED);
const port = LABS[lab].trapperPort;

const now = Math.floor(Date.now() / 1000);
const first = now - (scenarios.length * T.spacing + 3600);
const incidents = [];
let total = 0;

for (const n of scenarios.keys()) {
  const t0 = first + n * T.spacing - T.start; // fault start, epoch seconds
  const values = generate(n, seed).map(({ t, ...v }) => ({ ...v, clock: t0 + t }));
  for (let i = 0; i < values.length; i += 1500) {
    const res = await send(port, values.slice(i, i + 1500));
    const m = /failed: (\d+)/.exec(res.info ?? '');
    if (!m || m[1] !== '0') throw new Error(`sender rejected values: ${JSON.stringify(res)}`);
    await new Promise((r) => setTimeout(r, 400)); // let triggers process in order
  }
  total += values.length;
  incidents.push({ id: `INC-${String(n + 1).padStart(2, '0')}`, page_at: t0 + T.pageAt });
  console.log(`replayed scenario ${n + 1}/${scenarios.length} (${values.length} values)`);
}

fs.mkdirSync('evals/m0', { recursive: true });
fs.writeFileSync(`evals/m0/incidents.${lab}.json`, JSON.stringify({ lab, seed, incidents }, null, 2) + '\n');
console.log(`done: ${total} values`);

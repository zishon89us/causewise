// Replay a dataset into a lab Zabbix as back-dated history, one incident
// every four hours, ending a few hours before now. Writes the incident list
// (ids and page times only, no answers) to evals/<set>/incidents.json.
import fs from 'node:fs';
import { LABS, send } from './zabbix.mjs';
import { generate, DEFAULT_SEED } from './generate.mjs';
import { TIMELINE as T } from './scenarios.mjs';
import { resolve } from './dataset.mjs';

const lab = process.argv[2];
const set = process.argv[3] ?? 'golden';
if (!LABS[lab]) throw new Error('usage: node sim/replay.mjs <7.0|8.0> [m0|golden] [seed]');
const seed = Number(process.argv[4] ?? DEFAULT_SEED);
const scenarios = resolve(set);
const port = LABS[lab].trapperPort;

const now = Math.floor(Date.now() / 1000);
const first = now - (scenarios.length * T.spacing + 3600);
const incidents = [];
let total = 0;

for (const [n, sc] of scenarios.entries()) {
  const t0 = first + n * T.spacing - T.start; // fault start, epoch seconds
  const values = generate(sc.index, seed + n).map(({ t, ...v }) => ({ ...v, clock: t0 + t }));
  for (let i = 0; i < values.length; i += 1500) {
    const res = await send(port, values.slice(i, i + 1500));
    const m = /failed: (\d+)/.exec(res.info ?? '');
    if (!m || m[1] !== '0') throw new Error(`sender rejected values: ${JSON.stringify(res)}`);
    await new Promise((r) => setTimeout(r, 400)); // let triggers process in order
  }
  total += values.length;
  incidents.push({ id: sc.id, page_at: t0 + T.pageAt, ...(sc.hideTags ? { hide_tags: true } : {}) });
  console.log(`replayed scenario ${n + 1}/${scenarios.length} (${values.length} values)`);
}

const out = set === 'm0' ? `evals/m0/incidents.${lab}.json` : `evals/${set}/incidents.json`;
fs.mkdirSync(`evals/${set}`, { recursive: true });
fs.writeFileSync(out, JSON.stringify({ lab, set, seed, incidents }, null, 2) + '\n');
console.log(`done: ${total} values`);

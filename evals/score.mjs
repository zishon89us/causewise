#!/usr/bin/env node
// Score recorded answers against a dataset with the deterministic scorer
// (src/eval/score.ts).
//
//   node evals/score.mjs <m0|golden> <answers dir or file> [--hand <scores.json> <field>] [--out <file>]
//
// Answers: a directory of INC-xx.json files, or one JSON file holding an
// array (or {answers: [...]}) of answers that each carry an "incident" id.
// --hand compares against hand-assigned scores (field "investigator" or
// "alerts_only") and lists every disagreement.
import fs from 'node:fs';
import path from 'node:path';
import { resolve, truthOf, estate } from '../sim/dataset.mjs';
import { score } from '../src/eval/score.ts';

const args = process.argv.slice(2);
const take = (name, n) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, n + 1).slice(1) : null;
};
const hand = take('--hand', 2);
const out = take('--out', 1);
const [set, source] = args;
if (!set || !source) {
  console.error('usage: node evals/score.mjs <m0|golden> <answers dir or file> [--hand <scores.json> <field>] [--out <file>]');
  process.exit(2);
}

let answers;
if (fs.statSync(source).isDirectory()) {
  answers = fs.readdirSync(source).filter((f) => /^INC-\d+\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(source, f), 'utf8')));
} else {
  const j = JSON.parse(fs.readFileSync(source, 'utf8'));
  answers = Array.isArray(j) ? j : j.answers;
}
const handScores = hand ? Object.fromEntries(JSON.parse(fs.readFileSync(hand[0], 'utf8')).scores.map((s) => [s.id, s[hand[1]]])) : null;

const incidents = resolve(set);
const rows = [];
for (const answer of answers) {
  const incident = incidents.find((i) => i.id === answer.incident);
  if (!incident) throw new Error(`no incident ${answer.incident} in dataset ${set}`);
  const s = score(answer, truthOf(incident), estate);
  rows.push({ id: incident.id, scenario: incident.name + (incident.hideTags ? ' [no tags]' : ''), ...s, ...(handScores ? { hand: handScores[incident.id] } : {}) });
}

for (const r of rows) {
  const verdict = r.causeAccuracy ? 'correct' : 'wrong  ';
  const disagree = r.hand && (r.hand === 'correct') !== r.causeAccuracy ? `  << hand score: ${r.hand}` : '';
  console.log(`${r.id} ${r.scenario.padEnd(46)} ${verdict} unrelated:${r.unrelated.padEnd(4)}${r.falseBlame.length ? ` FALSE BLAME ${r.falseBlame.join(',')}` : ''}${disagree}`);
  for (const n of r.notes) console.log(`         - ${n}`);
}
const n = rows.length;
const withUnrelated = rows.filter((r) => r.unrelated !== 'n/a');
const totals = {
  incidents: n,
  cause_accuracy: `${rows.filter((r) => r.causeAccuracy).length}/${n}`,
  false_blame_incidents: rows.filter((r) => r.falseBlame.length).length,
  unrelated_separation: `${withUnrelated.filter((r) => r.unrelated === 'pass').length}/${withUnrelated.length}`,
  ...(handScores ? { disagreements_with_hand_score: rows.filter((r) => r.hand && (r.hand === 'correct') !== r.causeAccuracy).map((r) => r.id) } : {}),
};
console.log(JSON.stringify(totals));
if (out) fs.writeFileSync(out[0], JSON.stringify({ dataset: set, source, scorer: 'src/eval/score.ts', totals, rows }, null, 2) + '\n');

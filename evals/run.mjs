#!/usr/bin/env node
// Run the investigator on a replayed dataset and score it against the
// thresholds in docs/ai/eval-plan.md. Calls the Claude API: it costs money.
//
//   ANTHROPIC_API_KEY=... node evals/run.mjs [options]
//
//   --lab 7.0|8.0      lab the dataset was replayed into (default 7.0)
//   --set golden|m0    dataset (default golden)
//   --runs N           runs per incident (default 1; the thresholds are defined over 3)
//   --max-usd X        stop starting new investigations once estimated spend reaches X (default 5)
//   --model ID         default claude-opus-5-5
//   --effort LEVEL     default medium
//   --baseline         alerts-only baseline: the model gets the opening data and no further queries
//   --only INC-01,...  only these incidents
//   --out DIR          default evals/runs/<timestamp>
//
// Zabbix access: CAUSEWISE_ZABBIX_URL and CAUSEWISE_ZABBIX_TOKEN if set,
// otherwise the lab's default Admin account.
import fs from 'node:fs';
import path from 'node:path';
import { ZabbixApi, LABS } from '../sim/zabbix.mjs';
import { resolve, truthOf, estate } from '../sim/dataset.mjs';
import { ZabbixClient } from '../src/zabbix/client.ts';
import { Investigation } from '../src/tools.ts';
import { investigate } from '../src/investigator.ts';
import { ClaudeClient, estimateCostUsd } from '../src/llm-claude.ts';
import { loadPrompt } from '../src/prompt.ts';
import { score } from '../src/eval/score.ts';
import { checkEvidence, evidenceValidity } from '../src/eval/evidence.ts';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const lab = opt('lab', '7.0');
const set = opt('set', 'golden');
const runs = Number(opt('runs', 1));
const maxUsd = Number(opt('max-usd', 5));
const model = opt('model', 'claude-opus-5-5');
const effort = opt('effort', 'medium');
const baseline = args.includes('--baseline');
const only = opt('only')?.split(',');
const outDir = opt('out', `evals/runs/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}${baseline ? '-baseline' : ''}`);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(2);
}
const manifestPath = `evals/${set}/incidents.${lab}.local.json`;
if (!fs.existsSync(manifestPath)) {
  console.error(`${manifestPath} not found. Replay the dataset first: node sim/replay.mjs ${lab} ${set}`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).incidents;
const incidents = resolve(set).filter((i) => !only || only.includes(i.id));

let url = process.env.CAUSEWISE_ZABBIX_URL;
let token = process.env.CAUSEWISE_ZABBIX_TOKEN;
if (!url || !token) {
  url = LABS[lab].api;
  token = (await new ZabbixApi(url).login()).auth;
}
const zabbix = new ZabbixClient({ url, token, minIntervalMs: 50 });
const llm = new ClaudeClient({ model, effort });
const prompt = loadPrompt('investigator');

let spent = 0;
let stoppedForBudget = false;
const rows = [];
for (let run = 1; run <= runs && !stoppedForBudget; run++) {
  fs.mkdirSync(path.join(outDir, `run-${run}`), { recursive: true });
  for (const incident of incidents) {
    if (spent >= maxUsd) {
      stoppedForBudget = true;
      break;
    }
    const meta = manifest.find((m) => m.id === incident.id);
    // The opening step uses three queries, so a budget of three allows no more.
    const investigation = new Investigation(zabbix, { asOf: meta.page_at, hideTags: Boolean(meta.hide_tags), maxQueries: baseline ? 3 : 30 });
    const started = Date.now();
    let result;
    try {
      result = await investigate({ llm, investigation, system: prompt.text, incident: incident.id });
    } catch (e) {
      console.error(`${incident.id} run ${run}: ${e.name}: ${e.message}`);
      rows.push({ id: incident.id, run, error: `${e.name}: ${e.message}` });
      continue;
    }
    const cost = estimateCostUsd(model, result.usage) ?? 0;
    spent += cost;
    const s = score(result.diagnosis, truthOf(incident), estate);
    const checks = checkEvidence(result.diagnosis.evidence, investigation.log);
    // Whether the true cause was among the open alerts the model started from.
    const openAlerts = investigation.log[0].output;
    const causeHasAlert = truthOf(incident).causes.flat().some((h) => new RegExp(`\\s${h}\\s`).test(openAlerts));
    const row = {
      id: incident.id, run, scenario: incident.name, hide_tags: incident.hideTags, kind: truthOf(incident).kind, cause_has_alert: causeHasAlert,
      correct: s.causeAccuracy, verdict_ok: s.verdict, false_blame: s.falseBlame, unrelated: s.unrelated, notes: s.notes,
      evidence_validity: evidenceValidity(checks), queries: result.queries, turns: result.turns, seconds: Math.round((Date.now() - started) / 1000),
      cost_usd: Number(cost.toFixed(4)), models: result.models, stopped_because: result.stoppedBecause ?? null,
    };
    rows.push(row);
    fs.writeFileSync(
      path.join(outDir, `run-${run}`, `${incident.id}.json`),
      JSON.stringify({ incident: incident.id, ...result.diagnosis, meta: row, usage: result.usage, evidence_checks: checks, query_log: investigation.log }, null, 2) + '\n',
    );
    console.log(`${incident.id} run ${run}  ${s.causeAccuracy ? 'correct' : 'WRONG  '}  ${String(result.queries).padStart(2)} queries  $${cost.toFixed(3)}  ${incident.name}${s.notes.length ? `  [${s.notes.join('; ')}]` : ''}`);
  }
}

const ok = rows.filter((r) => !r.error);
const pct = (list) => (list.length ? Math.round((1000 * list.filter((r) => r.correct).length) / list.length) / 10 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const validity = ok.map((r) => r.evidence_validity).filter((v) => v !== null);
const special = ok.filter((r) => r.kind !== 'fault');
const summary = {
  dataset: set, lab, model, effort, prompt: `${prompt.name}/${prompt.version}`, mode: baseline ? 'alerts-only baseline' : 'investigator',
  runs_requested: runs, investigations: ok.length, errors: rows.length - ok.length, stopped_for_budget: stoppedForBudget,
  cause_accuracy_pct: pct(ok),
  cause_accuracy_no_alert_slice_pct: pct(ok.filter((r) => r.kind === 'fault' && !r.cause_has_alert)),
  cause_accuracy_alert_slice_pct: pct(ok.filter((r) => r.kind === 'fault' && r.cause_has_alert)),
  false_blame_investigations: ok.filter((r) => r.false_blame.length).length,
  benign_and_undeterminable_correct: `${special.filter((r) => r.correct).length}/${special.length}`,
  unrelated_separation: `${ok.filter((r) => r.unrelated === 'pass').length}/${ok.filter((r) => r.unrelated !== 'n/a').length}`,
  evidence_validity_pct: validity.length ? Math.round(1000 * mean(validity)) / 10 : null,
  queries_mean: ok.length ? Math.round(10 * mean(ok.map((r) => r.queries))) / 10 : null,
  queries_max: ok.length ? Math.max(...ok.map((r) => r.queries)) : null,
  seconds_mean: ok.length ? Math.round(mean(ok.map((r) => r.seconds))) : null,
  estimated_cost_usd: Number(spent.toFixed(2)),
  estimated_cost_per_investigation_usd: ok.length ? Number((spent / ok.length).toFixed(3)) : null,
};
// Thresholds from docs/ai/eval-plan.md. They are defined over 3 runs of the
// full dataset; a smaller run is indicative only. The margin over the
// alerts-only baseline needs a second run with --baseline.
const thresholds = baseline ? null : {
  'cause accuracy >= 85%': summary.cause_accuracy_pct >= 85,
  'no-alert slice >= 80%': summary.cause_accuracy_no_alert_slice_pct === null || summary.cause_accuracy_no_alert_slice_pct >= 80,
  'no false blame': summary.false_blame_investigations === 0,
  'benign and undeterminable all correct': special.every((r) => r.correct),
  'evidence validity >= 95%': summary.evidence_validity_pct === null || summary.evidence_validity_pct >= 95,
  'at most 30 queries': summary.queries_max === null || summary.queries_max <= 30,
};
const complete = !stoppedForBudget && summary.errors === 0 && runs >= 3 && !only && set === 'golden';
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ summary, thresholds, thresholds_apply: complete, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (thresholds) {
  for (const [name, pass] of Object.entries(thresholds)) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!complete) console.log('Indicative only: the thresholds are defined over 3 complete runs of the golden dataset.');
}
console.log(`Results written to ${outDir}`);
process.exit(thresholds && complete && Object.values(thresholds).some((p) => !p) ? 1 : 0);

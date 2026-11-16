# causewise

On-call investigator for Zabbix: turns an incident into a diagnosis with
evidence, delivered to chat.

> **Status: M1 spec, awaiting maintainer approval.** There is no product
> yet. This repository holds a lab, an outage simulator, a golden dataset
> and the specification. Progress: [`docs/STATUS.md`](docs/STATUS.md).

## Results so far

Simulated outages with a known cause, one run each, scored by hand by the
agent that wrote the scenarios (details and limits in
[`docs/m0-results.md`](docs/m0-results.md) and
[`docs/ai/eval-plan.md`](docs/ai/eval-plan.md)):

| Approach | M0 set (10) | Harder incidents (14) |
| --- | --- | --- |
| Zabbix 8.0 first-event-in-window rule | 5 of 10 | not run |
| Model reading only the alert list | 8 of 10 | 4 of 14 |
| Model investigating with read-only queries | 10 of 10 | 13 of 14 |

## Why

Zabbix tells you *what* is alerting. During an outage that can be dozens of
alerts, most of them symptoms. Zabbix 8.0 can group alerts under a "cause",
but its grouping rule picks the first event in a time window; it does not
investigate. causewise does the investigation an engineer would do (metric
history, dependencies, timing) and reports the likely cause with the evidence.

## What is here

| Path | What it is |
| --- | --- |
| `lab/` | Docker Compose lab with Zabbix 7.0 LTS and 8.0 LTS side by side |
| `sim/` | Simulated 19-host estate, twenty outage scenarios with a known cause, and the golden dataset |
| `tools/zq.mjs` | Read-only, point-in-time queries an investigator may use |
| `evals/` | Incident lists, baselines, investigator answers and scores |
| `docs/` | Requirements, design, decision records, eval plan, results |
| `AGENTS.md` | Working agreement for the AI agent that builds this |

## Run the lab

Needs Docker and Node.js 22 or newer. No npm dependencies.

```bash
docker compose -f lab/docker-compose.yml up -d
```

```bash
node sim/provision.mjs 7.0
```

```bash
node sim/replay.mjs 7.0
```

```bash
node tools/zq.mjs --lab 7.0 --at <page_at from evals/golden/incidents.json> problems
```

The lab uses Zabbix's default throwaway credentials and binds to localhost
only. Do not expose it.

## How this project is built

An AI coding agent (Claude) writes the code under the direction of a human
maintainer, who sets scope and reviews the work.

## Licence

[MIT](LICENSE)

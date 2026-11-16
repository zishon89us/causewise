# causewise

On-call investigator for Zabbix: turns an incident into a diagnosis with
evidence, delivered to chat.

> **Status: M0 proof spike.** There is no product yet. This repository
> currently holds a lab, an outage simulator and the results of a first
> feasibility test. Results so far are in `evals/m0/`; a written summary will follow in `docs/`.

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
| `sim/` | Simulated 19-host estate and ten outage scenarios with a known cause |
| `tools/zq.mjs` | Read-only, point-in-time queries an investigator may use |
| `evals/m0/` | Incident lists, baselines, investigator answers and scores |
| `docs/` | Results and notes |

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
node tools/zq.mjs --lab 7.0 --at <page_at from evals/m0/incidents.7.0.json> problems
```

The lab uses Zabbix's default throwaway credentials and binds to localhost
only. Do not expose it.

## How this project is built

An AI coding agent (Claude) writes the code under the direction of a human
maintainer, who sets scope and reviews the work.

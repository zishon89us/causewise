# Vision

Status: draft for maintainer review · M1

## Problem

During an outage Zabbix raises many alerts, most of them symptoms. The
on-call engineer has to work out which one matters, often at night, by
opening graphs host by host. Zabbix 8.0 can group alerts, but its grouping
attaches later alerts to whichever fired first. M0 measured that rule at 5
of 10 correct causes on simulated outages (`docs/m0-results.md`).

## Product

A small service that sits beside Zabbix. When an incident opens it
investigates with read-only queries and sends one message to the team's
chat:

- the likely cause, with a confidence level;
- the evidence, with times and numbers;
- which open alerts are unrelated;
- what it checked and ruled out;
- or, when the data does not show a cause, a plain statement of that.

## Who it is for

| User | Need |
| --- | --- |
| On-call engineer | Know where to look in the first minute, and trust why |
| Team lead at an ISP, hosting firm or MSP | Shorter outages without buying an enterprise AIOps suite |
| Zabbix administrator | Something safe to install: read-only, self-hosted, auditable |

## Principles

1. **Read-only.** It cannot break what it observes.
2. **Evidence or silence.** Every claim cites data it actually fetched.
3. **"I don't know" is a valid answer.** A wrong diagnosis during an outage
   costs more than none.
4. **Stays inside the network.** Self-hosted; outbound connections only, to
   the model provider and chat service the operator configured.
5. **Measured.** Accuracy claims come from the eval suite in this repo,
   always shown next to the baselines.

## Success for v1.0

- Meets the thresholds in `docs/ai/eval-plan.md`.
- Installs with one container and a webhook import on Zabbix 7.0 and 8.0.
- A public demo replays a simulated outage end to end.

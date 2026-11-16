# ADR 0006: Investigator as a budgeted tool-use loop

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
M0: a model with five read-only tools named the right cause in 10 of 10 incidents using 6 to 24 queries. M1 pilot: 13 of 14 on harder incidents, against 4 of 14 for the same model reading only the alert list.

## Options
- Fixed pipeline: gather a standard bundle of data, one model call.
- Tool-use loop: the model decides what to query.

## Decision
Tool-use loop with a fixed tool set, a query budget (default 30) and a token budget, ending in a diagnosis that validates against the schema. A cheap deterministic pre-step fetches what every investigation needs (open problems, recent events, host list) so the model starts with it.

## Consequences
Cost and latency vary per incident and must be capped and reported. Behaviour is harder to test than a pipeline, which is why no change to prompts, tools or model merges without an eval run.

# ADR 0004: Model access behind a provider interface

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
The investigator is a tool-using model loop. Operators differ on which provider they may send data to; some will want a local model.

## Decision
An `LlmClient` interface with tool calling and structured output. One real adapter first, plus a deterministic fake for unit tests. Model name and parameters live in config. The first adapter and default model are the maintainer's choice (see `docs/questions/m1.md`); the M0 and M1 pilots ran on Claude Sonnet 5.5.

## Consequences
A model change is a config change plus a full eval run. Local-model support is possible but unproven: nothing smaller than Sonnet 5.5 has been evaluated.

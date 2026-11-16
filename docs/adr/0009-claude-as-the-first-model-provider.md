# ADR 0009: Claude as the first model provider

Date: 2026-11-16 · Status: accepted (the maintainer chose Claude)

## Context
ADR 0004 put model access behind an `LlmClient` interface and left the
first provider to the maintainer, who chose Claude.

## Decision
- `src/llm-claude.ts` implements `LlmClient` on the official SDK,
  `@anthropic-ai/sdk` (Apache-2.0; pinned to 1.9.0; three small transitive
  dependencies). It is the service's first runtime dependency.
- Default model `claude-opus-5-5`, effort `medium`, both configurable
  (`CAUSEWISE_MODEL`, `CAUSEWISE_EFFORT`). The key comes from
  `ANTHROPIC_API_KEY`.
- Adaptive thinking is left on. Assistant turns are replayed unchanged,
  thinking blocks included.
- The diagnosis is returned through a strict `submit_diagnosis` tool.
  Current Claude models reject a forced tool choice, so the prompt asks for
  the call and the loop reminds the model if it answers in prose.
- Server-side refusal fallback is enabled (`fallbacks: "default"`), so a
  request declined by a safety classifier is retried by the API on its
  default fallback model. The models that served an investigation are
  recorded with the diagnosis.
- The whole prefix is cached on every turn; it only grows within an
  incident.

## Not verified
The adapter is tested through the real SDK against a local stand-in for the
Messages API (`test/llm-claude.test.ts`), which checks the request it builds
and how it reads responses. **It has not been run against the live API**:
the environment this was built in has no API key. The first live run is
the Eval workflow.

## Consequences
- A model or effort change is a config change plus an eval run.
- Cost depends on model choice. The pilots ran on Claude Sonnet 5.5, which
  is half the price of the default; choosing it is the maintainer's call
  and needs its own eval run.
- Prices used for cost estimates are a table in the adapter, dated
  2026-11-03; they are for reporting and budget caps, not billing.

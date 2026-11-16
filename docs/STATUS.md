# Status

Living progress log, updated at the end of every session.

## Current milestone: M3 Investigator

Exit: the thresholds in `docs/ai/eval-plan.md` are met.

First half (no model needed) is done and awaiting review. The second half
(agent loop, prompts, eval runs) is blocked on a model provider, API key
and spend limit.

## Done

- 2026-11-16 — Repository bootstrapped on `main`.
- 2026-11-16 — M0 proof spike: lab, simulator, ten scenarios, blind
  investigations, native Zabbix 8.0 grouping run. Results in
  `docs/m0-results.md`. Branch `spike/m0-proof`.
- 2026-11-16 — M1 spec drafted: MIT licence, working agreement,
  requirements, architecture, diagnosis schema, six ADRs, eval plan.
- 2026-11-16 — Golden dataset extended to 24 incidents (ten new hard
  scenarios, four no-tags variants) and piloted. Branch `docs/m1-spec`,
  stacked on `spike/m0-proof`.

- 2026-11-16 — Maintainer approved the M1 spec. Pull requests opened for
  M0 (#1) and M1 (#2).
- 2026-11-16 — M2 ingest: webhook media type for 7.0 and 8.0, receiver,
  incident former, SQLite store, container image, CI workflow, install
  guide, ADRs 0007 and 0008. 31 unit tests; end-to-end check against the
  lab. Branch `feat/m2-ingest`, stacked on `docs/m1-spec`.

- 2026-11-16 — Maintainer merged M0, M1 and M2 into `main`; CI passed.
- 2026-11-16 — M3, first half: read-only Zabbix client with a method
  allow-list, seven investigation tools, the dedicated read-only Zabbix
  role, and the deterministic scorer. `tools/zq.mjs` now runs the product
  tools. 67 unit tests; `npm run e2e:tools` passes on 7.0 and 8.0. Recorded
  pilot answers re-scored automatically. Branch `feat/m3-zabbix-tools`.

## Assumptions made without asking (maintainer said not to ask)

- Opened a pull request for this branch, as for the earlier milestones.
- Supported versions stay 7.0 and 8.0; 6.0 is not claimed.
- The audit-log tool is dropped, because it needs a super admin.
- Cause accuracy now counts a correct answer at low confidence (see the
  eval plan). This makes the alerts-only baseline score higher, not lower.
- Replay manifests (`incidents.<lab>.local.json`) are no longer committed,
  because their timestamps change on every replay.

## Next

1. Maintainer chooses the model provider and default model and supplies an
   API key and spend limit (question 2 in `docs/questions/m1.md`).
2. M3, second half: provider adapter, agent loop with the tool specs in
   `src/tools.ts`, versioned prompt, query log persisted to the store,
   evidence-validity and mechanism graders, three eval runs per incident,
   eval subset in CI.

## Blocked on the maintainer

- Model provider, API key and spend limit.
- `main` is not protected.

## Not done yet

- Nothing in the running service uses the client or tools yet; they are
  wired in with the agent loop.
- The maintenance tool has only been exercised against an empty lab and a
  unit-test fake.
- Lab end-to-end checks are manual, not in CI.
- No TLS on the receiver; documented as a deployment requirement.
- Issues for the user stories.
- Large-estate scenarios and independent scenario review.

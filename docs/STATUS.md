# Status

Living progress log, updated at the end of every session.

## Current milestone: M2 Ingest

Exit: a simulated outage arrives as one incident on 7.0 and 8.0. Met in the
lab on 2026-11-16 (`npm run e2e:lab`), on 7.0, on 8.0, and on 8.0 with a
native grouping rule enabled. Awaiting review.

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

## Next

1. Maintainer reviews and merges #1, #2, then the M2 branch.
2. Maintainer answers the remaining questions in `docs/questions/m1.md`
   (model provider and spend limit are needed before M3 can call a model).
3. M3: read-only Zabbix client, investigation tools, automated scorer
   (before any prompt work), agent loop, evals in CI.

## Blocked on the maintainer

- Model provider, API key and spend limit (M3).
- `main` is not protected.

## Not done yet

- The CI workflow has not run yet; it runs on the first pull request that
  contains it.
- The end-to-end lab check is manual, not in CI (it needs both Zabbix
  stacks).
- No TLS on the receiver; documented as a deployment requirement.
- Issues for the user stories.
- Automated scorer; scores so far are hand-assigned.
- Large-estate scenarios and independent scenario review.

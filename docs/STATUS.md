# Status

Living progress log, updated at the end of every session.

## Current milestone: M1 Spec

Exit: the maintainer approves the spec (`docs/questions/m1.md`).

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

## Next

1. Maintainer answers `docs/questions/m1.md`.
2. Merge `spike/m0-proof`, then `docs/m1-spec`.
3. M2: monorepo tooling and CI, webhook media type, receiver, incident
   store.

## Blocked on the maintainer

- Answers to `docs/questions/m1.md`.
- `main` is not protected.
- No pull requests exist yet; the agent opens them only when asked.

## Not done yet

- Issues for the user stories (the agent's session has no working GitHub
  API access; the stories are in `docs/requirements/user-stories.md`).
- Automated scorer; scores so far are hand-assigned.
- Large-estate scenarios and independent scenario review.
- CI, tests, `Makefile`: arrive with product code in M2.

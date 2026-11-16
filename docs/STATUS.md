# Status

Living progress log, updated at the end of every session.

## Current milestone: M3 Investigator

Exit: the thresholds in `docs/ai/eval-plan.md` are met.

The investigator is built and wired into the service. **It has not been run
against the live Claude API**, so the exit criterion is not yet measured.
The next step is the maintainer's: add the repository secret
`ANTHROPIC_API_KEY` and start the Eval workflow.

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

- 2026-11-16 — Maintainer merged the M3 first half (#4) and chose Claude.
- 2026-11-16 — M3, second half: Claude adapter on the official SDK, prompt
  `investigator/v1`, investigation loop, diagnosis validation, storage of
  diagnoses and query logs, service wiring, evidence-validity grader, eval
  runner, Eval workflow. 104 unit tests. End to end against the lab with a
  mock of the Claude API. Prompt v1 checked blind on six incidents through
  the Claude Code harness: 6 of 6. Branch `feat/m3-investigator`.

## Assumptions made without asking

- Default model `claude-opus-5-5` at effort `medium`. The pilots used
  Sonnet 5.5, which costs half as much; switching is a config change plus
  an eval run.
- No API key was available where this was built: the build environment
  refuses a credential for Anthropic's hosts. Live evals therefore run in
  GitHub Actions with a repository secret.
- The Eval workflow defaults to one run per incident and a 5 US dollar cap.
  The thresholds are defined over three runs; that is an input.
- A personal cloud environment named "causewise" was created for the key
  before it turned out no key could be stored. It serves no purpose now
  and can be deleted in Claude Code settings.

## Next

1. Maintainer adds the secret `ANTHROPIC_API_KEY` (Settings → Secrets and
   variables → Actions) and runs the Eval workflow, with the baseline
   option on.
2. Fix whatever the first live run shows; tune the evidence heuristic.
3. Three full runs against the thresholds; decide the default model on
   accuracy and cost.
4. Then M4: delivery to Telegram or Slack (question 3 in
   `docs/questions/m1.md` is still open).

## Blocked on the maintainer

- The repository secret and the first Eval run.
- Telegram or Slack first.
- `main` is not protected.

## Not done yet

- Live run of the product loop (above).
- Host-name masking (US-9), daily budget and degraded summary (US-8),
  re-investigation when an incident changes materially (ADR 0005).
- Mechanism grader; eval subset in CI.
- The image build could not be completed where this was built (its network
  proxy certificate is not trusted inside the build). The runtime was
  checked in a container with production dependencies; CI builds the real
  image.
- The maintenance tool against a real maintenance window.
- No TLS on the receiver; documented as a deployment requirement.
- Issues for the user stories; large-estate scenarios; independent
  scenario review.

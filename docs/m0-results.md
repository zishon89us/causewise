# M0 results: is investigation better than "first alert wins"?

Date: 2026-11-16 · Status: spike complete, awaiting maintainer decision

## Question

Zabbix 8.0 LTS (released 5 November 2026) can group alerts under a cause.
Would an agent that *investigates* an incident name the right cause clearly
more often than a first-event rule? If not, there is no product.

## Method

- A lab with Zabbix 7.0.32 and 8.0.0 in Docker (`lab/`).
- A simulated estate of 19 hosts, 129 metrics and 124 triggers, and ten
  outage scenarios with a known cause (`sim/`). Which alert fires first is
  decided by each check's sampling phase, not chosen by hand.
- Each incident was investigated 6 minutes after the fault began, by a model
  (Claude Sonnet 5.5) that could only run the five read-only queries in
  `tools/zq.mjs`. It was not told the scenario. Every command it ran was
  audited: only the query tool was used, no files were read.
- Compared against three baselines.

## Results

| Approach | Correct cause |
| --- | --- |
| Earliest open alert is the cause | 4 of 10 |
| Earliest alert in the last 15 minutes is the cause | 5 of 10 |
| Zabbix 8.0, first-event-in-window rule, run in real time | 5 of 10 (6 with one debatable case) |
| Model given only the alert list and host tags | 8 of 10 |
| Model investigating with read-only queries | 10 of 10 |

The investigator used between 6 and 24 queries per incident (median 12).

Per incident:

| Incident | True cause | Zabbix 8.0 rule | Alerts only | Investigator |
| --- | --- | --- | --- | --- |
| Switch uplink down | dist-sw-02 | debatable | correct | correct |
| Database volume full | db-01 | correct | correct | correct |
| Hypervisor CPU contention | hv-01 (no alert exists) | wrong | wrong | correct |
| DNS resolver slow | dns-01 | wrong | correct | correct |
| Storage latency | nas-01 | correct | correct | correct |
| App memory leak | app-03 | correct | correct | correct |
| Bad deploy | app tier, build 413 | wrong | correct | correct |
| Core router packet loss | core-rtr-01 | wrong | correct | correct |
| Two independent faults | cache-01 and db-02 | correct | wrong | correct |
| Load balancer health checks | lb-01 | correct | correct | correct |

Raw data: `evals/m0/` (answers, baselines, native grouping, scores).

## Findings

1. **The gate passes.** Investigation named the right cause twice as often as
   any first-event rule, including Zabbix 8.0's own.
2. **Most of the gain comes from the model reading the alerts, not from
   investigating.** With no queries at all it scored 8 of 10. Investigation
   added the two hardest cases: a cause that has no alert, and two unrelated
   faults at once. It also added evidence: times, numbers and what was ruled
   out.
3. **Zabbix 8.0 groups nothing out of the box.** Its event-processing rules
   ship as disabled samples; an administrator must write them. A grouping
   rule has no notion of dependency: it attaches later alerts to whatever
   fired first.
4. **Windows split and absorb incidents.** In two incidents one outage was
   split across two "causes" when a window expired mid-incident. In one, every
   alert was attached to an unrelated alert that was already open.
5. **Grouping windows use wall-clock time,** so back-dated history cannot be
   used to test them. The simulator has a real-time mode for this.
6. **Zabbix 8.0 only accepts trapper values from localhost by default.**
   Relevant to how any webhook or sender integration is documented.

## Limits of this result

- **Same author, same model family.** The scenarios were written by the same
  AI agent family that investigated them. They are textbook outages. Real
  estates are larger, noisier and less tidy; expect lower accuracy.
- **Complete topology tags.** Every host carried its upstream, hypervisor and
  storage as tags. Many real installations record none of this.
- **Small sample.** Ten incidents, one run each, one model. No variance
  measured.
- **Scored by the scenario author** (the agent), by hand. Not independently
  reviewed.
- **One right answer with wrong reasoning.** In the bad-deploy incident the
  investigator concluded that nodes still on the old build were failing; it
  was reading a version metric that is sampled only every five minutes.
- **Time compression.** The Zabbix 8.0 run was compressed 20 times (a
  15-minute window became 45 seconds). Triggers in the lab count samples, so
  alert order is preserved, but sub-second processing jitter matters more.
- **Not tested:** cost per incident, latency, behaviour of a smaller model,
  and the Zabbix 8.0 MCP server.

## Recommendation

Proceed to M1, with the scope adjusted by finding 2:

- The dataset must be dominated by cases where reading alerts is not enough:
  causes without alerts, missing or wrong topology tags, concurrent faults,
  stale metrics, long-open unrelated alerts, and estates of hundreds of hosts.
- Report the alerts-only baseline next to every investigator score, so the
  value of investigation is always visible.
- Score evidence and stated confidence, not just the named host.
- Scenarios should be reviewed, or partly written, by someone who runs Zabbix
  in production.

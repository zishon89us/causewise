# ADR 0008: Webhook alerts are a trigger; Zabbix is the source of truth

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
Found in the M2 end-to-end test on Zabbix 8.0.0. With an event-processing
rule that marks the first event in a window as the cause, Zabbix sent the
cause's notification immediately and held back the 23 symptom
notifications until the window ended. When the incident became ready after
the settle window it contained 2 of 24 alerts. Recoveries arrived for all
24. On 7.0, and on 8.0 without such a rule, all 24 arrived within seconds.

So the set of alerts received by webhook can be far from the set of
problems open in Zabbix, and how far depends on rules the operator wrote.

## Decision
- The webhook stream decides *when* an incident opens, becomes ready and
  closes. It is not the investigator's picture of the outage.
- At investigation time the investigator reads the open problems and
  recent events from the Zabbix API (already the first step in ADR 0006).
- Alerts that arrive after an incident is ready join it and never open a
  second one (tested end to end).

## Consequences
- The settle window does not need to be as long as the operator's grouping
  window.
- An installation whose action only fires for some problems (conditions,
  severities) still gets a full investigation.
- The count of alerts stored for an incident is not a reliable measure of
  its size; anything shown to users must come from the API read.
- A recovery can arrive for a problem causewise never saw. That is
  expected and is logged as `unknown-problem`, not treated as an error.

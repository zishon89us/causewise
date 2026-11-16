# ADR 0005: Incident formation: settle, then investigate

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
Alerts for one outage arrive over several minutes. M0 showed that arrival order does not identify the cause, and that Zabbix 8.0 grouping windows can split one outage or attach it to an unrelated open alert.

## Options
- Investigate on the first alert: fastest, but sees almost nothing.
- Fixed settle window after the first alert, then investigate once.
- Rely on Zabbix 8.0 cause and symptom links.

## Decision
Open an incident on the first alert, wait a settle window (default 90 seconds, configurable), then investigate everything open at that moment. Later alerts join the incident; a re-investigation runs only if the alert set changes materially after the first diagnosis. Native 8.0 links are passed to the investigator as hints.

## Consequences
The first message arrives no sooner than the settle window. Two unrelated faults in the same window become one incident, so the investigator must be able to report independent causes (it did in M0; it missed one of two in the M1 pilot).

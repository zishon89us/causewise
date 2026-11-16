# ADR 0002: Self-hosted single container with SQLite

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
Target users (ISPs, hosting firms, MSPs) will not expose their monitoring API to a third party's cloud, and Zabbix 8.0 restricts API and trapper access by default (observed in the lab).

## Options
- Hosted multi-tenant service: easiest to bill, hardest to get installed.
- Self-hosted container with outbound connections only.

## Decision
Self-hosted. One container beside Zabbix, SQLite on a mounted volume, outbound connections only to the configured model provider and chat service.

## Consequences
No hosted revenue in the MVP. Each installation is one tenant, which removes tenancy from the data model. Upgrades are the operator's job, so migrations must be automatic and reversible.

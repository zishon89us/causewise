# ADR 0003: Zabbix access through the JSON-RPC API, read-only

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
The investigator needs problems, events, hosts, items and history. Zabbix 8.0 also ships an MCP server.

## Options
- JSON-RPC API with an API token for a read-only role.
- The 8.0 MCP server.
- Direct database access.

## Decision
JSON-RPC API on 7.0 and 8.0, through one client with an allow-list of read methods (`event.get`, `problem.get`, `host.get`, `item.get`, `history.get`, `trigger.get`, `maintenance.get`, `auditlog.get`). Operators are told to create a read-only role; the allow-list protects them if they do not.

## Verified in the lab (7.0.32 and 8.0.0)
Bearer authentication with a session token from `user.login`, `event.get`, `host.get`, `item.get` and `history.get` on both versions; `problem.get`, `ceprule.get` and the `cause_eventid` field on 8.0 only.

## Assumptions, not yet verified
API tokens (as opposed to session tokens) and binding one to a read-only role; `problem.get` on 7.0; `trigger.get`, `maintenance.get` and `auditlog.get` behaviour; anything about the MCP server, which has not been tested and is deferred.

## Consequences
One code path for both versions. The MCP server can be added later as a second transport behind the same tool interface.

# ADR 0003: Zabbix access through the JSON-RPC API, read-only

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
The investigator needs problems, events, hosts, items and history. Zabbix 8.0 also ships an MCP server.

## Options
- JSON-RPC API with an API token for a read-only role.
- The 8.0 MCP server.
- Direct database access.

## Decision
JSON-RPC API on 7.0 and 8.0, through one client (`src/zabbix/client.ts`) with an allow-list of six read methods: `event.get`, `history.get`, `host.get`, `item.get`, `maintenance.get`, `trigger.get`. Any other method is refused before a request is made.

Operators create a dedicated Zabbix role whose API access is an allow-list of the same six methods, and a user with that role and read-only permission on the monitored host groups. `tools/lab-readonly-token.mjs` does this in the lab; `docs/install.md` gives the steps.

## Verified in the lab (7.0.32 and 8.0.0), 2026-11-16
- API tokens with Bearer authentication, and all six methods, on both versions (`npm run e2e:tools`).
- With the dedicated role, Zabbix itself refuses `history.push`, `event.acknowledge`, `host.update`, `host.delete`, `user.get` and `script.execute` on both versions.
- **A plain "read-only" user is not read-only.** On 7.0, a user with the built-in "User role" and read-only host permissions successfully called `history.push`, writing a value into a metric. The dedicated role closes that.
- On 8.0, the built-in "User role" cannot call the API at all; a role with API access enabled is required.
- `auditlog.get` needs a super admin, so recent configuration changes are not available to a least-privilege user. It is dropped from the tool set.
- On 8.0: `ceprule.get` and the `cause_eventid` field exist (seen with an admin session; not on the allow-list yet).

## Assumptions, not yet verified
- `maintenance.get` returns sensible data when a window exists; the lab has none, so only the empty case and a unit test against a fake cover it.
- Anything about the 8.0 MCP server, which has not been tested and is deferred.

## Consequences
One code path for both versions, and two independent layers keep the investigator read-only. Native 8.0 cause and symptom links need `event.get` fields only, so they can be added without widening the allow-list. The MCP server can be added later as a second transport behind the same tool interface.

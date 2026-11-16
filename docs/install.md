# Install

Status: M3. causewise receives alerts, forms incidents and, when configured,
investigates each one and stores the diagnosis. It does not send anything to
chat yet; the diagnosis appears in the container log and the local database.

The investigator has not yet been run against the live Claude API (see ADR
0009). Treat it as untested until the Eval workflow has passed.

Tested against Zabbix 7.0.32 and 8.0.0 in the lab.

## 1. Run the container

```bash
docker build -t causewise .
```

```bash
docker run -d --name causewise -p 8787:8787 -v causewise-data:/data -e CAUSEWISE_WEBHOOK_SECRET='<at least 16 characters>' causewise
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `CAUSEWISE_WEBHOOK_SECRET` | none, required | Shared secret the Zabbix webhook must send |
| `CAUSEWISE_PORT` | `8787` | Listening port |
| `CAUSEWISE_HOST` | `0.0.0.0` in the image | Listening address |
| `CAUSEWISE_DB` | `/data/causewise.db` | SQLite file |
| `CAUSEWISE_SETTLE_SECONDS` | `90` | Wait after the first alert before an incident is ready |
| `CAUSEWISE_QUIET_SECONDS` | `600` | All alerts recovered for this long closes the incident |

To turn on the investigator, also set:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CAUSEWISE_ZABBIX_URL` | none | Full URL of Zabbix's `api_jsonrpc.php` |
| `CAUSEWISE_ZABBIX_TOKEN` | none | API token of the read-only user from step 5 |
| `ANTHROPIC_API_KEY` | none | Claude API key |
| `CAUSEWISE_MODEL` | `claude-opus-5-5` | Claude model ID |
| `CAUSEWISE_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max` |
| `CAUSEWISE_MAX_QUERIES` | `30` | Zabbix queries allowed per incident |

Each investigation sends alert names, host names, tags and metric values to
the Claude API. Masking of host names is not built yet.

A missing or invalid value stops the container with a message naming it.

The receiver speaks plain HTTP. Run it on the same host or private network
as the Zabbix server, or put a TLS proxy in front of it.

## 2. Import the media type

In Zabbix: Alerts → Media types → Import, and choose
`zabbix/media-type-7.0.yaml` or `zabbix/media-type-8.0.yaml`. Then edit the
imported "causewise" media type:

- `url`: `http://<causewise host>:8787/v1/alerts`
- `secret`: the value of `CAUSEWISE_WEBHOOK_SECRET`
- make sure the media type is enabled.

## 3. Send alerts to it

1. Users → pick a user that can see the hosts you care about → Media → add
   "causewise" (the "Send to" value is not used; enter `causewise`), all
   severities.
2. Alerts → Actions → Trigger actions → create an action with no conditions
   (or scoped to the host groups you want), with an operation "Send message"
   to that user via "causewise", and the same as a recovery operation.

`tools/install-webhook.mjs` does these three steps through the API; it is
written for the lab and uses the default Admin account.

## 4. Check

Use the media type's "Test" button, or wait for a real alert, then look at
the container log for a line with `"event":"alert"`.

## 5. Read-only access for the investigator

The investigator reads from the Zabbix API. Give it its own user that
can do nothing else:

1. Users → User roles → create a role of type "User". Under API access,
   enable it, choose "Allow list" and enter exactly: `event.get`,
   `history.get`, `host.get`, `item.get`, `maintenance.get`, `trigger.get`.
   Untick everything under UI and Actions.
2. Users → User groups → create a group with **read** permission on the
   host groups you want investigated.
3. Users → create a user in that group with that role.
4. Users → API tokens → create a token for that user.

Do not reuse an existing "read-only" user. Tested on 7.0: a user with the
built-in "User role" and read-only host permissions can still push values
into metrics through the API. On 8.0 the built-in role cannot use the API
at all.

`tools/lab-readonly-token.mjs` does these steps in the lab, and
`npm run e2e:tools` checks that the token can read and cannot write.

## Notes for Zabbix 8.0

- **Grouping rules delay symptom alerts.** With an event-processing rule
  that marks causes and symptoms, Zabbix sends the cause's notification at
  once and holds back the symptoms' until the rule's window ends. causewise
  attaches them to the same incident when they arrive (ADR 0008).
- Media types created through the API are disabled unless created with
  `status: 0`.

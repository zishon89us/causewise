# Install

Status: M2. causewise currently receives alerts and forms incidents. It does
not investigate or send anything to chat yet.

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

## Notes for Zabbix 8.0

- **Grouping rules delay symptom alerts.** With an event-processing rule
  that marks causes and symptoms, Zabbix sends the cause's notification at
  once and holds back the symptoms' until the rule's window ends. causewise
  attaches them to the same incident when they arrive (ADR 0008).
- Media types created through the API are disabled unless created with
  `status: 0`.

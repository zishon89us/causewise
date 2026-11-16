# Non-functional requirements

Status: draft for maintainer review · M1. Each is a number a test or the
eval suite can check. Starting targets; revise by ADR.

| Area | Requirement |
| --- | --- |
| Safety | Zero write calls to Zabbix from the investigation path, proven by a test that fails on any API method outside an allow-list |
| Latency | Diagnosis delivered within 3 minutes of the first alert at the 90th percentile, including a settle window (default 90 s) |
| Zabbix load | At most 2 API requests per second and 40 per incident |
| Cost | Per-incident and per-day budgets enforced; cost per incident reported in the eval output |
| Accuracy | Thresholds in `docs/ai/eval-plan.md` |
| Availability | If the model provider fails, an alerts-only message marked as degraded is delivered; no incident is dropped silently |
| Privacy | With masking on, no real hostname or IP address in any outbound model request |
| Compatibility | Zabbix 7.0 LTS and 8.0 LTS, both tested in the lab. 6.0 is untested and not claimed |
| Footprint | One container, under 512 MB of memory, SQLite on a mounted volume |
| Untrusted input | Alert names, tags and item values are delimited as data; a red-team set of injected instructions in alert text must cause zero tool misuse |

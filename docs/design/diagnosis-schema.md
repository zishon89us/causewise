# Diagnosis schema

Status: draft for maintainer review · M1. The investigator's output, the
delivery input and the eval scorer all use this shape.

```json
{
  "incident": "INC-0042",
  "verdict": "cause_found | benign | undetermined | incomplete",
  "causes": [
    { "host": "nas-01", "what": "one sentence", "confidence": "high | medium | low" }
  ],
  "unrelated_alerts": ["web-02: Disk space is low on /"],
  "ruled_out": ["db-01 CPU, memory and disk space"],
  "evidence": [
    { "claim": "nas-01 latency rose from 4 ms to 120 ms at 03:02", "query": 7 }
  ],
  "next_step": "one suggested check or action for a human",
  "queries": 12,
  "degraded": false
}
```

Rules:

- `causes` has more than one entry only for independent faults.
- `undetermined` has empty `causes` and a non-empty `ruled_out`.
- `benign` means no real outage; `causes` is empty.
- `incomplete` means a budget was hit; whatever was found is reported.
- Every `evidence` item points at the query that produced it. A claim with
  no supporting query is a defect.
- `degraded: true` means no investigation ran (provider failure or daily
  budget exhausted) and the content is an alerts-only summary.

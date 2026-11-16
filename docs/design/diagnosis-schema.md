# Diagnosis schema

Status: draft for maintainer review · M1. The investigator's output, the
delivery input and the eval scorer all use this shape.

```json
{
  "verdict": "cause_found | benign | undetermined | incomplete",
  "causes": [
    { "host": "nas-01", "what": "one sentence", "confidence": "high | medium | low" }
  ],
  "unrelated_alerts": ["web-02: Disk space is low on /"],
  "ruled_out": ["db-01 CPU, memory and disk space"],
  "evidence": [
    { "claim": "nas-01 latency rose from 4 ms to 120 ms at 03:02", "query": 7 }
  ],
  "next_step": "one suggested check or action for a human"
}
```

Defined in `src/diagnosis.ts`. Stored beside it for each incident: every
query with its output, the prompt version, the models that served it, turn
and token counts, and estimated cost.

Rules:

- `causes` has more than one entry only for independent faults.
- `undetermined` has empty `causes` and a non-empty `ruled_out`.
- `benign` means no real outage; `causes` is empty.
- `incomplete` is set by the loop, never by the model: the provider
  declined, output was cut off, the model would not submit, or it could not
  produce a valid diagnosis. `causes` is empty and `next_step` says to
  investigate by hand.
- Every `evidence` item cites the number of a query that ran; a diagnosis
  citing a query that does not exist is sent back to the model.
- Not built yet: the degraded alerts-only summary when the provider is
  down or a daily budget is exhausted (US-8).

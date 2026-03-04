# Date Range Reference

`resolve_date_range(time_range)` maps time_range tokens to ISO UTC date strings.

| time_range | start | end |
|------------|-------|-----|
| `today` | midnight UTC today | now |
| `yesterday` | midnight UTC yesterday | midnight UTC today |
| `week` | 7 days ago midnight UTC | now |
| `month` | 30 days ago midnight UTC | now |

All dates are UTC ISO 8601 with timezone offset (e.g. `2026-02-27T00:00:00+00:00`).

**CRITICAL**: Always pass pre-computed start_date / end_date verbatim to Exa tool calls.
Never compute dates in the LLM prompt or allow the model to calculate them.

# News Agent

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | `general \| region \| curated` | yes | Search strategy |
| `time_range` | `today \| yesterday \| week \| month` | yes | Date window |
| `region` | `US \| India \| Europe \| APAC \| UK \| LatAm` | when mode=region | Regional focus |
| `custom_domains` | `string[]` | no | Override curated domain list |

## 4-Phase Loop

1. **Resolve dates** — call `resolve_date_range(time_range)` to get ISO start/end.
   Inject verbatim into every tool call. LLM never computes dates.

2. **Search (2–4 rounds)** — call the appropriate tool(s) with varied query angles:
   - `general`: 2–4 calls to `news_search_general`
   - `region`: 2–4 calls to `news_search_region` with the target region
   - `curated`: 2–4 calls to `news_search_curated` (or with `custom_domains`)

3. **Group by topic** — cluster articles by named entity / event / product / theme.
   Sort clusters by `article_count` descending. No deduplication.

4. **Emit `NewsDigest`** — return pure JSON matching the schema (no markdown wrapper).

## JSON Schema

```json
{
  "mode": "string",
  "time_range": "string",
  "region": "string | null",
  "generated_at": "ISO string",
  "topics": [
    {
      "label": "2–6 word title case label",
      "article_count": 3,
      "articles": [
        {
          "title": "string",
          "url": "string",
          "source": "domain",
          "published_date": "ISO string | null",
          "excerpt": "≤300 chars"
        }
      ]
    }
  ]
}
```

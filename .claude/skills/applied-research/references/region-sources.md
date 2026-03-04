# Region → Query Keyword Mapping

Used by `news_search_region` to enrich queries with geographic context.

| region code | keyword appended to query |
|-------------|--------------------------|
| `US` | `United States US` |
| `India` | `India` |
| `Europe` | `Europe EU` |
| `APAC` | `Asia Pacific China Japan` |
| `UK` | `UK Britain` |
| `LatAm` | `Latin America Brazil Mexico` |

Example: query `"AI regulation"` + region `Europe` → `"AI regulation Europe EU"`

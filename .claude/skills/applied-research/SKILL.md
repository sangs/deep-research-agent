# Applied Research Skill — News Intelligence Hub

## Overview

This skill aggregates news using a multi-tool agentic loop backed by FastMCP + Exa search.
It supports three modes, produces a structured `NewsDigest`, and renders it as a tabbed dashboard.

## Mode Detection

| User intent | mode |
|-------------|------|
| Global / top news | `general` |
| News from newsletters + AI/ML sites | `curated` |
| News from a specific country/region | `region` |

## Output Contract

The agent returns a `NewsDigest` JSON object:
```json
{
  "mode": "curated",
  "time_range": "today",
  "region": null,
  "generated_at": "2026-02-27T10:00:00Z",
  "topics": [
    {
      "label": "OpenAI GPT-5 Announcement",
      "article_count": 3,
      "articles": [ ... ]
    }
  ]
}
```

## No-Dedup Rule

The same story appearing in multiple sources creates **separate article cards** within the same
topic cluster. Deduplication is never performed. This preserves editorial diversity.

## Tool Routing

- `news_search_general` → global news (category=news)
- `news_search_region` → regional news (category=news + region keyword in query)
- `news_search_curated` → curated domain list (no category filter, includes newsletters)
- `manage_sources` → list / add / remove curated domains
- `get_news_digest` → high-level orchestrator (calls A/B/C internally)

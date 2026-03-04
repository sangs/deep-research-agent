# Bug Analysis and Resolution
**Date:** 2026-03-03
**Time:** 11:26:47

---

## Overview

Two bugs were identified and resolved in the `deep-research-agent` project:

1. **Research tab domain filtering** — the Research tab returned articles from arbitrary domains instead of the configured `research_sites` list.
2. **Key Takeaways card never activated** — the collapsible `✨ Key Takeaways` card in the Deep Research tab never rendered.

---

## Bug 1: Research Tab Returns Wrong Domains

### Root Cause A — `search_news()` crashes without dates (PRIMARY)

**File:** `backend/services/exa_client.py`

`search_news()` declared `start_date: str` and `end_date: str` as required positional parameters. The research branch in `_fetch_articles()` (`openrouter.py`) calls `search_news()` without those arguments — by design, since the research tool has no date filter.

**Chain of events:**
1. LLM correctly calls `news_search_research`
2. Python raises `TypeError: missing 2 required positional arguments: 'start_date' and 'end_date'`
3. Exception caught in `_dispatch_tool` → result returned as `{'article_ids': [], 'articles': []}`
4. LLM receives empty result and retries (`tool_choice='required'` for rounds 1–2)
5. LLM falls back to `news_search_general` (the only tool that succeeds) → returns articles from any domain

**Resolution:**

Made `start_date` and `end_date` optional (`str | None = None`) and changed the kwargs construction to add them conditionally:

```python
# Before
async def search_news(
    query: str,
    num_results: int,
    start_date: str,          # required — no default
    end_date: str,            # required — no default
    ...
) -> list[dict]:
    kwargs: dict = {
        'num_results': num_results,
        'start_published_date': start_date,   # always added
        'end_published_date': end_date,        # always added
        ...
    }

# After
async def search_news(
    query: str,
    num_results: int,
    start_date: str | None = None,   # optional
    end_date: str | None = None,     # optional
    ...
) -> list[dict]:
    kwargs: dict = {
        'num_results': num_results,
        ...
    }
    if start_date:
        kwargs['start_published_date'] = start_date   # only when provided
    if end_date:
        kwargs['end_published_date'] = end_date        # only when provided
```

All existing callers (`news_search_general`, `news_search_region`, `news_search_curated`) continue to pass explicit dates — no changes needed in those call sites.

---

### Root Cause B — All 4 tools offered for every mode (SECONDARY)

**File:** `backend/services/openrouter.py`

`TOOL_SCHEMAS` (all 4 tools) was always sent to the LLM regardless of the active mode. `tool_choice='required'` forces *a* tool call — but not *which* tool. Even with Fix A applied, the LLM could still choose a tool for a different mode if it misread the system prompt.

**Resolution:**

Added a `_MODE_TOOL` mapping and filtered `TOOL_SCHEMAS` to only the single relevant tool before sending to the LLM:

```python
# New mapping
_MODE_TOOL = {
    'general': 'news_search_general',
    'region':  'news_search_region',
    'curated': 'news_search_curated',
    'research':'news_search_research',
}

# In run_news_agent() — computed once before the httpx loop
mode_tool_name = _MODE_TOOL.get(mode)
tools_for_mode = (
    [s for s in TOOL_SCHEMAS if s['function']['name'] == mode_tool_name]
    if mode_tool_name else TOOL_SCHEMAS
)

# API call now uses tools_for_mode instead of TOOL_SCHEMAS
json={
    'model': MODEL,
    'messages': messages,
    'tools': tools_for_mode,   # was: TOOL_SCHEMAS
    'tool_choice': tool_choice,
}
```

With only one tool available, the LLM cannot pick the wrong one regardless of how it interprets the system prompt.

---

## Bug 2: Key Takeaways Card Never Activates

**File:** `components/research-display.tsx`

### Root Cause

`extractSummary()` checked only `lines[0]` for the `## Key Takeaways` heading:

```ts
if (!lines[0]?.match(/^#{1,2}\s*Key Takeaways/i)) return null;
```

Gemini streams planning/preamble text ("Okay, here's my plan...") in the same text part as the final answer. The `## Key Takeaways` heading appears later in the text, never at line 0. As a result, `extractSummary()` always returned `null`, the card never rendered, and the heading fell through as a plain `<h2>` in the prose.

### Resolution

Replaced the `lines[0]` check with `findIndex()` to locate the heading anywhere in the text. Preamble text before the heading is preserved in `body` rather than being silently discarded:

```ts
// Before
function extractSummary(text: string): { takeawaysContent: string; body: string } | null {
  const lines = text.split('\n');
  if (!lines[0]?.match(/^#{1,2}\s*Key Takeaways/i)) return null;

  let splitIdx = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].match(/^#{1,2}\s+\S/)) { splitIdx = i; break; }
  }

  const takeawaysContent = lines.slice(1, splitIdx).join('\n').trim();
  const body = lines.slice(splitIdx).join('\n').trim();
  return { takeawaysContent, body };
}

// After
function extractSummary(text: string): { takeawaysContent: string; body: string } | null {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.match(/^#{1,2}\s*Key Takeaways/i));
  if (idx === -1) return null;

  let splitIdx = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].match(/^#{1,2}\s+\S/)) { splitIdx = i; break; }
  }

  const takeawaysContent = lines.slice(idx + 1, splitIdx).join('\n').trim();
  const preamble = lines.slice(0, idx).join('\n').trim();
  const rest = lines.slice(splitIdx).join('\n').trim();
  const body = [preamble, rest].filter(Boolean).join('\n\n').trim();

  return takeawaysContent ? { takeawaysContent, body } : null;
}
```

---

## Files Changed

| File | Change |
|---|---|
| `backend/services/exa_client.py` | Made `start_date`/`end_date` optional (`None` defaults); conditionally add to kwargs |
| `backend/services/openrouter.py` | Added `_MODE_TOOL` dict; computed `tools_for_mode` and passed it to the API call |
| `components/research-display.tsx` | Replaced `lines[0]` check with `findIndex()` in `extractSummary()` |

---

## Verification Steps

### Bug 1 — Research tab domain filtering
1. `cd backend && uv run python main.py`
2. `npm run dev` (port 3001)
3. Navigate to the News tab → Research mode → submit a blank query
4. Results should only come from `research_sites` domains (e.g. `openai.com`, `anthropic.com`, `huggingface.co`)
5. Repeat with a specific query (e.g. "transformer architecture") — same domain constraint should hold

### Bug 2 — Key Takeaways card
1. Navigate to the Deep Research tab
2. Submit any query and wait for the response to complete
3. A `✨ Key Takeaways` card should appear at the top of the answer
4. Clicking **Collapse** hides the full report body
5. Clicking **Read full report** re-expands it

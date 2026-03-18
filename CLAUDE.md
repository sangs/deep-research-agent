# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend
npm run dev      # Start Next.js dev server (http://localhost:3001)
npm run build    # Production build + type check
npm run lint     # Run ESLint
npx tsc --noEmit # Type check only
npx shadcn@latest add <component>  # Add a new shadcn/ui component

# Backend
cd backend && poetry run uvicorn main:app --reload  # Start FastMCP + Starlette backend (http://localhost:8000)
```

Both servers must be running for the full app to work. There are no tests in this project.

## Environment

Requires `.env.local` with:
```
OPENROUTER_API_KEY=...
EXA_API_KEY=...
```

The backend reads the same keys from the environment (loaded via `python-dotenv` or shell).

## Architecture

A Next.js 15 app (App Router) with two main sections:

1. **Deep Research Agent** — agentic multi-step web research with streaming UI
2. **News Intelligence Hub** — tabbed news dashboard (Global, Regional, Blogs & Sites, Research, Newsletter)

The News Hub calls a Python FastMCP + Starlette backend; Deep Research calls a Next.js API route directly.

### Deep Research Data Flow
```
app/page.tsx  (useChat + DefaultChatTransport)
  → POST /api/research
    → streamText() with webSearch tool (up to 10 steps)
      → exa.searchAndContents() for each search
    → toUIMessageStreamResponse()  (SSE)
  → messages.parts rendered by ResearchDisplay
```

### News Hub Data Flow
```
components/news-hub-section.tsx  (fetch per tab)
  → POST /api/news  (Next.js route handler)
    → FastMCP + Starlette backend  http://localhost:8000
      → backend/tools/news_tools.py
        → exa_client.py → Exa search API
        → openrouter.py → LLM topic clustering
  → results rendered by NewsDashboard / TopicGroup / NewsCard
```

### Source Management
```
components/source-manager.tsx
  → GET/POST /api/sources  (Next.js route handler)
    → backend/config/default_sources.json  (persisted source list)
```

## Key Files

### Frontend
- `app/page.tsx` — Dual-section layout. `DefaultChatTransport` created outside component to avoid re-renders.
- `app/api/research/route.ts` — Deep Research agentic loop. Uses `streamText` with `stopWhen: stepCountIs(10)`. Model: `google/gemini-2.0-flash-001` via OpenRouter.
- `app/api/news/route.ts` — Proxies News Hub requests to the FastMCP + Starlette backend.
- `app/api/sources/route.ts` — Proxies source CRUD to the FastMCP + Starlette backend.
- `lib/tools.ts` — Exa `webSearchTool`. Registered as `webSearch` server-side; client part type is `tool-webSearch`.
- `components/research-display.tsx` — Renders `message.parts`. Tool parts cast via `as unknown as {...}` (TypeScript doesn't know tool-specific types).
- `components/news-hub-section.tsx` — News Hub tab container with Global/Regional/Curated/Research tabs.
- `components/news-dashboard.tsx` — Renders topic clusters and article cards.
- `components/topic-group.tsx` — Collapsible cluster group with article count badge.
- `components/news-card.tsx` — Individual article card (title, domain chip, date, excerpt). Clicking the card body opens a Sheet drawer with full structured summary and links. Title link still navigates externally. Sheet is only imported on client (`'use client'`).
- `components/source-manager.tsx` — Manage curated sources (add/remove domains) for Blogs & Sites and Research tabs.
- `components/nav-links.tsx` — Top nav bar (Deep Research | News Hub).
- `context/section-context.tsx` — Shared React context for active section state.
- `lib/excerpt-utils.ts` — Text truncation helpers for article excerpts.

### Backend (`backend/`)
- `main.py` — FastMCP server + Starlette app. Routes: `POST /digest`, `GET/POST /sources`, `Mount /mcp` (MCP HTTP interface).
- `services/exa_client.py` — Exa search + contents fetching, with region and time range support.
- `services/openrouter.py` — LLM calls via OpenRouter for topic clustering / summarisation.
- `tools/news_tools.py` — Orchestrates multi-query news fetching and cluster grouping.
- `tools/date_utils.py` — Converts time range labels (today/yesterday/past week/past month) to date filters.
- `models/schemas.py` — Pydantic request/response models. `ArticleItem` includes `links: list[str] = []` (newsletter-only; safe default for other tabs).
- `services/gmail_service.py` — Gmail OAuth + newsletter digest. Fetches emails, clusters by topic via LLM, summarizes with structured headline+bullets format, and populates `links` with up to 5 deduplicated article URLs per email.
- `config/default_sources.json` — Default curated source domains for Blogs & Sites and Research tabs.

## AI SDK v6 Patterns

This project uses AI SDK v6 — key differences from v4:

| v4 | v6 |
|----|----|
| `maxSteps` | `stopWhen: stepCountIs(N)` |
| `tool({ parameters })` | `tool({ inputSchema })` |
| `toDataStreamResponse()` | `toUIMessageStreamResponse()` |
| `useChat({ api })` | `useChat({ transport })` with `DefaultChatTransport` |
| `sendMessage(text)` | `sendMessage({ text })` |
| `convertToModelMessages()` sync | `await convertToModelMessages()` async |

## OpenRouter Compatibility

OpenRouter does not support the OpenAI Responses API (`/v1/responses`). The default `openrouter(modelId)` call routes to the Responses API and will fail with a 400 error. Always use `.chat()` explicitly to force Chat Completions (`/v1/chat/completions`):

```ts
// ❌ Wrong — uses Responses API, fails on OpenRouter
model: openrouter('google/gemini-2.0-flash-001')

// ✅ Correct — uses Chat Completions
model: openrouter.chat('google/gemini-2.0-flash-001')
```

## shadcn/ui

Style: New York, base color: Neutral, CSS variables enabled. Components live in `components/ui/`. Add new ones with `npx shadcn@latest add <name>`.

Installed components: `button`, `badge`, `card`, `select`, `sheet`, `tabs`, `toggle`, `toggle-group`.

## News Hub — Tab Modes

| Tab | Backend endpoint | Time filter | Region filter |
|-----|-----------------|-------------|---------------|
| Global | `/news` mode=`global` | today / yesterday / past week / past month | — |
| Regional | `/news` mode=`regional` | today / yesterday / past week / past month | US / India / Europe / APAC / UK / LatAm |
| Blogs & Sites | `/news` mode=`curated` | today / yesterday / past week / past month | — |
| Research | `/news` mode=`research` | none (relevance-ranked) | — |
| Newsletter | `/digest` mode=`newsletter` | today / yesterday / past week / past month | — |

## Newsletter Tab — Gmail Integration

### Data Flow
```
components/news-hub-section.tsx  (Newsletter tab)
  → POST /api/news  mode=newsletter
    → backend/main.py  POST /digest
      → services/gmail_service.py  run_gmail_digest()
        → Gmail API (OAuth) → fetch_emails()
        → _cluster_via_llm()  or  _group_by_source()
        → _summarize_via_openrouter()
        → _build_newsletter_digest() → NewsDigest
  → results rendered by NewsDashboard / TopicGroup / NewsCard
     → card body click → Sheet drawer (full summary + links)
```

### Gmail OAuth Setup (one-time)
1. Download `credentials.json` from Google Cloud Console → OAuth 2.0 Client ID (Desktop app)
2. Set in `.env.local`:
   ```
   GMAIL_CREDENTIALS_PATH=~/credentials.json
   GMAIL_TOKEN_PATH=~/gmail_token.json
   ```
3. Authorize once:
   ```bash
   cd backend && uv run python -c "from services.gmail_service import get_gmail_service; get_gmail_service()"
   ```
4. Token is auto-refreshed on subsequent calls.

If you see `invalid_grant: Bad Request`, delete `~/gmail_token.json` and re-run step 3.

### Summary Format
Summaries use a structured format generated by the LLM:
```
**[headline sentence]**
• bullet point 1
• bullet point 2
• bullet point 3
```
`news-card.tsx` detects this format via `renderExcerpt()` and renders the headline bold with a bullet list. Plain text falls back to a `<p>` tag (other tabs unaffected).

### ArticleItem `links` Field
`backend/models/schemas.py` — `ArticleItem.links: list[str] = []`

Newsletter emails populate up to 5 deduplicated article URLs extracted from the email body (tracking/utility links already filtered by `extract_urls()`). All other tabs send an empty list; the Sheet's links section is hidden when the list is empty.

### NewsCard Sheet Drawer
- **Click card body** → opens `Sheet` drawer (shadcn/ui) with full structured summary + links
- **Click card title** → opens `article.url` in new tab (unchanged behavior)
- State is local to each `NewsCard` instance via `useState(false)`

## Git Workflow

- Active branch: `feature-initial-research`
- Main branch: `main`
- `documents/` and `Notes/` are gitignored — test run logs stay local only.

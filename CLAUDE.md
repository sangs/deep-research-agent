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
cd backend && poetry run uvicorn main:app --reload  # Start FastAPI backend (http://localhost:8000)
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

The News Hub calls a Python FastAPI backend; Deep Research calls a Next.js API route directly.

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
    → FastAPI backend  http://localhost:8000
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
- `app/api/news/route.ts` — Proxies News Hub requests to the FastAPI backend.
- `app/api/sources/route.ts` — Proxies source CRUD to the FastAPI backend.
- `lib/tools.ts` — Exa `webSearchTool`. Registered as `webSearch` server-side; client part type is `tool-webSearch`.
- `components/research-display.tsx` — Renders `message.parts`. Tool parts cast via `as unknown as {...}` (TypeScript doesn't know tool-specific types).
- `components/news-hub-section.tsx` — News Hub tab container with Global/Regional/Curated/Research tabs.
- `components/news-dashboard.tsx` — Renders topic clusters and article cards.
- `components/topic-group.tsx` — Collapsible cluster group with article count badge.
- `components/news-card.tsx` — Individual article card (title, domain chip, date, excerpt).
- `components/source-manager.tsx` — Manage curated sources (add/remove domains) for Blogs & Sites and Research tabs.
- `components/nav-links.tsx` — Top nav bar (Deep Research | News Hub).
- `context/section-context.tsx` — Shared React context for active section state.
- `lib/excerpt-utils.ts` — Text truncation helpers for article excerpts.

### Backend (`backend/`)
- `main.py` — FastAPI app. Routes: `POST /news`, `GET/POST /sources`.
- `services/exa_client.py` — Exa search + contents fetching, with region and time range support.
- `services/openrouter.py` — LLM calls via OpenRouter for topic clustering / summarisation.
- `tools/news_tools.py` — Orchestrates multi-query news fetching and cluster grouping.
- `tools/date_utils.py` — Converts time range labels (today/yesterday/past week/past month) to date filters.
- `models/schemas.py` — Pydantic request/response models.
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

Installed components: `button`, `badge`, `card`, `select`, `tabs`, `toggle`, `toggle-group`.

## News Hub — Tab Modes

| Tab | Backend endpoint | Time filter | Region filter |
|-----|-----------------|-------------|---------------|
| Global | `/news` mode=`global` | today / yesterday / past week / past month | — |
| Regional | `/news` mode=`regional` | today / yesterday / past week / past month | US / India / Europe / APAC / UK / LatAm |
| Blogs & Sites | `/news` mode=`curated` | today / yesterday / past week / past month | — |
| Research | `/news` mode=`research` | none (relevance-ranked) | — |
| Newsletter | — | — | Coming soon (Gmail integration planned) |

## Git Workflow

- Active branch: `feature-initial-research`
- Main branch: `main`
- `logs/` and `Notes/` are gitignored — test run logs stay local only.

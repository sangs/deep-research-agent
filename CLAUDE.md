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

# Backend (port 8010 locally; 8000 is used by other local projects such as cortex-drive)
cd backend && uv run uvicorn main:app --reload --port 8010  # FastMCP + Starlette backend (http://localhost:8010)
```

Both servers must be running for the full app to work. There are no tests in this project.

## Environment

`.env.local` (gitignored):
```
OPENROUTER_API_KEY=...
EXA_API_KEY=...
DATABASE_URL=...                 # Supabase Postgres (pooler)
AUTH_GOOGLE_ID=...               # Google OAuth web client id (not a secret)
AUTH_OWNER_EMAILS=a@x.com       # claims the migrated owner account at first sign-in (default: first AUTH_ALLOWED_EMAILS entry)
AUTH_ALLOWED_EMAILS=a@x.com,...  # legacy allowlist: new accounts with these emails start active instead of pending
# Optional: APP_DAILY_BUDGET_USD (all users, UTC day; default 10), AUTH_MAX_PENDING_REQUESTS (default 50)
GCP_PROJECT_NUMBER=101419070755  # for Secret Manager reads
# BACKEND_URL optional, defaults to http://localhost:8010
```

The Google OAuth **client secret** and the Auth.js **session key** are never in env vars. They live in GCP Secret Manager
(`auth-google-client-secret`, `auth-session-secret`) and are read at runtime by `lib/gcp-secrets.ts`: locally with your
`gcloud` login, on Vercel through Workload Identity Federation as `vercel-auth-reader`.

The backend reads `OPENROUTER_API_KEY`, `EXA_API_KEY`, `DATABASE_URL` (and on Cloud Run `GMAIL_TOKEN_JSON`) from `backend/.env` / Secret Manager.

Vercel (Production + Preview) additionally has `BACKEND_URL`, `GCP_WORKLOAD_IDENTITY_POOL_ID=vercel`,
`GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel-oidc`, `GCP_SERVICE_ACCOUNT_EMAIL` (vercel-invoker) and `GCP_AUTH_READER_SA_EMAIL` (vercel-auth-reader).

## Architecture

A Next.js 16 app (App Router) with two main sections:

1. **Deep Research Agent**: agentic multi-step web research with streaming UI
2. **News Intelligence Hub**: tabbed news dashboard (Global, Regional, Blogs & Sites, Research, Newsletter)

The News Hub calls a Python FastMCP + Starlette backend (Cloud Run in production); Deep Research calls a Next.js API route directly.

### Identity & access
The app is **private per user**: every user's history, digests, sources and usage are theirs alone; there is no sharing or
invite concept. Design: `documents/architecture/features/14-per-user-data-isolation-design-2026-10-27.md` (Phase A built;
B = Postgres RLS + signed backend assertion + isolation tests; C = each user connects their own Gmail).
- **Sign-in & approval:** `auth.ts` (Auth.js v5, Google) → `lib/users.ts` `resolveSignIn`. Identity is keyed by Google `sub`
  (`user_identities`), not email. An unknown verified Google account becomes a `pending` user; the owner approves it (or
  pre-approves an email) at `/admin`. Statuses: `pending` | `active` | `suspended`; roles: `owner` | `member` | `system`
  (the newsletter sweeps' cost account, never signs in). Every access change is written to `audit_log`.
- **Gate:** `proxy.ts` (Next 16's name for middleware) runs the `authorized` callback for every page and API route except
  `/api/auth/*` and `/privacy`: no session → sign-in (API 401); pending/suspended → `/access` (API 403 `access_pending|suspended`).
  Status is read through `getUserAccess` (cached 30 s per instance). Preview deployments skip app sign-in and act as the owner.
- **User id:** `lib/user-id.ts` `sessionUser()` / `sessionUserId()` return the **active** user from the session (null otherwise);
  `isOwner(user)` for owner-only routes. Every personal query filters on this id; by-id routes return 404 for other users' rows.
  Never trust a client-supplied user id.
- **New personal tables** get `user_id` → `users.id` `ON DELETE CASCADE` and indexes leading with `user_id`.
- **Owner-only today:** Newsletter (the only mailbox is the owner's), Gmail organize, background-summarizing controls,
  provider balances, `/admin`. The UI reads the role from `context/account-context.tsx` (hint only; APIs check server-side).
- **Spend:** per-user daily budget + rate limits (`lib/usage.ts`) plus an app-wide daily cap across all users.
- **Workload (Vercel → backend):** the Cloud Run backend is **private** (`run.invoker` = `vercel-invoker` only). `lib/backend-auth.ts` mints a
  Google ID token through `lib/gcp-wif.ts` (Vercel OIDC → STS → IAM Credentials), with no stored keys. Operators use
  `gcloud auth print-identity-token` or `gcloud run services proxy backend --region=us-central1`.

### Deep Research Data Flow
```
components/research-section.tsx  (useChat + module-level DefaultChatTransport)
  → POST /api/research
    → streamText() with webSearch tool (up to 10 steps)
      → exa.searchAndContents() for each search
    → toUIMessageStreamResponse()  (SSE)
  → messages.parts rendered by ResearchDisplay
```

### News Hub Data Flow
```
components/news-category-panel.tsx → useNewsStream (components/news-display.tsx)
  → POST /api/news  (Next.js route; adds the Bearer ID token from lib/backend-auth.ts)
    → backend POST /digest (SSE)  — http://localhost:8010 locally, private Cloud Run in prod
      → services/openrouter.py run_news_agent (tool loop) → services/exa_client.py → Exa
      → services/gmail_service.py run_gmail_digest (Newsletter) → Gmail API + OpenRouter
  → results rendered by NewsDisplay / NewsPanel / TopicGroup / NewsCard
Digest cache + saved digests: /api/history/news[/list] → Supabase news_digests (Drizzle)
```

### Source Management
```
components/source-manager.tsx
  → GET/POST /api/sources  (Next.js route, Drizzle directly; scoped to the signed-in user)
    → Supabase curated_sources (one copy per user, seeded from default_sources on activation)
backend: tools/news_tools.load_sources(user_id) — the requesting user's lists; no user (MCP) → default_sources
```

## Key Files

### Frontend
- `app/page.tsx` — Dual-section layout; research session id + history drawer wiring.
- `auth.ts`, `proxy.ts`, `app/api/auth/[...nextauth]/route.ts` — sign-in and the access gate (see Identity & access).
- `lib/gcp-wif.ts` — shared Workload Identity Federation steps; `lib/backend-auth.ts` (ID tokens for Cloud Run), `lib/gcp-secrets.ts` (Secret Manager reads).
- `lib/users.ts` — users, sign-in resolution, access cache, owner actions (approve/reject/suspend/reactivate/pre-approve), audit log.
- `lib/user-id.ts` — server-side session user (`sessionUser`, `isOwner`); `lib/auth-allowlist.ts` — bootstrap env vars, preview detection.
- `app/access/page.tsx` — pending / suspended landing page. `app/admin/page.tsx` + `app/api/admin/users` — owner console (accounts + spend only).
- `app/api/research/route.ts` — Deep Research agentic loop. Uses `streamText` with `stopWhen: stepCountIs(10)`. Model: `~google/gemini-flash-latest` via OpenRouter.
- `app/api/news/route.ts` — Proxies News Hub requests to the backend `/digest` with a Bearer ID token; failures become an SSE `error` event.
- `app/api/sources/route.ts` — Curated source CRUD directly against Supabase (Drizzle).
- `app/api/history/research[/[id]]`, `app/api/history/news[/list]` — research sessions, digest cache, saved digests (Drizzle → Supabase).
- `lib/history-client.ts` — client fetch helpers + cache-key builders for the history routes.
- `lib/tools.ts` — Exa `webSearchTool`. Registered as `webSearch` server-side; client part type is `tool-webSearch`.
- `components/research-display.tsx` — Renders `message.parts`. Tool parts cast via `as unknown as {...}` (TypeScript doesn't know tool-specific types).
- `components/news-hub-section.tsx` — News Hub tab container (5 tabs).
- `components/news-category-panel.tsx` — Per-tab run, cache check/save, Newsletter lock/unlock, follow-up threads.
- `components/news-dashboard.tsx` — Renders topic clusters and article cards.
- `components/topic-group.tsx` — Collapsible cluster group with article count badge.
- `components/news-card.tsx` — Individual article card (title, domain chip, date, excerpt). Clicking the card body opens a Sheet drawer with full structured summary and links. Title link still navigates externally. Sheet is only imported on client (`'use client'`).
- `components/saved-digests-drawer.tsx` — Saved Digests library (rename, tags, unlock).
- `components/source-manager.tsx` — Manage curated sources (news_sites, research_sites, newsletters, global_news_sites).
- `components/nav-links.tsx` — Top nav bar (Deep Research | News Hub); sign-out button is in `app/layout.tsx`.
- `context/section-context.tsx` — Shared React context for active section state.
- `lib/excerpt-utils.ts` — Text truncation helpers for article excerpts.
- `lib/date-utils.ts` — Centralized date/time formatting, cache-key date resolution, and browser-timezone lookup; components import from here rather than defining local `formatDate`/`formatTimestamp`/etc. helpers.

### Backend (`backend/`)
- `main.py` — FastMCP server + Starlette app. Routes: `POST /digest` (SSE), `/gmail/*` (organize, owner-only via `/api/gmail`), `/ingest/status|settings|run` (owner controls via `/api/newsletter/ingest`) and `Mount /mcp` (MCP streamable HTTP; effective path `/mcp/mcp`).
- `services/ingest.py` + `jobs/ingest.py` — Newsletter background summarizing: runs with > 40 unsummarized emails queue an `ingest_jobs` row and start the Cloud Run Job `newsletter-ingest` (`python -m jobs.ingest`); Cloud Scheduler also starts it every 30 min. Locally (no `INGEST_JOB_NAME`) the worker runs in-process. Owner pause switch: `app_settings`.
- `services/exa_client.py` — Exa search + contents fetching, with domain allowlists, date filters and excerpt cleaning.
- `services/openrouter.py` — `run_news_agent`: OpenRouter tool-calling loop; the LLM returns article IDs and Python assembles the digest.
- `tools/news_tools.py` — `load_sources(user_id)` (per-user `curated_sources`, or `default_sources` for MCP) and the `@mcp.tool` functions (`list_sources` is read-only).
- `services/users.py` — `owner_user_id()` for owner-only newsletter work with no requesting user (scheduled sweeps).
- `tools/date_utils.py` — Converts time range labels (today/yesterday/past week/past month) to timezone-aware date filters (`resolve_date_range`). Also houses `resolve_tz` (shared IANA-timezone-with-UTC-fallback resolver), `format_header_date` (RFC 2822 email header → reader-timezone `YYYY-MM-DD`), and `now_iso()` (current-instant timestamp helper) — the single home for all backend date/time logic.
- `models/schemas.py` — Pydantic request/response models. `ArticleItem` includes `links: list[str] = []` (newsletter-only; safe default for other tabs).
- `services/gmail_service.py` — Gmail OAuth + newsletter digest. Fetches emails, clusters by topic via LLM, summarizes with structured headline+bullets format, and populates `links` with up to 5 deduplicated article URLs per email.
- `services/db.py` — asyncpg pool (`statement_cache_size=0` for Supabase PgBouncer).
- `scripts/refresh_gmail_token.sh` — one-command Gmail token renewal for Cloud Run (config in gitignored `scripts/refresh_gmail_token.env`).
- `config/default_sources.json` — legacy, unreferenced by code (defaults live in the `default_sources` table).

## Code Conventions

- **No duplicated logic.** If the same behavior (parsing, formatting, validation, etc.) is needed in more than one file, extract it into a named, exported function in a shared module and have every call site import it — never copy-paste a function body across files. `lib/date-utils.ts` (frontend) and `backend/tools/date_utils.py` (backend) are the canonical homes for date/time logic specifically — check both before adding a new date/time helper anywhere else.

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
model: openrouter('~google/gemini-flash-latest')

// ✅ Correct — uses Chat Completions
model: openrouter.chat('~google/gemini-flash-latest')
```

## shadcn/ui

Style: New York, base color: Neutral, CSS variables enabled. Components live in `components/ui/`. Add new ones with `npx shadcn@latest add <name>`.

Installed components: `button`, `badge`, `card`, `select`, `sheet`, `tabs`, `toggle`, `toggle-group`.

## News Hub — Tab Modes

| Tab | `mode` sent to `/digest` | Time filter | Region filter |
|-----|-----------------|-------------|---------------|
| Global | `general` | today / yesterday / past week / past month | — |
| Regional | `region` (+ `region`) | today / yesterday / past week / past month | US / India / Europe / APAC / UK / LatAm |
| Blogs & Sites | `curated` | today / yesterday / past week / past month | — |
| Research | `research` | none (relevance-ranked) | — |
| Newsletter | `newsletter` | today / yesterday / past week / past month / custom range | — |

## Git Workflow

- Active branch: `feature-initial-research`
- Main branch: `main`
- `documents/` is gitignored — test run logs stay local only. (`Notes/` was merged into `documents/` on 2026-07-20; it no longer exists as a separate directory.)

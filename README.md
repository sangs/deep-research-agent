# Deep Research Agent

An AI research suite built with Next.js 16 and the AI SDK v6, with two sections:

- **Deep Research**: an agent that searches the web (Exa) over several steps, streams its progress, and writes a cited report.
- **News Hub**: tabbed AI-curated news (Global, Regional, Blogs & Sites, Research) plus a **Newsletter** digest of a Gmail inbox, served by a Python FastMCP + Starlette backend.

Sign-in is required: Google accounts on an email allowlist (Auth.js). In production the backend is a **private** Cloud Run
service that the Vercel app calls with keyless Workload Identity Federation (no stored Google keys).

## Prerequisites

- Node.js 20+
- Python 3.12+ and [uv](https://docs.astral.sh/uv/getting-started/installation/)
- [gcloud](https://cloud.google.com/sdk/docs/install), signed in (`gcloud auth login`) with access to the GCP project. Locally, the
  sign-in secrets are read from Secret Manager with your gcloud login
- API keys: [OpenRouter](https://openrouter.ai), [Exa](https://exa.ai); a Supabase Postgres `DATABASE_URL`

## Local setup

### 1. Install dependencies

```bash
npm install
cd backend && uv sync && cd ..
```

### 2. Environment

`.env.local` (project root, gitignored):

```bash
OPENROUTER_API_KEY=...
EXA_API_KEY=...
DATABASE_URL=...
# Google sign-in. Not secrets: the OAuth client secret and session key are read from
# GCP Secret Manager at runtime (your gcloud login locally, Workload Identity Federation on Vercel)
AUTH_GOOGLE_ID=<oauth web client id>
AUTH_ALLOWED_EMAILS=you@example.com            # comma-separated allowlist
GCP_PROJECT_NUMBER=<gcp project number>
# Optional: BACKEND_URL defaults to http://localhost:8010
```

`backend/.env` holds `OPENROUTER_API_KEY`, `EXA_API_KEY`, `DATABASE_URL` for the Python backend. The Newsletter tab also needs a Gmail
OAuth token at `~/gmail_token.json` (see `services/gmail_service.py` for the one-time setup).

### 3. Start both services

```bash
# Terminal 1: backend on port 8010 (8000 is left free for other local projects)
cd backend && uv run uvicorn main:app --reload --port 8010

# Terminal 2: frontend on port 3001
npm run dev
```

Open **http://localhost:3001**, sign in with an allowlisted Google account, then use **Deep Research** or **News Hub**.
The OAuth client must list `http://localhost:3001/api/auth/callback/google` as a redirect URI.

### 4. Health check

| Check | Command | Expected |
|---|---|---|
| Backend up | `curl -s -X POST localhost:8010/digest -d x` | `{"error":"invalid json"}` |
| Frontend gate | `curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/sources` | `401` (sign-in required) |
| Sign-in config (reads secrets via gcloud) | `curl -s localhost:3001/api/auth/providers` | JSON with `"google"` |

## Commands

```bash
npm run dev      # Next.js dev server (http://localhost:3001)
npm run build    # Production build + type check
npm run lint     # ESLint
npx tsc --noEmit # Type check only
```

## MCP server

The backend also exposes its news tools over MCP (streamable HTTP) at **`/mcp/mcp`**: `news_search_general`, `news_search_region`,
`news_search_curated`, `news_search_research`, `manage_sources`, `get_news_digest`.

> **Known issue:** `/mcp/mcp` currently returns HTTP 500 (`Task group is not initialized`). The FastMCP app's lifespan isn't
> passed to the parent Starlette app in `backend/main.py`. The fix is pending.

- Local: `http://localhost:8010/mcp/mcp`
- Production (private Cloud Run): open an authenticated tunnel, then point the MCP client at the tunnel:
  ```bash
  gcloud run services proxy backend --region=us-central1 --project=<gcp-project-id>   # → http://localhost:8080/mcp/mcp
  ```

## Gmail token refresh (production)

When the Newsletter tab fails with `invalid_grant`, run `./backend/scripts/refresh_gmail_token.sh` after creating
`backend/scripts/refresh_gmail_token.env` from the `.env.example` next to it (gitignored; holds the project ID and backend URL).

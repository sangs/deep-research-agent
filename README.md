# Deep Research Agent

An AI-powered research agent built with Next.js 15 and the AI SDK. Submit a research query and the agent autonomously searches the web using Exa, streams results in real-time, and synthesizes findings with sources.

## Prerequisites

- Node.js 18+
- An [OpenRouter](https://openrouter.ai) API key
- An [Exa](https://exa.ai) API key

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root:

```bash
OPENROUTER_API_KEY=your_openrouter_api_key
EXA_API_KEY=your_exa_api_key
```

### 3. Start the development server

```bash
npm run dev
```

The app runs at **http://localhost:3001**.

## Usage

1. Open http://localhost:3001 in your browser
2. Enter a research question in the search box
3. The agent will search the web iteratively (up to 10 steps) and stream results as it works
4. Sources and synthesized findings appear in real-time

## Other Commands

```bash
npm run build    # Production build + type check
npm run lint     # Run ESLint
npx tsc --noEmit # Type check only
```

---

## Applied-Research Skill — News Intelligence Hub

The News Hub is an additional skill that adds AI-aggregated news from global sources, curated newsletters, or by region. It requires a separate Python backend (FastMCP) running alongside the Next.js app.

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/getting-started/installation/) package manager

### 1. Set up the Python backend

```bash
cd backend
uv sync          # install dependencies from pyproject.toml
```

The backend reads API keys from `backend/.env` (already populated with the same keys as `.env.local`).

### 2. Start the services

Open two terminals from the `deep-research-agent/` directory.

**Terminal 1 — Python MCP backend (port 8000)**

Start the server and redirect logs to a file so you can tail them separately:

```bash
cd backend
uv run python main.py > /tmp/backend.log 2>&1 &
echo "Backend PID: $!"
```

Tail the backend log in the same terminal:

```bash
tail -f /tmp/backend.log
```

Expected startup output:

```
INFO:     Started server process [<pid>]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**Terminal 2 — Next.js frontend (port 3001)**

Start the dev server and redirect logs:

```bash
npm run dev > /tmp/frontend.log 2>&1 &
echo "Frontend PID: $!"
```

Tail the frontend log in the same terminal:

```bash
tail -f /tmp/frontend.log
```

Expected startup output:

```
▲ Next.js 16.x
- Local: http://localhost:3001
✓ Ready in Xs
```

### 3. Health check

After both services start, verify they are healthy:

| Check | Command | Expected |
|-------|---------|----------|
| Backend process listening | `lsof -ti :8000` | Returns a PID |
| Frontend process listening | `lsof -ti :3001` | Returns a PID |
| Backend `/sources` endpoint | `curl -s http://localhost:8000/sources` | JSON with `"news_sites"` array of 20 domains and `"newsletters": []` |
| Frontend `/news` route | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/news` | `200` |

Run all four checks in one shot:

```bash
echo "Backend PID : $(lsof -ti :8000)"
echo "Frontend PID: $(lsof -ti :3001)"
echo "Backend /sources:" && curl -s http://localhost:8000/sources
echo ""
echo "Frontend /news HTTP:" && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/news
```

### 4. Stop the services

```bash
kill $(lsof -ti :8000)   # stop backend
kill $(lsof -ti :3001)   # stop frontend
```

### 5. Open the News Hub

Navigate to **http://localhost:3001/news**

The dashboard has four independent panels that all run simultaneously when you click **Run**:

| Panel | Description |
|-------|-------------|
| **Global News** | Breaking and trending news from worldwide sources |
| **Regional News** | News filtered to the selected region (US, India, Europe, APAC, UK, LatAm) |
| **News Sites & Blogs** | AI/ML coverage from 20 curated tech news sites and engineering blogs |
| **Newsletter Subscriptions** | Placeholder — Gmail integration coming soon |

**Workflow:**

1. *(Optional)* Type a natural-language question in the text box — e.g. `"AI/ML news from thoughtworks and infoq"` or `"Fintech news with high scale database usage"`. The question overrides or sharpens the filter selections.
2. Choose a **time range** (Today / Yesterday / Past Week / Past Month).
3. Choose a **region** for the Regional News panel.
4. Click **Run** — all three live panels fetch simultaneously; search progress badges stream in each panel header in real time.
5. Click **Manage Sources** to add or remove domains from the News Sites & Blogs panel. Changes persist to `backend/config/default_sources.json`.

### Connecting Claude Code to the MCP server

Add to `~/.claude/settings.json` to expose the news tools directly to Claude Code:

```json
{
  "mcpServers": {
    "news-hub": { "url": "http://localhost:8000/mcp/sse" }
  }
}
```

Available MCP tools: `news_search_general`, `news_search_region`, `news_search_curated`, `manage_sources`, `get_news_digest`.

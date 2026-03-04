# /test-hub — Randomised Browser Automation Test Suite

Run automated browser tests against the Deep Research Agent + News Intelligence Hub app at
`http://localhost:3001`. Picks random queries from predefined pools, exercises every section/tab,
writes per-test log files, a consolidated analysis, and updates `deep-research-agent/notes/TODO.md`.

**Usage:** `/test-hub` (all sections) | `/test-hub quick` (skip Deep Research)

---

## Step 0 — Start / Restart Servers

Before doing anything else, ensure the backend and frontend servers are running on a fresh instance.
If they are already active, restart them; otherwise start them from scratch.

```sh
# kill any existing processes (macOS):
pkill -f "uvicorn" || true
pkill -f "npm run dev" || true

# start backend (from project root):
cd deep-research-agent/backend && poetry run uvicorn main:app --reload &

# start frontend (from project root):
cd deep-research-agent && npm run dev &
```

Wait a few seconds for both servers to bind to their ports before proceeding to Step 1.

---

## Step 1 — Capture Timestamp & Roll Queries

Capture the current timestamp in format `YYYY-MM-DD-HH-MM`. This string is used in ALL filenames.

Select one query at random from each pool below. Use `Math.random()` mentally or just pick
whichever feels non-obvious (avoid always picking the first entry):

### Query Pools

**Deep Research Pool** (pick 1):
- quantum computing breakthroughs
- AI in drug discovery
- nuclear fusion 2025
- autonomous vehicle regulation
- carbon capture technology
- LLM multi-step reasoning
- central bank digital currencies
- gene editing in agriculture

**Global News Pool** (pick 1):
- artificial intelligence regulation
- climate technology startups
- semiconductor supply chain
- generative AI enterprise adoption
- open-source AI models

**Regional News Pool** (pick 1 pair — query + region):
- Silicon Valley AI investments → region: US
- India tech sector growth → region: India
- European AI Act implementation → region: Europe
- Japan robotics industry → region: APAC
- UK fintech regulation → region: UK
- LatAm digital transformation → region: LatAm

**Curated Blogs Pool** (pick 1):
- transformer architecture improvements
- fine-tuning large language models
- AI safety research
- multimodal model capabilities
- AI agents tool use

**Research Papers Pool** (pick 1):
- reinforcement learning from human feedback
- mechanistic interpretability
- sparse autoencoders
- AI alignment advances
- in-context learning limits

---

## Step 2 — Open the App

Use `mcp__claude-in-chrome__tabs_context_mcp` then `mcp__claude-in-chrome__tabs_create_mcp` to
open a new browser tab, then navigate to `http://localhost:3001`.

Take a screenshot to confirm the page loaded. If the page is blank or shows an error, stop and
report — do not proceed.

---

## Step 3 — DEEP RESEARCH TEST (skip if invoked with `quick`)

### 2a. Locate the search interface
- Confirm the heading or label "Deep Research" (or similar) is visible on the page.
- Use `mcp__claude-in-chrome__find` to locate the query input field (search box / textarea).

### 2b. Submit the rolled Deep Research query
- Click the input, type the rolled query, submit (press Enter or click the submit button).
- Observe the streaming state: wait until the UI is no longer in a "loading" or "streaming" state.
  Poll by taking screenshots every few seconds (up to 60 s total).

### 2c. Capture output
- Read the page for: search/source badges, any source cards, the final answer text (first ~200 chars).
- Note: article/source count, any error messages, latency estimate.

### 2d. Write log file
Write `deep-research-agent/logs/deep-research-TIMESTAMP.md` using the template at the bottom of
this file. Set Result to **PASS** if a non-empty answer was returned with no error UI visible,
otherwise **FAIL**.

---

## Step 4 — NEWS HUB: GLOBAL TAB

### 3a. Navigate to News Hub
- Click the "News Hub" button/link in the navigation.
- Confirm the News Hub section is now visible (look for tab labels: Global, Regional, Curated, Research).
- Confirm "Global" tab is active (selected / underlined).

### 3b. Submit the rolled Global query
- Leave time_range at its default (`today` or whatever is pre-selected).
- Type the rolled global query into the input, click Run (or press Enter).
- Wait for the loading state to finish — look for "done" event indicators, absence of spinner,
  or status text change. Poll up to 45 s.

### 3c. Capture output
- Article count, topic clusters count, first headline text, any visible errors.

### 3d. Write log file
Write `deep-research-agent/logs/news-global-TIMESTAMP.md`.

---

## Step 5 — NEWS HUB: REGIONAL TAB

### 4a. Click the Regional tab
- Click the tab labelled "Regional" inside the News Hub section.

### 4b. Set region + query
- Find the region dropdown/select. Choose the rolled region (US / India / Europe / APAC / UK / LatAm).
- Type the rolled regional query into the input.
- Click Run.
- Wait up to 45 s for completion.

### 4c. Capture output
- Article count, region confirmation, first headline, errors.

### 4d. Write log file
Write `deep-research-agent/logs/news-regional-TIMESTAMP.md`.

---

## Step 6 — NEWS HUB: CURATED TAB

### 5a. Click the Curated tab
### 5b. Submit the rolled Curated query
- Type query, click Run, wait up to 45 s.
### 5c. Capture output
- Source/domain badges visible, article count, first headline, errors.
### 5d. Write log file
Write `deep-research-agent/logs/news-curated-TIMESTAMP.md`.

---

## Step 7 — NEWS HUB: RESEARCH TAB

### 6a. Click the Research tab
### 6b. Submit the rolled Research query
- There is no time filter in Research mode — just type query and click Run.
- Wait up to 60 s (research queries may be slower).
### 6c. Capture output
- Paper/article count, topic groupings, first result title, errors.
### 6d. Write log file
Write `deep-research-agent/logs/news-research-TIMESTAMP.md`.

---

## Step 8 — CONSOLIDATED ANALYSIS

Write `deep-research-agent/logs/research_and_comments_TIMESTAMP.md` with the following structure:

```markdown
# Research & Comments — YYYY-MM-DD HH:MM

## Test Run Summary
| Section | Query | Result |
|---|---|---|
| Deep Research | <query> | PASS/FAIL/SKIPPED |
| News Global | <query> | PASS/FAIL |
| News Regional | <query> (region: X) | PASS/FAIL |
| News Curated | <query> | PASS/FAIL |
| News Research | <query> | PASS/FAIL |

## Observations
<What worked well, what looked off, UI quirks noticed>

## Recommendations
<Concrete suggestions to fix any failures or improve UX>

## Performance Insights
<Latency estimates per section, streaming smoothness, any timeouts>

## Usability Feedback
<Navigation clarity, input affordances, result readability>

## Potential Enhancements
<New features or improvements worth adding — these feed into TODO.md>
```

---

## Step 9 — TODO.md MANAGEMENT

### 9a. Read existing TODO.md
Read `deep-research-agent/notes/TODO.md` if it exists. Note every item and its status.

### 9b. Reconcile
For each **Potential Enhancement** identified in Step 8:
- If the feature already works correctly in testing → find its TODO entry and mark it ✅ Done.
- If the enhancement is NOT yet in TODO.md → append it as a new item.
- Never duplicate items that already exist (match by description, not exact text).

### 9c. Write updated TODO.md
Preserve existing items. Add new ones under an appropriate section. Write to
`deep-research-agent/notes/TODO.md` (create the `notes/` directory if it doesn't exist). Format:
```markdown
# TODO — Deep Research Agent + News Intelligence Hub

## Bugs / Fixes
- [ ] ...

## Enhancements
- [ ] ...
- [x] ✅ Done — <item that now works>

## Ideas
- [ ] ...
```

---

## Individual Log File Template

Use this template for each of the 5 per-test log files:

```markdown
# Test: <Section / Tab Name>
**Date:** YYYY-MM-DD | **Time:** HH:MM | **Run ID:** YYYY-MM-DD-HH-MM

## Input
- Query: "<query text>"
- Mode: <Global | Regional | Curated | Research | Deep Research>
- Time Range: <value or N/A>
- Region: <value or N/A>

## Observed Output
- Status: <idle | loading | done | error>
- Articles / Sources found: <N or unknown>
- Topics / Clusters: <N or unknown>
- Sample result: <first headline or first ~100 chars of answer>

## Errors
<none — or paste error message>

## Result
**PASS** / **FAIL**

## Notes
<latency, UI quirks, unexpected behaviour, screenshot observations>
```

---

## Completion Checklist

Before finishing, confirm:
- [ ] `deep-research-agent/logs/deep-research-TIMESTAMP.md` written (or skipped in quick mode)
- [ ] `deep-research-agent/logs/news-global-TIMESTAMP.md` written
- [ ] `deep-research-agent/logs/news-regional-TIMESTAMP.md` written
- [ ] `deep-research-agent/logs/news-curated-TIMESTAMP.md` written
- [ ] `deep-research-agent/logs/news-research-TIMESTAMP.md` written
- [ ] `deep-research-agent/logs/research_and_comments_TIMESTAMP.md` written
- [ ] `deep-research-agent/notes/TODO.md` created or updated (no duplicate entries)

Report a final summary to the user: which sections passed, which failed, and the path to the
consolidated analysis file.

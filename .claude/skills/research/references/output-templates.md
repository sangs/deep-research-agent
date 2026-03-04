# Output Templates

## Format Selection Guide

| Signal in user request | Format |
|------------------------|--------|
| "quickly", "what is", "define", "brief", follow-up question | **Brief** |
| Default (no format signal) | **Standard** |
| "detailed", "report", "analysis", "deep dive", "in-depth", "comprehensive" | **Detailed Report** |

---

## Brief Format (100–300 words)

Use for: quick factual lookups, definitions, simple "what is X" questions, follow-up clarifications.

```
[Direct answer to the question in 1-2 sentences]

**Key facts:**
- [fact 1]
- [fact 2]
- [fact 3]

**Sources:**
- [Title](URL)
- [Title](URL)
```

---

## Standard Format (400–800 words)

Use for: most research requests without explicit format signals.

```
## [Topic]

### Summary
[2–4 sentence overview of the most important findings. Lead with the "so what".]

### Key Findings

**[Finding 1 heading]**
[2–3 sentences. Cite confidence markers if needed.]

**[Finding 2 heading]**
[2–3 sentences.]

**[Finding 3 heading]**
[2–3 sentences.]

**[Finding 4 heading — optional]**
[2–3 sentences.]

### Context
[1–2 paragraphs situating the topic: history, trends, why it matters now, who the key players are.]

### Sources
- [Title](URL) — [one-phrase description of what this source contributes]
- [Title](URL) — [one-phrase description]
- [Title](URL) — [one-phrase description]
- [Title](URL) — [one-phrase description]
```

---

## Detailed Report Format (800–2,000 words)

Use for: explicit report requests, deep dives, briefings for decision-making.

```
## Research Report: [Topic]
*[Date of research]*

---

### Executive Summary
[3–5 sentences. The single most important paragraph: what is the topic, what did you find, and what does it mean? Written for a reader who will only read this section.]

---

### Background
[1–2 paragraphs on context: What is this? Where did it come from? Why is it being asked about now?]

---

### Key Findings

#### [Finding Category 1]
[2–4 sentences. Factual claims with source attribution. Use confidence markers.]

#### [Finding Category 2]
[2–4 sentences.]

#### [Finding Category 3]
[2–4 sentences.]

#### [Finding Category 4]
[2–4 sentences.]

#### [Finding Category 5 — optional]
[2–4 sentences.]

---

### Analysis
[2–3 paragraphs interpreting the findings. What patterns emerge? What tensions or tradeoffs exist? What does this mean for the user's likely use case?]

---

### Limitations
[Brief paragraph on gaps: What couldn't you verify? Where were sources thin? What would require primary research or expert consultation to answer definitively?]

---

### Recommendations
[2–4 actionable bullets based on the findings. Frame as "If you are doing X, then Y." Only include when genuinely useful — skip for purely informational topics.]

---

### Sources

| Source | URL | Key contribution |
|--------|-----|-----------------|
| [Title] | [URL] | [What claim this supports] |
| [Title] | [URL] | [What claim this supports] |
| [Title] | [URL] | [What claim this supports] |
| [Title] | [URL] | [What claim this supports] |
| [Title] | [URL] | [What claim this supports] |
```

---

## Inline Confidence Markers

Append these immediately after a claim that needs qualification:

| Marker | When to use |
|--------|-------------|
| `[single source]` | Only one source supports this specific claim |
| `[conflicting sources]` | Multiple sources disagree; you've reported both views |
| `[unverified]` | Could not find a credible source confirming the claim |
| `[outdated]` | Most recent source is 2+ years old on a fast-moving topic |

**Usage examples:**
- "TypeScript was used by 78% of developers in 2024 `[single source]`"
- "Performance overhead is negligible `[conflicting sources]` — some benchmarks show 5% overhead while others show 20%"
- "The project has 50,000 GitHub stars `[outdated — data from 2022]`"

Use sparingly. Don't mark every sentence — only where a reasonable reader would want to know about uncertainty.

---

## Professional Consultation Caveat

For medical, legal, or financial topics, add this note near the top of your output (after the summary):

> *Note: This research is for informational purposes. For [medical decisions / legal matters / financial decisions], please consult a qualified [physician / attorney / financial advisor].*

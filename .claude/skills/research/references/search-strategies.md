# Search Strategies

## The Six Query Patterns

### 1. Anchor Query
Direct, literal search for the topic. This is your baseline.

**Pattern**: `[topic] [key aspect]`
**Example**: `WebAssembly server-side runtime 2025`

---

### 2. Recency Query
Force recent results by appending the current year or recency markers.

**Pattern**: `[topic] [year] OR latest OR recent`
**Example**: `WebAssembly server-side 2026 latest developments`

Use when: the topic evolves quickly (tech, markets, policy, research)
Skip when: the topic is historical or definitional

---

### 3. Criticism / Problems Query
Surface limitations, failures, and critical perspectives for a balanced view.

**Pattern**: `[topic] problems OR limitations OR criticism OR "what's wrong with"`
**Examples**:
- `WebAssembly limitations server-side`
- `problems with HTMX at scale`
- `machine learning criticism bias`

Always run this query — balanced reporting requires it.

---

### 4. Expert / Technical Query
Use domain vocabulary to find authoritative, specialist content.

**Pattern**: `[technical term] [domain vocabulary] site:[authoritative domain]`
**Examples**:
- `WASM WASI component model specification`
- `TypeScript structural typing performance tradeoffs`

Use when: the user is likely technical or wants depth

---

### 5. Comparative Query
Contextualize the topic against alternatives.

**Pattern**: `[topic] vs [alternative] OR [topic] compared to OR alternatives to [topic]`
**Examples**:
- `WebAssembly vs native code server performance`
- `HTMX vs React tradeoffs`
- `alternatives to TypeScript 2025`

Use when: the topic is a tool, technology, or approach with competitors

---

### 6. Primary Source Query
Find official documentation, research papers, or primary data.

**Pattern**: `[topic] site:[official domain] OR "[topic]" filetype:pdf OR [topic] research paper`
**Examples**:
- `WebAssembly site:webassembly.org`
- `TypeScript adoption survey 2025`
- `"machine learning" IEEE research paper 2025`

Use when: you need authoritative claims or statistics to cite

---

## Source Credibility Hierarchy

Prefer sources in this order:

1. **Primary sources**: Official docs, spec sites, original research papers, government data
2. **Expert synthesis**: Academic blogs by known researchers, technical conference talks, peer-reviewed summaries
3. **Quality journalism**: Major tech publications (Wired, Ars Technica, The Verge), mainstream news for factual claims
4. **Community knowledge**: StackOverflow (for technical facts), GitHub discussions, developer surveys (State of JS, JetBrains)
5. **General reference**: Wikipedia (useful for overview and links, not for citing statistics)

Avoid: SEO content farms, undated articles, sites with no clear authorship

---

## `site:` Operator Tactics

Use `site:` to target authoritative domains:

| Domain | Best for |
|--------|----------|
| `site:github.com` | Open source project docs, issues, discussions |
| `site:developer.mozilla.org` | Web platform specs and guides |
| `site:arxiv.org` | ML/CS research preprints |
| `site:stackoverflow.com` | Technical questions with community consensus |
| `site:news.ycombinator.com` | Developer community reactions and links |
| `site:[official-project].org` | Authoritative project documentation |

---

## When Searches Return Poor Results

If the first search returns irrelevant or low-quality results:

1. **Rephrase**: Use synonyms or the official technical name (e.g., "WASM" → "WebAssembly")
2. **Narrow**: Add a qualifier (year, domain, use case)
3. **Broaden**: Remove a specific qualifier that may be too niche
4. **Use operators**: Try `"exact phrase"` for precise matches
5. **Try a different angle**: Switch from the anchor query to the expert or primary source query

If 3+ rephrased queries all return poor results, note in your output that sources were limited and flag affected claims with `[single source]` or `[unverified]`.

---

## Multi-Query Coordination

**Convergence as credibility**: When 3+ independent sources (different domains, different authors) report the same fact, treat it as well-established. You don't need to caveat every sentence.

**Divergence as a signal**: When sources disagree, investigate why. Common reasons:
- Different time periods (report the most recent with a date)
- Different definitions of the same term (clarify which definition applies)
- Genuine expert disagreement (report both views with `[conflicting sources]`)

**Diminishing returns**: After 5–8 sources, additional searches rarely change the picture. Stop searching and start synthesizing.

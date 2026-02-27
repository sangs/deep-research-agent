# Clarification Guide

## Decision Tree

```
Is the topic specific and unambiguous?
  YES → Proceed directly
  NO  ↓

Does the topic have 3+ radically different interpretations?
  NO  → Proceed directly (pick the most common interpretation, note it)
  YES ↓

Would a different interpretation lead to completely different research?
  NO  → Proceed with broadest reasonable interpretation
  YES → Ask ONE clarifying question
```

---

## Examples: Clear vs. Ambiguous Queries

| Query | Verdict | Reason |
|-------|---------|--------|
| "Research WebAssembly for server-side use cases" | **Proceed** | Specific topic, clear intent |
| "Latest developments in TypeScript 5.x" | **Proceed** | Specific version, clear recency intent |
| "What is HTMX?" | **Proceed** | Definition request, brief format implied |
| "Research machine learning" | **Ask** | Broad topic: could mean intro, latest research, tools, business applications, or ethics |
| "Find information on Python" | **Ask** | Could mean language overview, latest version, libraries, career info, or specific use case |
| "Research AI" | **Ask** | Extremely broad — ask for a subtopic or angle |
| "Give me a detailed report on TypeScript adoption in large companies" | **Proceed** | Format (detailed report) and scope (large companies) both specified |
| "Quickly look up what HTMX is" | **Proceed** | "Quickly" signals brief format; topic is unambiguous |

---

## Good vs. Bad Clarification Questions

### GOOD: Focused, gives examples
> "Before I start, quick question: what angle on machine learning are you most interested in?
> (e.g., introductory overview / latest research breakthroughs / practical tools and frameworks / business/industry applications)"

### BAD: Too open-ended
> "What would you like to know about machine learning?"

### GOOD: Clarifies the decision-changing variable
> "Before I start, quick question: is this research for a technical audience or a general one?
> (e.g., engineers/researchers / business decision-makers / general public)"

### BAD: Asks about mechanics the user doesn't care about
> "How many sources would you like me to use?"
> "Should I include a sources section?"
> "How detailed should the output be?"
> "What language do you want the output in?"

---

## What to Never Ask

- Whether to include sources (always include them)
- How thorough to be (infer from the request)
- What language to use (use the same language as the user's query)
- Whether to search the web (always search; that's the skill's purpose)
- Anything that has a clear default answer

---

## Acknowledging Clarification Efficiently

After the user answers a clarifying question, confirm briefly and proceed:

> "Got it — focusing on [their answer]. Let me search for that."

Do not ask follow-up questions about their answer unless it introduces a new genuine ambiguity.

---

## Handling Borderline Cases

When you're not sure whether to ask, **default to proceeding**. Pick the most likely interpretation, state it briefly at the start of your output ("I've interpreted this as a question about X — let me know if you meant something else"), and complete the research.

This is almost always better than delaying with a question.

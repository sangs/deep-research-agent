# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (http://localhost:3001)
npm run build    # Production build + type check
npm run lint     # Run ESLint
npx tsc --noEmit # Type check only
npx shadcn@latest add <component>  # Add a new shadcn/ui component
```

There are no tests in this project.

## Environment

Requires `.env.local` with:
```
OPENROUTER_API_KEY=...
EXA_API_KEY=...
```

## Architecture

A single-page Next.js 15 app (App Router). The user submits a research query → the client streams responses from the API route → the UI renders search badges and source cards in real-time as the agent works.

**Data flow:**
```
app/page.tsx  (useChat + DefaultChatTransport)
  → POST /api/research
    → streamText() with webSearch tool (up to 10 steps)
      → exa.searchAndContents() for each search
    → toUIMessageStreamResponse()  (SSE)
  → messages.parts rendered by ResearchDisplay
```

**Key files:**
- `app/api/research/route.ts` — The agentic loop. Uses `streamText` with `stopWhen: stepCountIs(10)`. LLM is `google/gemini-2.0-flash-001` via OpenRouter.
- `lib/tools.ts` — Exa `webSearchTool`. Tool is registered as `webSearch` on the server; client-side part type is `tool-webSearch`.
- `components/research-display.tsx` — Renders `message.parts` array. Tool parts are cast via `as unknown as {...}` since TypeScript doesn't know the tool-specific type.
- `app/page.tsx` — `DefaultChatTransport` instance is created once outside the component to avoid re-renders.

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

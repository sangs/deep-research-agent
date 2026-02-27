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

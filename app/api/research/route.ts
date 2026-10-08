import { randomUUID } from 'crypto';
import { streamText, UIMessage, convertToModelMessages, stepCountIs, type StepResult, type ToolSet } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createWebSearchTool } from '@/lib/tools';
import { sessionUserId } from '@/lib/user-id';
import { guardRun, recordUsage, type UsageItem } from '@/lib/usage';

// OpenRouter's own AI SDK provider (Chat Completions) with usage accounting,
// so each step reports its actual cost in providerMetadata.openrouter.usage.
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });

const SYSTEM_PROMPT = `You are a deep research agent. For every query:
1. Break the topic into 3-5 distinct angles (overview, recent news, technical details, criticism, comparisons)
2. Run a webSearch for each angle with specific, targeted queries
3. Synthesize all findings into a comprehensive, well-structured answer

Always search at least 3 times before writing your final answer.

RESPONSE FORMAT: Always begin your final answer with exactly this structure:

## Key Takeaways
- [Most important finding, 1-2 sentences]
- [Second key finding, 1-2 sentences]
- [Third key finding, 1-2 sentences]
- [Optional 4th finding]
- [Optional 5th finding]

Then follow with the full structured report using headings and citations.`;

function stepCost(step: StepResult<ToolSet>): number {
  const usage = (step.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined)?.usage;
  return usage?.cost ?? 0;
}

export async function POST(req: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const tz = req.headers.get('x-timezone') ?? 'UTC';
  const blocked = await guardRun(userId, tz, 'deep_research');
  if (blocked) return blocked;

  const { messages }: { messages: UIMessage[] } = await req.json();

  // Actual costs for this run, recorded once when it finishes or is stopped.
  const runId = randomUUID();
  let exaCost = 0;
  let llmCost = 0;
  let model: string | null = null;
  let recorded = false;
  const record = async () => {
    if (recorded) return;
    recorded = true;
    const items: UsageItem[] = [
      { provider: 'openrouter', model, costUsd: llmCost },
      { provider: 'exa', model: 'search', costUsd: exaCost },
    ];
    await recordUsage(userId, tz, 'deep_research', runId, items).catch((e) =>
      console.error('[api/research] recording usage failed:', e),
    );
  };

  const result = streamText({
    model: openrouter.chat('~google/gemini-flash-latest', { usage: { include: true } }),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { webSearch: createWebSearchTool((cost) => { exaCost += cost; }) },
    stopWhen: stepCountIs(10),
    abortSignal: req.signal,
    onStepFinish: (step) => {
      llmCost += stepCost(step);
      model = step.response.modelId ?? model;
    },
    onFinish: record,
    onAbort: record,
    onError: async ({ error }) => {
      console.error('[api/research] stream error:', error);
      await record();
    },
  });
  return result.toUIMessageStreamResponse();
}

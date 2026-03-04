import { streamText, UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { webSearchTool } from '@/lib/tools';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
});

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

export async function POST(req: Request): Promise<Response> {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model: openrouter.chat('google/gemini-2.0-flash-001'),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { webSearch: webSearchTool },
    stopWhen: stepCountIs(10),
  });
  return result.toUIMessageStreamResponse();
}

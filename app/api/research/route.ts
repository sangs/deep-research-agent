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
3. Synthesize all findings into a comprehensive, well-structured answer with headings and citations
Always search at least 3 times before writing your final answer.`;

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

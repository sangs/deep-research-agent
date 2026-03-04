import { tool } from 'ai';
import { z } from 'zod';
import Exa from 'exa-js';

const exa = new Exa(process.env.EXA_API_KEY!);

export const webSearchTool = tool({
  description:
    'Search the web for information. Call multiple times with different queries to gather comprehensive research from multiple angles.',
  inputSchema: z.object({
    query: z.string().describe('Targeted search query'),
    numResults: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe('Number of results (1-10)'),
  }),
  execute: async ({ query, numResults }) => {
    const response = await exa.searchAndContents(query, {
      numResults,
      type: 'auto',
      text: { maxCharacters: 3000 },
      highlights: { numSentences: 2, highlightsPerUrl: 1 },
    });
    return response.results.map((r) => ({
      title: r.title ?? 'Untitled',
      url: r.url,
      text: r.text ?? '',
      highlights: r.highlights ?? [],
      publishedDate: r.publishedDate ?? null,
      score: r.score ?? null,
    }));
  },
});

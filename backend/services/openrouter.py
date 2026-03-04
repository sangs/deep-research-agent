import json
import os
import re
from datetime import datetime, timezone
from typing import Callable, Awaitable, Any

import httpx
from dotenv import load_dotenv

from models.schemas import NewsDigest, TopicCluster, ArticleItem
from tools.date_utils import resolve_date_range
from services.exa_client import search_news
from tools.news_tools import load_sources, REGION_KEYWORDS

load_dotenv()

OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY', '')
MODEL = 'google/gemini-2.0-flash-001'

# OpenAI-compatible tool schemas for Exa tools (A, B, C)
_MODE_TOOL = {
    'general': 'news_search_general',
    'region': 'news_search_region',
    'curated': 'news_search_curated',
    'research': 'news_search_research',
}

TOOL_SCHEMAS = [
    {
        'type': 'function',
        'function': {
            'name': 'news_search_general',
            'description': 'Search for global news articles on any topic (date-filtered, news category).',
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {'type': 'string', 'description': 'Search query'},
                    'num_results': {'type': 'integer', 'description': 'Number of results (5-10)'},
                    'start_date': {'type': 'string', 'description': 'ISO start date (pre-computed)'},
                    'end_date': {'type': 'string', 'description': 'ISO end date (pre-computed)'},
                },
                'required': ['query', 'num_results', 'start_date', 'end_date'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'news_search_region',
            'description': 'Search for regional news. region must be one of: US, India, Europe, APAC, UK, LatAm.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {'type': 'string', 'description': 'Search query'},
                    'region': {'type': 'string', 'description': 'Region code: US, India, Europe, APAC, UK, LatAm'},
                    'num_results': {'type': 'integer', 'description': 'Number of results (5-10)'},
                    'start_date': {'type': 'string', 'description': 'ISO start date (pre-computed)'},
                    'end_date': {'type': 'string', 'description': 'ISO end date (pre-computed)'},
                },
                'required': ['query', 'region', 'num_results', 'start_date', 'end_date'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'news_search_curated',
            'description': 'Search any topic from curated domain list (includes newsletters).',
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {'type': 'string', 'description': 'Search query'},
                    'num_results': {'type': 'integer', 'description': 'Number of results (5-10)'},
                    'start_date': {'type': 'string', 'description': 'ISO start date (pre-computed)'},
                    'end_date': {'type': 'string', 'description': 'ISO end date (pre-computed)'},
                    'domains': {
                        'type': 'array',
                        'items': {'type': 'string'},
                        'description': 'Optional domain override list',
                    },
                },
                'required': ['query', 'num_results', 'start_date', 'end_date'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'news_search_research',
            'description': 'Search AI/ML research posts and papers from research labs (no date filter).',
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {'type': 'string', 'description': 'Search query'},
                    'num_results': {'type': 'integer', 'description': 'Number of results (5-10)'},
                    'domains': {
                        'type': 'array',
                        'items': {'type': 'string'},
                        'description': 'Optional domain override list',
                    },
                },
                'required': ['query', 'num_results'],
            },
        },
    },
]


async def _fetch_articles(name: str, args: dict, custom_domains: list[str] | None) -> list[dict]:
    """Raw article fetch — returns list of article dicts from Exa."""
    if name == 'news_search_general':
        return await search_news(
            query=args['query'],
            num_results=args.get('num_results', 8),
            start_date=args['start_date'],
            end_date=args['end_date'],
            category='news',
        )
    elif name == 'news_search_region':
        region = args.get('region', '')
        region_kw = REGION_KEYWORDS.get(region, region)
        return await search_news(
            query=f"{args['query']} {region_kw}",
            num_results=args.get('num_results', 8),
            start_date=args['start_date'],
            end_date=args['end_date'],
            category='news',
        )
    elif name == 'news_search_curated':
        active_domains = args.get('domains') or custom_domains or load_sources().get('news_sites', [])
        return await search_news(
            query=args['query'],
            num_results=args.get('num_results', 8),
            start_date=args['start_date'],
            end_date=args['end_date'],
            include_domains=active_domains,
            category='news',
        )
    elif name == 'news_search_research':
        active_domains = args.get('domains') or custom_domains or load_sources().get('research_sites', [])
        return await search_news(
            query=args['query'],
            num_results=args.get('num_results', 8),
            include_domains=active_domains,
        )
    return []


async def _dispatch_tool(
    name: str,
    args: dict,
    custom_domains: list[str] | None,
    article_pool: dict[int, dict],
) -> dict:
    """Fetch articles, add to the shared pool, return compact summary for the LLM.

    The summary contains article IDs and metadata (title/source/excerpt) but
    NO URLs, so the LLM cannot reproduce or hallucinate URLs in its final JSON.
    """
    articles = await _fetch_articles(name, args, custom_domains)

    added_ids: list[int] = []
    seen_urls = {a['url'] for a in article_pool.values() if a.get('url')}
    for article in articles:
        url = article.get('url', '')
        if url and url in seen_urls:
            continue
        aid = len(article_pool)
        article_pool[aid] = article
        added_ids.append(aid)
        seen_urls.add(url)

    summary = [
        {
            'id': aid,
            'title': article_pool[aid]['title'],
            'source': article_pool[aid]['source'],
            'published_date': article_pool[aid].get('published_date'),
            'excerpt': (article_pool[aid].get('excerpt') or '')[:150],
        }
        for aid in added_ids
    ]
    return {'article_ids': added_ids, 'articles': summary}


def _build_system_prompt(
    mode: str, time_range: str, region: str | None, dates: dict, question: str | None
) -> str:
    start = dates['start']
    end = dates['end']
    region_note = f' Focus on {region} region.' if region else ''

    default_mode_instruction = {
        'general': 'Use news_search_general for 2-4 varied query angles covering major themes.',
        'region': f'Use news_search_region with region="{region}" for 2-4 varied query angles.{region_note}',
        'curated': 'Use news_search_curated for 2-4 varied query angles (AI/ML/tech topics preferred).',
        'research': 'Use news_search_research for 2-4 varied query angles covering key research themes. Do NOT pass date parameters.',
    }.get(mode, 'Use appropriate search tools for 2-4 varied query angles.')

    if question:
        if mode == 'curated':
            tool_instruction = (
                f'The filter is mode=curated. '
                f'ALWAYS use news_search_curated (with the default curated domain list) '
                f'UNLESS the question explicitly names specific domains to use — '
                f'in that case pass those domains to news_search_curated. '
                f'Do NOT call news_search_general just because the topic is broad.'
            )
        elif mode == 'region':
            tool_instruction = (
                f'The filter is mode=region, region={region}. '
                f'Use news_search_region with region="{region}" unless the question names a different region.'
            )
        elif mode == 'research':
            tool_instruction = (
                f'The filter is mode=research. '
                f'ALWAYS use news_search_research. Do NOT pass date parameters — this tool has no date filter. '
                f'Focus on retrieving the most relevant research posts, papers, and technical blog posts.'
            )
        else:
            tool_instruction = (
                f'The filter is mode=general. Use news_search_general. '
                f'If the question names specific domains, switch to news_search_curated with those domains.'
            )

        question_block = f"""
USER QUESTION (drives the search topic — read carefully):
  "{question}"

TOOL SELECTION RULES:
- {tool_instruction}
- Extract 2-4 query angles from the question — each must approach the topic from a DIFFERENT perspective
  (e.g. legislative, executive/regulatory, industry response, academic/research, international comparison).
  NEVER use two queries that differ only by a synonym or word order.
- If the question names a region not in the filter, add that region keyword to your queries.
- Topic from the question overrides generic topic defaults; tool/domain selection follows the rules above.

FILTER CONTEXT: mode={mode}, time_range={time_range}, region={region or 'none'}"""
    else:
        question_block = f"""
NO USER QUESTION PROVIDED — use filter defaults:
SEARCH STRATEGY: {default_mode_instruction}"""

    date_instruction = (
        f'CRITICAL: Always pass start_date="{start}" and end_date="{end}" verbatim to every tool call. Never compute dates yourself.'
        if mode != 'research'
        else 'NOTE: mode=research uses news_search_research which has NO date parameters. Do NOT pass start_date or end_date to any tool call.'
    )

    return f"""You are a news aggregation agent. Your job is to search for news and return a structured digest.

TIME RANGE: {time_range}
START DATE: {start}
END DATE: {end}

{date_instruction}
{question_block}

ARTICLE POOL:
Each tool call returns a list of articles with integer IDs (e.g. {{"article_ids": [0, 1, 2], "articles": [...]}}).
These articles are stored in a pool indexed by those IDs. After all searches are complete, you must reference
articles ONLY by their pool IDs — never reproduce or invent URLs, titles, or article objects yourself.

After completing all searches, return a JSON object matching this EXACT schema (no markdown, pure JSON):
{{
  "mode": "{mode}",
  "time_range": "{time_range}",
  "region": {json.dumps(region)},
  "generated_at": "<ISO timestamp>",
  "topics": [
    {{
      "label": "<2-6 word title case label, named after entity/event/theme>",
      "article_ids": [<integer id>, <integer id>, ...]
    }}
  ]
}}

CRITICAL FINAL RESPONSE RULES:
- Use ONLY article_ids (integers from the pool) — do NOT include article objects, URLs, titles, or excerpts
- The system assembles full article data from the pool using your IDs
- If you include a URL or article object instead of an article_id, it will be ignored
- Only reference IDs that actually appeared in tool responses

GROUPING RULES:
- Group by named entity, event, product, or theme (e.g. "OpenAI GPT-5", "EU AI Act", "Apple WWDC")
- 2-6 word labels, title case, no verbs
- Same story from multiple sources = separate articles in ONE topic cluster (no deduplication)
- Sort topics by number of article_ids descending
- Include ALL article IDs found; do not filter or deduplicate"""


def _assemble_digest(
    raw_json: dict,
    pool: dict[int, dict],
    mode: str,
    time_range: str,
    region: str | None,
) -> NewsDigest:
    """Assemble a NewsDigest from LLM-emitted article_ids and the real article pool.

    The LLM never writes URLs — Python looks them up from pool entries that
    came directly from Exa, so hallucinated links are impossible.
    """
    topics: list[TopicCluster] = []
    for t in raw_json.get('topics', []):
        label = t.get('label', 'Uncategorized')
        article_ids = t.get('article_ids', [])
        articles: list[ArticleItem] = []
        for aid in article_ids:
            a = pool.get(int(aid))
            if a:
                articles.append(ArticleItem(
                    title=a.get('title', ''),
                    url=a.get('url', ''),
                    source=a.get('source', ''),
                    published_date=a.get('published_date'),
                    excerpt=a.get('excerpt', ''),
                ))
        if articles:
            topics.append(TopicCluster(
                label=label,
                article_count=len(articles),
                articles=articles,
            ))

    # Sort topics by article count descending (LLM may not always sort correctly)
    topics.sort(key=lambda t: t.article_count, reverse=True)

    return NewsDigest(
        mode=raw_json.get('mode', mode),
        time_range=raw_json.get('time_range', time_range),
        region=raw_json.get('region', region),
        generated_at=raw_json.get('generated_at') or datetime.now(timezone.utc).isoformat(),
        topics=topics,
    )


def _fallback_digest_from_pool(
    pool: dict[int, dict],
    mode: str,
    time_range: str,
    region: str | None,
) -> NewsDigest:
    """Build a digest directly from all fetched pool articles when LLM JSON fails or references no IDs."""
    if not pool:
        return NewsDigest(
            mode=mode,
            time_range=time_range,
            region=region,
            generated_at=datetime.now(timezone.utc).isoformat(),
            topics=[],
        )
    articles = [
        ArticleItem(
            title=a.get('title', ''),
            url=a.get('url', ''),
            source=a.get('source', ''),
            published_date=a.get('published_date'),
            excerpt=a.get('excerpt', ''),
        )
        for a in pool.values()
        if a.get('url')
    ]
    label = f"{region} News" if region else "Global News"
    topic = TopicCluster(label=label, article_count=len(articles), articles=articles)
    return NewsDigest(
        mode=mode,
        time_range=time_range,
        region=region,
        generated_at=datetime.now(timezone.utc).isoformat(),
        topics=[topic] if articles else [],
    )


async def run_news_agent(
    mode: str,
    time_range: str,
    region: str | None,
    custom_domains: list[str] | None,
    emit_event: Callable[[dict], Awaitable[None]] | None,
    question: str | None = None,
) -> NewsDigest:
    dates = resolve_date_range(time_range)
    system = _build_system_prompt(mode, time_range, region, dates, question)

    mode_tool_name = _MODE_TOOL.get(mode)
    tools_for_mode = (
        [s for s in TOOL_SCHEMAS if s['function']['name'] == mode_tool_name]
        if mode_tool_name else TOOL_SCHEMAS
    )

    if mode == 'research':
        if question:
            user_msg = (
                f'User question: "{question}"\n'
                f'Use news_search_research to find the most relevant research posts and papers. '
                f'Do NOT pass date parameters.'
            )
        else:
            user_msg = (
                f'Get the latest AI/ML research posts from research labs. '
                f'Use news_search_research with 2-4 broad query angles covering major research themes. '
                f'Do NOT pass date parameters.'
            )
    elif question:
        user_msg = (
            f'User question: "{question}"\n'
            f'Time range: {time_range} (start_date="{dates["start"]}", end_date="{dates["end"]}").\n'
            f'Use the question to guide your searches. Pass dates verbatim to every tool call.'
        )
    else:
        user_msg = (
            f'Get {mode} news for {time_range}. '
            f'Start all tool calls with start_date="{dates["start"]}" and end_date="{dates["end"]}".'
        )

    messages: list[dict] = [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user_msg},
    ]

    # Pool of real articles indexed by integer ID — populated during tool calls.
    # The LLM only emits IDs in its final response; Python assembles the digest here.
    article_pool: dict[int, dict] = {}

    async with httpx.AsyncClient(timeout=60.0) as client:
        round_num = 0
        for _ in range(12):
            round_num += 1
            # Force tool use for the first 2 rounds so the LLM always searches
            # before deciding it can answer from its own knowledge (Bug 1 fix).
            tool_choice = 'required' if round_num <= 2 else 'auto'

            resp = await client.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': MODEL,
                    'messages': messages,
                    'tools': tools_for_mode,
                    'tool_choice': tool_choice,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            choice = data['choices'][0]
            finish_reason = choice.get('finish_reason', '')
            assistant_msg = choice['message']

            messages.append(assistant_msg)

            if finish_reason == 'tool_calls':
                tool_calls = assistant_msg.get('tool_calls', [])
                for tc in tool_calls:
                    fn_name = tc['function']['name']
                    try:
                        args = json.loads(tc['function']['arguments'])
                    except json.JSONDecodeError:
                        args = {}

                    if emit_event:
                        await emit_event({'type': 'searching', 'query': args.get('query', fn_name)})

                    try:
                        result = await _dispatch_tool(fn_name, args, custom_domains, article_pool)
                    except Exception as e:
                        result = {'article_ids': [], 'articles': []}
                        if emit_event:
                            await emit_event({'type': 'error', 'message': str(e)})

                    if emit_event:
                        await emit_event({
                            'type': 'results',
                            'count': len(result.get('article_ids', [])),
                            'query': args.get('query', ''),
                        })

                    messages.append({
                        'role': 'tool',
                        'tool_call_id': tc['id'],
                        'content': json.dumps(result),
                    })

            else:
                # Final response — extract the outermost JSON object via regex (Bug 2 fix).
                content = assistant_msg.get('content') or '{}'
                match = re.search(r'\{[\s\S]*\}', content)
                raw = match.group(0) if match else '{}'

                try:
                    digest_data = json.loads(raw)
                    if 'generated_at' not in digest_data:
                        digest_data['generated_at'] = datetime.now(timezone.utc).isoformat()
                    digest = _assemble_digest(digest_data, article_pool, mode, time_range, region)
                    # If LLM JSON had no matching IDs but we fetched articles, fall back (Bug 3 fix).
                    if not digest.topics and article_pool:
                        return _fallback_digest_from_pool(article_pool, mode, time_range, region)
                    return digest
                except Exception as e:
                    if emit_event:
                        await emit_event({'type': 'error', 'message': f'JSON parse failed: {e}. Raw: {raw[:200]}'})
                    return _fallback_digest_from_pool(article_pool, mode, time_range, region)

    # Exhausted all rounds — return whatever was fetched (Bug 3 fix).
    return _fallback_digest_from_pool(article_pool, mode, time_range, region)

from typing import Literal

from services.db import get_pool
from services.exa_client import search_news

REGION_KEYWORDS: dict[str, str] = {
    'US': 'United States US',
    'India': 'India',
    'Europe': 'Europe EU',
    'APAC': 'Asia Pacific China Japan',
    'UK': 'UK Britain',
    'LatAm': 'Latin America Brazil Mexico',
}


async def load_sources(user_id: str | None = None) -> dict:
    """A user's own source lists (curated_sources). With no user — MCP callers,
    which never get user data — the default_sources template instead."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if user_id:
            rows = await conn.fetch(
                "SELECT domain, list_type FROM curated_sources WHERE user_id = $1 ORDER BY added_at",
                user_id,
            )
        else:
            rows = await conn.fetch(
                "SELECT domain, list_type FROM default_sources ORDER BY list_type, domain"
            )
    result: dict = {'news_sites': [], 'research_sites': [], 'newsletters': [], 'global_news_sites': []}
    for row in rows:
        lt = row['list_type']
        if lt in result:
            result[lt].append(row['domain'])
    return result


def register_tools(mcp) -> None:

    @mcp.tool()
    async def news_search_general(
        query: str,
        num_results: int,
        start_date: str,
        end_date: str,
        domains: list[str] | None = None,
    ) -> list[dict]:
        """
        Search for global news articles on any topic (date-filtered, news category).
        Restricted to global_news_sites from config (reputable, English-language outlets)
        so results stay in English and free of low-quality/spam domains.
        Pass domains to override the default list.
        """
        active_domains = domains or (await load_sources()).get('global_news_sites', [])
        return await search_news(
            query=query,
            num_results=num_results,
            start_date=start_date,
            end_date=end_date,
            include_domains=active_domains,
            category='news',
        )

    @mcp.tool()
    async def news_search_region(
        query: str,
        region: str,
        num_results: int,
        start_date: str,
        end_date: str,
        domains: list[str] | None = None,
    ) -> list[dict]:
        """
        Search for regional news. region must be one of: US, India, Europe, APAC, UK, LatAm.
        Restricted to global_news_sites from config (reputable, English-language outlets) —
        same allowlist as news_search_general. Pass domains to override the default list.
        """
        region_kw = REGION_KEYWORDS.get(region, region)
        enriched_query = f'{query} {region_kw}'
        active_domains = domains or (await load_sources()).get('global_news_sites', [])
        return await search_news(
            query=enriched_query,
            num_results=num_results,
            start_date=start_date,
            end_date=end_date,
            include_domains=active_domains,
            category='news',
        )

    @mcp.tool()
    async def news_search_curated(
        query: str,
        num_results: int,
        start_date: str,
        end_date: str,
        domains: list[str] | None = None,
    ) -> list[dict]:
        """
        Search AI/ML news from curated news sites and blogs.
        Uses news_sites from config (well-indexed tech news sites and AI lab blogs).
        Pass domains to override the default list.
        """
        active_domains = domains or (await load_sources()).get('news_sites', [])
        return await search_news(
            query=query,
            num_results=num_results,
            start_date=start_date,
            end_date=end_date,
            include_domains=active_domains,
            category='news',  # news category — proper articles, not newsletters
        )

    @mcp.tool()
    async def news_search_research(
        query: str,
        num_results: int,
        domains: list[str] | None = None,
    ) -> list[dict]:
        """
        Search AI/ML research posts and papers from research labs (no date filter).
        Uses research_sites from config (AI lab blogs, paper repositories).
        Pass domains to override the default list.
        """
        active_domains = domains or (await load_sources()).get('research_sites', [])
        return await search_news(
            query=query,
            num_results=num_results,
            include_domains=active_domains,
        )

    @mcp.tool()
    async def list_sources() -> dict:
        """
        List the default source lists (news_sites, research_sites, newsletters,
        global_news_sites) that the search tools use when no domains are passed.
        Read-only: each app user edits their own lists in the app; MCP callers
        have no user and never see or change anyone's lists.
        """
        data = await load_sources()
        return {
            'news_sites': data.get('news_sites', []),
            'research_sites': data.get('research_sites', []),
            'newsletters': data.get('newsletters', []),
            'global_news_sites': data.get('global_news_sites', []),
        }

    @mcp.tool()
    async def get_news_digest(
        mode: str,
        time_range: str,
        region: str | None = None,
        custom_domains: list[str] | None = None,
        question: str | None = None,
        conversation_history: list[dict] | None = None,
    ) -> dict:
        """
        High-level orchestrator. Runs the agentic loop and returns a full NewsDigest.
        mode: 'general' | 'region' | 'curated' | 'research'
        time_range: 'today' | 'yesterday' | 'week' | 'month'
        region: required when mode='region'
        custom_domains: optional override for curated mode
        question: natural language question to guide the search
        conversation_history: list of {question, topics} from prior turns in the session
        """
        from services.openrouter import run_news_agent

        digest = await run_news_agent(
            mode=mode,
            time_range=time_range,
            region=region,
            custom_domains=custom_domains,
            emit_event=None,
            question=question,
            conversation_history=conversation_history,
        )
        return digest.model_dump()

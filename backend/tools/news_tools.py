import json
import os
from pathlib import Path
from typing import Literal

from services.exa_client import search_news

REGION_KEYWORDS: dict[str, str] = {
    'US': 'United States US',
    'India': 'India',
    'Europe': 'Europe EU',
    'APAC': 'Asia Pacific China Japan',
    'UK': 'UK Britain',
    'LatAm': 'Latin America Brazil Mexico',
}

SOURCES_FILE = Path(__file__).parent.parent / 'config' / 'default_sources.json'


def load_sources() -> dict:
    with open(SOURCES_FILE) as f:
        return json.load(f)


def persist_sources(data: dict) -> None:
    with open(SOURCES_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def register_tools(mcp) -> None:

    @mcp.tool()
    async def news_search_general(
        query: str,
        num_results: int,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """Search for global news articles on any topic (date-filtered, news category)."""
        return await search_news(
            query=query,
            num_results=num_results,
            start_date=start_date,
            end_date=end_date,
            category='news',
        )

    @mcp.tool()
    async def news_search_region(
        query: str,
        region: str,
        num_results: int,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """Search for regional news. region must be one of: US, India, Europe, APAC, UK, LatAm."""
        region_kw = REGION_KEYWORDS.get(region, region)
        enriched_query = f'{query} {region_kw}'
        return await search_news(
            query=enriched_query,
            num_results=num_results,
            start_date=start_date,
            end_date=end_date,
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
        active_domains = domains or load_sources().get('news_sites', [])
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
        active_domains = domains or load_sources().get('research_sites', [])
        return await search_news(
            query=query,
            num_results=num_results,
            include_domains=active_domains,
        )

    @mcp.tool()
    async def manage_sources(
        action: Literal['list', 'add', 'remove'],
        domains: list[str] = [],
        list_type: Literal['news_sites', 'research_sites'] = 'news_sites',
    ) -> dict:
        """
        Manage the news_sites or research_sites domain list.
        action='list'   → returns current lists
        action='add'    → adds domains to list_type, persists to config/default_sources.json
        action='remove' → removes domains from list_type, persists to config/default_sources.json
        list_type: 'news_sites' (default) or 'research_sites'
        """
        data = load_sources()
        target_list: list[str] = data.get(list_type, [])

        if action == 'list':
            return {
                'action': 'list',
                'news_sites': data.get('news_sites', []),
                'research_sites': data.get('research_sites', []),
                'newsletters': data.get('newsletters', []),
            }

        elif action == 'add':
            added = []
            for d in domains:
                d = d.lower().strip()
                if d and d not in target_list:
                    target_list.append(d)
                    added.append(d)
            data[list_type] = target_list
            persist_sources(data)
            return {'action': 'add', 'list_type': list_type, 'added': added, 'total': len(target_list)}

        elif action == 'remove':
            removed = []
            for d in domains:
                d = d.lower().strip()
                if d in target_list:
                    target_list.remove(d)
                    removed.append(d)
            data[list_type] = target_list
            persist_sources(data)
            return {'action': 'remove', 'list_type': list_type, 'removed': removed, 'total': len(target_list)}

        return {'error': f'Unknown action: {action}'}

    @mcp.tool()
    async def get_news_digest(
        mode: str,
        time_range: str,
        region: str | None = None,
        custom_domains: list[str] | None = None,
        question: str | None = None,
    ) -> dict:
        """
        High-level orchestrator. Runs the agentic loop and returns a full NewsDigest.
        mode: 'general' | 'region' | 'curated' | 'research'
        time_range: 'today' | 'yesterday' | 'week' | 'month'
        region: required when mode='region'
        custom_domains: optional override for curated mode
        question: natural language question to guide the search
        """
        from services.openrouter import run_news_agent

        digest = await run_news_agent(
            mode=mode,
            time_range=time_range,
            region=region,
            custom_domains=custom_domains,
            emit_event=None,
            question=question,
        )
        return digest.model_dump()

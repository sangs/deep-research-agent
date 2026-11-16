"""Owner cost summary for /finops (design 16 §4.2 contract, §4A).

Reads ONLY this product's authorized views in finops-admin (dataset finops_gmail_digest; backend-run-sa may
read nothing else there) in one BigQuery query, adds today's live app spend from usage_events, and derives
the alert banners. All month/forecast logic lives in the views (finops-admin/sql/030); nothing is recomputed here.

Cached in-process for CACHE_SECONDS (one owner, a few views a day); ?refresh=1 bypasses the cache.
"""

import asyncio
import json
import os
import time
from datetime import datetime, timezone

from services.finops_push import bq_query

PROJECT_KEY = 'gmail-digest'
VIEW_DATASET = 'finops_gmail_digest'
CACHE_SECONDS = 600
DAILY_DAYS = 30                          # days in the daily chart
MAX_BYTES_BILLED = 200 * 1024 ** 2       # the views scan a few MB
WARN_PCTS = (50, 80, 100)                # banner levels; the email alerts use finops.cost_projects.warn_pcts

SUMMARY_SQL = """
SELECT TO_JSON_STRING(STRUCT(
  (SELECT AS STRUCT * FROM `{d}.v_month_summary`) AS totals,
  ARRAY(SELECT AS STRUCT provider, sources, month_to_date FROM `{d}.v_by_provider_mtd`
        ORDER BY month_to_date DESC) AS by_provider,
  ARRAY(SELECT AS STRUCT service, ROUND(SUM(effective_cost), 4) AS mtd FROM `{d}.v_cost_daily`
        WHERE provider = 'Google Cloud' AND usage_date >= DATE_TRUNC(CURRENT_DATE('America/Los_Angeles'), MONTH)
        GROUP BY service HAVING ROUND(SUM(effective_cost), 4) != 0 ORDER BY mtd DESC) AS by_gcp_service,
  ARRAY(SELECT AS STRUCT usage_date AS date, provider, ROUND(SUM(effective_cost), 4) AS cost FROM `{d}.v_cost_daily`
        WHERE usage_date >= DATE_SUB(CURRENT_DATE('America/Los_Angeles'), INTERVAL {days} DAY)
        GROUP BY 1, 2 ORDER BY 1, 2) AS daily,
  ARRAY(SELECT AS STRUCT source, provider, as_of, is_stale FROM `{d}.v_source_status` ORDER BY source) AS sources,
  (SELECT MIN(usage_date) FROM `{d}.v_cost_daily` WHERE source = 'app_recorded') AS app_recorded_since
)) AS payload
"""

_cache: dict = {}


class FinopsUnavailable(RuntimeError):
    """The cost data could not be read (finops not configured, BigQuery error)."""


def _num(v) -> float:
    return round(float(v or 0), 4)


def alerts_for(totals: dict, sources: list[dict]) -> list[dict]:
    """Banners for the page: threshold level reached, month-end forecast over it, stale sources."""
    out = []
    threshold = totals.get('threshold')
    if threshold:
        pct = 100 * totals['month_to_date'] / threshold
        reached = [p for p in WARN_PCTS if pct >= p]
        if reached:
            level = 'critical' if reached[-1] >= 100 else 'warning'
            out.append({'level': level, 'message': f'Month to date is {pct:.0f}% of the ${threshold:.2f} monthly limit'})
        if totals['forecast_month_end'] > threshold:
            out.append({'level': 'warning', 'message': f"Month-end forecast ${totals['forecast_month_end']:.2f} "
                                                       f'is over the ${threshold:.2f} limit'})
    for s in sources:
        if s['stale']:
            out.append({'level': 'warning', 'message': f"{s['provider']} data is out of date (as of {s['as_of']})"})
    return out


def build_summary(payload: dict, live_app_today: float | None, generated_at: datetime) -> dict:
    """View rows (one JSON payload) -> the §4.2 contract. Pure, so it is unit-tested."""
    t = payload.get('totals') or {}
    threshold = float(t['threshold_usd']) if t.get('threshold_usd') is not None else None
    totals = {
        'today': _num(t.get('today_cost')),
        'month_to_date': _num(t.get('month_to_date')),
        'last_month': _num(t.get('last_month')),
        'forecast_month_end': _num(t.get('forecast_month_end')),
        'threshold': threshold,
        'pct_of_threshold': round(100 * _num(t.get('month_to_date')) / threshold, 1) if threshold else None,
    }
    sources = [{'source': s['source'], 'provider': s['provider'], 'as_of': s.get('as_of'),
                'stale': bool(s.get('is_stale'))} for s in payload.get('sources') or []]
    return {
        'project': PROJECT_KEY,
        'currency': 'USD',
        'generated_at': generated_at.isoformat(),
        'as_of': {s['source']: s['as_of'] for s in sources},
        'totals': totals,
        'live': {'app_spend_today_utc': None if live_app_today is None else round(live_app_today, 4)},
        'by_provider': [{'provider': p['provider'], 'mtd': _num(p['month_to_date']), 'sources': p.get('sources') or []}
                        for p in payload.get('by_provider') or []],
        'by_gcp_service': [{'service': s['service'], 'mtd': _num(s['mtd'])} for s in payload.get('by_gcp_service') or []],
        'daily': [{'date': d['date'], 'provider': d['provider'], 'cost': _num(d['cost'])}
                  for d in payload.get('daily') or []],
        'sources': sources,
        'alerts': alerts_for(totals, sources),
        'untracked_before': payload.get('app_recorded_since'),
    }


async def _views_payload(project: str) -> dict:
    body = {
        'query': SUMMARY_SQL.format(d=f'{project}.{VIEW_DATASET}', days=DAILY_DAYS - 1),
        'useLegacySql': False,
        'maximumBytesBilled': str(MAX_BYTES_BILLED),
        'timeoutMs': 30000,
    }
    result = await asyncio.to_thread(bq_query, project, body)
    return json.loads(result['rows'][0]['f'][0]['v'])


async def _live_app_today() -> float | None:
    from services.ingest import app_spent_today
    try:
        return await app_spent_today()
    except Exception as exc:  # the page still shows the views
        print(f'[finops] live app spend unavailable ({type(exc).__name__}: {exc})')
        return None


async def summary(refresh: bool = False) -> dict:
    project = os.environ.get('FINOPS_PROJECT')
    if not project:
        raise FinopsUnavailable('Cost tracking is not configured (FINOPS_PROJECT is not set)')
    cached = _cache.get('views')
    fetched = refresh or not cached or time.monotonic() - cached[0] > CACHE_SECONDS
    if fetched:
        try:
            cached = (time.monotonic(), await _views_payload(project), datetime.now(timezone.utc))
        except Exception as exc:
            print(f'[finops] summary query failed ({type(exc).__name__}: {exc})')
            raise FinopsUnavailable('Cost data is unavailable right now. Try again shortly.') from exc
        _cache['views'] = cached
    out = build_summary(cached[1], await _live_app_today(), cached[2])
    out['cached'] = not fetched
    return out

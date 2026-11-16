"""Push gmail-digest's provider spend to finops-admin (design 16, P2).

usage_events (OpenRouter, Exa; every user, every feature) -> BigQuery
`<FINOPS_PROJECT>.finops_landing.gmail_digest`, as daily totals: UTC day x provider x model.
Aggregates only: no user ids, no run ids, no content leave this app.

Idempotent: one MERGE replaces the trailing PUSH_WINDOW_DAYS with the current totals, so re-running never
double counts and a late-recorded event is picked up on the next push. Runs after each scheduled ingest sweep
(jobs/ingest.py) as backend-run-sa, which may write only this landing table (finops-admin/infra/products.env).

FINOPS_PROJECT unset -> the push is skipped (no default project, AP-24 style).
"""

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from services.db import worker_conn

PUSH_WINDOW_DAYS = 7                     # days re-sent on every push (UTC); covers late events and outages
MAX_BACKFILL_DAYS = 400                  # one-off backfill limit (python -m jobs.ingest --finops-backfill-days=N)
LANDING_TABLE = 'finops_landing.gmail_digest'
MAX_BYTES_BILLED = 100 * 1024 ** 2       # the landing table is a few KB
PROVIDER_NAMES = {'openrouter': 'OpenRouter', 'exa': 'Exa'}
NO_MODEL = '(not recorded)'

MERGE_SQL = """
MERGE `{table}` t
USING (SELECT * FROM UNNEST(@rows)) s
ON t.usage_date = s.usage_date AND t.provider = s.provider AND t.service = s.service
WHEN MATCHED THEN UPDATE SET cost_usd = s.cost_usd, recorded_at = CURRENT_TIMESTAMP(), source_run_id = @run_id
WHEN NOT MATCHED BY TARGET THEN
  INSERT (usage_date, provider, service, cost_usd, recorded_at, source_run_id)
  VALUES (s.usage_date, s.provider, s.service, s.cost_usd, CURRENT_TIMESTAMP(), @run_id)
WHEN NOT MATCHED BY SOURCE AND t.usage_date >= @since THEN DELETE
"""


def window_start(now: datetime, days: int = PUSH_WINDOW_DAYS) -> datetime:
    """UTC midnight days - 1 days ago (the window includes today)."""
    day = now.astimezone(timezone.utc).date() - timedelta(days=days - 1)
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def to_rows(records) -> list[dict]:
    """(usage_date 'YYYY-MM-DD', provider, model, cost) -> landing rows; provider names as finops shows them."""
    rows = []
    for usage_date, provider, model, cost in records:
        rows.append({'usage_date': usage_date, 'provider': PROVIDER_NAMES.get(provider, provider),
                     'service': model or NO_MODEL, 'cost_usd': f'{float(cost):.9f}'})
    return rows


def merge_request(project: str, rows: list[dict], since: str, run_id: str) -> dict:
    """BigQuery jobs.query body: one MERGE with the rows as an ARRAY<STRUCT> parameter."""
    fields = [('usage_date', 'DATE'), ('provider', 'STRING'), ('service', 'STRING'), ('cost_usd', 'NUMERIC')]
    return {
        'query': MERGE_SQL.format(table=f'{project}.{LANDING_TABLE}'),
        'useLegacySql': False,
        'maximumBytesBilled': str(MAX_BYTES_BILLED),
        'timeoutMs': 60000,
        'queryParameters': [
            {'name': 'rows',
             'parameterType': {'type': 'ARRAY', 'arrayType': {'type': 'STRUCT', 'structTypes': [
                 {'name': n, 'type': {'type': t}} for n, t in fields]}},
             'parameterValue': {'arrayValues': [
                 {'structValues': {n: {'value': r[n]} for n, _ in fields}} for r in rows]}},
            {'name': 'since', 'parameterType': {'type': 'DATE'}, 'parameterValue': {'value': since}},
            {'name': 'run_id', 'parameterType': {'type': 'STRING'}, 'parameterValue': {'value': run_id}},
        ],
    }


async def _daily_totals(since: datetime) -> list:
    async with worker_conn('newsletter') as conn:
        return await conn.fetch(
            "SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS usage_date, "
            'provider, model, sum(cost_usd) AS cost FROM usage_events WHERE created_at >= $1 '
            'GROUP BY 1, 2, 3 ORDER BY 1, 2, 3',
            int(since.timestamp() * 1000),
        )


def _run_merge(project: str, body: dict) -> dict:
    from googleapiclient.discovery import build  # sync client; called via asyncio.to_thread
    bq = build('bigquery', 'v2', cache_discovery=False)
    result = bq.jobs().query(projectId=project, body=body).execute()
    if not result.get('jobComplete'):
        raise RuntimeError(f"MERGE did not finish in time (job {result.get('jobReference', {}).get('jobId')})")
    return result


async def push_costs(days: int = PUSH_WINDOW_DAYS) -> None:
    """One push of the trailing `days` (UTC). Never raises: cost reporting must not break ingest.
    A larger `days` is a backfill: same MERGE, so it only replaces days inside the window."""
    project = os.environ.get('FINOPS_PROJECT')
    if not project:
        print('[finops] push skipped: FINOPS_PROJECT not set')
        return
    started = time.monotonic()
    try:
        if not 1 <= days <= MAX_BACKFILL_DAYS:
            raise ValueError(f'days must be 1..{MAX_BACKFILL_DAYS}, got {days}')
        since = window_start(datetime.now(timezone.utc), days)
        rows = to_rows(await _daily_totals(since))
        run_id = f'gmail-digest-{uuid.uuid4().hex[:12]}'
        result = await asyncio.to_thread(_run_merge, project,
                                         merge_request(project, rows, since.date().isoformat(), run_id))
        total = sum(float(r['cost_usd']) for r in rows)
        print(f"[finops] pushed {len(rows)} rows (${total:.4f}, {days} days) run={run_id} "
              f"changed={result.get('numDmlAffectedRows')} in {time.monotonic() - started:.1f}s")
    except Exception as exc:
        print(f'[finops] push failed ({type(exc).__name__}: {exc})')

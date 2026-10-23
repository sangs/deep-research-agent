"""ingest.py — background summarizing of newsletter emails (scale-out Phase 2).

A digest run whose range has more than INLINE_SUMMARY_LIMIT unsummarized emails
can't summarize them inside one request (Vercel stops /api/news at 300 s), so it
queues an on_demand row in `ingest_jobs` and starts the Cloud Run Job
`newsletter-ingest` (jobs/ingest.py). The job claims queued rows, then sweeps
the configured senders' new mail, and Cloud Scheduler starts it every 30 min.
The UI polls the row and re-runs the digest once it is done.

The queue lives in the database, so starting the job needs no arguments: the
backend's run.invoker role allows jobs.run but not runWithOverrides.

The owner can pause the scheduled sweep from the Usage page (app_settings key
'newsletter_ingest'). On-demand jobs still run while it is paused: they come
from a Run the user clicked. Emergency stop without the app:
`gcloud scheduler jobs pause newsletter-ingest-every-30-min --location=us-central1`.
Design: architecture/features/13-newsletter-scale-out-plan-2026-10-20.md (Phase 2).
"""

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone

import httpx

from services import newsletter_store
from services.db import get_pool
from services.usage import start_tracking
from tools.date_utils import resolve_tz

# Runs with at most this many unsummarized emails summarize them inline
# (10 concurrent, about 80 s at most); larger ones go to the background job.
INLINE_SUMMARY_LIMIT = int(os.getenv('INGEST_INLINE_LIMIT', '40'))
CHUNK_SIZE = 20                     # emails fetched, summarized and saved per step (progress granularity)
STALE_RUNNING_MS = 75 * 60 * 1000   # job timeout is 60 min; a running row older than this crashed
STALE_QUEUED_MS = 2 * 3600 * 1000   # never started (the start call failed and no sweep picked it up)
SWEEP_OVERLAP_S = 3600              # each sweep re-lists the last hour before the previous one
FIRST_SWEEP_LOOKBACK_S = 86400      # no backfill: the first sweep looks back one day
JOB_RETENTION_DAYS = 30
SYSTEM_USER = 'system:newsletter-ingest'  # usage_events owner for scheduled sweeps
DAILY_CAP_USD = float(os.getenv('INGEST_DAILY_CAP_USD', '1'))

SETTINGS_KEY = 'newsletter_ingest'

# Keeps local in-process workers referenced until they finish.
_local_tasks: set[asyncio.Task] = set()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _day_in(tz_name: str | None) -> str:
    return datetime.now(resolve_tz(tz_name or 'UTC')).strftime('%Y-%m-%d')


async def _expire_stale(conn) -> None:
    now = _now_ms()
    await conn.execute(
        "UPDATE ingest_jobs SET status = 'failed', finished_at = $1, "
        "error = CASE WHEN status = 'running' THEN 'the background job stopped without finishing' "
        "ELSE 'the background job never started' END "
        "WHERE (status = 'running' AND started_at < $2) OR (status = 'queued' AND created_at < $3)",
        now, now - STALE_RUNNING_MS, now - STALE_QUEUED_MS,
    )


# ── Requesting a job (called from run_gmail_digest) ─────────────────────────

async def request_job(message_ids: list[str], requested_by: str, tz_name: str) -> dict:
    """Queue an on_demand job for `message_ids` and start the background job.

    If an on_demand job is already queued or running, returns that one instead
    (one at a time; emails it doesn't cover are queued by the re-run after it).
    Returns {id, status, total, done_count, failed_count}.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _expire_stale(conn)
        active = await conn.fetchrow(
            "SELECT id, status, total, done_count, failed_count FROM ingest_jobs "
            "WHERE kind = 'on_demand' AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1"
        )
        if active:
            return dict(active)
        job = {'id': str(uuid.uuid4()), 'status': 'queued', 'total': len(message_ids), 'done_count': 0, 'failed_count': 0}
        await conn.execute(
            "INSERT INTO ingest_jobs (id, kind, status, message_ids, requested_by, timezone, total, created_at) "
            "VALUES ($1, 'on_demand', 'queued', $2, $3, $4, $5, $6)",
            job['id'], message_ids, requested_by, tz_name, len(message_ids), _now_ms(),
        )
    try:
        await start_execution()
    except Exception as e:
        # The row stays queued; the next scheduled execution (<= 30 min) picks it up.
        print(f'[ingest] could not start the background job ({type(e).__name__}: {e}); job {job["id"]} waits for the next sweep')
    return job


async def start_execution(sweep: bool = False) -> None:
    """Start one execution of the Cloud Run Job named by INGEST_JOB_NAME
    (projects/P/locations/R/jobs/J); it always sweeps after the queue.
    Without it (local dev), run the worker in-process, sweeping only if `sweep`."""
    job_name = os.getenv('INGEST_JOB_NAME', '').strip()
    if not job_name:
        task = asyncio.get_running_loop().create_task(run_worker(sweep=sweep))
        _local_tasks.add(task)
        task.add_done_callback(_local_tasks.discard)
        return

    def _access_token() -> str:
        import google.auth
        import google.auth.transport.requests
        creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        creds.refresh(google.auth.transport.requests.Request())
        return creds.token

    token = await asyncio.to_thread(_access_token)
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f'https://run.googleapis.com/v2/{job_name}:run',
            headers={'Authorization': f'Bearer {token}'},
            json={},
        )
        resp.raise_for_status()


# ── Worker (jobs/ingest.py in production, in-process locally) ───────────────

async def run_worker(sweep: bool) -> None:
    """Process every queued on_demand job, then (if `sweep`) summarize new mail."""
    from services.gmail_service import get_gmail_service

    pool = await get_pool()
    async with pool.acquire() as conn:
        await _expire_stale(conn)

    service = None
    while (job := await _claim_next()) is not None:
        try:
            service = service or await asyncio.to_thread(get_gmail_service)
            status = await _summarize_ids(
                job['id'], list(job['message_ids']), service,
                charge_to=job['requested_by'], day=_day_in(job['timezone']), cap_reached=None,
            )
            await _finish(job['id'], status)
        except Exception as e:
            print(f'[ingest] job {job["id"]} failed: {type(e).__name__}: {e}')
            await _finish(job['id'], 'failed', f'{type(e).__name__}: {e}')

    if sweep:
        try:
            await _sweep(service)
        except Exception as e:
            print(f'[ingest] sweep failed: {type(e).__name__}: {e}')


async def _claim_next() -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE ingest_jobs SET status = 'running', started_at = $1 WHERE id = ("
            "  SELECT id FROM ingest_jobs WHERE kind = 'on_demand' AND status = 'queued' "
            "  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
            ") RETURNING id, message_ids, requested_by, timezone",
            _now_ms(),
        )
    return dict(row) if row else None


async def _finish(job_id: str, status: str, error: str | None = None) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            'UPDATE ingest_jobs SET status = $2, error = $3, finished_at = $4 WHERE id = $1',
            job_id, status, error, _now_ms(),
        )


async def _spent_today(user_id: str, day: str) -> float:
    pool = await get_pool()
    async with pool.acquire() as conn:
        return float(await conn.fetchval(
            'SELECT coalesce(sum(cost_usd), 0) FROM usage_events WHERE user_id = $1 AND day = $2',
            user_id, day,
        ))


async def _summarize_ids(job_id, ids, service, charge_to, day, cap_reached) -> str:
    """Fetch, summarize and store every id without a current summary, in chunks,
    updating the job's progress and recording spend after each chunk.
    Returns the final status: 'done', or 'capped' when `cap_reached()` says stop."""
    from services.gmail_service import SUMMARY_VERSION, fetch_emails_by_id, _summarize_via_openrouter

    stored = await newsletter_store.load_emails(ids, SUMMARY_VERSION)
    todo = [i for i in ids if i not in stored]
    done, failed = len(ids) - len(todo), 0
    await _progress(job_id, len(ids), done, failed, 0.0)

    tracker = start_tracking(None)  # collects provider costs reported by chat_completion
    recorded: dict[tuple[str, str | None], float] = {}
    for start in range(0, len(todo), CHUNK_SIZE):
        if cap_reached and await cap_reached():
            return 'capped'
        chunk = todo[start:start + CHUNK_SIZE]
        emails = await asyncio.to_thread(fetch_emails_by_id, service, chunk)
        summaries = await _summarize_via_openrouter(emails)
        for idx, e in enumerate(emails):
            e['summary'] = summaries.get(idx)
        await newsletter_store.save_emails(emails, SUMMARY_VERSION)
        ok = sum(1 for e in emails if e.get('summary'))
        done += ok
        failed += len(chunk) - ok

        # Write this chunk's spend so budgets and the cap see it right away.
        new_items = []
        for item in tracker.event()['items']:
            key = (item['provider'], item['model'])
            delta = item['cost_usd'] - recorded.get(key, 0.0)
            if delta > 0:
                new_items.append((key, delta))
                recorded[key] = item['cost_usd']
        if new_items and charge_to:
            await _record_usage(charge_to, day, job_id, new_items)
        await _progress(job_id, len(ids), done, failed, sum(recorded.values()))
    return 'done'


async def _progress(job_id, total, done, failed, cost) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            'UPDATE ingest_jobs SET total = $2, done_count = $3, failed_count = $4, cost_usd = $5 WHERE id = $1',
            job_id, total, done, failed, cost,
        )


async def _record_usage(user_id, day, run_id, items) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.executemany(
            'INSERT INTO usage_events (id, user_id, day, feature, provider, model, cost_usd, run_id, created_at) '
            "VALUES ($1, $2, $3, 'newsletter', $4, $5, $6, $7, $8)",
            [(str(uuid.uuid4()), user_id, day, provider, model, cost, run_id, _now_ms())
             for (provider, model), cost in items],
        )


async def _sweep(service) -> None:
    """Summarize the configured senders' mail since the last finished sweep."""
    from services.gmail_service import SUMMARY_VERSION, build_query, list_message_ids
    from tools.news_tools import load_sources

    if not (await get_settings())['enabled']:
        print('[ingest] sweep skipped: paused by the owner')
        return
    day = _day_in('UTC')
    if await _spent_today(SYSTEM_USER, day) >= DAILY_CAP_USD:
        print(f'[ingest] sweep skipped: daily cap ${DAILY_CAP_USD} reached for {day}')
        return
    senders = (await load_sources()).get('newsletters', [])
    if not senders:
        return

    pool = await get_pool()
    async with pool.acquire() as conn:
        last = await conn.fetchval(
            "SELECT max(started_at) FROM ingest_jobs WHERE kind = 'scheduled' AND status = 'done'"
        )
        await conn.execute(
            'DELETE FROM ingest_jobs WHERE created_at < $1',
            _now_ms() - JOB_RETENTION_DAYS * 86400 * 1000,
        )
    now = time.time()
    since = last / 1000 - SWEEP_OVERLAP_S if last else now - FIRST_SWEEP_LOOKBACK_S
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat()
    query = build_query(iso(since), iso(now + 60), senders, '')
    if service is None:
        from services.gmail_service import get_gmail_service
        service = await asyncio.to_thread(get_gmail_service)
    ids, _ = await asyncio.to_thread(list_message_ids, service, query)
    stored = await newsletter_store.load_emails(ids, SUMMARY_VERSION)
    todo = [i for i in ids if i not in stored]

    job_id = str(uuid.uuid4())
    started = int(now * 1000)  # the next sweep starts from here (minus the overlap)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO ingest_jobs (id, kind, status, message_ids, total, created_at, started_at) "
            "VALUES ($1, 'scheduled', 'running', $2, $3, $4, $4)",
            job_id, todo, len(todo), started,
        )

    async def cap_reached() -> bool:
        return await _spent_today(SYSTEM_USER, day) >= DAILY_CAP_USD

    try:
        status = await _summarize_ids(job_id, todo, service, charge_to=SYSTEM_USER, day=day, cap_reached=cap_reached)
        await _finish(job_id, status, f'daily cap ${DAILY_CAP_USD} reached' if status == 'capped' else None)
        await newsletter_store.purge_expired()
    except Exception as e:
        await _finish(job_id, 'failed', f'{type(e).__name__}: {e}')
        raise


# ── Owner controls (Usage page, via /api/newsletter/ingest) ─────────────────

async def get_settings() -> dict:
    """{enabled, updated_by, updated_at}; no row means enabled."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT value, updated_by, updated_at FROM app_settings WHERE key = $1', SETTINGS_KEY,
        )
    value = json.loads(row['value']) if row else {}
    return {
        'enabled': bool(value.get('enabled', True)),
        'updated_by': row['updated_by'] if row else None,
        'updated_at': row['updated_at'] if row else None,
    }


async def set_enabled(enabled: bool, actor: str) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, $4) '
            'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, '
            'updated_at = EXCLUDED.updated_at',
            SETTINGS_KEY, json.dumps({'enabled': enabled}), actor, _now_ms(),
        )
    print(f'[ingest] scheduled sweep {"resumed" if enabled else "paused"} by {actor}')
    return await get_settings()


async def status() -> dict:
    """Switch state, today's sweep spend against the cap, and the latest sweep."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await _expire_stale(conn)
        last = await conn.fetchrow(
            "SELECT status, total, done_count, failed_count, cost_usd, error, started_at, finished_at "
            "FROM ingest_jobs WHERE kind = 'scheduled' ORDER BY created_at DESC LIMIT 1"
        )
        active = await conn.fetchval("SELECT count(*) FROM ingest_jobs WHERE status IN ('queued', 'running')")
    return {
        **(await get_settings()),
        'daily_cap_usd': DAILY_CAP_USD,
        'spent_today_usd': await _spent_today(SYSTEM_USER, _day_in('UTC')),
        'schedule': 'every 30 minutes',
        'active_jobs': active,
        'last_sweep': dict(last) if last else None,
    }

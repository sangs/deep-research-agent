"""ingest.py — background summarizing of newsletter emails (scale-out Phase 2).

A digest run whose range has more than INLINE_SUMMARY_LIMIT unsummarized emails
can't summarize them inside one request (Vercel stops /api/news at 300 s), so it
queues an on_demand row in `ingest_jobs` and starts the Cloud Run Job
`newsletter-ingest` (jobs/ingest.py). The job claims queued rows, then sweeps
the configured senders' new mail, and Cloud Scheduler starts it every 30 min.
The UI polls the row and re-runs the digest once it is done.

The queue lives in the database, so starting the job needs no arguments: the
backend's run.invoker role allows jobs.run but not runWithOverrides.

Phase C (design 15 §7): the sweep visits every connected mailbox
(mailboxes.sweepable(): active, not paused by its user, Gmail allowed), each with
its own Gmail client and its user's sender list, and charges that user (D3), up
to MAILBOX_DAILY_CAP_USD of background work per mailbox per UTC day and never
past the user's default daily budget or the app-wide cap. A revoked grant marks
the mailbox 'reauth_required' and the sweep skips it until it is reconnected.

The owner can pause every scheduled sweep from the Usage page (app_settings key
'newsletter_ingest'); each user can pause their own mailbox's on /account.
On-demand jobs still run while paused: they come from a Run the user clicked. Emergency stop without the app:
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

from services import mailboxes, newsletter_store
from services.db import worker_conn
from services.mailboxes import Mailbox, MailboxError
from services.usage import start_tracking
from tools.date_utils import resolve_tz


def describe_gmail_error(exc: Exception) -> str:
    from services.gmail_service import describe_gmail_error as describe
    return describe(exc)

# Runs with at most this many unsummarized emails summarize them inline
# (10 concurrent, about 80 s at most); larger ones go to the background job.
INLINE_SUMMARY_LIMIT = int(os.getenv('INGEST_INLINE_LIMIT', '40'))
CHUNK_SIZE = 20                     # emails fetched, summarized and saved per step (progress granularity)
STALE_RUNNING_MS = 75 * 60 * 1000   # job timeout is 60 min; a running row older than this crashed
STALE_QUEUED_MS = 2 * 3600 * 1000   # never started (the start call failed and no sweep picked it up)
SWEEP_OVERLAP_S = 3600              # each sweep re-lists the last hour before the previous one
FIRST_SWEEP_LOOKBACK_S = 86400      # no backfill: the first sweep looks back one day
JOB_RETENTION_DAYS = 30
# Background summarizing per mailbox per UTC day (decision D3), charged to the mailbox's user.
MAILBOX_DAILY_CAP_USD = float(os.getenv('INGEST_MAILBOX_DAILY_CAP_USD', '0.5'))
# Sweeps stop for a user once they've spent their default daily budget (lib/usage.ts
# USAGE_DAILY_BUDGET_USD; raises are for runs the user starts, not background work),
# and for everyone at the app-wide cap (APP_DAILY_BUDGET_USD).
USER_DAILY_BUDGET_USD = float(os.getenv('USAGE_DAILY_BUDGET_USD', '2'))
APP_DAILY_BUDGET_USD = float(os.getenv('APP_DAILY_BUDGET_USD', '10'))

SETTINGS_KEY = 'newsletter_ingest'

# Keeps local in-process workers referenced until they finish.
_local_tasks: set[asyncio.Task] = set()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _day_in(tz_name: str | None) -> str:
    return datetime.now(resolve_tz(tz_name or 'UTC')).strftime('%Y-%m-%d')


def _utc_midnight_ms() -> int:
    now = datetime.now(timezone.utc)
    return int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


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

async def request_job(mailbox: Mailbox, message_ids: list[str], requested_by: str, tz_name: str) -> dict:
    """Queue an on_demand job for `message_ids` of `mailbox` and start the background job.

    If an on_demand job is already queued or running for this mailbox, returns
    that one instead (one at a time per mailbox; emails it doesn't cover are
    queued by the re-run after it).
    Returns {id, status, total, done_count, failed_count}.
    """
    async with worker_conn('newsletter') as conn:
        await _expire_stale(conn)
        active = await conn.fetchrow(
            "SELECT id, status, total, done_count, failed_count FROM ingest_jobs WHERE mailbox_id = $1 "
            "AND kind = 'on_demand' AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
            mailbox.id,
        )
        if active:
            return dict(active)
        job = {'id': str(uuid.uuid4()), 'status': 'queued', 'total': len(message_ids), 'done_count': 0, 'failed_count': 0}
        await conn.execute(
            "INSERT INTO ingest_jobs (id, mailbox_id, kind, status, message_ids, requested_by, timezone, total, created_at) "
            "VALUES ($1, $2, 'on_demand', 'queued', $3, $4, $5, $6, $7)",
            job['id'], mailbox.id, message_ids, requested_by, tz_name, len(message_ids), _now_ms(),
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
    """Process every queued on_demand job, then (if `sweep`) summarize new mail in every mailbox."""
    async with worker_conn('newsletter') as conn:
        await _expire_stale(conn)
    await purge_audit_log()
    await purge_deleted_accounts()

    services: dict[str, object] = {}  # one Gmail client per mailbox per execution

    async def service_for(mailbox: Mailbox):
        if mailbox.id not in services:
            services[mailbox.id] = await mailboxes.gmail_service(mailbox)
        return services[mailbox.id]

    while (job := await _claim_next()) is not None:
        try:
            mailbox = await _job_mailbox(job)
            status = await _summarize_ids(
                job['id'], mailbox, list(job['message_ids']), await service_for(mailbox),
                charge_to=job['requested_by'], day=_day_in(job['timezone']), cap_reached=None,
            )
            await _finish(job['id'], status)
        except Exception as e:
            print(f'[ingest] job {job["id"]} failed: {type(e).__name__}: {e}')
            await _finish(job['id'], 'failed', describe_gmail_error(e))

    if sweep:
        await _sweep_all(service_for)


async def _job_mailbox(job: dict) -> Mailbox:
    if not job['mailbox_id']:
        raise MailboxError('not_connected', 'Queued before Gmail was connected per user; run the digest again.', 409)
    async with worker_conn('newsletter') as conn:
        user_id = await conn.fetchval('SELECT user_id FROM mailboxes WHERE id = $1', job['mailbox_id'])
    mailbox = await mailboxes.require_active(user_id) if user_id else None
    if mailbox is None or mailbox.id != job['mailbox_id']:
        raise MailboxError('not_connected', 'The mailbox for this job is no longer connected.', 409)
    return mailbox


async def _claim_next() -> dict | None:
    async with worker_conn('newsletter') as conn:
        row = await conn.fetchrow(
            "UPDATE ingest_jobs SET status = 'running', started_at = $1 WHERE id = ("
            "  SELECT id FROM ingest_jobs WHERE kind = 'on_demand' AND status = 'queued' "
            "  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
            ") RETURNING id, mailbox_id, message_ids, requested_by, timezone",
            _now_ms(),
        )
    return dict(row) if row else None


async def _finish(job_id: str, status: str, error: str | None = None) -> None:
    async with worker_conn('newsletter') as conn:
        await conn.execute(
            'UPDATE ingest_jobs SET status = $2, error = $3, finished_at = $4 WHERE id = $1',
            job_id, status, error, _now_ms(),
        )


async def _spent_today(user_id: str, day: str) -> float:
    async with worker_conn('newsletter') as conn:
        return float(await conn.fetchval(
            'SELECT coalesce(sum(cost_usd), 0) FROM usage_events WHERE user_id = $1 AND day = $2',
            user_id, day,
        ))


async def _app_spent_today() -> float:
    """All users since UTC midnight (the same window as lib/usage.ts appBudgetAvailable)."""
    async with worker_conn('newsletter') as conn:
        return float(await conn.fetchval(
            'SELECT coalesce(sum(cost_usd), 0) FROM usage_events WHERE created_at >= $1', _utc_midnight_ms(),
        ))


async def _mailbox_sweep_spent_today(mailbox_id: str) -> float:
    async with worker_conn('newsletter') as conn:
        return float(await conn.fetchval(
            "SELECT coalesce(sum(cost_usd), 0) FROM ingest_jobs WHERE mailbox_id = $1 AND kind = 'scheduled' "
            'AND created_at >= $2', mailbox_id, _utc_midnight_ms(),
        ))


async def _summarize_ids(job_id, mailbox: Mailbox, ids, service, charge_to, day, cap_reached) -> str:
    """Fetch, summarize and store every id without a current summary, in chunks,
    updating the job's progress and recording spend after each chunk.
    Returns the final status: 'done', or 'capped' when `cap_reached()` says stop."""
    from services.gmail_service import SUMMARY_VERSION, fetch_emails_by_id, _summarize_via_openrouter

    stored = await newsletter_store.load_emails(mailbox, ids, SUMMARY_VERSION)
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
        await newsletter_store.save_emails(mailbox, emails, SUMMARY_VERSION)
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
    async with worker_conn('newsletter') as conn:
        await conn.execute(
            'UPDATE ingest_jobs SET total = $2, done_count = $3, failed_count = $4, cost_usd = $5 WHERE id = $1',
            job_id, total, done, failed, cost,
        )


async def _record_usage(user_id, day, run_id, items) -> None:
    async with worker_conn('newsletter') as conn:
        await conn.executemany(
            'INSERT INTO usage_events (id, user_id, day, feature, provider, model, cost_usd, run_id, created_at) '
            "VALUES ($1, $2, $3, 'newsletter', $4, $5, $6, $7, $8)",
            [(str(uuid.uuid4()), user_id, day, provider, model, cost, run_id, _now_ms())
             for (provider, model), cost in items],
        )


async def _sweep_all(service_for) -> None:
    """One scheduled pass over every sweepable mailbox, one at a time (< 100 mailboxes).
    A failure in one mailbox is recorded on it and never stops the others."""
    if not (await get_settings())['enabled']:
        print('[ingest] sweep skipped: paused by the owner')
        return
    async with worker_conn('newsletter') as conn:
        await conn.execute('DELETE FROM ingest_jobs WHERE created_at < $1',
                           _now_ms() - JOB_RETENTION_DAYS * 86400 * 1000)
    for mailbox in await mailboxes.sweepable():
        if await _app_spent_today() >= APP_DAILY_BUDGET_USD:
            print(f'[ingest] sweep stopped: app-wide daily cap ${APP_DAILY_BUDGET_USD} reached')
            break
        try:
            await _sweep_mailbox(mailbox, service_for)
            await mailboxes.record_sweep(mailbox.id, None)
        except Exception as e:
            # Recorded, so the Newsletter tab and /account show it. Failed rows don't
            # move the sweep window (it starts from the last *done* sweep), so the
            # next good sweep catches up.
            error = describe_gmail_error(e)
            print(f'[ingest] sweep of mailbox {mailbox.id} failed: {type(e).__name__}: {e}')
            await _record_failed_sweep(mailbox.id, error)
            await mailboxes.record_sweep(mailbox.id, error)
    try:
        await newsletter_store.purge_expired()
    except Exception as e:
        print(f'[retention] newsletter_emails purge failed: {type(e).__name__}: {e}')


async def _sweep_mailbox(mailbox: Mailbox, service_for) -> None:
    """Summarize the user's newsletter senders' mail since this mailbox's last finished sweep."""
    from services.gmail_service import SUMMARY_VERSION, build_query, list_message_ids
    from tools.news_tools import load_sources

    day = _day_in('UTC')

    async def cap_reached() -> bool:
        return (await _mailbox_sweep_spent_today(mailbox.id) >= MAILBOX_DAILY_CAP_USD
                or await _spent_today(mailbox.user_id, day) >= USER_DAILY_BUDGET_USD)

    if await cap_reached():
        print(f'[ingest] mailbox {mailbox.id} skipped: its daily background cap or budget is used up')
        return
    senders = (await load_sources(mailbox.user_id)).get('newsletters', [])
    if not senders:
        return

    async with worker_conn('newsletter') as conn:
        last = await conn.fetchval(
            "SELECT max(started_at) FROM ingest_jobs WHERE mailbox_id = $1 AND kind = 'scheduled' AND status = 'done'",
            mailbox.id,
        )
    now = time.time()
    since = last / 1000 - SWEEP_OVERLAP_S if last else now - FIRST_SWEEP_LOOKBACK_S
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat()
    query = build_query(iso(since), iso(now + 60), senders, '')
    service = await service_for(mailbox)
    ids, _ = await asyncio.to_thread(list_message_ids, service, query)
    stored = await newsletter_store.load_emails(mailbox, ids, SUMMARY_VERSION)
    todo = [i for i in ids if i not in stored]

    job_id = str(uuid.uuid4())
    started = int(now * 1000)  # the next sweep starts from here (minus the overlap)
    async with worker_conn('newsletter') as conn:
        await conn.execute(
            "INSERT INTO ingest_jobs (id, mailbox_id, kind, status, message_ids, total, created_at, started_at) "
            "VALUES ($1, $2, 'scheduled', 'running', $3, $4, $5, $5)",
            job_id, mailbox.id, todo, len(todo), started,
        )
    try:
        status = await _summarize_ids(job_id, mailbox, todo, service, charge_to=mailbox.user_id, day=day,
                                      cap_reached=cap_reached)
        await _finish(job_id, status, 'daily background cap reached' if status == 'capped' else None)
    except Exception as e:
        await _finish(job_id, 'failed', describe_gmail_error(e))
        raise


AUDIT_RETENTION_DAYS = 365
# Days between an account deletion request and the purge (design 14 §8).
# Must match DELETION_GRACE_DAYS in lib/users.ts (shown to users).
DELETION_GRACE_DAYS = 30


async def purge_deleted_accounts() -> None:
    """Remove accounts whose deletion grace period is over, with all their data
    (SQL function purge_deleted_accounts, drizzle/migrations/0011)."""
    try:
        async with worker_conn('retention') as conn:
            due = await conn.fetch(
                "SELECT id FROM users WHERE status = 'deleting' AND deletion_requested_at < $1",
                _now_ms() - DELETION_GRACE_DAYS * 86400 * 1000,
            )
        # Revoke their Gmail grants at Google first (best effort); the purge's
        # cascade then deletes the mailboxes and stored credentials.
        await mailboxes.revoke_for_users([r['id'] for r in due])
        async with worker_conn('retention') as conn:
            n = await conn.fetchval('SELECT purge_deleted_accounts($1)', DELETION_GRACE_DAYS)
        if n:
            print(f'[retention] purged {n} deleted account(s)')
    except Exception as e:  # never let retention stop the newsletter work
        print(f'[retention] account purge failed: {type(e).__name__}: {e}')


async def purge_audit_log() -> None:
    """Delete audit_log rows older than a year (design 14 §8). Indexed on created_at."""
    try:
        async with worker_conn('retention') as conn:
            await conn.execute(
                'DELETE FROM audit_log WHERE created_at < $1',
                _now_ms() - AUDIT_RETENTION_DAYS * 86400 * 1000,
            )
    except Exception as e:  # never let retention stop the newsletter work
        print(f'[retention] audit_log purge failed: {type(e).__name__}: {e}')


async def _record_failed_sweep(mailbox_id: str, error: str) -> None:
    """A sweep that failed before its row existed (e.g. Gmail sign-in) gets one now."""
    now = _now_ms()
    async with worker_conn('newsletter') as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM ingest_jobs WHERE mailbox_id = $1 AND kind = 'scheduled' AND status = 'failed' "
            'AND finished_at >= $2', mailbox_id, now - 60_000,
        )
        if not exists:  # the row-level handler in _sweep_mailbox already recorded this one
            await conn.execute(
                "INSERT INTO ingest_jobs (id, mailbox_id, kind, status, message_ids, total, error, created_at, started_at, finished_at) "
                "VALUES ($1, $2, 'scheduled', 'failed', '{}', 0, $3, $4, $4, $4)",
                str(uuid.uuid4()), mailbox_id, error, now,
            )


# ── Owner controls (Usage page, via /api/newsletter/ingest) ─────────────────

async def get_settings() -> dict:
    """{enabled, updated_by, updated_at}; no row means enabled."""
    async with worker_conn('newsletter') as conn:
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
    async with worker_conn('newsletter') as conn:
        await conn.execute(
            'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, $4) '
            'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, '
            'updated_at = EXCLUDED.updated_at',
            SETTINGS_KEY, json.dumps({'enabled': enabled}), actor, _now_ms(),
        )
    print(f'[ingest] scheduled sweep {"resumed" if enabled else "paused"} by {actor}')
    return await get_settings()


async def status(mailbox: Mailbox | None, include_app: bool) -> dict:
    """The mailbox's background summarizing: the owner's global switch, its own
    switch, today's spend against its cap, and its latest sweep. With
    `include_app` (owner), app-wide figures too; the owner may have no mailbox."""
    mailbox_id = mailbox.id if mailbox else ''
    async with worker_conn('newsletter') as conn:
        await _expire_stale(conn)
        last = await conn.fetchrow(
            "SELECT status, total, done_count, failed_count, cost_usd, error, started_at, finished_at "
            "FROM ingest_jobs WHERE mailbox_id = $1 AND kind = 'scheduled' ORDER BY created_at DESC LIMIT 1",
            mailbox_id,
        )
        last_ok = await conn.fetchval(
            "SELECT max(finished_at) FROM ingest_jobs WHERE mailbox_id = $1 AND kind = 'scheduled' AND status = 'done'",
            mailbox_id,
        )
        failing_since = None
        if last and last['status'] == 'failed':
            failing_since = await conn.fetchval(
                "SELECT min(created_at) FROM ingest_jobs WHERE mailbox_id = $1 AND kind = 'scheduled' "
                "AND status = 'failed' AND created_at > coalesce($2::bigint, 0)", mailbox_id, last_ok,
            )
        active = await conn.fetchval(
            "SELECT count(*) FROM ingest_jobs WHERE mailbox_id = $1 AND status IN ('queued', 'running')", mailbox_id,
        )
        app = None
        if include_app:
            app = dict(await conn.fetchrow(
                "SELECT count(*) FILTER (WHERE m.status = 'active') AS mailboxes_connected, "
                "count(*) FILTER (WHERE m.status = 'reauth_required') AS mailboxes_need_reconnect, "
                "(SELECT count(*) FROM ingest_jobs WHERE status IN ('queued', 'running')) AS active_jobs, "
                "(SELECT coalesce(sum(cost_usd), 0) FROM ingest_jobs WHERE kind = 'scheduled' AND created_at >= $1) "
                "AS spent_today_usd FROM mailboxes m", _utc_midnight_ms(),
            ))
    return {
        **(await get_settings()),  # enabled = the owner's global switch
        'mailbox': {'email': mailbox.email, 'sweep_enabled': mailbox.sweep_enabled} if mailbox else None,
        'daily_cap_usd': MAILBOX_DAILY_CAP_USD,
        'spent_today_usd': await _mailbox_sweep_spent_today(mailbox_id) if mailbox else 0.0,
        'schedule': 'every 30 minutes',
        'active_jobs': app['active_jobs'] if app else active,
        'last_sweep': dict(last) if last else None,
        'last_success_at': last_ok,
        'failing_since': failing_since,  # set while the latest sweep failed
        'app': {**app, 'spent_today_usd': float(app['spent_today_usd'])} if app else None,
    }

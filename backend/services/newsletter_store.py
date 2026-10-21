"""newsletter_store.py — per-email newsletter store (scale-out Phase 1).

Each email is summarized once and reused by every later digest run that
includes it (see architecture/features/13-newsletter-scale-out-plan-2026-10-20.md).
Table `newsletter_emails` is defined in drizzle/schema.ts (migration 0005).

Which emails belong to a run still comes from Gmail on every run, so emails
deleted or moved out of the range drop out on their own. Topic grouping is
not stored: it depends on the set of emails in a run.
"""

import time

from services.db import get_pool

RETENTION_DAYS = 90  # rows older than this are purged; re-summarized if requested again


async def load_emails(message_ids: list[str], summary_version: int) -> dict[str, dict]:
    """Stored emails for `message_ids` whose summary is current, keyed by message id.

    Returned dicts use the same keys as fetch_emails() (body is empty: it isn't stored).
    """
    if not message_ids:
        return {}
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            'SELECT message_id, sender, subject, date_header, snippet, links, summary '
            'FROM newsletter_emails WHERE message_id = ANY($1::text[]) AND summary_version = $2',
            message_ids, summary_version,
        )
    return {
        r['message_id']: {
            'id':      r['message_id'],
            'from':    r['sender'],
            'subject': r['subject'],
            'date':    r['date_header'],
            'snippet': r['snippet'],
            'links':   list(r['links']),
            'body':    '',
            'summary': r['summary'],
        }
        for r in rows
    }


async def save_emails(emails: list[dict], summary_version: int) -> None:
    """Upsert emails that have a `summary`. Emails without one (the summary call
    failed) are not stored, so the next run retries them."""
    rows = [
        (e['id'], e['from'], e['subject'], e['date'], e['snippet'], e['links'], e['summary'],
         summary_version, int(time.time() * 1000))
        for e in emails if e.get('summary')
    ]
    if not rows:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.executemany(
            'INSERT INTO newsletter_emails '
            '(message_id, sender, subject, date_header, snippet, links, summary, summary_version, created_at) '
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) '
            'ON CONFLICT (message_id) DO UPDATE SET sender = EXCLUDED.sender, subject = EXCLUDED.subject, '
            'date_header = EXCLUDED.date_header, snippet = EXCLUDED.snippet, links = EXCLUDED.links, '
            'summary = EXCLUDED.summary, summary_version = EXCLUDED.summary_version, created_at = EXCLUDED.created_at',
            rows,
        )


async def purge_expired() -> int:
    """Delete rows older than RETENTION_DAYS. Returns the number deleted."""
    cutoff = int((time.time() - RETENTION_DAYS * 86400) * 1000)
    pool = await get_pool()
    async with pool.acquire() as conn:
        status = await conn.execute('DELETE FROM newsletter_emails WHERE created_at < $1', cutoff)
    return int(status.split()[-1])

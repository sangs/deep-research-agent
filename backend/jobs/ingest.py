"""Entry point of the Cloud Run Job `newsletter-ingest` (scale-out Phase 2).

    python -m jobs.ingest              # queued on_demand jobs, then the sweep, then the finops cost push
    python -m jobs.ingest --no-sweep   # queued on_demand jobs only
    python -m jobs.ingest --finops-backfill-days=60   # one-off: cost push of the last 60 days only, no ingest

Started by the backend when a digest run queues a job, and by Cloud Scheduler
every 30 min. All work lives in services/ingest.py.
"""

import asyncio
import sys

from services.db import close_pool
from services.finops_push import push_costs
from services.ingest import run_worker


BACKFILL_FLAG = '--finops-backfill-days='


async def main() -> None:
    backfill = next((a[len(BACKFILL_FLAG):] for a in sys.argv if a.startswith(BACKFILL_FLAG)), None)
    if backfill is not None:
        await push_costs(days=int(backfill))  # no ingest work and no database pool beyond the push
        await close_pool()
        return
    sweep = '--no-sweep' not in sys.argv
    try:
        await run_worker(sweep=sweep)
        if sweep:  # scheduled runs only (every 30 min); push_costs never raises
            await push_costs()
    finally:
        await close_pool()


if __name__ == '__main__':
    asyncio.run(main())

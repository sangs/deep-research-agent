"""Entry point of the Cloud Run Job `newsletter-ingest` (scale-out Phase 2).

    python -m jobs.ingest              # queued on_demand jobs, then the sweep
    python -m jobs.ingest --no-sweep   # queued on_demand jobs only

Started by the backend when a digest run queues a job, and by Cloud Scheduler
every 30 min. All work lives in services/ingest.py.
"""

import asyncio
import sys

from services.db import close_pool
from services.ingest import run_worker


async def main() -> None:
    try:
        await run_worker(sweep='--no-sweep' not in sys.argv)
    finally:
        await close_pool()


if __name__ == '__main__':
    asyncio.run(main())

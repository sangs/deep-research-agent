import os
import asyncpg

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            os.environ['DATABASE_URL'],
            min_size=1,
            max_size=5,
            statement_cache_size=0,  # required for Supabase PgBouncer (transaction pooling mode)
        )
    return _pool

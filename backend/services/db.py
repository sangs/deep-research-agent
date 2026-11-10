"""Database access for the backend (design 14 §5.2, the asyncpg twin of lib/db-access.ts).

The pool logs in as `app_login`, which has no table access of its own
(drizzle/migrations/0010_rls_roles.sql). Every query runs inside one of:

- user_conn(user_id): a transaction as `app_user` with app.user_id set, so row
  security limits every query to that user's rows.
- worker_conn(reason): a transaction as `app_worker` for work that isn't one
  user's: the newsletter mailbox (owner-only until Phase C), the MCP default
  source list, retention. That role cannot read research, digests or sources.

Both settings are transaction-local (safe with the Supabase transaction pooler).
DATABASE_URL here is the app_login connection string (secret `app-database-url`).
"""

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Literal

import asyncpg

_pool: asyncpg.Pool | None = None

WorkerReason = Literal['newsletter', 'mcp_defaults', 'retention']


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


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def user_conn(user_id: str) -> AsyncIterator[asyncpg.Connection]:
    if not user_id:
        raise ValueError('user_conn: missing user id')
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('role', 'app_user', true), set_config('app.user_id', $1, true)", user_id,
            )
            yield conn


@asynccontextmanager
async def worker_conn(reason: WorkerReason) -> AsyncIterator[asyncpg.Connection]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('role', 'app_worker', true), set_config('application_name', $1, true)",
                f'worker:{reason}',
            )
            yield conn

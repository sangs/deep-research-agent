"""App users (table owned by drizzle/schema.ts; access logic in lib/users.ts)."""

from services.db import get_pool


async def owner_user_id() -> str | None:
    """The active owner's user id. The connected Gmail mailbox is the owner's until
    each user connects their own (design 14, Phase C), so newsletter work that
    has no requesting user (scheduled sweeps) uses the owner's sender list."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT id FROM users WHERE role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1"
        )

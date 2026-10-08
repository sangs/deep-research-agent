"""Per-request cost tracking for the News / Newsletter pipelines.

main.py starts a tracker for each /digest request. OpenRouter and Exa call
sites report the cost the provider returned via record_cost(), and the tracker
emits a cumulative {'type': 'usage', ...} SSE event after each paid call, so the
Next.js proxy (app/api/news/route.ts) can record actual spend against the
user's daily budget even if the run is stopped part-way.

MCP tool calls run without a tracker, so record_cost() is a no-op there.
"""

import contextvars
from typing import Awaitable, Callable

Emit = Callable[[dict], Awaitable[None]]


class UsageTracker:
    def __init__(self, emit: Emit | None):
        self._emit = emit
        self._costs: dict[tuple[str, str | None], float] = {}

    def event(self) -> dict:
        return {
            'type': 'usage',
            'cost_usd': round(sum(self._costs.values()), 6),
            'items': [
                {'provider': provider, 'model': model, 'cost_usd': round(cost, 6)}
                for (provider, model), cost in self._costs.items()
            ],
        }

    async def add(self, provider: str, model: str | None, cost_usd: float) -> None:
        key = (provider, model)
        self._costs[key] = self._costs.get(key, 0.0) + cost_usd
        if self._emit:
            await self._emit(self.event())


_current: contextvars.ContextVar[UsageTracker | None] = contextvars.ContextVar('usage_tracker', default=None)


def start_tracking(emit: Emit | None) -> UsageTracker:
    """Call at the start of the task that runs one pipeline; child tasks
    (asyncio.gather, to_thread) inherit the tracker through the context."""
    tracker = UsageTracker(emit)
    _current.set(tracker)
    return tracker


async def record_cost(provider: str, model: str | None, cost_usd: float | None) -> None:
    tracker = _current.get()
    if tracker is not None and cost_usd:
        await tracker.add(provider, model, float(cost_usd))

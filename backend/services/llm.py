"""Single entry point for OpenRouter Chat Completions calls from the backend.

Asks OpenRouter for usage accounting and records the returned cost (and the
model it actually routed to) with the per-request usage tracker.
"""

import os

import httpx

from services.usage import record_cost

OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'


async def chat_completion(client: httpx.AsyncClient, payload: dict) -> dict:
    resp = await client.post(
        OPENROUTER_URL,
        headers={
            'Authorization': f"Bearer {os.getenv('OPENROUTER_API_KEY', '')}",
            'Content-Type': 'application/json',
        },
        json={**payload, 'usage': {'include': True}},
    )
    resp.raise_for_status()
    data = resp.json()
    await record_cost('openrouter', data.get('model'), (data.get('usage') or {}).get('cost'))
    return data

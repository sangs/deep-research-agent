"""Single entry point for OpenRouter Chat Completions calls from the backend.

Asks OpenRouter for usage accounting and records the returned cost (and the
model it actually routed to) with the per-request usage tracker.

Every call carries an explicit max_tokens: without one OpenRouter pre-authorizes
the model's full output window (65,536 tokens for Gemini Flash), so a low
credit balance rejects the call outright (HTTP 402) even when the real
response would be small. That is what silently broke "By topic" grouping on
2026-10-20 (daily log §20).
"""

import os

import httpx

from services.usage import record_cost

OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
DEFAULT_MAX_TOKENS = 4096


class ProviderCreditError(RuntimeError):
    """OpenRouter refused the call for lack of credits (HTTP 402)."""


def describe_llm_error(exc: Exception) -> str:
    """Short, user-facing reason for a failed LLM call."""
    if isinstance(exc, ProviderCreditError):
        return str(exc)
    if isinstance(exc, httpx.TimeoutException):
        return 'the AI model took too long to respond'
    if isinstance(exc, httpx.HTTPStatusError):
        return f'the AI provider returned HTTP {exc.response.status_code}'
    return f'{type(exc).__name__}'


async def chat_completion(client: httpx.AsyncClient, payload: dict) -> dict:
    resp = await client.post(
        OPENROUTER_URL,
        headers={
            'Authorization': f"Bearer {os.getenv('OPENROUTER_API_KEY', '')}",
            'Content-Type': 'application/json',
        },
        json={'max_tokens': DEFAULT_MAX_TOKENS, **payload, 'usage': {'include': True}},
    )
    if resp.status_code == 402:
        raise ProviderCreditError('OpenRouter credit balance is exhausted — add credits at openrouter.ai/settings/credits')
    resp.raise_for_status()
    data = resp.json()
    await record_cost('openrouter', data.get('model'), (data.get('usage') or {}).get('cost'))
    return data

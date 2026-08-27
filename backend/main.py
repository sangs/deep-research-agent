import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="websockets")
warnings.filterwarnings("ignore", category=DeprecationWarning, module="uvicorn")

import asyncio
import json
import sys
import os

# Ensure project root is on the path so relative imports work
sys.path.insert(0, os.path.dirname(__file__))

from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.middleware.cors import CORSMiddleware

from tools.news_tools import register_tools


# ── FastMCP app ──────────────────────────────────────────────────────────────
mcp = FastMCP("News Intelligence Hub")
register_tools(mcp)


# ── Streaming /digest endpoint ────────────────────────────────────────────────
async def digest_endpoint(request: Request) -> Response:
    """SSE streaming endpoint for the Next.js UI.
    POST /digest { mode, time_range, region?, custom_domains? }
    Streams: searching / results / digest / done / error events.
    """
    try:
        body = await request.json()
    except Exception:
        return Response('{"error":"invalid json"}', status_code=400, media_type='application/json')

    mode = body.get('mode', 'general')
    time_range = body.get('time_range', 'today')
    region = body.get('region') or None
    custom_domains = body.get('custom_domains') or None
    question = body.get('question') or None
    conversation_history = body.get('conversation_history') or None
    tz_name = body.get('timezone') or 'UTC'

    # Newsletter-specific params (only used when mode == 'newsletter')
    newsletter_senders   = [s.strip() for s in (body.get('newsletter_senders') or '').split(',') if s.strip()]
    newsletter_subject   = body.get('newsletter_subject_kw') or None
    newsletter_by_source = bool(body.get('newsletter_by_source', False))
    # Custom date range (only used when time_range == 'custom')
    start_date = body.get('start_date') or None
    end_date   = body.get('end_date') or None

    async def event_stream():
        # Events are pushed onto a queue by the pipeline (running as a
        # background task) and drained here in real time, so the client sees
        # incremental progress instead of one burst after the entire fetch/
        # cluster/summarize pipeline finishes. The previous implementation
        # buffered every event into a list and only yielded after `await
        # run_gmail_digest(...)` fully returned — for a large digest (a
        # month range, many senders) that meant zero bytes reached the
        # client for minutes, risking proxy/serverless idle-timeout kills.
        queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit(event: dict):
            await queue.put(event)

        async def run_pipeline():
            try:
                if mode == 'newsletter':
                    from services.gmail_service import run_gmail_digest
                    digest = await run_gmail_digest(
                        time_range=time_range,
                        senders=newsletter_senders or None,
                        subject_kw=newsletter_subject,
                        by_source=newsletter_by_source,
                        emit_event=emit,
                        tz_name=tz_name,
                        start_date=start_date,
                        end_date=end_date,
                    )
                else:
                    from services.openrouter import run_news_agent
                    digest = await run_news_agent(
                        mode=mode,
                        time_range=time_range,
                        region=region,
                        custom_domains=custom_domains,
                        question=question,
                        conversation_history=conversation_history,
                        emit_event=emit,
                        tz_name=tz_name,
                    )
                await queue.put({'type': 'digest', **digest.model_dump()})
                await queue.put({'type': 'done'})
            except Exception as e:
                await queue.put({'type': 'error', 'message': str(e)})
            finally:
                await queue.put(None)  # sentinel — end of stream

        task = asyncio.create_task(run_pipeline())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f'data: {json.dumps(event)}\n\n'
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


# ── Mount everything on a single Starlette app ───────────────────────────────
def create_app():
    mcp_app = mcp.http_app(path='/mcp')

    routes = [
        Route('/digest', endpoint=digest_endpoint, methods=['POST']),
    ]

    app = Starlette(routes=routes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['*'],
        allow_headers=['*'],
    )

    # Mount MCP app
    app.mount('/mcp', mcp_app)
    return app


app = create_app()

if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', '8000'))
    uvicorn.run('main:app', host='0.0.0.0', port=port, reload=False)

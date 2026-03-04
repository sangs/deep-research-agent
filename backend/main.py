import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="websockets")
warnings.filterwarnings("ignore", category=DeprecationWarning, module="uvicorn")

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

    from services.openrouter import run_news_agent

    async def event_stream():
        events: list[dict] = []

        async def emit(event: dict):
            events.append(event)

        try:
            digest = await run_news_agent(
                mode=mode,
                time_range=time_range,
                region=region,
                custom_domains=custom_domains,
                question=question,
                emit_event=emit,
            )

            # Yield all accumulated search-progress events first
            for ev in events:
                yield f'data: {json.dumps(ev)}\n\n'

            # Yield the digest
            yield f'data: {json.dumps({"type": "digest", **digest.model_dump()})}\n\n'
            yield f'data: {json.dumps({"type": "done"})}\n\n'

        except Exception as e:
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'

    return StreamingResponse(
        event_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


# ── Sources REST endpoint (for Next.js /api/sources proxy) ───────────────────
async def sources_endpoint(request: Request) -> Response:
    from tools.news_tools import load_sources, persist_sources

    if request.method == 'GET':
        data = load_sources()
        return Response(
            json.dumps({
                'news_sites': data.get('news_sites', []),
                'research_sites': data.get('research_sites', []),
                'newsletters': data.get('newsletters', []),
            }),
            media_type='application/json',
        )

    try:
        body = await request.json()
    except Exception:
        return Response('{"error":"invalid json"}', status_code=400, media_type='application/json')

    action = body.get('action', 'list')
    domains = body.get('domains', [])
    list_type = body.get('list_type', 'news_sites')
    if list_type not in ('news_sites', 'research_sites'):
        list_type = 'news_sites'

    data = load_sources()
    target_list: list[str] = data.get(list_type, [])

    if action == 'add':
        added = []
        for d in domains:
            d = d.lower().strip()
            if d and d not in target_list:
                target_list.append(d)
                added.append(d)
        data[list_type] = target_list
        persist_sources(data)
        return Response(json.dumps({'added': added, 'total': len(target_list), 'list_type': list_type}), media_type='application/json')

    elif action == 'remove':
        removed = []
        for d in domains:
            d = d.lower().strip()
            if d in target_list:
                target_list.remove(d)
                removed.append(d)
        data[list_type] = target_list
        persist_sources(data)
        return Response(json.dumps({'removed': removed, 'total': len(target_list), 'list_type': list_type}), media_type='application/json')

    return Response(
        json.dumps({
            'news_sites': data.get('news_sites', []),
            'research_sites': data.get('research_sites', []),
        }),
        media_type='application/json',
    )


# ── Mount everything on a single Starlette app ───────────────────────────────
def create_app():
    mcp_app = mcp.http_app(path='/mcp')

    routes = [
        Route('/digest', endpoint=digest_endpoint, methods=['POST']),
        Route('/sources', endpoint=sources_endpoint, methods=['GET', 'POST']),
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

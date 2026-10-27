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
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.middleware.cors import CORSMiddleware

from tools.news_tools import register_tools
from services.usage import start_tracking


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
    # Set by the Next.js proxy from the session (the backend is private, only it can call)
    requested_by = body.get('user_id') or None

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
            # Costs reported by OpenRouter/Exa during this run stream to the
            # client as cumulative 'usage' events (services/usage.py).
            start_tracking(emit)
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
                        requested_by=requested_by,
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
                if digest is not None:  # None: newsletter summarizing handed to the background job
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



# ── Gmail organize endpoints (all writes go through services/gmail_organizer.py) ──
# The backend is private (Cloud Run IAM); the Next.js /api/gmail proxy is the
# only caller, restricts it to the owner, and supplies `actor` from the session.
async def _gmail_json(handler):
    from services.gmail_organizer import GmailGuardError
    try:
        return JSONResponse(await handler())
    except GmailGuardError as e:
        return JSONResponse({'error': str(e)}, status_code=400)
    except Exception as e:
        from services.gmail_service import describe_gmail_error
        return JSONResponse({'error': describe_gmail_error(e)}, status_code=502)


async def gmail_labels_endpoint(request: Request) -> Response:
    from services.gmail_service import get_gmail_service
    from services.gmail_organizer import list_user_labels

    async def run():
        service = await asyncio.to_thread(get_gmail_service)
        return {'labels': await asyncio.to_thread(list_user_labels, service)}
    return await _gmail_json(run)


async def gmail_actions_endpoint(request: Request) -> Response:
    from services.gmail_organizer import list_actions
    limit = min(int(request.query_params.get('limit', '20')), 100)

    async def run():
        return {'actions': await list_actions(limit)}
    return await _gmail_json(run)


async def gmail_apply_endpoint(request: Request) -> Response:
    """POST {kind: 'move'|'label'|'organize', actor, groups: [{label, message_ids}], move: bool, confirm_bulk?: bool}"""
    from services.gmail_service import get_gmail_service
    from services.gmail_organizer import apply_groups
    body = await request.json()

    async def run():
        groups = [
            {'label': g['label'], 'message_ids': [m for m in g.get('message_ids', []) if isinstance(m, str) and m]}
            for g in body.get('groups', []) if g.get('label')
        ]
        groups = [g for g in groups if g['message_ids']]
        service = await asyncio.to_thread(get_gmail_service)
        return await apply_groups(
            service, body.get('kind', 'label'), body.get('actor', 'unknown'), groups,
            move=bool(body.get('move')), confirm_bulk=bool(body.get('confirm_bulk')),
        )
    return await _gmail_json(run)


async def gmail_undo_endpoint(request: Request) -> Response:
    """POST {action_id, actor}"""
    from services.gmail_service import get_gmail_service
    from services.gmail_organizer import undo_action
    body = await request.json()

    async def run():
        service = await asyncio.to_thread(get_gmail_service)
        return await undo_action(service, body.get('action_id', ''), body.get('actor', 'unknown'))
    return await _gmail_json(run)


# ── Newsletter background summarizing: owner controls (services/ingest.py) ──
# Same trust model as the Gmail endpoints: only the Next.js proxy can call,
# it restricts these to the owner and supplies `actor` from the session.
async def ingest_status_endpoint(request: Request) -> Response:
    from services import ingest
    return JSONResponse(await ingest.status())


async def ingest_settings_endpoint(request: Request) -> Response:
    """POST {enabled: bool, actor}"""
    from services import ingest
    body = await request.json()
    if not isinstance(body.get('enabled'), bool):
        return JSONResponse({'error': 'enabled must be true or false'}, status_code=400)
    return JSONResponse(await ingest.set_enabled(body['enabled'], body.get('actor', 'unknown')))


async def ingest_run_endpoint(request: Request) -> Response:
    """POST {actor} — start a sweep now instead of waiting for the next slot."""
    from services import ingest
    body = await request.json()
    if not (await ingest.get_settings())['enabled']:
        return JSONResponse({'error': 'Background summarizing is paused; turn it on first'}, status_code=409)
    try:
        await ingest.start_execution(sweep=True)
    except Exception as e:
        return JSONResponse({'error': f'Could not start the job: {e}'}, status_code=502)
    print(f'[ingest] sweep started now by {body.get("actor", "unknown")}')
    return JSONResponse({'ok': True})


# ── Mount everything on a single Starlette app ───────────────────────────────
def create_app():
    mcp_app = mcp.http_app(path='/mcp')

    routes = [
        Route('/digest', endpoint=digest_endpoint, methods=['POST']),
        Route('/gmail/labels', endpoint=gmail_labels_endpoint, methods=['GET']),
        Route('/gmail/actions', endpoint=gmail_actions_endpoint, methods=['GET']),
        Route('/gmail/apply', endpoint=gmail_apply_endpoint, methods=['POST']),
        Route('/gmail/undo', endpoint=gmail_undo_endpoint, methods=['POST']),
        Route('/ingest/status', endpoint=ingest_status_endpoint, methods=['GET']),
        Route('/ingest/settings', endpoint=ingest_settings_endpoint, methods=['POST']),
        Route('/ingest/run', endpoint=ingest_run_endpoint, methods=['POST']),
    ]

    # The MCP sub-app's lifespan starts its session manager (task group);
    # without it every /mcp request fails with "Task group is not initialized".
    app = Starlette(routes=routes, lifespan=mcp_app.lifespan)
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
    # 8010 locally (8000 is often taken, e.g. by cortex-drive); Cloud Run sets PORT.
    port = int(os.getenv('PORT', '8010'))
    uvicorn.run('main:app', host='0.0.0.0', port=port, reload=False)

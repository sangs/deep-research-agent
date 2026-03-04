# Applied Research — Design Decisions

Explains key architectural choices and technology decisions in the News Intelligence Hub backend.

---

## 1. What is Uvicorn?

Uvicorn is an async Python web server. It listens on a network port (e.g., `0.0.0.0:8000`), accepts raw TCP connections, and translates them into the ASGI interface that frameworks like Starlette expect.

In this project it is started in `backend/main.py`:

```python
uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=False)
```

**Stack position:**

```
HTTP request
    → Uvicorn (web server — handles TCP/HTTP)
        → Starlette (routing, middleware)
            → /digest, /sources, /mcp endpoints
```

Uvicorn is the Python equivalent of what Node's built-in HTTP server does for Express apps — the framework defines the logic, the server handles the network layer.

---

## 2. What is Starlette, and does the backend use FastMCP or FastAPI?

**Starlette** is a lightweight Python async web framework. It provides routing, middleware, request/response handling — the building blocks of an HTTP server. FastAPI is built on top of Starlette under the hood, but this project uses Starlette directly.

The two HTTP routes are defined with plain Starlette primitives:

```python
from starlette.applications import Starlette
from starlette.routing import Route

routes = [
    Route('/digest', endpoint=digest_endpoint, methods=['POST']),
    Route('/sources', endpoint=sources_endpoint, methods=['GET', 'POST']),
]
app = Starlette(routes=routes)
app.add_middleware(CORSMiddleware, ...)
```

**The backend uses FastMCP, not FastAPI.** There is no FastAPI import anywhere. FastMCP provides the MCP server that exposes the 5 news tools over the `/mcp` SSE endpoint. Starlette provides the two UI-facing HTTP endpoints. They are composed together:

```python
from fastmcp import FastMCP

mcp = FastMCP("News Intelligence Hub")
register_tools(mcp)          # registers the 5 MCP tools

mcp_app = mcp.http_app(path='/mcp')
app.mount('/mcp', mcp_app)   # FastMCP handles /mcp/*
                             # Starlette handles /digest and /sources
```

---

## 3. Why do 4 tabs share only 2 endpoints?

The 4 tabs (Global, Regional, Blogs & Sites, Newsletter) do not map to 4 separate endpoints. They all post to the same `/digest` endpoint, differentiated by a `mode` parameter in the request body.

**`/digest` — serves all 4 tabs**

```python
mode = body.get('mode', 'general')
time_range = body.get('time_range', 'today')
region = body.get('region') or None          # Regional tab only
custom_domains = body.get('custom_domains') or None  # Curated tab only
question = body.get('question') or None
```

| Tab | `mode` value |
|-----|--------------|
| Global | `general` |
| Regional | `region` |
| Blogs & Sites | `curated` |
| Newsletter | `newsletter` |

The backend routes internally via `run_news_agent(mode=mode, ...)`, which calls different Exa search tools depending on the mode.

**`/sources` — unrelated to the 4 tabs**

This endpoint backs the "Manage Sources" panel (not any content tab). It is a simple CRUD interface for adding and removing curated domains: `GET` to list, `POST` with `action: add | remove` to modify.

**Design rationale:** One flexible, parameterized endpoint rather than one endpoint per tab. This keeps the backend surface minimal and makes it straightforward to add new modes without adding new routes.

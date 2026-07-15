# ---- Builder: resolve/install deps with uv ----
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

# ---- Runtime: slim image, no build tools ----
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8080
# Shell form is required so $PORT expands at container start (exec-form CMD arrays don't expand env vars)
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}

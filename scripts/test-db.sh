#!/usr/bin/env bash
# Run the isolation suite (design 14 §5.4) against a throwaway Postgres.
#
#   scripts/test-db.sh [vitest args]
#
# Starts its own container (`dra-rls-test`, port 54330, removed afterwards), applies
# every migration as postgres, enables app_login, and runs vitest. Roles are
# server-wide in Postgres, so the suite must not share a server with local dev
# (it sets app_login's password). Never point this at Supabase.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="dra-rls-test"
PORT="${TEST_DB_PORT:-54330}"
IMAGE="${TEST_DB_IMAGE:-postgres:16-alpine}"
PW="test-only-password"
# Migrations run as `migrator`, shaped like Supabase's `postgres` role: CREATEROLE,
# CREATEDB, BYPASSRLS and owner of the database, but NOT a superuser (a superuser
# would hide statements that fail on Supabase, as NOSUPERUSER did on 2026-11-10).
ADMIN_URL="postgres://migrator:${PW}@localhost:${PORT}/app"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD="$PW" -p "${PORT}:5432" "$IMAGE" >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1 # the image restarts the server once after initdb
for _ in $(seq 1 20); do
  docker exec "$NAME" psql -U postgres -qc "select 1" >/dev/null 2>&1 && break
  sleep 0.5
done
docker exec "$NAME" psql -U postgres -q \
  -c "CREATE ROLE migrator LOGIN PASSWORD '${PW}' CREATEROLE CREATEDB BYPASSRLS NOSUPERUSER" \
  -c "CREATE DATABASE app OWNER migrator"

DATABASE_URL="$ADMIN_URL" npx drizzle-kit migrate >/dev/null
APP_URL="$(scripts/db-app-login.sh "$ADMIN_URL")"

TEST_ADMIN_DATABASE_URL="$ADMIN_URL" APP_DATABASE_URL="$APP_URL" npx vitest run "$@"

#!/usr/bin/env bash
# Prepare a disposable database for the isolation suite (design 14 §5.4) and run it.
#
#   scripts/test-db.sh            # recreate `rls_test` in the local Docker Postgres, migrate, run `npm test`
#
# Uses the container `dra-local-db` (postgres:16, port 54329). Never point this
# at Supabase: it drops and recreates the database.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${TEST_DB_CONTAINER:-dra-local-db}"
PORT="${TEST_DB_PORT:-54329}"
DB="rls_test"

PW="$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')"
ADMIN_URL="postgres://postgres:${PW}@localhost:${PORT}/${DB}"

docker exec "$CONTAINER" psql -U postgres -q -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE)" -c "CREATE DATABASE ${DB}"
DATABASE_URL="$ADMIN_URL" npx drizzle-kit migrate >/dev/null
APP_URL="$(scripts/db-app-login.sh "$ADMIN_URL")"

TEST_ADMIN_DATABASE_URL="$ADMIN_URL" APP_DATABASE_URL="$APP_URL" npx vitest run "$@"

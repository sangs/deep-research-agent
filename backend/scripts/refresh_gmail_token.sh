#!/usr/bin/env bash
#
# refresh_gmail_token.sh — one-command Gmail OAuth token renewal for the
# Newsletter panel's Cloud Run backend.
#
# Run this ONLY when the Newsletter panel is actually failing with
# "invalid_grant: Bad Request" or the backend log shows
# google.auth.exceptions.RefreshError — NOT as routine maintenance. Access
# tokens auto-refresh silently on every call; this script is only needed
# when the underlying refresh_token itself has been revoked or expired.
#
# What this automates (see documents/gmail_auth_setup.md Part 2b / Part 3
# for the full explanation of *why* each step is needed):
#   1. Back up the current ~/gmail_token.json (timestamped, non-destructive)
#   2. Re-run the local OAuth flow — opens a browser, you sign in
#      (this step is inherently interactive; Google's OAuth flow for a
#      Desktop-app client requires a real browser + human consent, so it
#      cannot be scripted away)
#   3. Push the new token as a new Secret Manager secret version
#   4. Force the Cloud Run "backend" service to deploy a new revision that
#      reads the secret fresh (a secret version alone does NOT take effect
#      on an already-running container — Cloud Run revisions are immutable)
#   5. Verify: hit the live backend's newsletter mode and confirm no
#      invalid_grant/RefreshError comes back
#
# Usage:
#   ./backend/scripts/refresh_gmail_token.sh
#
# No flags. Deployment-specific values (GCP project ID, Cloud Run backend URL)
# are read from the gitignored config file refresh_gmail_token.env next to this
# script, so they are never committed. One-time setup:
#   cp backend/scripts/refresh_gmail_token.env.example backend/scripts/refresh_gmail_token.env
#   # then fill in PROJECT_ID and BACKEND_URL
# (see documents/gcp_cloud_run_deployment.md for the current values).

set -euo pipefail

# Resolve this script's location so it works from any cwd
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
BACKEND_DIR="$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\n\033[1;31mFAILED:\033[0m %s\n' "$1" >&2; exit 1; }

CONFIG_FILE="$SCRIPT_DIR/refresh_gmail_token.env"
[ -f "$CONFIG_FILE" ] || fail "Missing $CONFIG_FILE — copy refresh_gmail_token.env.example to it and fill in the values."
# shellcheck source=/dev/null
source "$CONFIG_FILE"

: "${PROJECT_ID:?PROJECT_ID must be set in $CONFIG_FILE}"
: "${BACKEND_URL:?BACKEND_URL must be set in $CONFIG_FILE}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-backend}"
SECRET_NAME="${SECRET_NAME:-gmail-token-json}"
TOKEN_PATH="${GMAIL_TOKEN_PATH:-$HOME/gmail_token.json}"

command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI not found on PATH."
command -v uv     >/dev/null 2>&1 || fail "uv not found on PATH (needed to run the backend's Python OAuth flow)."

# ── Step 1: backup ────────────────────────────────────────────────────────
if [ -f "$TOKEN_PATH" ]; then
  BACKUP_PATH="${TOKEN_PATH}.bak.$(date +%Y%m%d-%H%M%S)"
  log "Backing up existing token: $TOKEN_PATH -> $BACKUP_PATH"
  cp "$TOKEN_PATH" "$BACKUP_PATH"
  rm "$TOKEN_PATH"
else
  log "No existing token at $TOKEN_PATH — skipping backup, proceeding to re-auth."
fi

# ── Step 2: interactive re-auth (opens a browser) ───────────────────────────
log "Starting the OAuth flow — a browser window will open. Sign in and grant access."
(
  cd "$BACKEND_DIR"
  uv run python -c "from services.gmail_service import get_gmail_service; get_gmail_service()"
)

[ -f "$TOKEN_PATH" ] || fail "Expected a new token at $TOKEN_PATH after the OAuth flow, but it's missing."
log "New token written to $TOKEN_PATH"

# ── Step 3: push new Secret Manager version ─────────────────────────────────
log "Pushing new token to Secret Manager secret '$SECRET_NAME' (project $PROJECT_ID)…"
gcloud secrets versions add "$SECRET_NAME" \
  --project="$PROJECT_ID" \
  --data-file="$TOKEN_PATH"

# ── Step 4: force Cloud Run to pick it up ───────────────────────────────────
log "Deploying a new Cloud Run revision so '$SERVICE' reads the secret fresh…"
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-secrets="GMAIL_TOKEN_JSON=${SECRET_NAME}:latest"

# ── Step 5: verify ───────────────────────────────────────────────────────────
log "Verifying against the live backend ($BACKEND_URL)…"
# The backend is private (Cloud Run IAM): authenticate as the operator's own
# gcloud identity, which needs roles/run.invoker on the service.
ID_TOKEN="$(gcloud auth print-identity-token)" || fail "Could not get a gcloud identity token (run: gcloud auth login)."
RESPONSE_FILE="$(mktemp)"
HTTP_CODE="$(curl -s -o "$RESPONSE_FILE" -w '%{http_code}' -X POST "$BACKEND_URL/digest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -d '{"mode":"newsletter","time_range":"today"}' \
  --max-time 120 || true)"
RESPONSE="$(cat "$RESPONSE_FILE")"
rm -f "$RESPONSE_FILE"

if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "$RESPONSE" >&2
  fail "Backend returned HTTP $HTTP_CODE (403 = this gcloud account lacks roles/run.invoker on '$SERVICE')."
fi

if echo "$RESPONSE" | grep -qi 'invalid_grant\|RefreshError'; then
  printf '%s\n' "$RESPONSE" >&2
  fail "The new token still fails against the live backend — see response above."
fi

log "Success — the Cloud Run backend is using the newly refreshed Gmail token."

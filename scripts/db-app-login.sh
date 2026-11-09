#!/usr/bin/env bash
# Enable (or rotate) the password of the app's single database login role,
# app_login (drizzle/migrations/0010_rls_roles.sql creates it NOLOGIN), and
# print or store the connection string the app and backend use.
#
#   scripts/db-app-login.sh <admin-database-url> [--secret <secret-name>] [--project <gcp-project>]
#
# - <admin-database-url>: a postgres (migration) URL. Its host/port/database are
#   reused; the user becomes app_login (on the Supabase pooler: app_login.<project-ref>).
# - --secret: add the URL as a new version of that Secret Manager secret instead of printing it.
# The password is generated here and never written to disk.
set -euo pipefail

ADMIN_URL="${1:?usage: $0 <admin-database-url> [--secret name] [--project id]}"; shift
SECRET=""; PROJECT="${GCP_PROJECT_ID:-gmail-digest-488118}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --secret) SECRET="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

PASSWORD="$(openssl rand -hex 32)"
psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 -q -c "ALTER ROLE app_login LOGIN PASSWORD '${PASSWORD}'"

APP_URL="$(ADMIN_URL="$ADMIN_URL" PASSWORD="$PASSWORD" python3 - <<'EOF'
import os, urllib.parse as u
p = u.urlsplit(os.environ['ADMIN_URL'])
user = p.username or ''
# Supabase pooler users look like "postgres.<project-ref>": keep the suffix.
login = 'app_login' + (user[user.index('.'):] if '.' in user else '')
host = p.hostname + (f':{p.port}' if p.port else '')
print(u.urlunsplit((p.scheme, f'{login}:{os.environ["PASSWORD"]}@{host}', p.path, p.query, '')))
EOF
)"

if [[ -n "$SECRET" ]]; then
  if ! gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=automatic >/dev/null
  fi
  printf '%s' "$APP_URL" | gcloud secrets versions add "$SECRET" --project="$PROJECT" --data-file=- >/dev/null
  echo "app_login password set; new version of secret $SECRET added. The old password stops working for new connections now: redeploy the backend and frontend to pick it up."
else
  echo "$APP_URL"
fi

"""Connected Gmail mailboxes (Phase C, design 15).

Each user may connect their own Gmail (decision D1: the Google account they sign
in with) once the owner has turned Gmail on for them (D2; the owner always may).
The refresh token is envelope-encrypted (services/gmail_credentials.py) in
`gmail_credentials`, which only the backend's worker role can read.

Callers get a Mailbox from require_active(user_id) and a Gmail client from
gmail_service(mailbox). A revoked grant (invalid_grant) flips the mailbox to
'reauth_required': no more calls to Google until the user reconnects.
"""

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass

import httpx

from services import gmail_credentials
from services.db import worker_conn

GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
TOKEN_URI = 'https://oauth2.googleapis.com/token'
REVOKE_URI = 'https://oauth2.googleapis.com/revoke'
# Google lets at most 100 users ever grant a restricted scope to an unverified
# app (design 14 §6.1). Connecting is refused at the guard, keeping a reserve.
CAP_LIMIT = 100
CAP_GUARD = int(os.getenv('GMAIL_CAP_GUARD', '95'))

# Gmail access for a user: active account, and owner or turned on by the owner.
_ALLOWED_SQL = "status = 'active' AND (role = 'owner' OR gmail_enabled)"


class MailboxError(Exception):
    """A Gmail request that can't proceed for this user; `code` is shown to the UI."""

    def __init__(self, code: str, message: str, http_status: int):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


@dataclass(frozen=True)
class Mailbox:
    id: str
    user_id: str
    email: str
    status: str
    sweep_enabled: bool


def _now_ms() -> int:
    return int(time.time() * 1000)


def _mailbox(row) -> Mailbox:
    return Mailbox(row['id'], row['user_id'], row['email'], row['status'], row['sweep_enabled'])


async def _audit(conn, action: str, actor_user_id: str | None, target_user_id: str, metadata: dict) -> None:
    # 'email' in metadata is stripped by purge_deleted_accounts (migration 0011).
    await conn.execute(
        'INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, created_at) '
        'VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
        str(uuid.uuid4()), actor_user_id, action, target_user_id, json.dumps(metadata), _now_ms(),
    )


# ── Connect ──────────────────────────────────────────────────────────────────

async def connect(user_id: str, google_sub: str, email: str, refresh_token: str,
                  scopes: list[str], client_id: str) -> Mailbox:
    """Store a newly granted refresh token for `user_id` (from the signed assertion).
    Called by POST /gmail/mailbox after the app's OAuth callback."""
    if GMAIL_SCOPE not in scopes:
        raise MailboxError('scope_missing', 'Gmail access was not granted. Tick the Gmail box on Google\'s screen.', 400)
    if not (google_sub and email and refresh_token and client_id):
        raise MailboxError('bad_request', 'Incomplete Gmail grant', 400)
    async with worker_conn('gmail') as conn:
        # Serializes connects so two can't both take the last slot under the cap.
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext('gmail_cap_ledger'))")
        if not await conn.fetchval(f'SELECT 1 FROM users WHERE id = $1 AND {_ALLOWED_SQL}', user_id):
            raise MailboxError('not_enabled', 'Gmail is not turned on for your account. Ask the owner.', 403)
        same_account = await conn.fetchval(
            "SELECT 1 FROM user_identities WHERE provider = 'google' AND subject = $1 AND user_id = $2",
            google_sub, user_id,
        )
        if not same_account:  # decision D1
            raise MailboxError('wrong_account', 'Connect the same Google account you sign in with.', 400)
        if not await conn.fetchval('SELECT 1 FROM gmail_cap_ledger WHERE google_sub = $1', google_sub):
            used = await conn.fetchval('SELECT count(*) FROM gmail_cap_ledger')
            if used >= CAP_GUARD:
                raise MailboxError('cap_reached', 'The app has reached its limit of Gmail connections.', 409)
            await conn.execute('INSERT INTO gmail_cap_ledger (google_sub, first_granted_at) VALUES ($1, $2)',
                               google_sub, _now_ms())

        mailbox_id = await conn.fetchval('SELECT id FROM mailboxes WHERE user_id = $1', user_id) or str(uuid.uuid4())
        sealed = await gmail_credentials.seal(mailbox_id, refresh_token)
        now = _now_ms()
        row = await conn.fetchrow(
            'INSERT INTO mailboxes (id, user_id, google_sub, email, status, connected_at) '
            "VALUES ($1, $2, $3, $4, 'active', $5) "
            "ON CONFLICT (user_id) DO UPDATE SET google_sub = EXCLUDED.google_sub, email = EXCLUDED.email, "
            "status = 'active', connected_at = EXCLUDED.connected_at, disconnected_at = NULL, "
            'last_error = NULL, last_error_at = NULL '
            'RETURNING id, user_id, email, status, sweep_enabled',
            mailbox_id, user_id, google_sub, email.lower(), now,
        )
        await conn.execute(
            'INSERT INTO gmail_credentials (mailbox_id, token_ciphertext, token_nonce, data_key_ciphertext, '
            'kms_key_name, scopes, client_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) '
            'ON CONFLICT (mailbox_id) DO UPDATE SET token_ciphertext = EXCLUDED.token_ciphertext, '
            'token_nonce = EXCLUDED.token_nonce, data_key_ciphertext = EXCLUDED.data_key_ciphertext, '
            'kms_key_name = EXCLUDED.kms_key_name, scopes = EXCLUDED.scopes, client_id = EXCLUDED.client_id, '
            'created_at = EXCLUDED.created_at',
            row['id'], sealed.token_ciphertext, sealed.token_nonce, sealed.data_key_ciphertext,
            sealed.kms_key_name, scopes, client_id, now,
        )
        # Before Phase C the only mailbox was the owner's: its rows (no mailbox_id)
        # become the owner's mailbox's when the owner connects (design 15 §10, D5).
        if await conn.fetchval("SELECT role = 'owner' FROM users WHERE id = $1", user_id):
            for table in ('newsletter_emails', 'ingest_jobs', 'gmail_actions'):
                await conn.execute(f'UPDATE {table} SET mailbox_id = $1 WHERE mailbox_id IS NULL', row['id'])
        await _audit(conn, 'gmail_connected', user_id, user_id, {'email': email.lower()})
    print(f'[gmail] mailbox {row["id"]} connected')
    return _mailbox(row)


# ── Lookup ───────────────────────────────────────────────────────────────────

async def require_active(user_id: str) -> Mailbox:
    async with worker_conn('gmail') as conn:
        allowed = await conn.fetchval(f'SELECT 1 FROM users WHERE id = $1 AND {_ALLOWED_SQL}', user_id)
        row = await conn.fetchrow(
            'SELECT id, user_id, email, status, sweep_enabled FROM mailboxes WHERE user_id = $1', user_id,
        )
    if not allowed:
        raise MailboxError('not_enabled', 'Gmail is not turned on for your account. Ask the owner.', 403)
    if row is None or row['status'] == 'disconnected':
        raise MailboxError('not_connected', 'Connect your Gmail first.', 409)
    if row['status'] == 'reauth_required':
        raise MailboxError('reauth_required', 'Gmail access was removed or expired. Reconnect Gmail.', 409)
    return _mailbox(row)


async def sweepable() -> list[Mailbox]:
    """Mailboxes the background job summarizes: connected, not paused, owner allowed."""
    async with worker_conn('gmail') as conn:
        rows = await conn.fetch(
            'SELECT m.id, m.user_id, m.email, m.status, m.sweep_enabled FROM mailboxes m JOIN users u ON u.id = m.user_id '
            "WHERE m.status = 'active' AND m.sweep_enabled AND u.status = 'active' AND (u.role = 'owner' OR u.gmail_enabled) "
            'ORDER BY m.connected_at'
        )
    return [_mailbox(r) for r in rows]


async def cap_usage() -> dict:
    async with worker_conn('gmail') as conn:
        used = await conn.fetchval('SELECT count(*) FROM gmail_cap_ledger')
    return {'used': used, 'limit': CAP_LIMIT, 'guard': CAP_GUARD}


# ── Gmail client ─────────────────────────────────────────────────────────────

def _client_secret(client_id: str) -> str:
    """The web OAuth client's secret (Cloud Run: secret `auth-google-client-secret`)."""
    expected = os.getenv('GOOGLE_OAUTH_CLIENT_ID', '').strip()
    secret = os.getenv('GOOGLE_OAUTH_CLIENT_SECRET', '').strip()
    if not secret or (expected and expected != client_id):
        raise MailboxError('server_config', 'The backend is missing the Google client settings for Gmail.', 500)
    return secret


def is_revoked(exc: Exception) -> bool:
    return 'invalid_grant' in str(exc)


async def _refresh_token(mailbox_id: str) -> tuple[str, str, list[str]]:
    async with worker_conn('gmail') as conn:
        row = await conn.fetchrow('SELECT * FROM gmail_credentials WHERE mailbox_id = $1', mailbox_id)
    if row is None:
        raise MailboxError('not_connected', 'Connect your Gmail first.', 409)
    sealed = gmail_credentials.Sealed(row['token_ciphertext'], row['token_nonce'],
                                      row['data_key_ciphertext'], row['kms_key_name'])
    return await gmail_credentials.open_(mailbox_id, sealed), row['client_id'], list(row['scopes'])


def _build(refresh_token: str, client_id: str, client_secret: str, scopes: list[str]):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(token=None, refresh_token=refresh_token, token_uri=TOKEN_URI,
                        client_id=client_id, client_secret=client_secret, scopes=scopes)
    creds.refresh(Request())  # fails here, not mid-run, when the grant was revoked
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


async def gmail_service(mailbox: Mailbox):
    """An authenticated Gmail client for `mailbox` (its owner's inbox only)."""
    token, client_id, scopes = await _refresh_token(mailbox.id)
    try:
        return await asyncio.to_thread(_build, token, client_id, _client_secret(client_id), scopes)
    except MailboxError:
        raise
    except Exception as e:
        if is_revoked(e):
            await mark_reauth(mailbox.id, 'Google refused the stored access (revoked or expired)')
            raise MailboxError('reauth_required', 'Gmail access was removed or expired. Reconnect Gmail.', 409) from e
        raise


async def mark_reauth(mailbox_id: str, error: str) -> None:
    async with worker_conn('gmail') as conn:
        await conn.execute(
            "UPDATE mailboxes SET status = 'reauth_required', last_error = $2, last_error_at = $3 WHERE id = $1",
            mailbox_id, error, _now_ms(),
        )
    print(f'[gmail] mailbox {mailbox_id} needs reconnecting: {error}')


async def record_sweep(mailbox_id: str, error: str | None) -> None:
    async with worker_conn('gmail') as conn:
        if error:
            await conn.execute('UPDATE mailboxes SET last_error = $2, last_error_at = $3 WHERE id = $1',
                               mailbox_id, error, _now_ms())
        else:
            await conn.execute('UPDATE mailboxes SET last_sweep_at = $2, last_error = NULL, last_error_at = NULL '
                               'WHERE id = $1', mailbox_id, _now_ms())


# ── Disconnect, revoke ───────────────────────────────────────────────────────

async def revoke(refresh_token: str) -> bool:
    """Ask Google to revoke the grant (best effort; the stored copy is deleted regardless)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(REVOKE_URI, data={'token': refresh_token})
        return resp.status_code == 200 or 'invalid_token' in resp.text  # already revoked counts as done
    except Exception as e:
        print(f'[gmail] revoke failed: {type(e).__name__}')
        return False


async def _revoke_mailbox(mailbox_id: str) -> bool:
    try:
        token, _, _ = await _refresh_token(mailbox_id)
    except Exception:
        return False  # nothing stored or undecryptable: nothing to revoke
    return await revoke(token)


async def disconnect(user_id: str, actor_user_id: str) -> bool:
    """Revoke at Google, delete the stored access and the mailbox's email summaries,
    jobs and Gmail action history (decision D4: saved digests are kept). Returns
    False when there was nothing connected."""
    async with worker_conn('gmail') as conn:
        mailbox_id = await conn.fetchval(
            "SELECT id FROM mailboxes WHERE user_id = $1 AND status <> 'disconnected'", user_id,
        )
    if not mailbox_id:
        return False
    revoked = await _revoke_mailbox(mailbox_id)
    async with worker_conn('gmail') as conn:
        await conn.execute('DELETE FROM gmail_credentials WHERE mailbox_id = $1', mailbox_id)
        await conn.execute('DELETE FROM newsletter_emails WHERE mailbox_id = $1', mailbox_id)
        await conn.execute('DELETE FROM ingest_jobs WHERE mailbox_id = $1', mailbox_id)
        await conn.execute('DELETE FROM gmail_actions WHERE mailbox_id = $1', mailbox_id)
        await conn.execute(
            "UPDATE mailboxes SET status = 'disconnected', disconnected_at = $2, last_error = NULL, "
            'last_error_at = NULL WHERE id = $1', mailbox_id, _now_ms(),
        )
        await _audit(conn, 'gmail_disconnected', actor_user_id, user_id, {'revoked_at_google': revoked})
    print(f'[gmail] mailbox {mailbox_id} disconnected (revoked at Google: {revoked})')
    return True


async def revoke_for_users(user_ids: list[str]) -> None:
    """Before an account purge: revoke each mailbox's grant at Google (best effort).
    The purge's ON DELETE CASCADE then removes the mailbox and its credential."""
    if not user_ids:
        return
    async with worker_conn('gmail') as conn:
        ids = await conn.fetch('SELECT m.id FROM mailboxes m JOIN gmail_credentials c ON c.mailbox_id = m.id '
                               'WHERE m.user_id = ANY($1::text[])', user_ids)
    for r in ids:
        await _revoke_mailbox(r['id'])

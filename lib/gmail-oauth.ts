// "Connect Gmail" OAuth flow on the app's web client (design 15 §4, §12).
//
// GET /api/gmail/connect          → Google consent (gmail.modify, offline), separate from sign-in
// GET /api/gmail/oauth/callback   → verify, exchange the code, hand the refresh token to the backend
//
// CSRF / mix-up protection: `state` is HMAC-signed with the session key, expires
// after 10 minutes, names the user who started the flow and carries a nonce that
// must equal the one in a short-lived httpOnly cookie, which also holds the PKCE
// verifier. The refresh token is never stored or logged here.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decodeJwt } from 'jose';
import { getSecret } from '@/lib/gcp-secrets';
import { GMAIL_SCOPE } from '@/lib/mailboxes';

export const OAUTH_COOKIE = 'gmail_oauth';
export const CALLBACK_PATH = '/api/gmail/oauth/callback';
const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const b64url = (b: Buffer) => b.toString('base64url');

function clientId(): string {
  const id = process.env.AUTH_GOOGLE_ID;
  if (!id) throw new Error('AUTH_GOOGLE_ID is not set');
  return id;
}

async function sign(payload: string): Promise<string> {
  return b64url(createHmac('sha256', await getSecret('auth-session-secret')).update(`gmail-oauth:${payload}`).digest());
}

export function redirectUri(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

/** Start: the Google URL to send the user to, and the cookie value to set. */
export async function startConnect(userId: string, email: string, origin: string) {
  const nonce = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(32));
  const payload = b64url(Buffer.from(JSON.stringify({ u: userId, n: nonce, exp: Date.now() + STATE_TTL_MS })));
  const state = `${payload}.${await sign(payload)}`;
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: `openid email ${GMAIL_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent', // always returns a refresh token
    include_granted_scopes: 'true',
    login_hint: email,
    state,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  return { url: `${AUTH_ENDPOINT}?${params}`, cookie: `${nonce}.${verifier}`, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

/** Callback: the PKCE verifier if `state` is genuine, fresh, for `userId` and matches the cookie; else null. */
export async function verifyState(state: string | null, cookie: string | undefined, userId: string): Promise<string | null> {
  if (!state || !cookie) return null;
  const [payload, mac] = state.split('.');
  const [nonce, verifier] = cookie.split('.');
  if (!payload || !mac || !nonce || !verifier) return null;
  const expected = Buffer.from(await sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: { u?: string; n?: string; exp?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.u !== userId || claims.n !== nonce || typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
  return verifier;
}

export interface GmailGrant {
  refreshToken: string;
  scopes: string[];
  googleSub: string;
  email: string;
  clientId: string;
}

export class ConnectError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Exchange the code for tokens and check what Google says was granted, and to whom. */
export async function exchangeCode(code: string, verifier: string, origin: string): Promise<GmailGrant> {
  const id = clientId();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: await getSecret('auth-google-client-secret'),
      redirect_uri: redirectUri(origin),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new ConnectError('exchange_failed', `Google refused the sign-in code (${res.status})`);
  const body = (await res.json()) as { refresh_token?: string; scope?: string; id_token?: string };
  const scopes = (body.scope ?? '').split(' ').filter(Boolean);
  if (!body.refresh_token) throw new ConnectError('no_refresh_token', 'Google did not return offline access');
  // Received directly from Google's token endpoint over TLS, so the claims can be
  // used without a signature check (OpenID Connect Core §3.1.3.7); still check them.
  const claims = body.id_token ? decodeJwt(body.id_token) : null;
  const ok =
    !!claims &&
    GOOGLE_ISSUERS.has(String(claims.iss)) &&
    claims.aud === id &&
    claims.email_verified === true &&
    typeof claims.sub === 'string' &&
    typeof claims.email === 'string' &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > Date.now();
  if (!ok) {
    await revokeGrant(body.refresh_token);
    throw new ConnectError('bad_identity', 'Google did not confirm which account was connected');
  }
  if (!scopes.includes(GMAIL_SCOPE)) {
    await revokeGrant(body.refresh_token);
    throw new ConnectError('scope_missing', 'Gmail access was not granted');
  }
  return {
    refreshToken: body.refresh_token,
    scopes,
    googleSub: claims!.sub as string,
    email: String(claims!.email).toLowerCase(),
    clientId: id,
  };
}

/** Undo a grant that won't be stored (e.g. the backend refused it). Best effort. */
export async function revokeGrant(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // ignore: the grant is unusable without the client secret anyway
  }
}

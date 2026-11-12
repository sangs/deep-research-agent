// "Connect Gmail" OAuth request checks (lib/gmail-oauth.ts, design 15 §12). No database needed.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/gcp-secrets', () => ({ getSecret: async () => 'test-session-secret' }));
process.env.AUTH_GOOGLE_ID = 'web-client.apps.googleusercontent.com';

const ORIGIN = 'http://localhost:3001';

async function start(userId = 'user-a') {
  const { startConnect } = await import('@/lib/gmail-oauth');
  const r = await startConnect(userId, 'a@example.com', ORIGIN);
  return { ...r, state: new URL(r.url).searchParams.get('state')!, params: new URL(r.url).searchParams };
}

describe('Connect Gmail request', () => {
  afterEach(() => vi.useRealTimers());

  it('asks Google for Gmail only, offline, with PKCE, for the signed-in account', async () => {
    const { params } = await start();
    expect(params.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.modify');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('login_hint')).toBe('a@example.com');
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/api/gmail/oauth/callback`);
    expect(params.get('client_id')).toBe('web-client.apps.googleusercontent.com');
  });

  it('accepts its own state with the matching cookie and returns the PKCE verifier', async () => {
    const { verifyState } = await import('@/lib/gmail-oauth');
    const { state, cookie } = await start();
    expect(await verifyState(state, cookie, 'user-a')).toBe(cookie.split('.')[1]);
  });

  it('refuses another user, another browser (cookie), a forged or tampered state, or a missing part', async () => {
    const { verifyState } = await import('@/lib/gmail-oauth');
    const { state, cookie } = await start();
    const other = await start();
    expect(await verifyState(state, cookie, 'user-b')).toBeNull();
    expect(await verifyState(state, other.cookie, 'user-a')).toBeNull();
    const [payload, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'user-a', n: cookie.split('.')[0], exp: Date.now() + 1e9 })).toString('base64url');
    expect(await verifyState(`${forged}.${mac}`, cookie, 'user-a')).toBeNull();
    expect(await verifyState(`${payload}.${mac.slice(0, -2)}xx`, cookie, 'user-a')).toBeNull();
    expect(await verifyState(null, cookie, 'user-a')).toBeNull();
    expect(await verifyState(state, undefined, 'user-a')).toBeNull();
  });

  it('expires after 10 minutes', async () => {
    const { verifyState } = await import('@/lib/gmail-oauth');
    const { state, cookie } = await start();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await verifyState(state, cookie, 'user-a')).toBeNull();
  });
});

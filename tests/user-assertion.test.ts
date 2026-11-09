// The assertion the app signs (lib/user-assertion.ts, jose) is accepted by the
// backend's verifier (backend/services/user_assertion.py, PyJWT), and a tampered
// one is not. Skipped when `uv` isn't installed.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

const BACKEND = path.resolve(__dirname, '..', 'backend');
const hasUv = spawnSync('uv', ['--version']).status === 0;
const suite = hasUv ? describe : describe.skip;

let publicPem = '';

function backendVerify(token: string): { ok: boolean; out: string } {
  const code = `
import json, sys
from services.user_assertion import verify, AssertionError_
try:
    u = verify(sys.argv[1]); print(json.dumps({'id': u.id, 'role': u.role, 'email': u.email}))
except AssertionError_ as e:
    print('REJECTED', e); sys.exit(3)`;
  try {
    const out = execFileSync('uv', ['run', '--quiet', 'python', '-c', code, token], {
      cwd: BACKEND,
      env: { ...process.env, USER_ASSERTION_PUBLIC_KEY: publicPem },
      encoding: 'utf8',
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String((e as { stdout?: string }).stdout ?? e) };
  }
}

suite('user assertion: app → backend', () => {
  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    process.env.USER_ASSERTION_PRIVATE_KEY = await exportPKCS8(privateKey);
    publicPem = await exportSPKI(publicKey);
  });

  it('the backend accepts what the app signs', async () => {
    const { signUserAssertion } = await import('@/lib/user-assertion');
    const token = await signUserAssertion({ id: 'user-x', role: 'member', email: 'x@example.com' });
    const result = backendVerify(token);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.out)).toEqual({ id: 'user-x', role: 'member', email: 'x@example.com' });
  });

  it('the backend rejects a token whose user was changed', async () => {
    const { signUserAssertion } = await import('@/lib/user-assertion');
    const [h, , s] = (await signUserAssertion({ id: 'user-x', role: 'member', email: 'x@example.com' })).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'owner', role: 'owner' })).toString('base64url');
    expect(backendVerify(`${h}.${forged}.${s}`).ok).toBe(false);
  });
});

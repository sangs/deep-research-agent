// Signed user identity for calls from this app to the backend (design 14 §5.3).
//
// The Google ID token (lib/backend-auth.ts) proves the *caller* is this app; this
// assertion says *which user* the call is for. It is a 5-minute EdDSA (Ed25519)
// JWT: sub = user id, plus role and email. The backend verifies it with the
// public key (backend/services/user_assertion.py) and ignores any user id or
// actor in the request body, so a body can never pick whose data is used.
//
// Private key (PKCS#8 PEM): USER_ASSERTION_PRIVATE_KEY when set (tests), else the
// Secret Manager secret `backend-user-assertion-key` (Vercel via WIF, local dev via gcloud).

import { importPKCS8, SignJWT } from 'jose';
import { getSecret } from '@/lib/gcp-secrets';
import type { SessionUser } from '@/lib/user-id';

export const USER_ASSERTION_HEADER = 'X-User-Assertion';
export const USER_ASSERTION_AUDIENCE = 'deep-research-backend';
export const USER_ASSERTION_ISSUER = 'deep-research-web';
const SECRET_NAME = 'backend-user-assertion-key';
const LIFETIME_SECONDS = 300;

let keyPromise: Promise<CryptoKey> | null = null;

function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const pem = process.env.USER_ASSERTION_PRIVATE_KEY;
    keyPromise = (pem ? Promise.resolve(pem) : getSecret(SECRET_NAME)).then((p) => importPKCS8(p, 'EdDSA'));
    keyPromise.catch(() => {
      keyPromise = null;
    });
  }
  return keyPromise;
}

export async function signUserAssertion(user: SessionUser): Promise<string> {
  return new SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(user.id)
    .setIssuer(USER_ASSERTION_ISSUER)
    .setAudience(USER_ASSERTION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${LIFETIME_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(await signingKey());
}

/** Header carrying the signed assertion for `user`. */
export async function userAssertionHeaders(user: SessionUser): Promise<Record<string, string>> {
  return { [USER_ASSERTION_HEADER]: await signUserAssertion(user) };
}

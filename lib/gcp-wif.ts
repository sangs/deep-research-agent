// Keyless Google Cloud credentials for Vercel functions via Workload Identity
// Federation: the deployment's Vercel OIDC token is exchanged at GCP STS for a
// short-lived federated access token (pool trusts https://oidc.vercel.com/<team>),
// which then mints credentials for a specific service account. No Google key is
// stored anywhere. Shared by lib/backend-auth.ts (ID tokens for Cloud Run) and
// lib/gcp-secrets.ts (access tokens for Secret Manager).
// See documents/architecture/security/ for the full design.

import { getVercelOidcToken } from '@vercel/oidc';

const STS_URL = 'https://sts.googleapis.com/v1/token';
const IAM_CREDENTIALS_URL = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts';

/** Full resource name of the workload identity pool provider, or null when
 *  federation isn't configured (local dev). */
export function wifProviderAudience(): string | null {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  if (!projectNumber || !poolId || !providerId) return null;
  return `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
}

/** This deployment's Vercel OIDC token: the incoming request's
 *  x-vercel-oidc-token header when a request is passed, otherwise whatever
 *  @vercel/oidc finds (request context, token file, VERCEL_OIDC_TOKEN). */
export async function vercelOidcToken(req?: Request): Promise<string> {
  return req?.headers.get('x-vercel-oidc-token') ?? (await getVercelOidcToken());
}

export async function federatedAccessToken(subjectToken: string, providerAudience: string): Promise<string> {
  const res = await fetch(STS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: providerAudience,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      subject_token: subjectToken,
    }),
  });
  if (!res.ok) throw new Error(`GCP STS token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Google-signed ID token for `serviceAccountEmail` (needs
 *  roles/iam.serviceAccountOpenIdTokenCreator for the pool principal). */
export async function generateIdToken(federatedToken: string, serviceAccountEmail: string, audience: string): Promise<string> {
  const res = await fetch(`${IAM_CREDENTIALS_URL}/${encodeURIComponent(serviceAccountEmail)}:generateIdToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${federatedToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience, includeEmail: true }),
  });
  if (!res.ok) throw new Error(`generateIdToken failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

/** OAuth access token acting as `serviceAccountEmail` (needs
 *  roles/iam.workloadIdentityUser for the pool principal). */
export async function generateAccessToken(federatedToken: string, serviceAccountEmail: string): Promise<string> {
  const res = await fetch(`${IAM_CREDENTIALS_URL}/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${federatedToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'] }),
  });
  if (!res.ok) throw new Error(`generateAccessToken failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}

export function jwtExpiryMs(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload.exp * 1000;
}

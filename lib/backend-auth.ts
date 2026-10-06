// Keyless authentication from Vercel functions to the private Cloud Run backend.
//
// Chain (Workload Identity Federation — no stored Google key anywhere):
//   1. Vercel OIDC token for this deployment (x-vercel-oidc-token request header
//      on Vercel; VERCEL_OIDC_TOKEN env var locally after `vercel env pull`)
//   2. GCP STS exchanges it for a short-lived federated access token
//      (workload identity pool provider trusts https://oidc.vercel.com/<team>)
//   3. IAM Credentials generateIdToken mints a Google-signed ID token for the
//      invoker service account, audience = BACKEND_URL
//   4. Caller sends `Authorization: Bearer <id token>`; Cloud Run checks
//      roles/run.invoker before the request reaches the container.
//
// When the GCP_* variables are not set (local dev against localhost:8000),
// backendAuthHeaders() returns {} and requests go out unauthenticated, exactly
// as before. See documents/architecture/security/ for the full design.

const STS_URL = 'https://sts.googleapis.com/v1/token';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface WifConfig {
  providerAudience: string;
  serviceAccountEmail: string;
}

function wifConfig(): WifConfig | null {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!projectNumber || !poolId || !providerId || !serviceAccountEmail) return null;
  return {
    providerAudience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    serviceAccountEmail,
  };
}

// ID tokens live 1 hour; reuse across invocations of a warm function instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function jwtExpiryMs(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload.exp * 1000;
}

function vercelOidcToken(req: Request): string {
  const token = req.headers.get('x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN;
  if (!token) {
    throw new Error('No Vercel OIDC token available (x-vercel-oidc-token header / VERCEL_OIDC_TOKEN)');
  }
  return token;
}

async function federatedAccessToken(subjectToken: string, providerAudience: string): Promise<string> {
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

async function generateIdToken(accessToken: string, serviceAccountEmail: string, audience: string): Promise<string> {
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateIdToken`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience, includeEmail: true }),
  });
  if (!res.ok) throw new Error(`generateIdToken failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

/** Authorization header for calls to the Cloud Run backend at `audience`
 *  (its base URL). Returns {} when Workload Identity Federation isn't configured. */
export async function backendAuthHeaders(req: Request, audience: string): Promise<Record<string, string>> {
  const config = wifConfig();
  if (!config) return {};

  const cached = tokenCache.get(audience);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return { Authorization: `Bearer ${cached.token}` };
  }

  const accessToken = await federatedAccessToken(vercelOidcToken(req), config.providerAudience);
  const idToken = await generateIdToken(accessToken, config.serviceAccountEmail, audience);
  tokenCache.set(audience, { token: idToken, expiresAt: jwtExpiryMs(idToken) });
  return { Authorization: `Bearer ${idToken}` };
}

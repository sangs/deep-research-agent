// Keyless authentication from Vercel functions to the private Cloud Run backend.
//
// Chain (Workload Identity Federation, see lib/gcp-wif.ts):
//   Vercel OIDC token → GCP STS federated token → IAM Credentials
//   generateIdToken for the invoker service account (audience = BACKEND_URL)
//   → `Authorization: Bearer <id token>`; Cloud Run checks roles/run.invoker
//   before the request reaches the container.
//
// When the GCP_* variables are not set (local dev against localhost:8010),
// backendAuthHeaders() returns {} and requests go out unauthenticated.

import { wifProviderAudience, vercelOidcToken, federatedAccessToken, generateIdToken, jwtExpiryMs } from './gcp-wif';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ID tokens live 1 hour; reuse across invocations of a warm function instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Authorization header for calls to the Cloud Run backend at `audience`
 *  (its base URL). Returns {} when Workload Identity Federation isn't configured. */
export async function backendAuthHeaders(req: Request, audience: string): Promise<Record<string, string>> {
  const providerAudience = wifProviderAudience();
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!providerAudience || !serviceAccountEmail) return {};

  const cached = tokenCache.get(audience);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return { Authorization: `Bearer ${cached.token}` };
  }

  const federated = await federatedAccessToken(await vercelOidcToken(req), providerAudience);
  const idToken = await generateIdToken(federated, serviceAccountEmail, audience);
  tokenCache.set(audience, { token: idToken, expiresAt: jwtExpiryMs(idToken) });
  return { Authorization: `Bearer ${idToken}` };
}

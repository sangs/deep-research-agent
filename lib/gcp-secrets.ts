// Reads login secrets (Google OAuth client secret, session-signing key) from
// GCP Secret Manager at runtime, so they are never stored in Vercel env vars or
// local files.
//
//   Vercel: Vercel OIDC → WIF federated token → generateAccessToken for
//           GCP_AUTH_READER_SA_EMAIL (secretAccessor on exactly these secrets)
//   Local dev (no WIF config): the developer's own `gcloud auth print-access-token`
//
// Values are cached per server instance; a rotated secret is picked up by new
// instances (or the next deployment).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { wifProviderAudience, vercelOidcToken, federatedAccessToken, generateAccessToken } from './gcp-wif';

const execFileAsync = promisify(execFile);

async function secretReaderAccessToken(): Promise<string> {
  const providerAudience = wifProviderAudience();
  const readerEmail = process.env.GCP_AUTH_READER_SA_EMAIL;
  if (providerAudience && readerEmail) {
    const federated = await federatedAccessToken(await vercelOidcToken(), providerAudience);
    return generateAccessToken(federated, readerEmail);
  }
  if (process.env.NODE_ENV === 'development') {
    const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token']);
    return stdout.trim();
  }
  throw new Error('No Google credentials for Secret Manager (set GCP_* WIF vars or run locally with gcloud)');
}

async function accessSecret(name: string): Promise<string> {
  const project = process.env.GCP_PROJECT_NUMBER;
  if (!project) throw new Error('GCP_PROJECT_NUMBER is not set');
  const res = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${await secretReaderAccessToken()}` } },
  );
  if (!res.ok) throw new Error(`Secret Manager access to ${name} failed: ${res.status} ${await res.text()}`);
  const { payload } = await res.json();
  return Buffer.from(payload.data, 'base64').toString('utf8');
}

const cache = new Map<string, Promise<string>>();

export function getSecret(name: string): Promise<string> {
  let value = cache.get(name);
  if (!value) {
    value = accessSecret(name);
    cache.set(name, value);
    value.catch(() => cache.delete(name)); // retry on the next call instead of caching the failure
  }
  return value;
}

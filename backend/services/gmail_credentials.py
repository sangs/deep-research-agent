"""Envelope encryption of each mailbox's Google refresh token (design 15 §6, design 14 §6.2).

    seal(mailbox_id, token)  → a random 256-bit data key encrypts the token locally
                               (AES-256-GCM, associated data = mailbox id); the data
                               key itself is encrypted by the key-encryption key (KEK).
    open_(mailbox_id, row)   → the reverse; the token exists in memory only.

The associated data binds a ciphertext to its mailbox: copying one row's
credential onto another mailbox makes it undecryptable.

KEK, chosen by GMAIL_KMS_KEY:
  projects/P/locations/L/keyRings/R/cryptoKeys/K   Cloud KMS (production: `gmail-credentials`;
                                                   local development may use `gmail-credentials-dev`).
                                                   Called over REST as the runtime identity
                                                   (backend-run-sa holds cryptoKeyEncrypterDecrypter
                                                   on that one key).
  local                                            GMAIL_LOCAL_KEK (base64, 32 bytes) — local
                                                   development and tests only; refused on Cloud Run.
"""

import asyncio
import base64
import os
from dataclasses import dataclass

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

LOCAL_KEY_NAME = 'local'
KMS_API = 'https://cloudkms.googleapis.com/v1'


class CredentialError(RuntimeError):
    """The token could not be sealed or opened (wrong key, tampered row, KMS unavailable)."""


@dataclass(frozen=True)
class Sealed:
    token_ciphertext: bytes
    token_nonce: bytes
    data_key_ciphertext: bytes
    kms_key_name: str  # KMS: the crypto key *version* that encrypted the data key; else 'local'


def _key_setting() -> str:
    key = os.getenv('GMAIL_KMS_KEY', '').strip()
    if not key:
        raise CredentialError('GMAIL_KMS_KEY is not set (a Cloud KMS key name, or "local" for development)')
    if key == LOCAL_KEY_NAME and (os.getenv('K_SERVICE') or os.getenv('CLOUD_RUN_JOB')):  # set by Cloud Run
        raise CredentialError('The local key is for development only; Cloud Run must use Cloud KMS')
    return key


def _local_kek() -> AESGCM:
    raw = base64.b64decode(os.getenv('GMAIL_LOCAL_KEK', ''))
    if len(raw) != 32:
        raise CredentialError('GMAIL_LOCAL_KEK must be 32 random bytes, base64-encoded')
    return AESGCM(raw)


def _access_token() -> str:
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloudkms'])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


async def _kms(path: str, body: dict) -> dict:
    token = await asyncio.to_thread(_access_token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f'{KMS_API}/{path}', headers={'Authorization': f'Bearer {token}'}, json=body)
    if resp.status_code != 200:
        raise CredentialError(f'Cloud KMS {path.rsplit(":", 1)[-1]} failed: {resp.status_code} {resp.text[:200]}')
    return resp.json()


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


async def _wrap(data_key: bytes, aad: bytes) -> tuple[bytes, str]:
    key = _key_setting()
    if key == LOCAL_KEY_NAME:
        nonce = os.urandom(12)
        return nonce + _local_kek().encrypt(nonce, data_key, aad), LOCAL_KEY_NAME
    out = await _kms(f'{key}:encrypt', {'plaintext': _b64(data_key), 'additionalAuthenticatedData': _b64(aad)})
    return base64.b64decode(out['ciphertext']), out['name']


async def _unwrap(wrapped: bytes, key_name: str, aad: bytes) -> bytes:
    if key_name == LOCAL_KEY_NAME:
        _key_setting()  # refuses on Cloud Run
        try:
            return _local_kek().decrypt(wrapped[:12], wrapped[12:], aad)
        except Exception as e:
            raise CredentialError('Stored Gmail access could not be decrypted with the local key') from e
    # KMS decrypts with the key (it finds the version from the ciphertext).
    crypto_key = key_name.split('/cryptoKeyVersions/')[0]
    out = await _kms(f'{crypto_key}:decrypt', {'ciphertext': _b64(wrapped), 'additionalAuthenticatedData': _b64(aad)})
    return base64.b64decode(out['plaintext'])


async def seal(mailbox_id: str, refresh_token: str) -> Sealed:
    if not mailbox_id or not refresh_token:
        raise CredentialError('seal: missing mailbox id or token')
    aad = mailbox_id.encode()
    data_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext = AESGCM(data_key).encrypt(nonce, refresh_token.encode(), aad)
    wrapped, key_name = await _wrap(data_key, aad)
    return Sealed(ciphertext, nonce, wrapped, key_name)


async def open_(mailbox_id: str, sealed: Sealed) -> str:
    aad = mailbox_id.encode()
    data_key = await _unwrap(bytes(sealed.data_key_ciphertext), sealed.kms_key_name, aad)
    try:
        return AESGCM(data_key).decrypt(bytes(sealed.token_nonce), bytes(sealed.token_ciphertext), aad).decode()
    except Exception as e:
        raise CredentialError('Stored Gmail access failed its integrity check') from e

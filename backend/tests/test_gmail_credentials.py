"""Envelope encryption of Gmail refresh tokens (services/gmail_credentials.py, design 15 §6).

Run locally:  cd backend && uv run python -m unittest discover -s tests -v
"""

import asyncio
import base64
import os
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402

from services import gmail_credentials as gc  # noqa: E402

TOKEN = '1//0g-test-refresh-token'
LOCAL_ENV = {'GMAIL_KMS_KEY': 'local', 'GMAIL_LOCAL_KEK': base64.b64encode(os.urandom(32)).decode()}
KMS_KEY = 'projects/p/locations/us-central1/keyRings/app-secrets/cryptoKeys/gmail-credentials'


def run(coro):
    return asyncio.run(coro)


class LocalKey(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, LOCAL_ENV, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for var in ('K_SERVICE', 'CLOUD_RUN_JOB'):
            os.environ.pop(var, None)

    def test_round_trip(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        self.assertNotIn(TOKEN.encode(), sealed.token_ciphertext)
        self.assertEqual(sealed.kms_key_name, 'local')
        self.assertEqual(run(gc.open_('mb-1', sealed)), TOKEN)

    def test_each_seal_uses_a_fresh_data_key_and_nonce(self):
        a, b = run(gc.seal('mb-1', TOKEN)), run(gc.seal('mb-1', TOKEN))
        self.assertNotEqual(a.token_ciphertext, b.token_ciphertext)
        self.assertNotEqual(a.data_key_ciphertext, b.data_key_ciphertext)

    def test_ciphertext_is_bound_to_its_mailbox(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        with self.assertRaises(gc.CredentialError):
            run(gc.open_('mb-2', sealed))

    def test_tampered_token_is_rejected(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        flipped = bytes([sealed.token_ciphertext[0] ^ 1]) + sealed.token_ciphertext[1:]
        with self.assertRaises(gc.CredentialError):
            run(gc.open_('mb-1', gc.Sealed(flipped, sealed.token_nonce, sealed.data_key_ciphertext, 'local')))

    def test_tampered_data_key_is_rejected(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        dk = sealed.data_key_ciphertext
        flipped = dk[:-1] + bytes([dk[-1] ^ 1])
        with self.assertRaises(gc.CredentialError):
            run(gc.open_('mb-1', gc.Sealed(sealed.token_ciphertext, sealed.token_nonce, flipped, 'local')))

    def test_another_key_cannot_open(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        with mock.patch.dict(os.environ, {'GMAIL_LOCAL_KEK': base64.b64encode(os.urandom(32)).decode()}):
            with self.assertRaises(gc.CredentialError):
                run(gc.open_('mb-1', sealed))

    def test_local_key_refused_on_cloud_run(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        for var in ('K_SERVICE', 'CLOUD_RUN_JOB'):
            with mock.patch.dict(os.environ, {var: 'backend'}):
                with self.assertRaises(gc.CredentialError):
                    run(gc.seal('mb-1', TOKEN))
                with self.assertRaises(gc.CredentialError):
                    run(gc.open_('mb-1', sealed))

    def test_missing_settings(self):
        with mock.patch.dict(os.environ, {'GMAIL_KMS_KEY': ''}):
            with self.assertRaises(gc.CredentialError):
                run(gc.seal('mb-1', TOKEN))
        with mock.patch.dict(os.environ, {'GMAIL_LOCAL_KEK': 'c2hvcnQ='}):
            with self.assertRaises(gc.CredentialError):
                run(gc.seal('mb-1', TOKEN))


class FakeKms:
    """Stands in for Cloud KMS encrypt/decrypt (AES-GCM with associated data, like KMS)."""

    def __init__(self):
        self.key = AESGCM(AESGCM.generate_key(bit_length=256))
        self.calls = []

    async def __call__(self, path: str, body: dict) -> dict:
        self.calls.append((path, body))
        aad = base64.b64decode(body['additionalAuthenticatedData'])
        if path.endswith(':encrypt'):
            nonce = os.urandom(12)
            ct = nonce + self.key.encrypt(nonce, base64.b64decode(body['plaintext']), aad)
            return {'name': f'{KMS_KEY}/cryptoKeyVersions/3', 'ciphertext': base64.b64encode(ct).decode()}
        ct = base64.b64decode(body['ciphertext'])
        try:
            pt = self.key.decrypt(ct[:12], ct[12:], aad)
        except Exception as e:
            raise gc.CredentialError('Cloud KMS decrypt failed: 400') from e
        return {'plaintext': base64.b64encode(pt).decode()}


class CloudKms(unittest.TestCase):
    def setUp(self):
        self.kms = FakeKms()
        for p in (mock.patch.dict(os.environ, {'GMAIL_KMS_KEY': KMS_KEY}), mock.patch.object(gc, '_kms', self.kms)):
            p.start()
            self.addCleanup(p.stop)

    def test_round_trip_records_key_version_and_sends_no_token(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        self.assertEqual(sealed.kms_key_name, f'{KMS_KEY}/cryptoKeyVersions/3')
        self.assertEqual(run(gc.open_('mb-1', sealed)), TOKEN)
        encrypt, decrypt = self.kms.calls
        self.assertEqual(encrypt[0], f'{KMS_KEY}:encrypt')
        self.assertEqual(decrypt[0], f'{KMS_KEY}:decrypt')  # the key, not the version
        for _, body in self.kms.calls:  # KMS only ever sees the data key, never the token
            self.assertNotIn(base64.b64encode(TOKEN.encode()).decode(), str(body))
            self.assertEqual(base64.b64decode(body['additionalAuthenticatedData']), b'mb-1')

    def test_mailbox_binding_holds_through_kms(self):
        sealed = run(gc.seal('mb-1', TOKEN))
        with self.assertRaises(gc.CredentialError):
            run(gc.open_('mb-2', sealed))


if __name__ == '__main__':
    unittest.main()

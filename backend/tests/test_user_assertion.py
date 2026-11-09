"""The backend accepts a user only from a valid signed assertion (design 14 §5.3).
Runs in the image build (Dockerfile) with the Gmail safety tests."""

import os
import sys
import time
import unittest

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services import user_assertion as ua  # noqa: E402


def _keypair():
    private = Ed25519PrivateKey.generate()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private, public_pem


class UserAssertion(unittest.TestCase):
    def setUp(self):
        self.private, public_pem = _keypair()
        self._old = os.environ.get('USER_ASSERTION_PUBLIC_KEY')
        os.environ['USER_ASSERTION_PUBLIC_KEY'] = public_pem

    def tearDown(self):
        if self._old is None:
            os.environ.pop('USER_ASSERTION_PUBLIC_KEY', None)
        else:
            os.environ['USER_ASSERTION_PUBLIC_KEY'] = self._old

    def token(self, key=None, **overrides):
        now = int(time.time())
        claims = {'sub': 'user-a', 'role': 'member', 'email': 'a@example.com', 'iss': ua.ISSUER,
                  'aud': ua.AUDIENCE, 'iat': now, 'exp': now + 300}
        claims.update(overrides)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(claims, key or self.private, algorithm='EdDSA')

    def test_valid_assertion_gives_the_user(self):
        user = ua.verify(self.token())
        self.assertEqual((user.id, user.role, user.email), ('user-a', 'member', 'a@example.com'))
        self.assertFalse(user.is_owner)
        self.assertTrue(ua.verify(self.token(role='owner')).is_owner)

    def test_missing_assertion_is_rejected(self):
        with self.assertRaises(ua.AssertionError_):
            ua.verify(None)
        with self.assertRaises(ua.AssertionError_):
            ua.verify('')

    def test_expired_assertion_is_rejected(self):
        now = int(time.time())
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token(iat=now - 900, exp=now - 600))

    def test_wrong_audience_or_issuer_is_rejected(self):
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token(aud='someone-else'))
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token(iss='someone-else'))

    def test_assertion_signed_by_another_key_is_rejected(self):
        other, _ = _keypair()
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token(key=other))

    def test_tampered_payload_is_rejected(self):
        header, payload, signature = self.token().split('.')
        forged_payload = jwt.utils.base64url_encode(b'{"sub":"user-b","role":"owner"}').decode()
        with self.assertRaises(ua.AssertionError_):
            ua.verify('.'.join([header, forged_payload, signature]))

    def test_unsigned_or_symmetric_tokens_are_rejected(self):
        now = int(time.time())
        claims = {'sub': 'user-a', 'role': 'owner', 'iss': ua.ISSUER, 'aud': ua.AUDIENCE, 'iat': now, 'exp': now + 300}
        with self.assertRaises(ua.AssertionError_):
            ua.verify(jwt.encode(claims, None, algorithm='none'))
        # Algorithm confusion: HMAC "signed" with the public key (built by hand,
        # since PyJWT refuses to create one).
        import hashlib, hmac, json
        b64 = lambda b: jwt.utils.base64url_encode(b).decode()
        signing_input = b64(b'{"alg":"HS256","typ":"JWT"}') + '.' + b64(json.dumps(claims).encode())
        mac = hmac.new(os.environ['USER_ASSERTION_PUBLIC_KEY'].encode(), signing_input.encode(), hashlib.sha256).digest()
        with self.assertRaises(ua.AssertionError_):
            ua.verify(signing_input + '.' + b64(mac))

    def test_unknown_role_or_missing_subject_is_rejected(self):
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token(role='system'))
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token(sub=None))

    def test_no_public_key_configured_fails_closed(self):
        os.environ.pop('USER_ASSERTION_PUBLIC_KEY', None)
        with self.assertRaises(ua.AssertionError_):
            ua.verify(self.token())


if __name__ == '__main__':
    unittest.main()

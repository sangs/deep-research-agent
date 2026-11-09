"""Verify the signed user assertion the web app sends (design 14 §5.3).

Cloud Run's invoker check proves the caller is the web app; this assertion says
which user a request is for. It's a 5-minute EdDSA (Ed25519) JWT signed by the
app (lib/user-assertion.ts) with sub = user id, role, email. The backend holds
only the public key (USER_ASSERTION_PUBLIC_KEY, PEM), so it can check
assertions but never create them. Any user_id / actor in a request body is ignored.
"""

import os
from dataclasses import dataclass

import jwt

HEADER = 'X-User-Assertion'
AUDIENCE = 'deep-research-backend'
ISSUER = 'deep-research-web'
LEEWAY_SECONDS = 30


class AssertionError_(Exception):
    """Missing or invalid user assertion (sent back as 401)."""


@dataclass(frozen=True)
class AssertedUser:
    id: str
    role: str
    email: str

    @property
    def is_owner(self) -> bool:
        return self.role == 'owner'


def _public_key() -> str:
    key = os.getenv('USER_ASSERTION_PUBLIC_KEY', '').strip()
    if not key:
        raise AssertionError_('the backend has no USER_ASSERTION_PUBLIC_KEY configured')
    return key.replace('\\n', '\n')  # allow a one-line env value


def verify(token: str | None) -> AssertedUser:
    if not token:
        raise AssertionError_('missing user assertion')
    try:
        claims = jwt.decode(
            token,
            _public_key(),
            algorithms=['EdDSA'],
            audience=AUDIENCE,
            issuer=ISSUER,
            leeway=LEEWAY_SECONDS,
            options={'require': ['sub', 'exp', 'iat', 'aud', 'iss']},
        )
    except jwt.PyJWTError as e:
        raise AssertionError_(f'invalid user assertion: {type(e).__name__}') from e
    role = claims.get('role')
    if role not in ('owner', 'member'):
        raise AssertionError_('invalid user assertion: role')
    return AssertedUser(id=str(claims['sub']), role=role, email=str(claims.get('email') or 'unknown'))


def from_request(request) -> AssertedUser:
    return verify(request.headers.get(HEADER))

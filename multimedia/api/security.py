"""Reuse the team's HS256/access and hashed-refresh cookie contract, read-only."""

from dataclasses import dataclass, field
from datetime import timedelta
import hashlib
from uuid import UUID

from fastapi import Depends, Security
from fastapi.security import APIKeyCookie
import jwt

from api.dependencies import get_clock, get_repository, get_settings
from api.errors import ApiError
from database.validation import as_utc

ACCESS_COOKIE = "echosight_access"
REFRESH_COOKIE = "echosight_session"
access_cookie = APIKeyCookie(name=ACCESS_COOKIE, scheme_name="ExistingAccessCookie", auto_error=False)
refresh_cookie = APIKeyCookie(name=REFRESH_COOKIE, scheme_name="ExistingRefreshCookie", auto_error=False)


@dataclass(frozen=True)
class Credentials:
    user_id: UUID | None = None
    refresh_hash: str | None = field(default=None, repr=False)


def get_credentials(access=Security(access_cookie), refresh=Security(refresh_cookie), settings=Depends(get_settings)):
    if not access and not refresh:
        raise ApiError(401, "not_authenticated", "Log in through the existing account service first.")
    if access and settings.jwt_secret:
        try:
            claims = jwt.decode(access, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
            if claims.get("typ") == "access":
                return Credentials(user_id=UUID(claims["sub"]))
        except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError):
            pass
    if isinstance(refresh, str) and 1 <= len(refresh) <= 256:
        return Credentials(refresh_hash=hashlib.sha256(refresh.encode("utf-8")).hexdigest())
    if access and not settings.jwt_secret:
        raise ApiError(503, "authentication_unavailable", "Shared authentication configuration is unavailable.")
    raise ApiError(401, "not_authenticated", "The login session is invalid or expired.")


def get_principal(credentials=Depends(get_credentials), repository=Depends(get_repository),
                  settings=Depends(get_settings), clock=Depends(get_clock)):
    user_id = credentials.user_id
    if user_id is None:
        user_id = repository.get_refresh_user(credentials.refresh_hash, now=as_utc(clock()),
                                               max_age=timedelta(days=settings.refresh_max_days))
    if user_id is None or not repository.has_account(user_id):
        raise ApiError(401, "not_authenticated", "The login session is invalid or expired.")
    return user_id


def require_session_access(repository, session_id, user_id):
    if not repository.session_owned_by(session_id, user_id):
        # Hide whether another person's session exists.
        raise ApiError(404, "not_found", "Session or frame not found.")

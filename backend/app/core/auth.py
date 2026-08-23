from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Annotated

from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase_auth.errors import (
    AuthApiError,
    AuthInvalidCredentialsError,
    AuthInvalidJwtError,
    AuthRetryableError,
)

from app.core.errors import ApiError
from app.core.supabase import get_supabase_client

bearer_scheme = HTTPBearer(auto_error=False)

# One page load fires several requests at once. Verifying each against
# Supabase's /auth/v1/user turns that into a burst of identical round trips, so
# coalesce them behind a short process-local cache. Short enough that a revoked
# token stops working promptly.
_AUTH_CACHE_TTL_SECONDS = 60.0
_AUTH_CACHE_MAX_ENTRIES = 1_024
_verified_users: dict[str, tuple[float, "CurrentUser"]] = {}
_verified_users_lock = Lock()


def clear_verified_user_cache() -> None:
    """Clear the process-local verification cache (primarily for tests)."""
    with _verified_users_lock:
        _verified_users.clear()


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    access_token: str


def _unauthenticated(code: str, message: str) -> ApiError:
    return ApiError(
        status_code=status.HTTP_401_UNAUTHORIZED,
        code=code,
        message=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthenticated("not_authenticated", "Not authenticated")

    access_token = credentials.credentials

    # Hold the lock across a miss too, so concurrent requests carrying the same
    # token share one verification instead of racing.
    with _verified_users_lock:
        now = monotonic()
        cached = _verified_users.get(access_token)
        if cached is not None and cached[0] > now:
            return cached[1]

        try:
            response = get_supabase_client().auth.get_user(access_token)
        except RuntimeError as exc:
            raise ApiError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                code="internal_server_error",
                message="Internal server error",
            ) from exc
        except (AuthInvalidCredentialsError, AuthInvalidJwtError) as exc:
            raise _unauthenticated("invalid_token", "Invalid or expired token") from exc
        except AuthRetryableError as exc:
            raise ApiError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="authentication_service_error",
                message="Authentication service error",
            ) from exc
        except AuthApiError as exc:
            if exc.status in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
                raise _unauthenticated("invalid_token", "Invalid or expired token") from exc
            raise ApiError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                code="authentication_service_error",
                message="Authentication service error",
            ) from exc
        except Exception as exc:
            raise ApiError(
                status_code=status.HTTP_502_BAD_GATEWAY,
                code="authentication_service_error",
                message="Authentication service error",
            ) from exc

        user = response.user if response is not None else None
        if user is None:
            raise _unauthenticated("invalid_token", "Invalid or expired token")

        current_user = CurrentUser(
            id=str(user.id),
            email=getattr(user, "email", None),
            access_token=access_token,
        )

        if len(_verified_users) >= _AUTH_CACHE_MAX_ENTRIES:
            for token, (expires_at, _) in list(_verified_users.items()):
                if expires_at <= now:
                    _verified_users.pop(token, None)
            if len(_verified_users) >= _AUTH_CACHE_MAX_ENTRIES:
                _verified_users.pop(next(iter(_verified_users)))

        _verified_users[access_token] = (now + _AUTH_CACHE_TTL_SECONDS, current_user)
        return current_user

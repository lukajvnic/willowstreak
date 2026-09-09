from typing import Any

from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.users.schemas import (
    UserCreateRequest,
    UserData,
    UserStats,
    UserUpdateRequest,
)

POSTGRES_UNIQUE_VIOLATION = "23505"
USERS_TABLE = "users"


def get_user(client: Client, user_id: str) -> UserData | None:
    try:
        response = (
            client.table(USERS_TABLE).select("*").eq("id", user_id).maybe_single().execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_fetch_failed",
            message="Profile could not be loaded",
        ) from exc

    data = getattr(response, "data", None) if response is not None else None
    return UserData.model_validate(data) if data else None


def require_user(client: Client, user_id: str) -> UserData:
    """404 is not an error state — it's how the client knows to show the
    username picker after a first signup."""
    user = get_user(client, user_id)
    if user is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="profile_not_created",
            message="Profile not created",
        )
    return user


def create_user(client: Client, user_id: str, payload: UserCreateRequest) -> UserData:
    if get_user(client, user_id) is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="profile_exists",
            message="Profile already exists",
        )

    row: dict[str, Any] = {"id": user_id, **payload.model_dump()}
    try:
        response = client.table(USERS_TABLE).insert(row).execute()
    except APIError as exc:
        if exc.code == POSTGRES_UNIQUE_VIOLATION:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code="username_taken",
                message="Username already taken",
            ) from exc
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_create_failed",
            message="Profile could not be created",
        ) from exc

    return UserData.model_validate(response.data[0])


def update_user(client: Client, user_id: str, payload: UserUpdateRequest) -> UserData:
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        return require_user(client, user_id)

    try:
        response = (
            client.table(USERS_TABLE).update(patch).eq("id", user_id).execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_update_failed",
            message="Profile could not be updated",
        ) from exc

    if not response.data:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="profile_not_created",
            message="Profile not created",
        )
    return UserData.model_validate(response.data[0])


def username_available(client: Client, username: str) -> bool:
    """RLS hides other people's rows, so this can't be answered by selecting
    from `users` as the caller — it goes through a security-definer RPC that
    returns only a boolean and leaks nothing else."""
    try:
        response = client.rpc("username_available", {"p_username": username}).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="username_check_failed",
            message="Username availability could not be checked",
        ) from exc
    return bool(response.data)


def get_stats(client: Client) -> UserStats:
    """Gaps-and-islands streak maths, which PostgREST can't express. The RPC is
    security invoker, so RLS scopes it to the caller's rows."""
    try:
        response = client.rpc("get_my_stats").execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="stats_failed",
            message="Stats could not be loaded",
        ) from exc

    rows = response.data or []
    if not rows:
        return UserStats(streak=0, best=0, tracked=0)
    return UserStats.model_validate(rows[0])

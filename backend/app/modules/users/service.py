import re
from datetime import date
from typing import Any

from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.users.schemas import (
    PersonHitData,
    PublicGridData,
    PublicHabitData,
    UserCardData,
    UserCreateRequest,
    UserData,
    UserStats,
    UserUpdateRequest,
)

POSTGRES_UNIQUE_VIOLATION = "23505"
USERS_TABLE = "users"
AVATAR_FILE_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,80}")


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

    # avatar_path is rendered to everyone as a public Storage URL. Storage RLS
    # only lets you upload into your own folder; this keeps the pointer there too.
    path = patch.get("avatar_path")
    if path is not None:
        folder, _, filename = path.partition("/")
        if folder != user_id or not AVATAR_FILE_PATTERN.fullmatch(filename):
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="avatar_path_not_yours",
                message="avatar_path must be a file in your own avatars folder",
            )

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


def search_users(client: Client, query: str, limit: int) -> list[PersonHitData]:
    """Name or username via a security-definer RPC — RLS hides every row but
    the caller's, and the function returns only public fields. It also does
    the ranking, since the result is cut to `limit`."""
    try:
        response = client.rpc("search_people", {"p_query": query, "p_limit": limit}).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_search_failed",
            message="Accounts could not be searched",
        ) from exc
    return [PersonHitData.model_validate(row) for row in (response.data or [])]


def get_user_card(client: Client, user_id: str) -> UserCardData:
    try:
        response = client.rpc("get_user_card", {"p_user_id": user_id}).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_card_failed",
            message="Profile card could not be loaded",
        ) from exc

    rows = response.data or []
    if not rows:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message="User not found",
        )
    return UserCardData.model_validate(rows[0])


def get_user_habits(client: Client, user_id: str) -> list[PublicHabitData]:
    """Someone else's unarchived habits, definition only — RLS hides the rows,
    so this is a security-definer RPC like the card. An unknown user is just an
    empty list."""
    try:
        response = client.rpc("get_user_habits", {"p_user_id": user_id}).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_habits_failed",
            message="Habits could not be loaded",
        ) from exc
    return [PublicHabitData.model_validate(row) for row in (response.data or [])]


def get_user_grids(
    client: Client, user_id: str, date_from: date, date_to: date
) -> list[PublicGridData]:
    """The same habits with a window of their entries — what someone's profile
    draws its grids from."""
    try:
        response = client.rpc(
            "get_user_grids",
            {
                "p_user_id": user_id,
                "p_from": date_from.isoformat(),
                "p_to": date_to.isoformat(),
            },
        ).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="user_habits_failed",
            message="Habits could not be loaded",
        ) from exc
    return [PublicGridData.model_validate(row) for row in (response.data or [])]

from typing import Any

from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.habits.schemas import (
    HabitCreateRequest,
    HabitData,
    HabitUpdateRequest,
)
from app.modules.users.schemas import HabitType

HABITS_TABLE = "habits"
POSTGRES_CHECK_VIOLATION = "23514"


def _goal_type_error() -> ApiError:
    return ApiError(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        code="habit_goal_type_mismatch",
        message="A 'count' habit needs a positive goal; a 'completion' habit must not have one",
    )


def list_habits(client: Client, user_id: str) -> list[HabitData]:
    try:
        response = (
            client.table(HABITS_TABLE)
            .select("*")
            # RLS already scopes this; the filter is defence in depth
            .eq("user_id", user_id)
            .is_("archived_at", "null")
            .order("created_at")
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="habits_fetch_failed",
            message="Habits could not be loaded",
        ) from exc

    return [HabitData.model_validate(row) for row in (response.data or [])]


def get_habit(client: Client, user_id: str, habit_id: str) -> HabitData:
    """404 rather than 403 for someone else's habit — no existence leak. RLS
    makes it invisible anyway; this turns that into a clean status code."""
    try:
        response = (
            client.table(HABITS_TABLE)
            .select("*")
            .eq("id", habit_id)
            .eq("user_id", user_id)
            .is_("archived_at", "null")
            .maybe_single()
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="habit_fetch_failed",
            message="Habit could not be loaded",
        ) from exc

    data = getattr(response, "data", None) if response is not None else None
    if not data:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="habit_not_found",
            message="Habit not found",
        )
    return HabitData.model_validate(data)


def create_habit(client: Client, user_id: str, payload: HabitCreateRequest) -> HabitData:
    row: dict[str, Any] = {"user_id": user_id, **payload.model_dump(mode="json")}
    try:
        response = client.table(HABITS_TABLE).insert(row).execute()
    except APIError as exc:
        if exc.code == POSTGRES_CHECK_VIOLATION:
            raise _goal_type_error() from exc
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="habit_create_failed",
            message="Habit could not be created",
        ) from exc

    return HabitData.model_validate(response.data[0])


def update_habit(
    client: Client, user_id: str, habit_id: str, payload: HabitUpdateRequest
) -> HabitData:
    existing = get_habit(client, user_id, habit_id)
    patch = payload.model_dump(mode="json", exclude_unset=True)
    if not patch:
        return existing

    # ck_goal_matches_type spans two columns, so a patch touching one of them
    # has to be judged against the merged row, not the patch alone.
    merged_type = patch.get("type", existing.type)
    merged_goal = patch.get("goal", existing.goal)
    if merged_type == HabitType.COUNT and (merged_goal is None or merged_goal <= 0):
        raise _goal_type_error()
    if merged_type == HabitType.COMPLETION and merged_goal is not None:
        raise _goal_type_error()

    try:
        response = (
            client.table(HABITS_TABLE)
            .update(patch)
            .eq("id", habit_id)
            .eq("user_id", user_id)
            .execute()
        )
    except APIError as exc:
        if exc.code == POSTGRES_CHECK_VIOLATION:
            raise _goal_type_error() from exc
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="habit_update_failed",
            message="Habit could not be updated",
        ) from exc

    if not response.data:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="habit_not_found",
            message="Habit not found",
        )
    return HabitData.model_validate(response.data[0])


def archive_habit(client: Client, user_id: str, habit_id: str) -> None:
    """Soft delete: entries stay, so history doesn't develop holes."""
    get_habit(client, user_id, habit_id)
    try:
        client.table(HABITS_TABLE).update({"archived_at": "now()"}).eq(
            "id", habit_id
        ).eq("user_id", user_id).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="habit_archive_failed",
            message="Habit could not be archived",
        ) from exc

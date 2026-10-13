from typing import Any

from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.reminders.schemas import (
    CategoryCreateRequest,
    CategoryData,
    ReminderCreateRequest,
    ReminderData,
)

REMINDERS_TABLE = "reminders"
CATEGORIES_TABLE = "reminder_categories"
POSTGRES_UNIQUE_VIOLATION = "23505"
POSTGRES_CHECK_VIOLATION = "23514"


def _not_found() -> ApiError:
    return ApiError(
        status_code=status.HTTP_404_NOT_FOUND,
        code="reminder_not_found",
        message="Reminder not found",
    )


def _insert(client: Client, table: str, row: dict[str, Any], what: str) -> dict[str, Any]:
    """Shared by both tables: the client supplies the id, so a replayed create
    is a unique violation rather than a second row."""
    if row.get("id") is None:
        row.pop("id", None)
    try:
        response = client.table(table).insert(row).execute()
    except APIError as exc:
        if exc.code == POSTGRES_UNIQUE_VIOLATION:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code=f"{what}_exists",
                message=f"That {what} already exists",
            ) from exc
        if exc.code == POSTGRES_CHECK_VIOLATION:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code=f"{what}_invalid",
                message=f"That {what} isn't valid",
            ) from exc
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code=f"{what}_create_failed",
            message=f"The {what} could not be saved",
        ) from exc
    return response.data[0]


def list_reminders(client: Client, user_id: str) -> list[ReminderData]:
    try:
        response = (
            client.table(REMINDERS_TABLE)
            .select("*")
            # RLS already scopes this; the filter is defence in depth
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="reminders_fetch_failed",
            message="Reminders could not be loaded",
        ) from exc
    return [ReminderData.model_validate(row) for row in (response.data or [])]


def list_categories(client: Client, user_id: str) -> list[CategoryData]:
    try:
        response = (
            client.table(CATEGORIES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="reminders_fetch_failed",
            message="Reminders could not be loaded",
        ) from exc
    return [CategoryData.model_validate(row) for row in (response.data or [])]


def create_reminder(
    client: Client, user_id: str, payload: ReminderCreateRequest
) -> ReminderData:
    row = {"user_id": user_id, **payload.model_dump(mode="json")}
    return ReminderData.model_validate(_insert(client, REMINDERS_TABLE, row, "reminder"))


def set_reminder_done(
    client: Client, user_id: str, reminder_id: str, done: bool
) -> ReminderData:
    try:
        response = (
            client.table(REMINDERS_TABLE)
            .update({"done": done})
            .eq("id", reminder_id)
            .eq("user_id", user_id)
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="reminder_update_failed",
            message="The reminder could not be updated",
        ) from exc

    # someone else's reminder is invisible under RLS, so it's a 404 like a missing one
    if not response.data:
        raise _not_found()
    return ReminderData.model_validate(response.data[0])


def delete_reminder(client: Client, user_id: str, reminder_id: str) -> None:
    try:
        response = (
            client.table(REMINDERS_TABLE)
            .delete()
            .eq("id", reminder_id)
            .eq("user_id", user_id)
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="reminder_delete_failed",
            message="The reminder could not be deleted",
        ) from exc

    if not response.data:
        raise _not_found()


def create_category(
    client: Client, user_id: str, payload: CategoryCreateRequest
) -> CategoryData:
    row = {"user_id": user_id, **payload.model_dump(mode="json")}
    return CategoryData.model_validate(_insert(client, CATEGORIES_TABLE, row, "category"))

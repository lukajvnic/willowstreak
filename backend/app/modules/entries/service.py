from datetime import date

from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.entries.schemas import EntryData
from app.modules.habits.service import get_habit

ENTRIES_TABLE = "habit_entries"


def list_entries(
    client: Client, user_id: str, habit_id: str, date_from: date, date_to: date
) -> list[EntryData]:
    # 404s if the habit isn't the caller's, so a missing habit and an empty
    # range stay distinguishable
    get_habit(client, user_id, habit_id)

    try:
        response = (
            client.table(ENTRIES_TABLE)
            .select("*")
            .eq("habit_id", habit_id)
            .gte("entry_date", date_from.isoformat())
            .lte("entry_date", date_to.isoformat())
            .order("entry_date")
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="entries_fetch_failed",
            message="Entries could not be loaded",
        ) from exc

    return [EntryData.model_validate(row) for row in (response.data or [])]


def upsert_entry(
    client: Client, user_id: str, habit_id: str, entry_date: date, value: float
) -> EntryData:
    """`entry_date` arrives from the client in ITS local timezone. Never derive
    it here from the server clock, or an entry lands on the wrong square for
    anyone outside UTC.

    uq_entry_habit_date is the conflict target, so this is a single statement
    with no read-modify-write and no lost update between two open tabs.
    """
    get_habit(client, user_id, habit_id)

    row = {
        "habit_id": habit_id,
        "entry_date": entry_date.isoformat(),
        "value": str(value),
        # PostgREST upserts don't fire an ORM-side onupdate, so set it here
        "updated_at": "now()",
    }
    try:
        response = (
            client.table(ENTRIES_TABLE)
            .upsert(row, on_conflict="habit_id,entry_date")
            .execute()
        )
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="entry_write_failed",
            message="Entry could not be saved",
        ) from exc

    if not response.data:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="entry_write_failed",
            message="Entry could not be saved",
        )
    return EntryData.model_validate(response.data[0])


def delete_entry(client: Client, user_id: str, habit_id: str, entry_date: date) -> None:
    """Clears a day. Distinct from writing 0, which records a real zero."""
    get_habit(client, user_id, habit_id)
    try:
        client.table(ENTRIES_TABLE).delete().eq("habit_id", habit_id).eq(
            "entry_date", entry_date.isoformat()
        ).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="entry_delete_failed",
            message="Entry could not be deleted",
        ) from exc

from datetime import date

from supabase import Client

from app.core.auth import CurrentUser
from app.modules.entries.schemas import EntriesListResponse, EntryResponse
from app.modules.entries.service import delete_entry, list_entries, upsert_entry


def list_entries_controller(
    current_user: CurrentUser,
    client: Client,
    habit_id: str,
    date_from: date,
    date_to: date,
) -> EntriesListResponse:
    return EntriesListResponse(
        entries=list_entries(client, current_user.id, habit_id, date_from, date_to)
    )


def upsert_entry_controller(
    current_user: CurrentUser,
    client: Client,
    habit_id: str,
    entry_date: date,
    value: float,
) -> EntryResponse:
    return EntryResponse(
        entry=upsert_entry(client, current_user.id, habit_id, entry_date, value)
    )


def delete_entry_controller(
    current_user: CurrentUser, client: Client, habit_id: str, entry_date: date
) -> None:
    delete_entry(client, current_user.id, habit_id, entry_date)

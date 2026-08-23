from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.modules.entries.controller import (
    delete_entry_controller,
    list_entries_controller,
    upsert_entry_controller,
)
from app.modules.entries.schemas import (
    EntriesListResponse,
    EntryResponse,
    EntryWriteRequest,
)

router = APIRouter()


@router.get("/habits/{habit_id}/entries", response_model=EntriesListResponse)
def list_entries(
    habit_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
    # `from` is a python keyword, hence the alias
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> EntriesListResponse:
    return list_entries_controller(
        current_user=current_user,
        client=client,
        habit_id=str(habit_id),
        date_from=date_from,
        date_to=date_to,
    )


@router.put("/habits/{habit_id}/entries/{entry_date}", response_model=EntryResponse)
def upsert_entry(
    habit_id: UUID,
    entry_date: date,
    payload: EntryWriteRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> EntryResponse:
    return upsert_entry_controller(
        current_user=current_user,
        client=client,
        habit_id=str(habit_id),
        entry_date=entry_date,
        value=float(payload.value),
    )


@router.delete(
    "/habits/{habit_id}/entries/{entry_date}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_entry(
    habit_id: UUID,
    entry_date: date,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> Response:
    delete_entry_controller(
        current_user=current_user,
        client=client,
        habit_id=str(habit_id),
        entry_date=entry_date,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

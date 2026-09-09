from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.core.errors import ApiError
from app.modules.habits.controller import (
    archive_habit_controller,
    create_habit_controller,
    list_habits_controller,
    list_habits_with_entries_controller,
    update_habit_controller,
)
from app.modules.habits.schemas import (
    HabitCreateRequest,
    HabitResponse,
    HabitsListResponse,
    HabitsWithEntriesResponse,
    HabitUpdateRequest,
)

router = APIRouter()


@router.get("/habits", response_model=HabitsWithEntriesResponse | HabitsListResponse)
def list_habits(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
    include: Annotated[Literal["entries"] | None, Query()] = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> HabitsWithEntriesResponse | HabitsListResponse:
    if include == "entries":
        if date_from is None or date_to is None:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="missing_entries_range",
                message="include=entries needs both 'from' and 'to'",
            )
        return list_habits_with_entries_controller(
            current_user=current_user, client=client, date_from=date_from, date_to=date_to
        )
    return list_habits_controller(current_user=current_user, client=client)


@router.post("/habits", response_model=HabitResponse, status_code=status.HTTP_201_CREATED)
def create_habit(
    payload: HabitCreateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> HabitResponse:
    return create_habit_controller(current_user=current_user, client=client, payload=payload)


@router.patch("/habits/{habit_id}", response_model=HabitResponse)
def update_habit(
    habit_id: UUID,
    payload: HabitUpdateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> HabitResponse:
    return update_habit_controller(
        current_user=current_user, client=client, habit_id=str(habit_id), payload=payload
    )


@router.delete("/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_habit(
    habit_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> Response:
    archive_habit_controller(
        current_user=current_user, client=client, habit_id=str(habit_id)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

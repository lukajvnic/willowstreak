from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.modules.habits.controller import (
    archive_habit_controller,
    create_habit_controller,
    list_habits_controller,
    update_habit_controller,
)
from app.modules.habits.schemas import (
    HabitCreateRequest,
    HabitResponse,
    HabitsListResponse,
    HabitUpdateRequest,
)

router = APIRouter()


@router.get("/habits", response_model=HabitsListResponse)
def list_habits(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> HabitsListResponse:
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

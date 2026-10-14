from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.modules.reminders.controller import (
    create_category_controller,
    create_reminder_controller,
    delete_reminder_controller,
    edit_reminder_controller,
    list_reminders_controller,
    update_reminder_controller,
)
from app.modules.reminders.schemas import (
    CategoryCreateRequest,
    CategoryResponse,
    ReminderCreateRequest,
    ReminderEditRequest,
    ReminderResponse,
    RemindersResponse,
    ReminderUpdateRequest,
)

router = APIRouter()


@router.get("/reminders", response_model=RemindersResponse)
def list_reminders(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> RemindersResponse:
    return list_reminders_controller(current_user=current_user, client=client)


@router.post("/reminders", response_model=ReminderResponse, status_code=status.HTTP_201_CREATED)
def create_reminder(
    payload: ReminderCreateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> ReminderResponse:
    return create_reminder_controller(current_user=current_user, client=client, payload=payload)


@router.patch("/reminders/{reminder_id}", response_model=ReminderResponse)
def update_reminder(
    reminder_id: UUID,
    payload: ReminderUpdateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> ReminderResponse:
    return update_reminder_controller(
        current_user=current_user, client=client, reminder_id=str(reminder_id), payload=payload
    )


@router.put("/reminders/{reminder_id}", response_model=ReminderResponse)
def edit_reminder(
    reminder_id: UUID,
    payload: ReminderEditRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> ReminderResponse:
    return edit_reminder_controller(
        current_user=current_user, client=client, reminder_id=str(reminder_id), payload=payload
    )


@router.delete("/reminders/{reminder_id}",status_code=status.HTTP_204_NO_CONTENT)
def delete_reminder(
    reminder_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> Response:
    delete_reminder_controller(
        current_user=current_user, client=client, reminder_id=str(reminder_id)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/reminder-categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED
)
def create_category(
    payload: CategoryCreateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> CategoryResponse:
    return create_category_controller(current_user=current_user, client=client, payload=payload)

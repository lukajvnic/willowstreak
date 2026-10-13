from supabase import Client

from app.core.auth import CurrentUser
from app.modules.reminders.schemas import (
    CategoryCreateRequest,
    CategoryResponse,
    ReminderCreateRequest,
    ReminderResponse,
    RemindersResponse,
    ReminderUpdateRequest,
)
from app.modules.reminders.service import (
    create_category,
    create_reminder,
    delete_reminder,
    list_categories,
    list_reminders,
    set_reminder_done,
)


def list_reminders_controller(current_user: CurrentUser, client: Client) -> RemindersResponse:
    return RemindersResponse(
        reminders=list_reminders(client, current_user.id),
        categories=list_categories(client, current_user.id),
    )


def create_reminder_controller(
    current_user: CurrentUser, client: Client, payload: ReminderCreateRequest
) -> ReminderResponse:
    return ReminderResponse(reminder=create_reminder(client, current_user.id, payload))


def update_reminder_controller(
    current_user: CurrentUser, client: Client, reminder_id: str, payload: ReminderUpdateRequest
) -> ReminderResponse:
    return ReminderResponse(
        reminder=set_reminder_done(client, current_user.id, reminder_id, payload.done)
    )


def delete_reminder_controller(
    current_user: CurrentUser, client: Client, reminder_id: str
) -> None:
    delete_reminder(client, current_user.id, reminder_id)


def create_category_controller(
    current_user: CurrentUser, client: Client, payload: CategoryCreateRequest
) -> CategoryResponse:
    return CategoryResponse(category=create_category(client, current_user.id, payload))

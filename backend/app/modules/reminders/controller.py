from supabase import Client

from app.core.auth import CurrentUser
from app.modules.reminders.schemas import (
    CategoryCreateRequest,
    CategoryEditRequest,
    CategoryResponse,
    ReminderCreateRequest,
    ReminderEditRequest,
    ReminderImportRequest,
    ReminderImportResponse,
    ReminderResponse,
    RemindersResponse,
    ReminderUpdateRequest,
)
from app.modules.reminders.service import (
    create_category,
    delete_category,
    edit_category,
    create_reminder,
    delete_reminder,
    edit_reminder,
    import_reminders,
    list_categories,
    list_reminders,
    set_reminder_done,
    undo_import,
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
        reminder=set_reminder_done(client, current_user.id, reminder_id, payload)
    )


def edit_reminder_controller(
    current_user: CurrentUser, client: Client, reminder_id: str, payload: ReminderEditRequest
) -> ReminderResponse:
    return ReminderResponse(
        reminder=edit_reminder(client, current_user.id, reminder_id, payload)
    )


def delete_reminder_controller(
    current_user: CurrentUser, client: Client, reminder_id: str
) -> None:
    delete_reminder(client, current_user.id, reminder_id)


def import_reminders_controller(
    current_user: CurrentUser, client: Client, payload: ReminderImportRequest
) -> ReminderImportResponse:
    created = import_reminders(client, current_user.id, payload)
    return ReminderImportResponse(
        reminders=created, skipped=len(payload.reminders) - len(created)
    )


def undo_import_controller(current_user: CurrentUser, client: Client, import_id: str) -> None:
    undo_import(client, current_user.id, import_id)


def create_category_controller(
    current_user: CurrentUser, client: Client, payload: CategoryCreateRequest
) -> CategoryResponse:
    return CategoryResponse(category=create_category(client, current_user.id, payload))


def edit_category_controller(
    current_user: CurrentUser, client: Client, category_id: str, payload: CategoryEditRequest
) -> CategoryResponse:
    return CategoryResponse(
        category=edit_category(client, current_user.id, category_id, payload)
    )


def delete_category_controller(current_user: CurrentUser, client: Client, category_id: str) -> None:
    delete_category(client, current_user.id, category_id)

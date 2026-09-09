from datetime import date

from supabase import Client

from app.core.auth import CurrentUser
from app.modules.habits.schemas import (
    HabitCreateRequest,
    HabitResponse,
    HabitsListResponse,
    HabitsWithEntriesResponse,
    HabitUpdateRequest,
)
from app.modules.habits.service import (
    archive_habit,
    create_habit,
    list_habits,
    list_habits_with_entries,
    update_habit,
)


def list_habits_controller(current_user: CurrentUser, client: Client) -> HabitsListResponse:
    return HabitsListResponse(habits=list_habits(client, current_user.id))


def list_habits_with_entries_controller(
    current_user: CurrentUser, client: Client, date_from: date, date_to: date
) -> HabitsWithEntriesResponse:
    return HabitsWithEntriesResponse(
        habits=list_habits_with_entries(client, current_user.id, date_from, date_to)
    )


def create_habit_controller(
    current_user: CurrentUser, client: Client, payload: HabitCreateRequest
) -> HabitResponse:
    return HabitResponse(habit=create_habit(client, current_user.id, payload))


def update_habit_controller(
    current_user: CurrentUser, client: Client, habit_id: str, payload: HabitUpdateRequest
) -> HabitResponse:
    return HabitResponse(habit=update_habit(client, current_user.id, habit_id, payload))


def archive_habit_controller(
    current_user: CurrentUser, client: Client, habit_id: str
) -> None:
    archive_habit(client, current_user.id, habit_id)

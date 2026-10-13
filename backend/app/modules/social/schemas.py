from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from app.modules.users.schemas import HabitType, PublicUserData


class LeaderboardEntry(BaseModel):
    user: PublicUserData
    # a streak in days for a completion board, this week's total for a count one
    value: Decimal


class LeaderboardData(BaseModel):
    habit: str
    type: HabitType
    unit: str = ""
    entries: list[LeaderboardEntry]


class LeaderboardsResponse(BaseModel):
    boards: list[LeaderboardData]


class ActivityData(BaseModel):
    """One logged day from someone else. `id` is the entry's, so a client can
    tell which items it has already shown."""

    id: UUID
    user: PublicUserData
    habit: str
    type: HabitType
    unit: str = ""
    value: Decimal
    entry_date: date
    logged_at: datetime


class ActivityResponse(BaseModel):
    activity: list[ActivityData]

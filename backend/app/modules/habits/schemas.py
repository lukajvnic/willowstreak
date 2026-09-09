from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.modules.entries.schemas import EntryData
from app.modules.users.schemas import HabitType


class HabitData(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    type: HabitType
    goal: int | None = None
    unit: str = ""
    archived_at: datetime | None = None
    created_at: datetime | None = None


class _GoalMatchesType(BaseModel):
    """Mirrors the ck_goal_matches_type constraint so a bad pairing comes back
    as a readable 422 instead of a 5xx bubbling out of Postgres."""

    @model_validator(mode="after")
    def _check_goal(self):
        habit_type = getattr(self, "type", None)
        goal = getattr(self, "goal", None)
        if habit_type == HabitType.COUNT and (goal is None or goal <= 0):
            raise ValueError("a 'count' habit needs a positive goal")
        if habit_type == HabitType.COMPLETION and goal is not None:
            raise ValueError("a 'completion' habit must not have a goal")
        return self


class HabitCreateRequest(_GoalMatchesType):
    name: str = Field(min_length=1, max_length=40)
    type: HabitType = HabitType.COMPLETION
    goal: int | None = Field(default=None, gt=0)
    unit: str = ""


class HabitUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    type: HabitType | None = None
    goal: int | None = Field(default=None, gt=0)
    unit: str | None = None


class HabitResponse(BaseModel):
    habit: HabitData


class HabitsListResponse(BaseModel):
    habits: list[HabitData]


class HabitWithEntriesData(HabitData):
    entries: list[EntryData] = []


class HabitsWithEntriesResponse(BaseModel):
    habits: list[HabitWithEntriesData]

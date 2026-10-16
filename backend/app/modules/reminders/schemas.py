from datetime import date, datetime, time
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class ReminderKind(StrEnum):
    REFILE = "refile"
    BACKLOG = "backlog"
    FLOATER = "floater"
    ANCHOR = "anchor"


class ReminderData(BaseModel):
    id: UUID
    title: str
    kind: ReminderKind
    done: bool = False
    start_date: date | None = None
    end_date: date | None = None
    at_time: time | None = None
    duration_minutes: int | None = None
    alert_minutes: int | None = None
    place: str = ""
    category_id: str | None = None
    created_at: datetime | None = None


class ReminderShape(BaseModel):
    """Everything about a reminder the user writes — shared by create and edit,
    so both get the same per-kind checks."""

    title: str = Field(min_length=1, max_length=200)
    kind: ReminderKind
    start_date: date | None = None
    end_date: date | None = None
    at_time: time | None = None
    # anchors only; null draws as the default one-hour block
    duration_minutes: int | None = Field(default=None, ge=5, le=1440)
    # anchors only — minutes before the start to alert; null is no alert
    alert_minutes: int | None = Field(default=None, ge=0, le=1440)
    place: str = Field(default="", max_length=120)
    category_id: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def _check_dates(self):
        """Mirrors ck_reminder_dates so a bad shape is a readable 422 rather
        than a constraint error out of Postgres."""
        if self.duration_minutes is not None and self.kind != ReminderKind.ANCHOR:
            raise ValueError("only an 'anchor' has a length")
        if self.alert_minutes is not None and self.kind != ReminderKind.ANCHOR:
            raise ValueError("only an 'anchor' has an alert")
        if self.kind in {ReminderKind.REFILE, ReminderKind.BACKLOG}:
            if self.start_date or self.end_date or self.at_time:
                raise ValueError(f"a '{self.kind}' reminder carries no date or time")
        elif self.kind == ReminderKind.FLOATER:
            if self.start_date is None or self.end_date is None:
                raise ValueError("a 'floater' needs both start_date and end_date")
            if self.end_date < self.start_date:
                raise ValueError("a 'floater' can't end before it starts")
            if self.at_time:
                raise ValueError("a 'floater' has a window, not a time")
        else:
            if self.start_date is None:
                raise ValueError("an 'anchor' needs a start_date")
            if self.end_date:
                raise ValueError("an 'anchor' is a single day")
        return self


class ReminderCreateRequest(ReminderShape):
    # the client makes the id, so the row it already drew is the real one
    id: UUID | None = None
    done: bool = False


class ReminderEditRequest(ReminderShape):
    """A full rewrite of what the reminder says. `done` is left alone — that
    has its own PATCH."""


class ReminderUpdateRequest(BaseModel):
    done: bool


class ReminderResponse(BaseModel):
    reminder: ReminderData


class CategoryData(BaseModel):
    id: UUID
    name: str
    icon: str = ""
    created_at: datetime | None = None


class CategoryCreateRequest(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=24)
    icon: str = Field(default="", max_length=16)


class CategoryResponse(BaseModel):
    category: CategoryData


class RemindersResponse(BaseModel):
    """The whole to-do tab in one response: reminders plus the caller's own
    categories (the built-in ones live in the client)."""

    reminders: list[ReminderData]
    categories: list[CategoryData]

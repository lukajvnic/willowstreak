from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

USERNAME_PATTERN = r"^[a-z0-9_]{2,20}$"


class HabitType(StrEnum):
    COMPLETION = "completion"
    COUNT = "count"


class UserData(BaseModel):
    id: UUID
    username: str
    first_name: str
    last_name: str
    bio: str = ""
    avatar: dict | None = None
    avatar_path: str | None = None
    created_at: datetime | None = None


class UserCreateRequest(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    first_name: str = Field(min_length=1, max_length=40)
    last_name: str = Field(default="", max_length=40)
    bio: str = ""


class UserUpdateRequest(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=40)
    last_name: str | None = Field(default=None, max_length=40)
    bio: str | None = None
    avatar_path: str | None = Field(default=None, max_length=255)


class UserResponse(BaseModel):
    user: UserData


class PublicUserData(BaseModel):
    """What search_users() returns — the fields anyone may see."""

    id: UUID
    username: str
    first_name: str
    last_name: str
    avatar: dict | None = None
    avatar_path: str | None = None


class UserSearchResponse(BaseModel):
    users: list[PublicUserData]


class UserCardData(PublicUserData):
    """The full profile card: public fields plus activity numbers. No habit
    names or entries — the card shows that someone is active, not what they do."""

    bio: str = ""
    created_at: datetime | None = None
    streak: int
    best: int
    tracked: int


class UserCardResponse(BaseModel):
    card: UserCardData


class UsernameAvailableResponse(BaseModel):
    available: bool


class UserStats(BaseModel):
    streak: int
    best: int
    tracked: int


class UserStatsResponse(BaseModel):
    stats: UserStats

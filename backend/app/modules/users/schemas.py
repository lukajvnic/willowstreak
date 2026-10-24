from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

USERNAME_PATTERN = r"^[a-z0-9_]{2,20}$"
# an item id from the frontend's avatar kit: "bare", "top_hat", "rick_tee"
AVATAR_ITEM_PATTERN = r"^[a-z0-9_]{1,40}$"


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


class AvatarLook(BaseModel):
    """What users.avatar holds: the drawn figure. The uploaded head photo is
    separate — a Storage object that avatar_path points at."""

    skin: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    head: str = Field(default="bare", pattern=AVATAR_ITEM_PATTERN)
    shirt: str = Field(default="bare", pattern=AVATAR_ITEM_PATTERN)


class UserUpdateRequest(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=40)
    last_name: str | None = Field(default=None, max_length=40)
    bio: str | None = None
    avatar: AvatarLook | None = None
    # null clears the photo; a path must sit in the caller's own folder
    avatar_path: str | None = Field(default=None, max_length=255)


class UserResponse(BaseModel):
    user: UserData


class PublicUserData(BaseModel):
    """The fields anyone may see."""

    id: UUID
    username: str
    first_name: str
    last_name: str
    avatar: dict | None = None
    avatar_path: str | None = None


class Relation(StrEnum):
    FRIENDS = "friends"
    # they asked you
    INCOMING = "incoming"
    # you asked them
    OUTGOING = "outgoing"
    NONE = "none"


class PersonHitData(PublicUserData):
    """search_people(): an account plus where you stand with them, so the
    result can carry the right add / requested / accept / friends action."""

    relation: Relation
    mutual_friends: int


class UserSearchResponse(BaseModel):
    users: list[PersonHitData]


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


class PublicHabitData(BaseModel):
    """What get_user_habits() returns — enough of someone's habit to start the
    same one yourself. No id, no entries."""

    name: str
    type: HabitType
    goal: int | None = None
    unit: str = ""


class UserHabitsResponse(BaseModel):
    habits: list[PublicHabitData]


class PublicEntryData(BaseModel):
    entry_date: date
    value: Decimal


class PublicGridData(PublicHabitData):
    """get_user_grids(): a habit plus a window of its days, for someone's
    profile."""

    entries: list[PublicEntryData] = []


class UserGridsResponse(BaseModel):
    habits: list[PublicGridData]


class UsernameAvailableResponse(BaseModel):
    available: bool


class UserStats(BaseModel):
    streak: int
    best: int
    tracked: int


class UserStatsResponse(BaseModel):
    stats: UserStats

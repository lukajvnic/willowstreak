from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel

from app.modules.users.schemas import PublicUserData


class FriendshipStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"


class FriendshipData(BaseModel):
    """A friendships row, as a send or an accept returns it."""

    requester_id: UUID
    addressee_id: UUID
    status: FriendshipStatus
    created_at: datetime
    accepted_at: datetime | None = None


class FriendshipResponse(BaseModel):
    friendship: FriendshipData


class FriendData(BaseModel):
    user: PublicUserData
    # when the request was accepted, or when it was sent while it's pending
    since: datetime
    # friends you both have
    mutual_friends: int


class FriendsResponse(BaseModel):
    friends: list[FriendData]
    # requests other people sent you, waiting on your accept
    incoming: list[FriendData]
    # requests you sent, waiting on theirs
    outgoing: list[FriendData]


class SuggestionVia(BaseModel):
    """A friend of yours on the path to a suggestion, for its reason line."""

    username: str
    first_name: str
    last_name: str


class SuggestionData(BaseModel):
    user: PublicUserData
    # 2: a friend of a friend, 3: a friend of one of those
    hop: int
    # 0 past hop 2
    mutual_friends: int
    via: SuggestionVia


class SuggestionsResponse(BaseModel):
    suggestions: list[SuggestionData]

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


class FriendsResponse(BaseModel):
    friends: list[FriendData]
    # requests other people sent you, waiting on your accept
    incoming: list[FriendData]
    # requests you sent, waiting on theirs
    outgoing: list[FriendData]

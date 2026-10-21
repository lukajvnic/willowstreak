from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.friends.schemas import (
    FriendData,
    FriendshipData,
    FriendshipStatus,
    FriendsResponse,
)
from app.modules.users.schemas import PublicUserData

FRIENDSHIPS_TABLE = "friendships"
POSTGRES_UNIQUE_VIOLATION = "23505"
POSTGRES_FOREIGN_KEY_VIOLATION = "23503"


def _failed(code: str, message: str) -> ApiError:
    return ApiError(status_code=status.HTTP_502_BAD_GATEWAY, code=code, message=message)


def list_friends(client: Client) -> FriendsResponse:
    """RLS hides the other person's profile, so this is a security-definer RPC
    that returns only the caller's own friendships, newest first."""
    try:
        response = client.rpc("get_friendships").execute()
    except APIError as exc:
        raise _failed("friends_fetch_failed", "Friends could not be loaded") from exc

    result = FriendsResponse(friends=[], incoming=[], outgoing=[])
    for row in response.data or []:
        user = PublicUserData.model_validate({**row, "id": row["user_id"]})
        if row["status"] == FriendshipStatus.ACCEPTED:
            result.friends.append(FriendData(user=user, since=row["accepted_at"]))
        else:
            bucket = result.incoming if row["incoming"] else result.outgoing
            bucket.append(FriendData(user=user, since=row["created_at"]))
    return result


def _accept(client: Client, user_id: str, other_id: str) -> FriendshipData | None:
    """Accepts other_id's pending request to user_id, if there is one."""
    try:
        response = (
            client.table(FRIENDSHIPS_TABLE)
            .update({"status": FriendshipStatus.ACCEPTED.value, "accepted_at": "now()"})
            .eq("requester_id", other_id)
            .eq("addressee_id", user_id)
            .eq("status", FriendshipStatus.PENDING.value)
            .execute()
        )
    except APIError as exc:
        raise _failed("friend_accept_failed", "The request could not be accepted") from exc
    return FriendshipData.model_validate(response.data[0]) if response.data else None


def send_request(client: Client, user_id: str, other_id: str) -> FriendshipData:
    """If they've already asked you, sending one back accepts theirs."""
    if user_id == other_id:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="cannot_friend_yourself",
            message="You can't send yourself a friend request",
        )

    accepted = _accept(client, user_id, other_id)
    if accepted is not None:
        return accepted

    try:
        response = (
            client.table(FRIENDSHIPS_TABLE)
            .insert({"requester_id": user_id, "addressee_id": other_id})
            .execute()
        )
    except APIError as exc:
        # uq_friendship_pair: already friends, or your request is still pending
        if exc.code == POSTGRES_UNIQUE_VIOLATION:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code="friendship_exists",
                message="You're already friends, or a request is pending",
            ) from exc
        if exc.code == POSTGRES_FOREIGN_KEY_VIOLATION:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="user_not_found",
                message="User not found",
            ) from exc
        raise _failed("friend_request_failed", "The request could not be sent") from exc
    return FriendshipData.model_validate(response.data[0])


def accept_request(client: Client, user_id: str, other_id: str) -> FriendshipData:
    accepted = _accept(client, user_id, other_id)
    if accepted is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="request_not_found",
            message="Friend request not found",
        )
    return accepted


def _delete_pair(client: Client, user_id: str, other_id: str, state: FriendshipStatus) -> bool:
    """The row can point either way, so try both. RLS already limits deletes to
    rows the caller is in; the filters are defence in depth."""
    for requester, addressee in ((user_id, other_id), (other_id, user_id)):
        try:
            response = (
                client.table(FRIENDSHIPS_TABLE)
                .delete()
                .eq("requester_id", requester)
                .eq("addressee_id", addressee)
                .eq("status", state.value)
                .execute()
            )
        except APIError as exc:
            raise _failed("friend_delete_failed", "The friendship could not be removed") from exc
        if response.data:
            return True
    return False


def remove_request(client: Client, user_id: str, other_id: str) -> None:
    """Declines their request or cancels yours — whichever is pending."""
    if not _delete_pair(client, user_id, other_id, FriendshipStatus.PENDING):
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="request_not_found",
            message="Friend request not found",
        )


def remove_friend(client: Client, user_id: str, other_id: str) -> None:
    if not _delete_pair(client, user_id, other_id, FriendshipStatus.ACCEPTED):
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="friend_not_found",
            message="Friend not found",
        )

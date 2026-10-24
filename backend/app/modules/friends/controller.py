from supabase import Client

from app.core.auth import CurrentUser
from app.modules.friends.schemas import FriendshipResponse, FriendsResponse, SuggestionsResponse
from app.modules.friends.service import (
    accept_request,
    dismiss_suggestion,
    list_friends,
    list_suggestions,
    remove_friend,
    remove_request,
    send_request,
)


def list_friends_controller(client: Client) -> FriendsResponse:
    return list_friends(client)


def send_request_controller(
    current_user: CurrentUser, client: Client, user_id: str
) -> FriendshipResponse:
    return FriendshipResponse(friendship=send_request(client, current_user.id, user_id))


def accept_request_controller(
    current_user: CurrentUser, client: Client, user_id: str
) -> FriendshipResponse:
    return FriendshipResponse(friendship=accept_request(client, current_user.id, user_id))


def remove_request_controller(current_user: CurrentUser, client: Client, user_id: str) -> None:
    remove_request(client, current_user.id, user_id)


def remove_friend_controller(current_user: CurrentUser, client: Client, user_id: str) -> None:
    remove_friend(client, current_user.id, user_id)


def list_suggestions_controller(client: Client, limit: int) -> SuggestionsResponse:
    return SuggestionsResponse(suggestions=list_suggestions(client, limit))


def dismiss_suggestion_controller(current_user: CurrentUser, client: Client, user_id: str) -> None:
    dismiss_suggestion(client, current_user.id, user_id)

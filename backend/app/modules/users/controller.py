from supabase import Client

from app.core.auth import CurrentUser
from app.modules.users.schemas import (
    UserCardResponse,
    UserCreateRequest,
    UsernameAvailableResponse,
    UserResponse,
    UserSearchResponse,
    UserStatsResponse,
    UserUpdateRequest,
)
from app.modules.users.service import (
    create_user,
    get_stats,
    get_user_card,
    require_user,
    search_users,
    update_user,
    username_available,
)


def read_me_controller(current_user: CurrentUser, client: Client) -> UserResponse:
    return UserResponse(user=require_user(client, current_user.id))


def create_me_controller(
    current_user: CurrentUser, client: Client, payload: UserCreateRequest
) -> UserResponse:
    return UserResponse(user=create_user(client, current_user.id, payload))


def update_me_controller(
    current_user: CurrentUser, client: Client, payload: UserUpdateRequest
) -> UserResponse:
    return UserResponse(user=update_user(client, current_user.id, payload))


def username_available_controller(
    client: Client, username: str
) -> UsernameAvailableResponse:
    return UsernameAvailableResponse(available=username_available(client, username))


def read_stats_controller(client: Client) -> UserStatsResponse:
    return UserStatsResponse(stats=get_stats(client))


def search_users_controller(client: Client, prefix: str) -> UserSearchResponse:
    return UserSearchResponse(users=search_users(client, prefix))


def user_card_controller(client: Client, user_id: str) -> UserCardResponse:
    return UserCardResponse(card=get_user_card(client, user_id))

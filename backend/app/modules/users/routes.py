from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.modules.users.controller import (
    create_me_controller,
    read_me_controller,
    read_stats_controller,
    search_users_controller,
    update_me_controller,
    user_card_controller,
    username_available_controller,
)
from app.modules.users.schemas import (
    UserCardResponse,
    UserCreateRequest,
    UsernameAvailableResponse,
    UserResponse,
    UserSearchResponse,
    UserStatsResponse,
    UserUpdateRequest,
)

router = APIRouter()


@router.get("/me", response_model=UserResponse)
def read_me(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> UserResponse:
    return read_me_controller(current_user=current_user, client=client)


@router.post("/me", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_me(
    payload: UserCreateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> UserResponse:
    return create_me_controller(current_user=current_user, client=client, payload=payload)


@router.patch("/me", response_model=UserResponse)
def update_me(
    payload: UserUpdateRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> UserResponse:
    return update_me_controller(current_user=current_user, client=client, payload=payload)


@router.get("/me/stats", response_model=UserStatsResponse)
def read_stats(
    client: Annotated[Client, Depends(get_current_user_client)],
) -> UserStatsResponse:
    return read_stats_controller(client=client)


@router.get("/usernames/{username}/available", response_model=UsernameAvailableResponse)
def check_username(
    username: str,
    client: Annotated[Client, Depends(get_current_user_client)],
) -> UsernameAvailableResponse:
    return username_available_controller(client=client, username=username)


@router.get("/users", response_model=UserSearchResponse)
def search_accounts(
    client: Annotated[Client, Depends(get_current_user_client)],
    search: Annotated[str, Query(min_length=1, max_length=20, pattern=r"^[a-z0-9_]+$")],
) -> UserSearchResponse:
    return search_users_controller(client=client, prefix=search)


@router.get("/users/{user_id}/card", response_model=UserCardResponse)
def user_card(
    user_id: UUID,
    client: Annotated[Client, Depends(get_current_user_client)],
) -> UserCardResponse:
    return user_card_controller(client=client, user_id=str(user_id))

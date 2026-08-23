from typing import Annotated

from fastapi import APIRouter, Depends, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.modules.users.controller import (
    create_me_controller,
    read_me_controller,
    read_stats_controller,
    update_me_controller,
    username_available_controller,
)
from app.modules.users.schemas import (
    UserCreateRequest,
    UsernameAvailableResponse,
    UserResponse,
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

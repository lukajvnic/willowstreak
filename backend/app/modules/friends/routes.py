from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.dependencies import get_current_user_client
from app.modules.friends.controller import (
    accept_request_controller,
    list_friends_controller,
    remove_friend_controller,
    remove_request_controller,
    send_request_controller,
)
from app.modules.friends.schemas import FriendshipResponse, FriendshipStatus, FriendsResponse

router = APIRouter()


@router.get("/friends", response_model=FriendsResponse)
def list_friends(
    client: Annotated[Client, Depends(get_current_user_client)],
) -> FriendsResponse:
    return list_friends_controller(client=client)


@router.post(
    "/friends/requests/{user_id}",
    response_model=FriendshipResponse,
    status_code=status.HTTP_201_CREATED,
)
def send_request(
    user_id: UUID,
    response: Response,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> FriendshipResponse:
    result = send_request_controller(current_user=current_user, client=client, user_id=str(user_id))
    # they had already asked you, so this accepted theirs instead of creating one
    if result.friendship.status == FriendshipStatus.ACCEPTED:
        response.status_code = status.HTTP_200_OK
    return result


@router.post("/friends/requests/{user_id}/accept", response_model=FriendshipResponse)
def accept_request(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> FriendshipResponse:
    return accept_request_controller(current_user=current_user, client=client, user_id=str(user_id))


@router.delete("/friends/requests/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_request(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> Response:
    remove_request_controller(current_user=current_user, client=client, user_id=str(user_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/friends/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_friend(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    client: Annotated[Client, Depends(get_current_user_client)],
) -> Response:
    remove_friend_controller(current_user=current_user, client=client, user_id=str(user_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

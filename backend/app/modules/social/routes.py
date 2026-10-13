from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from supabase import Client

from app.core.dependencies import get_current_user_client
from app.core.errors import ApiError
from app.modules.social.controller import activity_controller, leaderboards_controller
from app.modules.social.schemas import ActivityResponse, LeaderboardsResponse

router = APIRouter()


@router.get("/leaderboards", response_model=LeaderboardsResponse)
def leaderboards(
    client: Annotated[Client, Depends(get_current_user_client)],
    # both are the CLIENT's local dates — the server never derives a day
    today: Annotated[date, Query()],
    week_start: Annotated[date, Query()],
) -> LeaderboardsResponse:
    if not timedelta(0) <= today - week_start <= timedelta(days=6):
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="week_start_out_of_range",
            message="'week_start' must be the first day of the week containing 'today'",
        )
    return leaderboards_controller(client=client, today=today, week_start=week_start)


@router.get("/activity", response_model=ActivityResponse)
def activity(
    client: Annotated[Client, Depends(get_current_user_client)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> ActivityResponse:
    return activity_controller(client=client, limit=limit)

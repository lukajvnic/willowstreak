from datetime import date
from typing import Any

from fastapi import status
from postgrest import APIError
from supabase import Client

from app.core.errors import ApiError
from app.modules.social.schemas import ActivityData, LeaderboardData, LeaderboardEntry
from app.modules.users.schemas import PublicUserData


def _user(row: dict[str, Any]) -> PublicUserData:
    """Both RPCs return the account flattened into the row."""
    return PublicUserData.model_validate({**row, "id": row["user_id"]})


def get_leaderboards(client: Client, today: date, week_start: date) -> list[LeaderboardData]:
    """One board per habit the caller tracks. The ranking is SQL — streak
    islands and weekly sums across other people's rows — so this only folds the
    flat, already-ordered rows back into boards."""
    try:
        response = client.rpc(
            "get_leaderboards",
            {"p_today": today.isoformat(), "p_week_start": week_start.isoformat()},
        ).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="leaderboards_failed",
            message="Leaderboards could not be loaded",
        ) from exc

    boards: dict[tuple[str, str, str], LeaderboardData] = {}
    for row in response.data or []:
        key = (row["habit"], row["type"], row["unit"])
        board = boards.get(key)
        if board is None:
            board = boards[key] = LeaderboardData(
                habit=row["habit"], type=row["type"], unit=row["unit"], entries=[]
            )
        board.entries.append(LeaderboardEntry(user=_user(row), value=row["value"]))
    return list(boards.values())


def get_activity(client: Client, limit: int) -> list[ActivityData]:
    try:
        response = client.rpc("get_activity", {"p_limit": limit}).execute()
    except APIError as exc:
        raise ApiError(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="activity_failed",
            message="Activity could not be loaded",
        ) from exc

    return [
        ActivityData.model_validate({**row, "user": _user(row)})
        for row in (response.data or [])
    ]

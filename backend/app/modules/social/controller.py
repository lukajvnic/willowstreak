from datetime import date

from supabase import Client

from app.modules.social.schemas import ActivityResponse, LeaderboardsResponse
from app.modules.social.service import get_activity, get_leaderboards


def leaderboards_controller(
    client: Client, today: date, week_start: date
) -> LeaderboardsResponse:
    return LeaderboardsResponse(boards=get_leaderboards(client, today, week_start))


def activity_controller(client: Client, limit: int) -> ActivityResponse:
    return ActivityResponse(activity=get_activity(client, limit))

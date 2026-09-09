from typing import Annotated

from fastapi import Depends
from supabase import Client

from app.core.auth import CurrentUser, get_current_user
from app.core.supabase import get_user_scoped_supabase_client


def get_current_user_client(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> Client:
    return get_user_scoped_supabase_client(current_user.access_token)

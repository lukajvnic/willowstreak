from supabase import Client, create_client

from app.core.config import settings


def get_supabase_client() -> Client:
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise RuntimeError("Supabase is not configured")

    return create_client(settings.supabase_url, settings.supabase_publishable_key)


def get_user_scoped_supabase_client(access_token: str) -> Client:
    """The client every request should use. Passing the caller's token means
    PostgREST evaluates RLS as that user, so the policies in the migration are
    the authorization boundary."""
    client = get_supabase_client()
    client.postgrest.auth(access_token)
    return client


def get_service_role_supabase_client() -> Client:
    """Bypasses RLS. Only for work that legitimately has no caller."""
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase service role is not configured")

    return create_client(settings.supabase_url, settings.supabase_service_role_key)

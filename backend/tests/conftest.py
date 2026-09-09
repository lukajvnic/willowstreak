import os
import uuid

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-anon-key")
os.environ.setdefault("BACKEND_CORS_ORIGINS", "http://localhost:5173")

import pytest
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, clear_verified_user_cache, get_current_user
from app.core.dependencies import get_current_user_client
from app.main import app
from tests.fake_supabase import FakeClient, FakeDB


@pytest.fixture(autouse=True)
def _clear_auth_cache():
    clear_verified_user_cache()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def db() -> FakeDB:
    return FakeDB()


@pytest.fixture
def client(db) -> TestClient:
    """A TestClient signed in as a fixed user, backed by the in-memory store."""
    return _client_for(db, str(uuid.uuid4()))


def _client_for(db: FakeDB, user_id: str) -> TestClient:
    db.current_user_id = user_id
    current = CurrentUser(id=user_id, email=f"{user_id[:8]}@x.com", access_token=f"tok-{user_id}")
    app.dependency_overrides[get_current_user] = lambda: current
    app.dependency_overrides[get_current_user_client] = lambda: FakeClient(db)
    tc = TestClient(app)
    tc.user_id = user_id  # type: ignore[attr-defined]
    return tc


@pytest.fixture
def sign_in(db):
    """Switch the signed-in identity mid-test, sharing one row store."""
    def _sign_in(user_id: str | None = None) -> TestClient:
        return _client_for(db, user_id or str(uuid.uuid4()))
    return _sign_in


@pytest.fixture
def anon_client() -> TestClient:
    """No auth override — exercises the real bearer-token dependency."""
    app.dependency_overrides.clear()
    return TestClient(app)

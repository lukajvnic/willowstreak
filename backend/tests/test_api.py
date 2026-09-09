import datetime as dt

TODAY = dt.date.today()


def register(client, username="luka", first="Luka", last="J"):
    r = client.post(
        "/api/me", json={"username": username, "first_name": first, "last_name": last}
    )
    assert r.status_code == 201, r.text
    return r.json()["user"]


def make_habit(client, name="gym", type_="completion", goal=None, unit=""):
    body = {"name": name, "type": type_, "unit": unit}
    if goal is not None:
        body["goal"] = goal
    r = client.post("/api/habits", json=body)
    assert r.status_code == 201, r.text
    return r.json()["habit"]["id"]


# ----------------------------------------------------------------- auth

def test_health_needs_no_auth(anon_client):
    assert anon_client.get("/api/health").json() == {"status": "ok"}


def test_no_token_is_401(anon_client):
    r = anon_client.get("/api/habits")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "not_authenticated"


def test_non_bearer_scheme_is_401(anon_client):
    r = anon_client.get("/api/habits", headers={"Authorization": "Basic abc123"})
    assert r.status_code == 401


# ----------------------------------------------------------------- users

def test_me_404s_before_profile_exists(client):
    """The 404 is what tells the client to show the username picker."""
    r = client.get("/api/me")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "profile_not_created"


def test_create_and_read_profile(client):
    register(client)
    user = client.get("/api/me").json()["user"]
    assert user["username"] == "luka"
    assert user["first_name"] == "Luka"


def test_creating_a_second_profile_is_409(client):
    register(client)
    r = client.post("/api/me", json={"username": "other", "first_name": "X"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "profile_exists"


def test_duplicate_username_is_409(client, sign_in):
    register(client, "luka")
    other = sign_in()
    r = other.post("/api/me", json={"username": "luka", "first_name": "Impostor"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "username_taken"


def test_invalid_usernames_rejected(client):
    for bad in ["LUKA", "lu ka", "a", "x" * 21, "lu-ka"]:
        r = client.post("/api/me", json={"username": bad, "first_name": "x"})
        assert r.status_code == 422, f"{bad!r} should have been rejected"
        assert r.json()["error"]["code"] == "validation_error"


def test_validation_error_names_the_field(client):
    r = client.post("/api/me", json={"username": "LUKA", "first_name": "x"})
    fields = [f["field"] for f in r.json()["error"]["details"]["fields"]]
    assert "username" in fields


def test_username_availability(client):
    register(client, "luka")
    assert client.get("/api/usernames/luka/available").json() == {"available": False}
    assert client.get("/api/usernames/nobody/available").json() == {"available": True}


def test_patch_me(client):
    register(client)
    r = client.patch("/api/me", json={"bio": "building willo"})
    assert r.status_code == 200
    assert r.json()["user"]["bio"] == "building willo"


# ----------------------------------------------------------------- habits

def test_completion_habit_roundtrip(client):
    register(client)
    hid = make_habit(client, "gym")
    habits = client.get("/api/habits").json()["habits"]
    assert habits[0]["id"] == hid
    assert habits[0]["type"] == "completion" and habits[0]["goal"] is None


def test_count_habit_roundtrip(client):
    register(client)
    make_habit(client, "push-ups", "count", goal=100, unit="reps")
    h = client.get("/api/habits").json()["habits"][0]
    assert h["type"] == "count" and h["goal"] == 100 and h["unit"] == "reps"


def test_count_habit_requires_a_goal(client):
    register(client)
    r = client.post("/api/habits", json={"name": "push-ups", "type": "count"})
    assert r.status_code == 422


def test_completion_habit_rejects_a_goal(client):
    register(client)
    r = client.post("/api/habits", json={"name": "gym", "type": "completion", "goal": 5})
    assert r.status_code == 422


def test_unknown_habit_type_rejected(client):
    register(client)
    r = client.post("/api/habits", json={"name": "x", "type": "boolean"})
    assert r.status_code == 422


def test_patch_cannot_break_goal_type_pairing(client):
    """The constraint spans two columns, so a patch touching one still has to be
    judged against the merged row."""
    register(client)
    hid = make_habit(client, "push-ups", "count", goal=100, unit="reps")
    r = client.patch(f"/api/habits/{hid}", json={"type": "completion"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "habit_goal_type_mismatch"
    # and the row is untouched
    assert client.get("/api/habits").json()["habits"][0]["type"] == "count"


def test_patch_type_and_goal_together_is_allowed(client):
    register(client)
    hid = make_habit(client, "push-ups", "count", goal=100, unit="reps")
    r = client.patch(f"/api/habits/{hid}", json={"type": "completion", "goal": None})
    assert r.status_code == 200
    assert r.json()["habit"]["type"] == "completion"


def test_archive_habit(client):
    register(client)
    hid = make_habit(client)
    assert client.delete(f"/api/habits/{hid}").status_code == 204
    assert client.get("/api/habits").json()["habits"] == []


def test_unknown_habit_is_404(client):
    register(client)
    missing = "00000000-0000-0000-0000-000000000009"
    assert client.patch(f"/api/habits/{missing}", json={"unit": "x"}).status_code == 404
    assert client.delete(f"/api/habits/{missing}").status_code == 404


# ------------------------------------------------------- cross-user isolation
# RLS is the real boundary (see test_rls.py); these cover the explicit
# user_id filtering the services do on top of it.

def test_another_users_habit_is_invisible_and_untouchable(client, sign_in):
    register(client, "luka")
    hid = make_habit(client, "gym")

    other = sign_in()
    register(other, "sam", "Sam")
    today = TODAY.isoformat()

    assert other.get("/api/habits").json()["habits"] == []
    assert other.patch(f"/api/habits/{hid}", json={"unit": "x"}).status_code == 404
    assert other.delete(f"/api/habits/{hid}").status_code == 404
    assert other.get(f"/api/habits/{hid}/entries?from={today}&to={today}").status_code == 404
    assert other.put(f"/api/habits/{hid}/entries/{today}", json={"value": 1}).status_code == 404
    assert other.delete(f"/api/habits/{hid}/entries/{today}").status_code == 404


# ----------------------------------------------------------------- entries

def test_entry_upsert_is_idempotent(client):
    register(client)
    hid = make_habit(client, "push-ups", "count", goal=100, unit="reps")
    today = TODAY.isoformat()

    first = client.put(f"/api/habits/{hid}/entries/{today}", json={"value": 40})
    assert first.status_code == 200
    second = client.put(f"/api/habits/{hid}/entries/{today}", json={"value": 75})

    assert second.json()["entry"]["id"] == first.json()["entry"]["id"]
    entries = client.get(f"/api/habits/{hid}/entries?from={today}&to={today}").json()["entries"]
    assert len(entries) == 1 and float(entries[0]["value"]) == 75.0


def test_upsert_sets_updated_at(client):
    register(client)
    hid = make_habit(client)
    today = TODAY.isoformat()
    r = client.put(f"/api/habits/{hid}/entries/{today}", json={"value": 1})
    assert r.json()["entry"]["updated_at"] is not None


def test_negative_value_rejected(client):
    register(client)
    hid = make_habit(client)
    r = client.put(f"/api/habits/{hid}/entries/{TODAY.isoformat()}", json={"value": -1})
    assert r.status_code == 422


def test_entry_range_query_excludes_outside_days(client):
    register(client)
    hid = make_habit(client)
    for offset in range(5):
        day = (TODAY - dt.timedelta(days=offset)).isoformat()
        client.put(f"/api/habits/{hid}/entries/{day}", json={"value": 1})

    since = (TODAY - dt.timedelta(days=2)).isoformat()
    entries = client.get(
        f"/api/habits/{hid}/entries?from={since}&to={TODAY.isoformat()}"
    ).json()["entries"]
    assert len(entries) == 3


def test_delete_entry_clears_the_day(client):
    register(client)
    hid = make_habit(client)
    today = TODAY.isoformat()
    client.put(f"/api/habits/{hid}/entries/{today}", json={"value": 1})
    assert client.delete(f"/api/habits/{hid}/entries/{today}").status_code == 204
    assert client.get(f"/api/habits/{hid}/entries?from={today}&to={today}").json()["entries"] == []


def test_archiving_keeps_entries(client):
    """Soft delete, so history doesn't develop holes."""
    register(client)
    hid = make_habit(client)
    today = TODAY.isoformat()
    client.put(f"/api/habits/{hid}/entries/{today}", json={"value": 1})
    client.delete(f"/api/habits/{hid}")
    assert client.get(f"/api/habits/{hid}/entries?from={today}&to={today}").status_code == 404


# ----------------------------------------------------------------- stats

def test_streak_breaks_on_a_gap(client):
    register(client)
    hid = make_habit(client, "gym")
    for o in [0, 1, 2, 4, 5, 6, 7, 8]:  # 3 current, gap, then 5 older
        day = (TODAY - dt.timedelta(days=o)).isoformat()
        client.put(f"/api/habits/{hid}/entries/{day}", json={"value": 1})

    stats = client.get("/api/me/stats").json()["stats"]
    assert stats["streak"] == 3
    assert stats["best"] == 5
    assert stats["tracked"] == 1


def test_streak_survives_an_unlogged_today(client):
    """You haven't broken a streak at 9am."""
    register(client)
    hid = make_habit(client)
    for o in [1, 2, 3]:
        day = (TODAY - dt.timedelta(days=o)).isoformat()
        client.put(f"/api/habits/{hid}/entries/{day}", json={"value": 1})
    assert client.get("/api/me/stats").json()["stats"]["streak"] == 3


def test_zero_value_does_not_count_toward_a_streak(client):
    register(client)
    hid = make_habit(client)
    client.put(f"/api/habits/{hid}/entries/{TODAY.isoformat()}", json={"value": 0})
    assert client.get("/api/me/stats").json()["stats"]["streak"] == 0


# ------------------------------------------- habits + entries in one request

def test_include_entries_returns_each_habits_entries(client):
    register(client)
    gym = make_habit(client, "gym")
    push = make_habit(client, "push-ups", "count", goal=100, unit="reps")
    for offset in range(3):
        day = (TODAY - dt.timedelta(days=offset)).isoformat()
        client.put(f"/api/habits/{gym}/entries/{day}", json={"value": 1})

    since = (TODAY - dt.timedelta(days=30)).isoformat()
    r = client.get(f"/api/habits?include=entries&from={since}&to={TODAY.isoformat()}")
    assert r.status_code == 200
    habits = {h["id"]: h for h in r.json()["habits"]}
    assert len(habits[gym]["entries"]) == 3
    assert habits[push]["entries"] == []


def test_include_entries_trims_to_range_and_sorts(client):
    register(client)
    hid = make_habit(client)
    for offset in range(5):  # inserted newest-first, so sorting is exercised
        day = (TODAY - dt.timedelta(days=offset)).isoformat()
        client.put(f"/api/habits/{hid}/entries/{day}", json={"value": 1})

    since = (TODAY - dt.timedelta(days=1)).isoformat()
    habits = client.get(
        f"/api/habits?include=entries&from={since}&to={TODAY.isoformat()}"
    ).json()["habits"]
    dates = [e["entry_date"] for e in habits[0]["entries"]]
    assert len(dates) == 2 and dates == sorted(dates)


def test_include_entries_requires_a_range(client):
    register(client)
    assert client.get("/api/habits?include=entries").status_code == 422


def test_plain_habit_list_carries_no_entries(client):
    register(client)
    make_habit(client)
    assert "entries" not in client.get("/api/habits").json()["habits"][0]

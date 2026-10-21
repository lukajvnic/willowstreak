import datetime as dt

TODAY = dt.date.today()


def register(client, username="luka", first="Luka", last="J"):
    r = client.post(
        "/api/me", json={"username": username, "first_name": first, "last_name": last}
    )
    assert r.status_code == 201, r.text
    return r.json()["user"]


def befriend(db, *user_ids):
    """Accepted friendships straight into the store, for tests about what
    friends can see rather than how they got there."""
    for i, a in enumerate(user_ids):
        for b in user_ids[i + 1:]:
            db.insert("friendships", {
                "requester_id": a, "addressee_id": b,
                "status": "accepted", "accepted_at": "now()",
            })


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


# ----------------------------------------------------------------- account search

def test_search_matches_username_prefix_only(client, sign_in):
    register(client, "luka")
    other = sign_in()
    register(other, "lucia", first="Lucia")
    third = sign_in()
    register(third, "annaluka", first="Anna")  # contains but doesn't start with

    r = third.get("/api/users?search=lu")
    assert r.status_code == 200
    names = [u["username"] for u in r.json()["users"]]
    assert names == ["lucia", "luka"]


def test_search_rejects_bad_characters(client):
    register(client)
    assert client.get("/api/users?search=Lu%20ka").status_code == 422
    assert client.get("/api/users?search=%25").status_code == 422


def test_search_finds_yourself_too(client):
    me = register(client, "solo")
    r = client.get("/api/users?search=solo")
    assert [u["id"] for u in r.json()["users"]] == [me["id"]]


def test_user_card_carries_profile_and_stats(client, sign_in):
    register(client, "runner", first="Ren")
    hid = make_habit(client, "run")
    for offset in range(3):
        day = (TODAY - dt.timedelta(days=offset)).isoformat()
        client.put(f"/api/habits/{hid}/entries/{day}", json={"value": 1})

    viewer = sign_in()
    register(viewer, "viewer")
    target = viewer.get("/api/users?search=runner").json()["users"][0]["id"]
    card = viewer.get(f"/api/users/{target}/card").json()["card"]
    assert card["username"] == "runner" and card["first_name"] == "Ren"
    assert card["streak"] == 3 and card["best"] == 3 and card["tracked"] == 1
    # the card never carries the habits themselves
    assert "habits" not in card and "entries" not in card


def test_user_card_unknown_user_is_404(client):
    register(client)
    import uuid as _uuid

    assert client.get(f"/api/users/{_uuid.uuid4()}/card").status_code == 404


def test_user_habits_lists_definitions_only(client, sign_in, db):
    register(client, "runner", first="Ren")
    gym = make_habit(client, "gym")
    make_habit(client, "reading", "count", goal=30, unit="min")
    gone = make_habit(client, "old one")
    client.delete(f"/api/habits/{gone}")
    client.put(f"/api/habits/{gym}/entries/{TODAY.isoformat()}", json={"value": 1})
    runner_id = client.user_id

    viewer = sign_in()
    register(viewer, "viewer")
    # no peeking: strangers see nothing
    r = viewer.get(f"/api/users/{runner_id}/habits")
    assert r.status_code == 200 and r.json()["habits"] == []

    befriend(db, runner_id, viewer.user_id)
    r = viewer.get(f"/api/users/{runner_id}/habits")
    # archived habits are left out, and nothing but the definition comes back
    assert r.json()["habits"] == [
        {"name": "gym", "type": "completion", "goal": None, "unit": ""},
        {"name": "reading", "type": "count", "goal": 30, "unit": "min"},
    ]


def test_user_habits_unknown_user_is_empty(client):
    register(client)
    import uuid as _uuid

    r = client.get(f"/api/users/{_uuid.uuid4()}/habits")
    assert r.status_code == 200 and r.json()["habits"] == []


# ----------------------------------------------------------------- avatar

def test_avatar_look_round_trips(client):
    register(client)
    look = {"skin": "#4A90E2", "head": "top_hat", "shirt": "rick_tee"}
    r = client.patch("/api/me", json={"avatar": look})
    assert r.status_code == 200 and r.json()["user"]["avatar"] == look
    assert client.get("/api/me").json()["user"]["avatar"] == look


def test_avatar_look_is_validated(client):
    register(client)
    assert client.patch("/api/me", json={"avatar": {"skin": "blue"}}).status_code == 422
    bad_item = {"skin": "#4A90E2", "head": "../../etc"}
    assert client.patch("/api/me", json={"avatar": bad_item}).status_code == 422


def test_avatar_path_must_be_in_your_own_folder(client, sign_in):
    register(client)
    mine = f"{client.user_id}/1760000000.webp"
    assert client.patch("/api/me", json={"avatar_path": mine}).json()["user"]["avatar_path"] == mine

    other = sign_in()
    register(other, "other")
    for path in (mine, f"{other.user_id}/../x.webp", "loose.webp", f"{other.user_id}/"):
        r = other.patch("/api/me", json={"avatar_path": path})
        assert r.status_code == 422, path
        assert r.json()["error"]["code"] == "avatar_path_not_yours"


def test_avatar_path_null_clears_the_photo(client):
    register(client)
    client.patch("/api/me", json={"avatar_path": f"{client.user_id}/a.png"})
    r = client.patch("/api/me", json={"avatar_path": None})
    assert r.status_code == 200 and r.json()["user"]["avatar_path"] is None


def test_search_and_card_carry_the_avatar(client, sign_in):
    register(client, "runner")
    look = {"skin": "#3EAE6B", "head": "cap", "shirt": "bare"}
    client.patch("/api/me", json={"avatar": look, "avatar_path": f"{client.user_id}/me.webp"})
    runner_id = client.user_id

    viewer = sign_in()
    register(viewer, "viewer")
    hit = viewer.get("/api/users?search=runner").json()["users"][0]
    card = viewer.get(f"/api/users/{runner_id}/card").json()["card"]
    for row in (hit, card):
        assert row["avatar"] == look and row["avatar_path"] == f"{runner_id}/me.webp"


# ----------------------------------------------------------------- profile grids

def test_user_grids_carry_entries_inside_the_window(client, sign_in, db):
    register(client, "runner")
    gym = make_habit(client, "gym")
    for offset in (0, 1, 40):
        day = (TODAY - dt.timedelta(days=offset)).isoformat()
        client.put(f"/api/habits/{gym}/entries/{day}", json={"value": 1})
    make_habit(client, "reading", "count", goal=30, unit="min")
    runner_id = client.user_id

    viewer = sign_in()
    register(viewer, "viewer")
    since = (TODAY - dt.timedelta(days=7)).isoformat()
    grids = f"/api/users/{runner_id}/habits?include=entries&from={since}&to={TODAY.isoformat()}"
    assert viewer.get(grids).json()["habits"] == []
    # your own always show
    assert len(sign_in(runner_id).get(grids).json()["habits"]) == 2

    befriend(db, runner_id, viewer.user_id)
    r = sign_in(viewer.user_id).get(grids)
    assert r.status_code == 200
    gym_grid, reading_grid = r.json()["habits"]
    assert gym_grid["name"] == "gym" and "id" not in gym_grid
    assert [e["entry_date"] for e in gym_grid["entries"]] == [
        (TODAY - dt.timedelta(days=1)).isoformat(), TODAY.isoformat(),
    ]
    assert reading_grid["entries"] == []


def test_user_grids_require_a_range(client):
    register(client)
    r = client.get(f"/api/users/{client.user_id}/habits?include=entries")
    assert r.status_code == 422


# ----------------------------------------------------------------- leaderboards

WEEK_START = TODAY - dt.timedelta(days=(TODAY.weekday() + 1) % 7)  # sunday


def boards_for(client):
    r = client.get(
        f"/api/leaderboards?today={TODAY.isoformat()}&week_start={WEEK_START.isoformat()}"
    )
    assert r.status_code == 200, r.text
    return r.json()["boards"]


def log(client, habit_id, days_ago, value=1):
    day = (TODAY - dt.timedelta(days=days_ago)).isoformat()
    assert client.put(f"/api/habits/{habit_id}/entries/{day}", json={"value": value}).status_code == 200


def test_leaderboard_ranks_streaks_across_friends(client, sign_in, db):
    register(client, "luka")
    mine = make_habit(client, "gym")
    for d in range(2):
        log(client, mine, d)

    sam = sign_in()
    register(sam, "sam", first="Sam")
    theirs = make_habit(sam, "Gym ")  # same habit once the name is normalised
    for d in range(1, 5):  # nothing today, but it reaches yesterday — still live
        log(sam, theirs, d)

    idle = sign_in()
    register(idle, "idle", first="Ida")
    make_habit(idle, "gym")
    stale = sign_in()
    register(stale, "stale", first="Stu")
    old = make_habit(stale, "gym")
    for d in range(3, 9):  # a long run that ended days ago is not a current streak
        log(stale, old, d)
    make_habit(stale, "chess")  # a habit luka doesn't track makes no board for luka

    stranger = sign_in()
    register(stranger, "stranger", first="Stan")
    log(stranger, make_habit(stranger, "gym"), 0)  # not a friend, not on the board

    befriend(db, client.user_id, sam.user_id, idle.user_id, stale.user_id)
    luka = sign_in(client.user_id)
    (board,) = boards_for(luka)
    assert (board["habit"], board["type"]) == ("gym", "completion")
    ranked = [(e["user"]["username"], float(e["value"])) for e in board["entries"]]
    assert ranked[:2] == [("sam", 4), ("luka", 2)]
    assert sorted(ranked[2:]) == [("idle", 0), ("stale", 0)]


def test_leaderboard_totals_the_week_for_counted_habits(client, sign_in, db):
    register(client, "luka")
    mine = make_habit(client, "reading", "count", goal=30, unit="min")
    log(client, mine, 0, 25)
    log(client, mine, 7, 500)  # last week — not part of this week's total

    sam = sign_in()
    register(sam, "sam", first="Sam")
    theirs = make_habit(sam, "reading", "count", goal=30, unit="Min")
    log(sam, theirs, 0, 40)

    pages = sign_in()
    register(pages, "pages", first="Pia")
    other_unit = make_habit(pages, "reading", "count", goal=20, unit="pages")
    log(pages, other_unit, 0, 999)  # different unit, different board

    befriend(db, client.user_id, sam.user_id, pages.user_id)
    luka = sign_in(client.user_id)
    (board,) = boards_for(luka)
    assert (board["habit"], board["unit"]) == ("reading", "min")
    assert [(e["user"]["username"], float(e["value"])) for e in board["entries"]] == [
        ("sam", 40), ("luka", 25),
    ]


def test_leaderboard_is_empty_without_habits(client):
    register(client)
    assert boards_for(client) == []


def test_leaderboard_rejects_a_week_start_outside_the_week(client):
    register(client)
    far = (TODAY - dt.timedelta(days=9)).isoformat()
    r = client.get(f"/api/leaderboards?today={TODAY.isoformat()}&week_start={far}")
    assert r.status_code == 422 and r.json()["error"]["code"] == "week_start_out_of_range"
    assert client.get("/api/leaderboards").status_code == 422


# ----------------------------------------------------------------- activity

def test_activity_is_friends_logs_newest_first(client, sign_in, db):
    register(client, "luka")
    log(client, make_habit(client, "gym"), 0)

    sam = sign_in()
    register(sam, "sam", first="Sam")
    reading = make_habit(sam, "reading", "count", goal=30, unit="min")
    log(sam, reading, 1, 45)
    log(sam, reading, 0, 0)  # a recorded zero isn't news
    log(sam, make_habit(sam, "gym"), 0)

    stranger = sign_in()
    register(stranger, "stranger", first="Stan")
    log(stranger, make_habit(stranger, "gym"), 0)  # not a friend, not in the feed

    befriend(db, client.user_id, sam.user_id)
    luka = sign_in(client.user_id)
    feed = luka.get("/api/activity").json()["activity"]
    assert [(a["user"]["username"], a["habit"], float(a["value"])) for a in feed] == [
        ("sam", "gym", 1), ("sam", "reading", 45),
    ]
    assert feed[1]["unit"] == "min" and feed[1]["type"] == "count"
    assert len(luka.get("/api/activity?limit=1").json()["activity"]) == 1
    assert luka.get("/api/activity?limit=0").status_code == 422


# ----------------------------------------------------------------- reminders

def new_reminder(**over):
    import uuid as _uuid

    return {"id": str(_uuid.uuid4()), "title": "haircut", "kind": "refile", **over}


def test_reminder_keeps_the_id_the_client_made(client):
    register(client)
    body = new_reminder(
        kind="anchor", start_date="2026-11-02", at_time="09:30", place="king st",
        category_id="health",
    )
    r = client.post("/api/reminders", json=body)
    assert r.status_code == 201, r.text
    made = r.json()["reminder"]
    assert made["id"] == body["id"] and made["at_time"] == "09:30:00" and made["done"] is False

    listed = client.get("/api/reminders").json()
    assert [x["id"] for x in listed["reminders"]] == [body["id"]]
    assert listed["categories"] == []
    # filing the same one twice is a conflict, not a duplicate row
    assert client.post("/api/reminders", json=body).status_code == 409


def test_reminder_shape_must_match_its_kind(client):
    register(client)
    bad = [
        new_reminder(kind="refile", start_date="2026-11-02"),
        new_reminder(kind="anchor"),
        new_reminder(kind="floater", start_date="2026-11-02"),
        new_reminder(kind="floater", start_date="2026-11-09", end_date="2026-11-02"),
        new_reminder(kind="someday"),
        new_reminder(title=""),
    ]
    for body in bad:
        assert client.post("/api/reminders", json=body).status_code == 422, body
    ok = new_reminder(kind="floater", start_date="2026-11-02", end_date="2026-11-09")
    assert client.post("/api/reminders", json=ok).status_code == 201


def test_reminder_done_and_delete(client):
    register(client)
    rid = client.post("/api/reminders", json=new_reminder()).json()["reminder"]["id"]
    r = client.patch(f"/api/reminders/{rid}", json={"done": True})
    assert r.status_code == 200 and r.json()["reminder"]["done"] is True
    assert client.delete(f"/api/reminders/{rid}").status_code == 204
    assert client.get("/api/reminders").json()["reminders"] == []
    assert client.delete(f"/api/reminders/{rid}").status_code == 404


def test_reminder_edit(client):
    register(client)
    body = new_reminder(kind="anchor", start_date="2026-11-02", at_time="09:30", place="king st")
    rid = client.post("/api/reminders", json=body).json()["reminder"]["id"]
    client.patch(f"/api/reminders/{rid}", json={"done": True})

    # switching kind rewrites the whole shape: the anchor's day, time and place go
    edit = {"title": "trim", "kind": "floater", "start_date": "2026-11-03", "end_date": "2026-11-05"}
    r = client.put(f"/api/reminders/{rid}", json=edit)
    assert r.status_code == 200, r.text
    got = r.json()["reminder"]
    assert got["title"] == "trim" and got["kind"] == "floater"
    assert got["end_date"] == "2026-11-05" and got["at_time"] is None and got["place"] == ""
    # an edit isn't a toggle — done stays where it was
    assert got["done"] is True

    assert client.put(f"/api/reminders/{rid}", json={**edit, "end_date": None}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**edit, "title": ""}).status_code == 422


def test_reminder_duration(client):
    register(client)
    body = new_reminder(kind="anchor", start_date="2026-11-02", at_time="09:30")
    r = client.post("/api/reminders", json={**body, "duration_minutes": 90})
    assert r.status_code == 201, r.text
    assert r.json()["reminder"]["duration_minutes"] == 90

    # stretching it on the calendar is just an edit with a new length
    rid = body["id"]
    stretched = {k: v for k, v in body.items() if k != "id"} | {"duration_minutes": 150}
    r = client.put(f"/api/reminders/{rid}", json=stretched)
    assert r.status_code == 200 and r.json()["reminder"]["duration_minutes"] == 150

    # a length only means something on an anchor, and has to be sane
    floater = new_reminder(kind="floater", start_date="2026-11-02", end_date="2026-11-03")
    assert client.post("/api/reminders", json={**floater, "duration_minutes": 30}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**stretched, "duration_minutes": 0}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**stretched, "duration_minutes": 2000}).status_code == 422


def test_reminder_alert(client):
    register(client)
    body = new_reminder(kind="anchor", start_date="2026-11-02", at_time="09:30")
    r = client.post("/api/reminders", json={**body, "alert_minutes": 15})
    assert r.status_code == 201, r.text
    assert r.json()["reminder"]["alert_minutes"] == 15

    rid = body["id"]
    edit = {k: v for k, v in body.items() if k != "id"}
    # an edit that doesn't mention the alert leaves it alone
    r = client.put(f"/api/reminders/{rid}", json={**edit, "title": "moved"})
    assert r.status_code == 200 and r.json()["reminder"]["alert_minutes"] == 15
    # an explicit null turns it off
    r = client.put(f"/api/reminders/{rid}", json={**edit, "alert_minutes": None})
    assert r.status_code == 200 and r.json()["reminder"]["alert_minutes"] is None

    # at start is allowed; an alert only means something on an anchor, within a day
    assert client.put(f"/api/reminders/{rid}", json={**edit, "alert_minutes": 0}).status_code == 200
    floater = new_reminder(kind="floater", start_date="2026-11-02", end_date="2026-11-03")
    assert client.post("/api/reminders", json={**floater, "alert_minutes": 5}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**edit, "alert_minutes": -1}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**edit, "alert_minutes": 2000}).status_code == 422


def test_reminder_repeat(client):
    register(client)
    body = new_reminder(kind="anchor", start_date="2026-11-02", at_time="09:30")
    r = client.post("/api/reminders", json={**body, "repeat": "weekly", "repeat_until": "2026-12-31"})
    assert r.status_code == 201, r.text
    got = r.json()["reminder"]
    assert got["repeat"] == "weekly" and got["repeat_until"] == "2026-12-31"

    rid = body["id"]
    edit = {k: v for k, v in body.items() if k != "id"}
    # rolling forward to the next occurrence is an edit that doesn't mention the rule
    r = client.put(f"/api/reminders/{rid}", json={**edit, "start_date": "2026-11-09"})
    assert r.status_code == 200 and r.json()["reminder"]["repeat"] == "weekly"
    # an explicit null stops it repeating
    r = client.put(f"/api/reminders/{rid}", json={**edit, "repeat": None, "repeat_until": None})
    assert r.status_code == 200 and r.json()["reminder"]["repeat"] is None

    floater = new_reminder(kind="floater", start_date="2026-11-02", end_date="2026-11-04")
    assert client.post("/api/reminders", json={**floater, "repeat": "monthly"}).status_code == 201
    # a window can't repeat daily, an undated pile can't repeat at all
    assert client.post("/api/reminders", json={**new_reminder(kind="floater", start_date="2026-11-02", end_date="2026-11-04"), "repeat": "daily"}).status_code == 422
    assert client.post("/api/reminders", json={**new_reminder(), "repeat": "weekly"}).status_code == 422
    # an end needs a rule, and can't come before the start
    assert client.put(f"/api/reminders/{rid}", json={**edit, "repeat_until": "2026-12-01"}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**edit, "repeat": "daily", "repeat_until": "2026-10-01"}).status_code == 422
    assert client.put(f"/api/reminders/{rid}", json={**edit, "repeat": "hourly"}).status_code == 422


def test_reminders_are_private(client, sign_in):
    register(client, "luka")
    rid = client.post("/api/reminders", json=new_reminder()).json()["reminder"]["id"]

    other = sign_in()
    register(other, "other")
    assert other.get("/api/reminders").json()["reminders"] == []
    assert other.patch(f"/api/reminders/{rid}", json={"done": True}).status_code == 404
    assert other.put(f"/api/reminders/{rid}", json={"title": "x", "kind": "refile"}).status_code == 404
    assert other.delete(f"/api/reminders/{rid}").status_code == 404


def test_reminder_categories(client, sign_in):
    register(client, "luka")
    import uuid as _uuid

    cid = str(_uuid.uuid4())
    r = client.post("/api/reminder-categories", json={"id": cid, "name": "garden", "icon": "🌱"})
    assert r.status_code == 201 and r.json()["category"] == {
        "id": cid, "name": "garden", "icon": "🌱", "created_at": r.json()["category"]["created_at"],
    }
    assert client.post("/api/reminder-categories", json={"name": ""}).status_code == 422
    assert [c["id"] for c in client.get("/api/reminders").json()["categories"]] == [cid]

    other = sign_in()
    register(other, "other")
    assert other.get("/api/reminders").json()["categories"] == []


# ----------------------------------------------------------------- friends

def names(client, bucket):
    return [f["user"]["username"] for f in client.get("/api/friends").json()[bucket]]


def test_friend_request_then_accept(client, sign_in):
    register(client, "luka")
    sam = sign_in()
    register(sam, "sam", first="Sam")

    luka = sign_in(client.user_id)
    r = luka.post(f"/api/friends/requests/{sam.user_id}")
    assert r.status_code == 201 and r.json()["friendship"]["status"] == "pending"
    assert names(luka, "outgoing") == ["sam"] and names(luka, "friends") == []
    # only the person asked can accept
    assert luka.post(f"/api/friends/requests/{sam.user_id}/accept").status_code == 404

    sam = sign_in(sam.user_id)
    assert names(sam, "incoming") == ["luka"]
    r = sam.post(f"/api/friends/requests/{client.user_id}/accept")
    assert r.status_code == 200 and r.json()["friendship"]["accepted_at"] is not None
    assert names(sam, "friends") == ["luka"] and names(sam, "incoming") == []

    luka = sign_in(client.user_id)
    assert names(luka, "friends") == ["sam"] and names(luka, "outgoing") == []


def test_asking_someone_who_asked_you_accepts(client, sign_in):
    register(client, "luka")
    sam = sign_in()
    register(sam, "sam", first="Sam")
    assert sam.post(f"/api/friends/requests/{client.user_id}").status_code == 201

    luka = sign_in(client.user_id)
    r = luka.post(f"/api/friends/requests/{sam.user_id}")
    assert r.status_code == 200 and r.json()["friendship"]["status"] == "accepted"
    assert names(luka, "friends") == ["sam"]


def test_friend_request_conflicts_and_bad_targets(client, sign_in):
    import uuid as _uuid

    register(client, "luka")
    sam = sign_in()
    register(sam, "sam", first="Sam")

    luka = sign_in(client.user_id)
    assert luka.post(f"/api/friends/requests/{sam.user_id}").status_code == 201
    r = luka.post(f"/api/friends/requests/{sam.user_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "friendship_exists"

    r = luka.post(f"/api/friends/requests/{client.user_id}")
    assert r.status_code == 422 and r.json()["error"]["code"] == "cannot_friend_yourself"
    r = luka.post(f"/api/friends/requests/{_uuid.uuid4()}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "user_not_found"
    assert luka.post("/api/friends/requests/not-a-uuid").status_code == 422


def test_decline_cancel_and_unfriend(client, sign_in):
    register(client, "luka")
    sam = sign_in()
    register(sam, "sam", first="Sam")

    # cancel your own request
    luka = sign_in(client.user_id)
    luka.post(f"/api/friends/requests/{sam.user_id}")
    assert luka.delete(f"/api/friends/requests/{sam.user_id}").status_code == 204
    assert luka.delete(f"/api/friends/requests/{sam.user_id}").status_code == 404

    # decline theirs
    luka.post(f"/api/friends/requests/{sam.user_id}")
    sam = sign_in(sam.user_id)
    assert sam.delete(f"/api/friends/requests/{client.user_id}").status_code == 204
    assert names(sam, "incoming") == []

    # a request isn't a friendship, and a friendship isn't a request
    sam.post(f"/api/friends/requests/{client.user_id}")
    assert sam.delete(f"/api/friends/{client.user_id}").status_code == 404
    luka = sign_in(client.user_id)
    luka.post(f"/api/friends/requests/{sam.user_id}/accept")
    assert luka.delete(f"/api/friends/requests/{sam.user_id}").status_code == 404

    assert luka.delete(f"/api/friends/{sam.user_id}").status_code == 204
    assert names(luka, "friends") == []
    r = luka.delete(f"/api/friends/{sam.user_id}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "friend_not_found"


def test_unfriending_takes_them_off_your_board_and_feed(client, sign_in):
    register(client, "luka")
    log(client, make_habit(client, "gym"), 0)
    sam = sign_in()
    register(sam, "sam", first="Sam")
    log(sam, make_habit(sam, "gym"), 0)
    sam.post(f"/api/friends/requests/{client.user_id}")

    luka = sign_in(client.user_id)
    # a pending request isn't a friendship yet
    assert [e["user"]["username"] for e in boards_for(luka)[0]["entries"]] == ["luka"]
    luka.post(f"/api/friends/requests/{sam.user_id}/accept")
    assert sorted(e["user"]["username"] for e in boards_for(luka)[0]["entries"]) == ["luka", "sam"]
    assert len(luka.get("/api/activity").json()["activity"]) == 1

    luka.delete(f"/api/friends/{sam.user_id}")
    assert [e["user"]["username"] for e in boards_for(luka)[0]["entries"]] == ["luka"]
    assert luka.get("/api/activity").json()["activity"] == []

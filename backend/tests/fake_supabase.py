"""A small in-memory stand-in for the Supabase client.

Only the query-builder surface the services actually use. It stores real rows
and applies real filters, so tests exercise service logic rather than asserting
on mock call arguments.

It deliberately does NOT model RLS — that boundary lives in SQL and is covered
by tests/test_rls.py against a real Postgres.
"""

from __future__ import annotations

import itertools
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from postgrest import APIError

EMBED_FK = {"habit_entries": "habit_id"}

UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"
FOREIGN_KEY_VIOLATION = "23503"


class _Response:
    def __init__(self, data: Any) -> None:
        self.data = data


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _resolve(value: Any) -> Any:
    return _now() if value == "now()" else value


class _Query:
    def __init__(self, db: FakeDB, table: str) -> None:
        self._db = db
        self._table = table
        self._filters: list[tuple[str, str, Any]] = []
        self._op = "select"
        self._payload: Any = None
        self._on_conflict: list[str] = []
        self._single = False
        self._order: str | None = None
        self._embed: str | None = None

    # ---- filters
    def eq(self, column: str, value: Any) -> _Query:
        self._filters.append(("eq", column, value))
        return self

    def gte(self, column: str, value: Any) -> _Query:
        self._filters.append(("gte", column, value))
        return self

    def lte(self, column: str, value: Any) -> _Query:
        self._filters.append(("lte", column, value))
        return self

    def is_(self, column: str, value: Any) -> _Query:
        self._filters.append(("is", column, value))
        return self

    # ---- verbs
    def select(self, *columns: str) -> _Query:
        self._op = "select"
        for col in columns:
            m = re.search(r"(\w+)\(\*\)", col)
            if m:
                self._embed = m.group(1)
        return self

    def insert(self, payload: dict) -> _Query:
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload: dict) -> _Query:
        self._op, self._payload = "update", payload
        return self

    def upsert(self, payload: dict, on_conflict: str = "") -> _Query:
        self._op, self._payload = "upsert", payload
        self._on_conflict = [c.strip() for c in on_conflict.split(",") if c.strip()]
        return self

    def delete(self) -> _Query:
        self._op = "delete"
        return self

    # ---- modifiers
    def maybe_single(self) -> _Query:
        self._single = True
        return self

    def order(self, column: str) -> _Query:
        self._order = column
        return self

    # ---- execution
    def _matches(self, row: dict) -> bool:
        for kind, column, value in self._filters:
            if "." in column:  # dotted filters apply to the embedded rows
                continue
            actual = row.get(column)
            if kind == "eq" and str(actual) != str(value):
                return False
            if kind == "is" and value == "null" and actual is not None:
                return False
            if kind in {"gte", "lte"} and actual is None:
                return False
            if kind == "gte" and str(actual) < str(value):
                return False
            if kind == "lte" and str(actual) > str(value):
                return False
        return True

    def execute(self) -> _Response:
        rows = self._db.tables.setdefault(self._table, [])

        if self._op == "select":
            hits = [r for r in rows if self._matches(r)]
            if self._order:
                hits.sort(key=lambda r: str(r.get(self._order) or ""))
            if self._embed:
                hits = [self._with_embed(r) for r in hits]
            if self._single:
                return _Response(hits[0] if hits else None)
            return _Response(hits)

        if self._op == "insert":
            row = self._db.insert(self._table, dict(self._payload))
            return _Response([row])

        if self._op == "upsert":
            payload = {k: _resolve(v) for k, v in self._payload.items()}
            for row in rows:
                if all(str(row.get(c)) == str(payload.get(c)) for c in self._on_conflict):
                    row.update(payload)
                    return _Response([row])
            return _Response([self._db.insert(self._table, payload)])

        if self._op == "update":
            hits = [r for r in rows if self._matches(r)]
            for row in hits:
                row.update({k: _resolve(v) for k, v in self._payload.items()})
            self._db.check_constraints(self._table, hits)
            return _Response(hits)

        if self._op == "delete":
            hits = [r for r in rows if self._matches(r)]
            self._db.tables[self._table] = [r for r in rows if r not in hits]
            return _Response(hits)

        raise AssertionError(f"unsupported op {self._op}")

    # ---- embedding
    def _embed_matches(self, row: dict) -> bool:
        for kind, column, value in self._filters:
            if "." not in column:
                continue
            table, col = column.split(".", 1)
            if table != self._embed:
                continue
            actual = row.get(col)
            if kind == "eq" and str(actual) != str(value):
                return False
            if kind == "gte" and (actual is None or str(actual) < str(value)):
                return False
            if kind == "lte" and (actual is None or str(actual) > str(value)):
                return False
        return True

    def _with_embed(self, row: dict) -> dict:
        fk = EMBED_FK[self._embed]
        children = [
            e
            for e in self._db.tables.get(self._embed, [])
            if str(e.get(fk)) == str(row.get("id")) and self._embed_matches(e)
        ]
        return {**row, self._embed: children}


class _Rpc:
    def __init__(self, db: FakeDB, name: str, params: dict | None) -> None:
        self._db, self._name, self._params = db, name, params or {}

    def execute(self) -> _Response:
        if self._name == "username_available":
            taken = any(
                u["username"] == self._params["p_username"]
                for u in self._db.tables.get("users", [])
            )
            return _Response(not taken)
        if self._name == "get_my_stats":
            return _Response([self._db.stats()])
        if self._name == "search_users":
            prefix = self._params["p_prefix"]
            if not re.fullmatch(r"[a-z0-9_]{1,20}", prefix):
                return _Response([])
            hits = sorted(
                (u for u in self._db.tables.get("users", [])
                 if u["username"].startswith(prefix)),
                key=lambda u: u["username"],
            )[:20]
            public = ("id", "username", "first_name", "last_name", "avatar", "avatar_path")
            return _Response([{k: u.get(k) for k in public} for u in hits])
        if self._name == "get_user_card":
            target = str(self._params["p_user_id"])
            user = next(
                (u for u in self._db.tables.get("users", []) if str(u["id"]) == target),
                None,
            )
            if user is None:
                return _Response([])
            card = {k: user.get(k) for k in (
                "id", "username", "first_name", "last_name", "bio",
                "avatar", "avatar_path", "created_at",
            )}
            card.setdefault("bio", "")
            return _Response([{**card, **self._db.stats(target)}])
        if self._name == "get_user_habits":
            target = str(self._params["p_user_id"])
            if target not in self._db.circle():
                return _Response([])
            rows = sorted(
                (h for h in self._db.tables.get("habits", [])
                 if str(h["user_id"]) == target and h.get("archived_at") is None),
                key=lambda h: h["created_at"],
            )
            return _Response(
                [{k: h.get(k) for k in ("name", "type", "goal", "unit")} for h in rows]
            )
        if self._name == "get_user_grids":
            target = str(self._params["p_user_id"])
            lo, hi = self._params["p_from"], self._params["p_to"]
            grids = []
            if target not in self._db.circle():
                return _Response([])
            for h in self._db.active_habits(target):
                days = sorted(
                    (e for e in self._db.tables["habit_entries"]
                     if str(e["habit_id"]) == str(h["id"]) and lo <= str(e["entry_date"]) <= hi),
                    key=lambda e: str(e["entry_date"]),
                )
                grids.append({
                    **{k: h.get(k) for k in ("name", "type", "goal", "unit")},
                    "entries": [{"entry_date": e["entry_date"], "value": e["value"]} for e in days],
                })
            return _Response(grids)
        if self._name == "get_leaderboards":
            return _Response(self._db.leaderboards(
                date.fromisoformat(self._params["p_today"]),
                date.fromisoformat(self._params["p_week_start"]),
            ))
        if self._name == "get_activity":
            return _Response(self._db.activity(int(self._params["p_limit"])))
        if self._name == "get_friendships":
            return _Response(self._db.friendships())
        raise AssertionError(f"unknown rpc {self._name}")


class FakeDB:
    """Shared row store. One per test."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "users": [], "habits": [], "habit_entries": [],
            "reminders": [], "reminder_categories": [], "friendships": [],
        }
        self.current_user_id: str | None = None

    # -- constraint enforcement, mirroring the migration
    def check_constraints(self, table: str, rows: list[dict]) -> None:
        for row in rows:
            if table == "habits":
                if row.get("type") not in {"completion", "count"}:
                    raise APIError({"code": CHECK_VIOLATION, "message": "ck_habit_type"})
                goal = row.get("goal")
                if row["type"] == "count" and (goal is None or goal <= 0):
                    raise APIError({"code": CHECK_VIOLATION, "message": "ck_goal_matches_type"})
                if row["type"] == "completion" and goal is not None:
                    raise APIError({"code": CHECK_VIOLATION, "message": "ck_goal_matches_type"})
            if table == "reminders":
                start, end, at = row.get("start_date"), row.get("end_date"), row.get("at_time")
                ok = {
                    "refile": not (start or end or at),
                    "backlog": not (start or end or at),
                    "floater": bool(start and end) and str(end) >= str(start) and not at,
                    "anchor": bool(start) and not end,
                }.get(row.get("kind"))
                if ok is None:
                    raise APIError({"code": CHECK_VIOLATION, "message": "ck_reminder_kind"})
                if not ok:
                    raise APIError({"code": CHECK_VIOLATION, "message": "ck_reminder_dates"})

    def insert(self, table: str, row: dict) -> dict:
        row = {k: _resolve(v) for k, v in row.items()}
        row.setdefault("id", str(uuid.uuid4()))
        row.setdefault("created_at", _now())
        if table == "users" and any(
            u["username"] == row["username"] for u in self.tables["users"]
        ):
            raise APIError({"code": UNIQUE_VIOLATION, "message": "users_username_key"})
        if table == "habits":
            row.setdefault("goal", None)
            row.setdefault("unit", "")
            row.setdefault("archived_at", None)
        if table in {"reminders", "reminder_categories"} and any(
            str(r["id"]) == str(row["id"]) for r in self.tables[table]
        ):
            raise APIError({"code": UNIQUE_VIOLATION, "message": f"{table}_pkey"})
        if table == "friendships":
            self._check_friendship(row)
        if table == "habit_entries":
            row.setdefault("updated_at", None)
            key = (str(row["habit_id"]), str(row["entry_date"]))
            for e in self.tables["habit_entries"]:
                if (str(e["habit_id"]), str(e["entry_date"])) == key:
                    raise APIError({"code": UNIQUE_VIOLATION, "message": "uq_entry_habit_date"})
        self.check_constraints(table, [row])
        self.tables[table].append(row)
        return row

    def _check_friendship(self, row: dict) -> None:
        """ck_friendship_not_self, the foreign keys, and uq_friendship_pair."""
        row.setdefault("status", "pending")
        row.setdefault("accepted_at", None)
        pair = {str(row["requester_id"]), str(row["addressee_id"])}
        if len(pair) == 1:
            raise APIError({"code": CHECK_VIOLATION, "message": "ck_friendship_not_self"})
        users = {str(u["id"]) for u in self.tables["users"]}
        if not pair <= users:
            raise APIError({"code": FOREIGN_KEY_VIOLATION, "message": "friendships_fkey"})
        if any({str(f["requester_id"]), str(f["addressee_id"])} == pair
               for f in self.tables["friendships"]):
            raise APIError({"code": UNIQUE_VIOLATION, "message": "uq_friendship_pair"})

    def circle(self) -> set[str]:
        """Same as my_circle(): the caller plus their accepted friends."""
        me = str(self.current_user_id)
        mine = {me}
        for f in self.tables["friendships"]:
            pair = {str(f["requester_id"]), str(f["addressee_id"])}
            if f["status"] == "accepted" and me in pair:
                mine |= pair
        return mine

    def friendships(self) -> list[dict]:
        """Same shape as get_friendships(): the caller's rows, each with the
        other person's public profile, newest first."""
        me = str(self.current_user_id)
        rows = []
        for f in self.tables["friendships"]:
            if me not in (str(f["requester_id"]), str(f["addressee_id"])):
                continue
            incoming = str(f["addressee_id"]) == me
            other = str(f["requester_id"] if incoming else f["addressee_id"])
            rows.append({
                **self._user_row(other), "status": f["status"], "incoming": incoming,
                "created_at": f["created_at"], "accepted_at": f["accepted_at"],
            })
        rows.sort(key=lambda r: str(r["accepted_at"] or r["created_at"]), reverse=True)
        return rows

    def active_habits(self, user_id: str) -> list[dict]:
        return sorted(
            (h for h in self.tables["habits"]
             if str(h["user_id"]) == user_id and h.get("archived_at") is None),
            key=lambda h: h["created_at"],
        )

    def _user_row(self, user_id: str) -> dict:
        user = next(u for u in self.tables["users"] if str(u["id"]) == user_id)
        row = {k: user.get(k) for k in (
            "username", "first_name", "last_name", "avatar", "avatar_path",
        )}
        return {"user_id": user_id, **row}

    def _days(self, habit: dict) -> dict[date, float]:
        return {
            date.fromisoformat(str(e["entry_date"])): float(e["value"])
            for e in self.tables["habit_entries"]
            if str(e["habit_id"]) == str(habit["id"])
        }

    def leaderboards(self, today: date, week_start: date) -> list[dict]:
        """Same rules as get_leaderboards(): a board per habit the caller
        tracks, matched across the caller's friends by lowercased name (and
        unit, for counts); streak that reaches yesterday, or the week's total."""
        def key(h: dict) -> tuple[str, str, str]:
            unit = h["unit"].strip().lower() if h["type"] == "count" else ""
            return (h["name"].strip().lower(), h["type"], unit)

        rows: list[dict] = []
        seen: set[tuple[str, str, str]] = set()
        circle = self.circle()
        for mine in self.active_habits(str(self.current_user_id)):
            if key(mine) in seen:
                continue
            seen.add(key(mine))
            scores: dict[str, float] = {}
            for h in self.tables["habits"]:
                if (h.get("archived_at") is not None or key(h) != key(mine)
                        or str(h["user_id"]) not in circle):
                    continue
                days = self._days(h)
                if h["type"] == "count":
                    score = sum(v for d, v in days.items()
                                if week_start <= d <= week_start + timedelta(days=6))
                else:
                    done = {d for d, v in days.items() if v > 0 and d <= today}
                    cursor = today if today in done else today - timedelta(days=1)
                    score = 0
                    while cursor in done:
                        score += 1
                        cursor -= timedelta(days=1)
                uid = str(h["user_id"])
                scores[uid] = max(scores.get(uid, 0), score)
            for uid, score in sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:100]:
                rows.append({
                    "habit": mine["name"], "type": mine["type"], "unit": mine["unit"],
                    **self._user_row(uid), "value": score,
                })
        return rows

    def activity(self, limit: int) -> list[dict]:
        habits = {str(h["id"]): h for h in self.tables["habits"]}
        circle = self.circle()
        rows = []
        for e in self.tables["habit_entries"]:
            h = habits[str(e["habit_id"])]
            if (str(h["user_id"]) == str(self.current_user_id)
                    or str(h["user_id"]) not in circle
                    or h.get("archived_at") is not None or float(e["value"]) <= 0):
                continue
            rows.append({
                "id": e["id"], **self._user_row(str(h["user_id"])),
                "habit": h["name"], "type": h["type"], "unit": h["unit"],
                "value": e["value"], "entry_date": e["entry_date"],
                "logged_at": e.get("updated_at") or e["created_at"],
            })
        rows.sort(key=lambda r: str(r["logged_at"]), reverse=True)
        return rows[: max(1, min(limit, 50))]

    def stats(self, user_id: str | None = None) -> dict:
        """Same rules as get_my_stats(): consecutive days with value > 0, a run
        counts as current if it reaches yesterday."""
        uid = user_id or self.current_user_id
        mine = {
            str(h["id"])
            for h in self.tables["habits"]
            if str(h["user_id"]) == uid
        }
        active = [
            h for h in self.tables["habits"]
            if str(h["user_id"]) == uid and h.get("archived_at") is None
        ]
        by_habit: dict[str, list[date]] = {}
        for e in self.tables["habit_entries"]:
            if str(e["habit_id"]) in mine and float(e["value"]) > 0:
                d = e["entry_date"]
                by_habit.setdefault(str(e["habit_id"]), []).append(
                    d if isinstance(d, date) else date.fromisoformat(str(d))
                )

        streak = best = 0
        today = date.today()
        for days in by_habit.values():
            days.sort()
            run = 1
            runs: list[tuple[int, date]] = []
            for prev, cur in itertools.pairwise(days):
                if (cur - prev).days == 1:
                    run += 1
                else:
                    runs.append((run, prev))
                    run = 1
            runs.append((run, days[-1]))
            for length, last in runs:
                best = max(best, length)
                if (today - last).days <= 1:
                    streak = max(streak, length)
        return {"streak": streak, "best": best, "tracked": len(active)}


class FakeClient:
    def __init__(self, db: FakeDB) -> None:
        self.db = db

    def table(self, name: str) -> _Query:
        return _Query(self.db, name)

    def rpc(self, name: str, params: dict | None = None) -> _Rpc:
        return _Rpc(self.db, name, params)

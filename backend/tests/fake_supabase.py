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
from datetime import UTC, date, datetime
from typing import Any

from postgrest import APIError

EMBED_FK = {"habit_entries": "habit_id"}

UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"


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
        raise AssertionError(f"unknown rpc {self._name}")


class FakeDB:
    """Shared row store. One per test."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {"users": [], "habits": [], "habit_entries": []}
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
        if table == "habit_entries":
            row.setdefault("updated_at", None)
            key = (str(row["habit_id"]), str(row["entry_date"]))
            for e in self.tables["habit_entries"]:
                if (str(e["habit_id"]), str(e["entry_date"])) == key:
                    raise APIError({"code": UNIQUE_VIOLATION, "message": "uq_entry_habit_date"})
        self.check_constraints(table, [row])
        self.tables[table].append(row)
        return row

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

"""RLS policy tests against a real Postgres.

Moving to a user-scoped PostgREST client moved authorization out of Python and
into SQL, so these are the tests that actually cover it — the API tests run
against a fake client that has no concept of policies.

Skipped automatically when psql or a local server isn't available.
"""

import pathlib
import re
import shutil
import subprocess

import pytest

DB = "willo_rls_test"
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def migration_files() -> list[pathlib.Path]:
    """Every migration, in timestamp order — the same order the CLI applies
    them. Globbing rather than naming one file keeps this honest as migrations
    accumulate."""
    return sorted(MIGRATIONS_DIR.glob("*.sql"))

A = "11111111-1111-1111-1111-111111111111"
B = "22222222-2222-2222-2222-222222222222"
A_HABIT = "aaaa0000-0000-0000-0000-000000000001"
B_HABIT = "bbbb0000-0000-0000-0000-000000000002"

# what Supabase provides and a bare postgres doesn't
AUTH_STUB = """
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to authenticated;
"""

SEED = f"""
insert into auth.users values ('{A}','a@x.com'), ('{B}','b@x.com');
insert into public.users (id, username, first_name, last_name) values
  ('{A}','luka','Luka','J'), ('{B}','sam','Sam','R');
insert into public.habits (id, user_id, name, type) values
  ('{A_HABIT}','{A}','gym','completion'),
  ('{B_HABIT}','{B}','gym','completion');
insert into public.habit_entries (habit_id, entry_date, value)
select '{A_HABIT}', current_date - g, 1 from generate_series(0,4) g;
insert into public.habit_entries (habit_id, entry_date, value)
select '{B_HABIT}', current_date - g, 1 from generate_series(0,1) g;
"""

pytestmark = pytest.mark.skipif(
    shutil.which("psql") is None
    or subprocess.run(["pg_isready"], capture_output=True, check=False).returncode != 0,
    reason="needs a local postgres",
)


def _psql(db: str, sql: str, check: bool = True) -> str:
    result = subprocess.run(
        ["psql", "-d", db, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, check=False,
    )
    if check and result.returncode != 0:
        raise AssertionError(result.stderr)
    return (result.stdout + result.stderr).strip()


@pytest.fixture(scope="module", autouse=True)
def database():
    subprocess.run(["psql", "-d", "postgres", "-qc", f"drop database if exists {DB}"],
                   capture_output=True, check=True)
    subprocess.run(["psql", "-d", "postgres", "-qc", f"create database {DB}"],
                   capture_output=True, check=True)
    _psql(DB, AUTH_STUB)
    for migration in migration_files():
        subprocess.run(
            ["psql", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-f", str(migration)],
            capture_output=True, check=True,
        )
    _psql(DB, SEED)
    yield
    subprocess.run(["psql", "-d", "postgres", "-qc", f"drop database {DB}"],
                   capture_output=True, check=False)


def as_user(user_id: str, sql: str) -> str:
    """Run SQL as `authenticated` with the JWT claims Supabase would set.

    The whole thing is one transaction and rolled back — SET LOCAL outside a
    transaction is silently a no-op, which would run everything as the table
    owner and bypass RLS entirely, making every assertion here vacuous.
    """
    wrapped = (
        f"begin; set local role authenticated; "
        f"set local request.jwt.claims = '{{\"sub\":\"{user_id}\"}}'; "
        f"{sql} rollback;"
    )
    return _psql(DB, wrapped, check=False)


# psql echoes a status tag for every statement (BEGIN, SET, ROLLBACK, UPDATE 0
# ...). Strip them so a query's value is what comes back.
_TAGS = re.compile(r"^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$")


def scalar(user_id: str, sql: str) -> str:
    lines = [
        line for line in as_user(user_id, sql).splitlines()
        if line.strip() and not _TAGS.match(line.strip())
    ]
    assert lines, f"no value returned for {sql!r}"
    return lines[-1].strip()


def test_harness_actually_applies_rls():
    """Guards the guard: if SET LOCAL stopped working, every other test here
    would pass for the wrong reason."""
    assert scalar(A, "select current_user;") == "authenticated"


def test_users_see_only_their_own_row():
    assert scalar(A, "select count(*) from public.users;") == "1"
    assert scalar(A, "select username from public.users;") == "luka"
    assert scalar(B, "select username from public.users;") == "sam"


def test_habits_are_scoped_to_their_owner():
    assert scalar(A, "select count(*) from public.habits;") == "1"
    assert scalar(B, "select count(*) from public.habits;") == "1"


def test_entries_are_scoped_through_the_parent_habit():
    assert scalar(A, "select count(*) from public.habit_entries;") == "5"
    assert scalar(B, "select count(*) from public.habit_entries;") == "2"


def test_cannot_insert_an_entry_onto_someone_elses_habit():
    out = as_user(B, f"insert into public.habit_entries (habit_id, entry_date, value) "
                     f"values ('{A_HABIT}', current_date - 10, 99);")
    assert "row-level security" in out


def test_cannot_create_a_habit_owned_by_someone_else():
    out = as_user(B, f"insert into public.habits (user_id, name, type) "
                     f"values ('{A}','sneaky','completion');")
    assert "row-level security" in out


def test_cannot_re_parent_someone_elses_habit():
    out = as_user(B, f"update public.habits set user_id='{B}' where id='{A_HABIT}';")
    assert "UPDATE 0" in out


def test_cannot_read_another_users_row_by_username():
    assert scalar(B, "select count(*) from public.users where username='luka';") == "0"


def test_stats_rpc_is_scoped_to_the_caller():
    """security invoker, so the policies scope it without a user_id argument."""
    assert scalar(A, "select streak||'/'||best||'/'||tracked from public.get_my_stats();") == "5/5/1"
    assert scalar(B, "select streak||'/'||best||'/'||tracked from public.get_my_stats();") == "2/2/1"


def test_username_available_sees_past_rls():
    """security definer on purpose — RLS would otherwise report a taken name as
    free, since the caller can't see the other user's row."""
    assert scalar(B, "select public.username_available('luka');") == "f"
    assert scalar(B, "select public.username_available('nobody');") == "t"


def test_check_constraints_still_apply_under_rls():
    out = as_user(A, f"insert into public.habits (user_id, name, type, goal) "
                     f"values ('{A}','bad','count',null);")
    assert "ck_goal_matches_type" in out


def test_every_migration_applies_in_order():
    """The fixture replays all of them; this makes the count visible so a new
    migration that is never picked up is obvious."""
    assert len(migration_files()) >= 2


def test_helper_functions_are_not_callable_anonymously():
    """The publishable key ships in the browser bundle, so anything anon can
    execute is effectively public. username_available() is security definer and
    sees past RLS — left open it is a username enumeration oracle.

    Postgres grants EXECUTE to PUBLIC on new functions by default, so this needs
    an explicit revoke; it is not the default.
    """
    for fn in ("public.username_available(text)", "public.get_my_stats()"):
        granted = _psql(DB, f"select has_function_privilege('anon', '{fn}', 'execute');")
        assert granted.strip() == "f", f"anon can execute {fn}"


def test_helper_functions_remain_callable_by_authenticated():
    """Revoking from PUBLIC also strips the grant authenticated inherits, so the
    re-grant ordering in the migration matters."""
    assert scalar(A, "select public.username_available('nobody');") == "t"
    assert scalar(A, "select streak from public.get_my_stats();") == "5"

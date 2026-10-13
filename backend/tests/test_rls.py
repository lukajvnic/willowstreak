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
# C and D only track a counted habit, so they never show up on A's or B's boards
C = "33333333-3333-3333-3333-333333333333"
D = "44444444-4444-4444-4444-444444444444"
A_HABIT = "aaaa0000-0000-0000-0000-000000000001"
B_HABIT = "bbbb0000-0000-0000-0000-000000000002"
C_HABIT = "cccc0000-0000-0000-0000-000000000003"
D_HABIT = "dddd0000-0000-0000-0000-000000000004"
A_REMINDER = "aaaa0000-0000-0000-0000-00000000000a"

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

-- just enough of Supabase Storage for the avatars migration: the two tables it
-- writes to and the path helper its policies call
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id), name text
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
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

insert into auth.users values ('{C}','c@x.com'), ('{D}','d@x.com');
insert into public.users (id, username, first_name, last_name) values
  ('{C}','cleo','Cleo','M'), ('{D}','dev','Dev','P');
insert into public.habits (id, user_id, name, type, goal, unit) values
  ('{C_HABIT}','{C}','reading','count',30,'min'),
  ('{D_HABIT}','{D}','Reading ','count',45,'Min');
insert into public.habit_entries (habit_id, entry_date, value) values
  ('{C_HABIT}', current_date, 25),
  ('{D_HABIT}', current_date, 40),
  ('{D_HABIT}', current_date - 8, 500);

insert into public.reminders (id, user_id, title, kind) values
  ('{A_REMINDER}','{A}','haircut','refile');
insert into public.reminder_categories (user_id, name) values ('{A}','garden');
insert into storage.objects (bucket_id, name) values ('avatars', '{A}/seed.webp');
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
    for fn in (
        "public.username_available(text)",
        "public.get_my_stats()",
        "public.get_user_habits(uuid)",
        "public.get_user_grids(uuid, date, date)",
        "public.get_leaderboards(date, date)",
        "public.get_activity(integer)",
    ):
        granted = _psql(DB, f"select has_function_privilege('anon', '{fn}', 'execute');")
        assert granted.strip() == "f", f"anon can execute {fn}"


def test_helper_functions_remain_callable_by_authenticated():
    """Revoking from PUBLIC also strips the grant authenticated inherits, so the
    re-grant ordering in the migration matters."""
    assert scalar(A, "select public.username_available('nobody');") == "t"
    assert scalar(A, "select streak from public.get_my_stats();") == "5"


def test_user_habits_sees_past_rls_but_only_the_definition():
    """security definer on purpose — copying someone's habit needs their habit
    list, which RLS hides. The return shape is the whole exposure: no ids, no
    entries."""
    assert scalar(A, f"select count(*) from public.habits where user_id='{B}';") == "0"
    assert scalar(
        A, f"select name||'/'||type||'/'||coalesce(goal::text,'-')||'/'||unit "
           f"from public.get_user_habits('{B}');"
    ) == "gym/completion/-/"
    columns = _psql(DB, "select string_agg(a, ',') from unnest("
                        "(select proargnames from pg_proc where proname='get_user_habits')) a;")
    assert columns == "p_user_id,name,type,goal,unit"


# ----------------------------------------------------------------- social reads

def rows(user_id: str, sql: str) -> list[str]:
    return [
        line.strip() for line in as_user(user_id, sql).splitlines()
        if line.strip() and not _TAGS.match(line.strip())
    ]


def test_user_grids_return_entries_inside_the_window():
    assert scalar(A, f"select name||'/'||jsonb_array_length(entries) "
                     f"from public.get_user_grids('{B}', current_date - 1, current_date);") == "gym/2"
    assert scalar(A, f"select entries from public.get_user_grids('{B}', current_date, current_date);") \
        == f'[{{"value": 1, "entry_date": "{_psql(DB, "select current_date;")}"}}]'


LEADERBOARD = ("select habit||'/'||unit||'/'||username||'/'||value "
               "from public.get_leaderboards(current_date, current_date - 3);")


def test_leaderboard_ranks_streaks_for_a_shared_habit():
    """The board is the caller's habit, populated with everyone who tracks one
    of the same name — rows RLS would never let the caller read directly."""
    assert rows(A, LEADERBOARD) == ["gym//luka/5", "gym//sam/2"]
    assert rows(B, LEADERBOARD) == ["gym//luka/5", "gym//sam/2"]


def test_leaderboard_totals_the_week_and_matches_units_loosely():
    """'Reading ' in 'Min' and 'reading' in 'min' are one board; the entry from
    eight days back is outside the week and doesn't count."""
    assert rows(C, LEADERBOARD) == ["reading/min/dev/40", "reading/min/cleo/25"]


def test_leaderboard_streak_survives_an_unlogged_today():
    tomorrow = "select username||'/'||value from public.get_leaderboards(current_date + 1, current_date);"
    later = "select username||'/'||value from public.get_leaderboards(current_date + 2, current_date);"
    assert rows(A, tomorrow) == ["luka/5", "sam/2"]
    assert rows(A, later) == ["luka/0", "sam/0"]


def test_activity_shows_everyone_but_the_caller():
    assert scalar(A, "select count(*)||'/'||bool_and(username <> 'luka') "
                     "from public.get_activity(50);") == "5/true"
    assert scalar(A, "select count(*) from public.get_activity(2);") == "2"
    assert scalar(A, "select count(*) from public.get_activity(100000);") == "5"


# ----------------------------------------------------------------- reminders

def test_reminders_are_scoped_to_their_owner():
    assert scalar(A, "select count(*) from public.reminders;") == "1"
    assert scalar(B, "select count(*) from public.reminders;") == "0"
    assert scalar(A, "select count(*) from public.reminder_categories;") == "1"
    assert scalar(B, "select count(*) from public.reminder_categories;") == "0"
    assert "UPDATE 0" in as_user(B, f"update public.reminders set done = true where id = '{A_REMINDER}';")
    assert "DELETE 0" in as_user(B, f"delete from public.reminders where id = '{A_REMINDER}';")


def test_cannot_file_a_reminder_for_someone_else():
    out = as_user(B, f"insert into public.reminders (user_id, title, kind) "
                     f"values ('{A}','sneaky','refile');")
    assert "row-level security" in out


def test_reminder_dates_must_fit_the_kind():
    for values in (
        f"('{A}','x','anchor',null,null)",
        f"('{A}','x','refile',current_date,null)",
        f"('{A}','x','floater',current_date,current_date - 1)",
    ):
        out = as_user(A, "insert into public.reminders (user_id, title, kind, start_date, end_date) "
                         f"values {values};")
        assert "ck_reminder_dates" in out, values
    ok = as_user(A, "insert into public.reminders (user_id, title, kind, start_date, end_date) "
                    f"values ('{A}','x','floater',current_date,current_date + 7);")
    assert "INSERT 0 1" in ok


# ----------------------------------------------------------------- avatar storage

def test_avatar_uploads_are_limited_to_your_own_folder():
    put = "insert into storage.objects (bucket_id, name) values ('avatars', '{}/new.webp');"
    assert "INSERT 0 1" in as_user(A, put.format(A))
    assert "row-level security" in as_user(A, put.format(B))
    assert "row-level security" in as_user(A, "insert into storage.objects (bucket_id, name) "
                                              "values ('avatars', 'loose.webp');")


def test_only_the_owner_can_delete_an_avatar():
    drop = f"delete from storage.objects where name = '{A}/seed.webp';"
    assert "DELETE 0" in as_user(B, drop)
    assert "DELETE 1" in as_user(A, drop)

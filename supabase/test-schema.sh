#!/usr/bin/env bash
# Checks supabase/schema.sql against a throwaway local Postgres: runs it twice (it must be re-runnable),
# then exercises the public read functions as the anon role. Needs PostgreSQL 15+ binaries on PATH or in PG_BIN.
set -euo pipefail
BIN=${PG_BIN:-$(dirname "$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}
DIR=$(mktemp -d); PORT=${PORT:-55432}
trap '"$BIN/pg_ctl" -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$BIN/initdb" -D "$DIR/data" -A trust >/dev/null
"$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null; sleep 1
q() { psql -h "$DIR" -p "$PORT" -U "$(whoami)" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
q <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated;
SQL
q -f "$(dirname "$0")/schema.sql" 2>/dev/null; q -f "$(dirname "$0")/schema.sql" 2>/dev/null
q <<'SQL'
-- Supabase grants table access to these roles and relies on row level security; do the same here
grant usage on schema public to anon, authenticated; grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'coach@example.com');
insert into teams_cloud (id, name, owner) values ('t1', 'Test', '11111111-1111-1111-1111-111111111111');
insert into records (store, id, team_id, data) values
  ('teams', 't1', 't1', '{"name":"Test"}'), ('seasons', 's1', 't1', '{"name":"Fall"}'),
  ('matches', 'm1', 't1', '{"id":"m1","seasonId":"s1","kind":"match","opp":"Them","date":"2026-10-01","bestOf":5,"status":"done"}'),
  ('logs', 'l1', 't1', '{"matchId":"m1","events":[{"id":"e1","t":"K","p":"p1","ts":1},{"id":"e2","t":"TAG","note":"private film note","ts":2}]}'),
  ('players', 'p1', 't1', '{"id":"p1","num":"7","first":"Maya","last":"Chen","pos":"OH"}'),
  ('players', 'p2', 't1', '{"id":"p2","num":"9","first":"Riley","last":"Brooks","pos":"MB","hidePublic":true}');
update records set data = data || '{"notes":"private match notes","video":"https://youtu.be/x"}' where id = 'm1';
insert into season_shares values ('S1S1S1', 't1', 's1');
insert into live_shares (code, team_id, match_id) values ('L1L1L1', 't1', 'm1');
insert into recruit_shares (code, team_id, player_id, html) values ('R1R1R1', 't1', 'p1', '<p>profile</p>');
SQL
check() { [ "$(q -c "set role anon; $1" | tail -1)" = "$2" ] && echo "ok   $3" || { echo "FAIL $3"; exit 1; }; }
check "select season_view('s1s1s1')->'players'->0->>'last';" "C" "season page shows last initial only"
check "select count(*) from jsonb_array_elements(season_view('s1s1s1')->'players') p where p->>'num' = '9' and p->>'first' = '' and p->>'last' = '';" "1" "players kept off public pages show only their number"
check "select watch('l1l1l1')::text like '%private%';" "f" "live link never includes match notes or film tags"
check "select season_view('s1s1s1')::text like '%private%';" "f" "season page never includes film tags"
check "select season_view('s1s1s1')->'live'->0->>'code';" "L1L1L1" "season page links to the live gamecast"
check "select jsonb_array_length(watch('l1l1l1')->'logs'->0);" "1" "live link keeps the plays"
check "select jsonb_array_length(season_view('s1s1s1')->'matches');" "1" "season page lists matches"
check "select watch('l1l1l1')->'match'->>'opp';" "Them" "live link returns the match"
check "select recruit_view('r1r1r1')->>'html';" "<p>profile</p>" "recruit link returns the page"
check "select count(*) from records;" "0" "anon can't read records directly"
check "select schema_version();" "9" "schema version is reported"
check "select abs(server_time() - (extract(epoch from now()) * 1000)::bigint) < 5000;" "t" "server time is in milliseconds"
# row level security as signed-in coaches: A owns a team, B is a stranger until invited as a viewer
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa; B=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
q -c "insert into auth.users values ('$A', 'a@example.com'), ('$B', 'b@example.com');"
as() { q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false); $2" 2>&1 | tail -1; }
expect() { [ "$1" = "$2" ] && echo "ok   $3" || { echo "FAIL $3 (got: $1)"; exit 1; }; }
as $A "insert into teams_cloud (id, name) values ('t2', 'Mine');" >/dev/null
expect "$(as $A "select role from members where team_id = 't2';")" "owner" "creating a team makes you its owner"
as $A "insert into records (store, id, team_id, data, u) values ('players', 'p9', 't2', '{\"first\":\"Ann\"}', 5);" >/dev/null
expect "$(as $B "select count(*) from records where team_id = 't2';")" "0" "strangers can't read a team's data"
expect "$(as $B "insert into records (store, id, team_id, data) values ('players', 'x', 't2', '{}');" | grep -c 'row-level security')" "1" "strangers can't write a team's data"
as $A "insert into invites (code, team_id, role) values ('VIEW01', 't2', 'viewer');" >/dev/null
expect "$(as $B "select join_team('view01');")" "t2" "an invite code joins the team"
expect "$(as $B "select count(*) from records where team_id = 't2';")" "1" "members can read"
as $B "update records set data = '{}' where id = 'p9';" >/dev/null
expect "$(as $A "select data->>'first' from records where id = 'p9';")" "Ann" "view-only members can't change data"
as $A "update records set data = '{\"first\":\"Old\"}', u = 3 where id = 'p9';" >/dev/null
expect "$(as $A "select data->>'first' from records where id = 'p9';")" "Ann" "an older edit never overwrites a newer one"
# deleting an account removes the user, the teams they own (and everything in them) and their memberships
q -c "insert into teams_cloud (id, name, owner) values ('t3', 'Theirs', '$B');" >/dev/null
q -c "insert into members (team_id, user_id, role) values ('t3', '$A', 'coach') on conflict do nothing;" >/dev/null
as $A "select delete_my_account();" >/dev/null
expect "$(q -c "select count(*) from auth.users where id = '$A';")" "0" "account deleted"
expect "$(q -c "select count(*) from records where team_id = 't2';")" "0" "teams they owned are deleted with their data"
expect "$(q -c "select count(*) from members where user_id = '$A';")" "0" "memberships on other teams are removed"
expect "$(q -c "select count(*) from teams_cloud where id = 't3';")" "1" "other people's teams stay"
expect "$(q -c "set role anon; select delete_my_account();" 2>&1 | grep -c 'permission denied')" "1" "signed-out visitors can't call it"
echo "schema OK"

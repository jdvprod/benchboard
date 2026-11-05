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
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), raw_user_meta_data jsonb not null default '{}');
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
  ('teams', 't1', 't1', '{"name":"Test","logo":"data:image/png;base64,AAAA","tournaments":[{"id":"tn1","name":"Fall Classic","start":"2026-11-07","poolTeams":["A","B"],"games":[],"others":[]}]}'), ('seasons', 's1', 't1', '{"name":"Fall"}'),
  ('matches', 'm1', 't1', '{"id":"m1","seasonId":"s1","kind":"match","opp":"Them","date":"2026-10-01","bestOf":5,"status":"done","oppLogo":"https://upload.wikimedia.org/them.png"}'),
  ('logs', 'l1', 't1', '{"matchId":"m1","events":[{"id":"e1","t":"K","p":"p1","ts":1},{"id":"e2","t":"TAG","note":"private film note","ts":2}]}'),
  ('players', 'p1', 't1', '{"id":"p1","num":"7","first":"Maya","last":"Chen","pos":"OH","photo":"https://x.supabase.co/storage/v1/object/public/media/t1/p1.jpg"}'),
  ('players', 'p2', 't1', '{"id":"p2","num":"9","first":"Riley","last":"Brooks","pos":"MB","hidePublic":true,"photo":"https://x.supabase.co/storage/v1/object/public/media/t1/p2.jpg"}');
update records set data = data || '{"notes":"private match notes","video":"https://youtu.be/x"}' where id = 'm1';
insert into season_shares values ('S1S1S1', 't1', 's1');
insert into live_shares (code, team_id, match_id) values ('L1L1L1', 't1', 'm1');
insert into recruit_shares (code, team_id, player_id, html, data) values ('R1R1R1', 't1', 'p1', '<p>profile</p>', '{"player":{"first":"Maya","num":"7"},"season":{"sets":3},"clips":[{"start":10}]}');
insert into recruit_boards (code, team_id) values ('B1B1B1', 't1');
insert into push_subs (endpoint, team_id, p256dh, auth) values ('https://push.example/1', 't1', 'k', 'a');
insert into push_sent (match_id, kind, team_id) values ('m1', 'start', 't1');
SQL
check() { [ "$(q -c "set role anon; $1" | tail -1)" = "$2" ] && echo "ok   $3" || { echo "FAIL $3"; exit 1; }; }
check "select season_view('s1s1s1')->'players'->0->>'last';" "C" "season page shows last initial only"
check "select count(*) from jsonb_array_elements(season_view('s1s1s1')->'players') p where p->>'num' = '9' and p->>'first' = '' and p->>'last' = '';" "1" "players kept off public pages show only their number"
check "select watch('l1l1l1')::text like '%private%';" "f" "live link never includes match notes or film tags"
check "select season_view('s1s1s1')::text like '%private%';" "f" "season page never includes film tags"
check "select season_view('s1s1s1')->'live'->0->>'code';" "L1L1L1" "season page links to the live gamecast"
check "select season_view('s1s1s1')->'team'->'tournaments'->0->>'name';" "Fall Classic" "season page includes tournament days"
check "select jsonb_array_length(watch('l1l1l1')->'logs'->0);" "1" "live link keeps the plays"
check "select jsonb_array_length(season_view('s1s1s1')->'matches');" "1" "season page lists matches"
check "select watch('l1l1l1')->'match'->>'opp';" "Them" "live link returns the match"
check "select count(*) from jsonb_array_elements(season_view('s1s1s1')->'players') p where p->>'photo' like 'https://%';" "1" "public pages show photos, except for players kept off them"
check "select season_view('s1s1s1')->'team'->>'logo' is null;" "t" "pictures embedded in a record never reach public pages"
check "select watch('l1l1l1')->'match'->>'oppLogo';" "https://upload.wikimedia.org/them.png" "gamecast gets the opponent's logo"
check "select recruit_view('r1r1r1')->>'html';" "<p>profile</p>" "recruit link returns the page"
check "select recruit_view('r1r1r1')->'data'->'player'->>'first';" "Maya" "recruit link returns the profile data"
check "select recruit_board('b1b1b1')->'players'->0->>'clips';" "1" "recruiting board lists shared profiles with their clip count"
check "select count(*) from recruit_boards;" "0" "anon can't read boards directly"
check "select count(*) from push_subs;" "0" "anon can't read notification subscriptions"
check "select count(*) from records;" "0" "anon can't read records directly"
check "select schema_version();" "16" "schema version is reported"
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
# admin console: only people in admins
q -c "insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin@example.com');" >/dev/null
asall() { q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false); $2" 2>&1; }
expect "$(asall $B "select admin_overview();" | grep -c 'Admins only')" "1" "non-admins can't see the admin console"
expect "$(as $B "select is_admin();")" "f" "is_admin says no for coaches"
q -c "insert into admins values ('cccccccc-cccc-cccc-cccc-cccccccccccc');" >/dev/null
C=cccccccc-cccc-cccc-cccc-cccccccccccc
q -c "set role anon; insert into app_errors (version, message, page) values ('2.1.0', 'x is undefined', 'stats');" >/dev/null
expect "$(q -c "set role anon; select count(*) from app_errors;" | tail -1)" "0" "crash reports can be sent but not read by visitors"
expect "$(q -c "set role anon; insert into app_errors (message) values (repeat('x', 400));" 2>&1 | grep -c 'row-level security')" "1" "oversized crash reports are refused"
expect "$(as $C "select (admin_overview()->>'users')::int >= 2;")" "t" "admins see the overview"
expect "$(as $C "select admin_overview()->'errors'->0->>'message';")" "x is undefined" "admins see crash reports"
expect "$(as $C "select admin_pictures();")" "[]" "pictures list works without Storage installed"
q -c "update records set data = data || '{\"photo\":\"https://x.supabase.co/storage/v1/object/public/media/t1/player-p1.jpg?v=1\"}' where id = 'p1';" >/dev/null
as $C "select admin_remove_picture('t1/player-p1.jpg');" >/dev/null
expect "$(q -c "select data ? 'photo' from records where id = 'p1';")" "f" "taking a picture down removes it from the player"
expect "$(asall $B "select admin_remove_picture('t1/x.jpg');" | grep -c 'Admins only')" "1" "coaches can't take pictures down"
q -c "set role anon; select recruit_seen('r1r1r1'); select recruit_seen('r1r1r1');" >/dev/null
expect "$(q -c "select views from recruit_shares where code = 'R1R1R1';")" "2" "profile views are counted"
expect "$(q -c "set role anon; select count(*) from recruit_shares;" | tail -1)" "0" "visitors can't read view counts"
# college coach search: listed profiles, approved .edu staff only
q -c "update recruit_shares set listed = true, data = '{\"player\":{\"first\":\"Maya\",\"num\":\"7\",\"grad\":2027,\"pos\":\"OH\"},\"team\":{\"name\":\"Test\"},\"season\":{\"sets\":3,\"kps\":3.2,\"hitting\":0.31},\"clips\":[]}' where code = 'R1R1R1';" >/dev/null
q -c "insert into auth.users (id, email) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'coach@state.edu'), ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'scout@gmail.com');" >/dev/null
D=dddddddd-dddd-dddd-dddd-dddddddddddd; E=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee
expect "$(asall $E "select college_request('Sam Scout', 'State', 'Recruiter');" | grep -c 'ending in .edu')" "1" "college access needs a .edu email"
expect "$(as $D "select college_request('Pat Coach', 'State University', 'Assistant coach');")" "pending" "college staff request access"
expect "$(asall $D "select recruit_search();" | grep -c 'College staff only')" "1" "pending staff can't search"
as $C "select admin_decide_college('$D', true);" >/dev/null
expect "$(as $D "select jsonb_array_length(recruit_search('{\"grad\":[2027],\"pos\":[\"OH\"],\"min\":{\"kps\":3}}'));")" "1" "approved staff find listed players by class, position and numbers"
expect "$(as $D "select jsonb_array_length(recruit_search('{\"min\":{\"kps\":4}}'));")" "0" "number filters exclude players below them"
expect "$(as $D "select jsonb_array_length(recruit_search('{\"min\":{\"dps\":1}}'));")" "0" "a stat the staff never recorded doesn't pass a filter"
q -c "update recruit_shares set listed = false where code = 'R1R1R1';" >/dev/null
expect "$(as $D "select jsonb_array_length(recruit_search());")" "0" "unlisted profiles never show in search"
expect "$(asall $B "select admin_decide_college('$E', true);" | grep -c 'Admins only')" "1" "only admins approve college staff"
# accounts: the news email list is for admins only
q -c "update auth.users set raw_user_meta_data = '{\"name\":\"Pat\",\"kind\":\"coach\",\"email_ok\":true}' where id = '$D';" >/dev/null
expect "$(as $C "select jsonb_array_length(admin_email_list());")" "1" "admins get the news email list (only people who said yes)"
expect "$(as $C "select admin_accounts()->'byKind'->>'coach' >= '1';")" "t" "admins see accounts by kind"
expect "$(asall $B "select admin_email_list();" | grep -c 'Admins only')" "1" "coaches can't read the email list"
# film sessions: coaches share, signed-in people watch, coaches see who watched
FC=$(as $B "select film_share('t3', 's1', '{\"title\":\"Serve receive\",\"items\":[{\"label\":\"Pass\"},{\"label\":\"Kill\"}]}');")
expect "${#FC}" "8" "a coach shares a film session and gets a code"
expect "$(asall $E "select film_share('t3', 's2', '{}');" | grep -c "Only the team's coaches")" "1" "people who don't coach the team can't share film"
expect "$(as $B "select film_share('t3', 's1', '{\"title\":\"Serve receive v2\",\"items\":[]}');")" "$FC" "sharing again keeps the same code"
expect "$(q -c "set role anon; select film_open('$FC');" 2>&1 | grep -c 'permission denied')" "1" "film needs an account"
expect "$(as $D "select film_open('$FC')->>'title';")" "Serve receive v2" "a signed-in player opens the session"
as $D "select film_watched('$FC', 0); select film_watched('$FC', 0); select film_watched('$FC', 1);" >/dev/null
expect "$(as $D "select film_open('$FC')->'watched';")" "[0, 1]" "watched clips are remembered"
expect "$(as $B "select film_viewers('$FC')->0->>'name';")" "Pat" "the coach sees who watched"
expect "$(as $B "select film_viewers('$FC')->0->>'watched';")" "2" "and how many clips"
expect "$(asall $D "select film_viewers('$FC');" | grep -c "Only the team's coaches")" "1" "players can't see who else watched"
expect "$(q -c "set role anon; select count(*) from film_views;" 2>&1 | grep -c 'permission denied\|^ *0$')" "1" "view records aren't readable directly"
as $B "select film_unshare('$FC');" >/dev/null
expect "$(as $D "select film_open('$FC');")" "" "a session taken down no longer opens"
echo "schema OK"

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
-- what Supabase does before our schema runs: anon and authenticated get every new table and function by default
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL
if q -f "$(dirname "$0")/schema.sql" 2>&1 | grep -E "^psql:.*ERROR"; then echo "FAIL schema.sql has errors"; exit 1; fi; q -f "$(dirname "$0")/schema.sql" 2>/dev/null
q <<'SQL'
-- (Supabase's default grants were set up before the schema ran, above; the schema's own revokes have already applied)
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'coach@example.com');
insert into teams_cloud (id, name, owner) values ('t1', 'Test', '11111111-1111-1111-1111-111111111111');
insert into records (store, id, team_id, data) values
  ('teams', 't1', 't1', '{"name":"Test","logo":"data:image/png;base64,AAAA","tournaments":[{"id":"tn1","name":"Fall Classic","start":"2026-11-07","poolTeams":["A","B"],"games":[],"others":[]}]}'), ('seasons', 's1', 't1', '{"name":"Fall"}'),
  ('matches', 'm1', 't1', '{"id":"m1","seasonId":"s1","kind":"match","opp":"Them","date":"2026-10-01","bestOf":5,"status":"done","oppLogo":"https://upload.wikimedia.org/them.png","oppRoster":{"11":{"name":"Kayla M","pos":"OH"}}}'),
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
expect() { [ "$1" = "$2" ] && echo "ok   $3" || { echo "FAIL $3 (got: $1)"; exit 1; }; }
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
check "select watch('l1l1l1')->'match'->'oppRoster'->'11'->>'name';" "Kayla M" "gamecast gets their roster names the coach entered"
check "select season_view('s1s1s1')->'matches'->0->'oppRoster'->'11'->>'pos';" "OH" "season page gets their roster too"
check "select recruit_view('r1r1r1')->>'html';" "<p>profile</p>" "recruit link returns the page"
check "select recruit_view('r1r1r1')->'data'->'player'->>'first';" "Maya" "recruit link returns the profile data"
check "select recruit_board('b1b1b1')->'players'->0->>'clips';" "1" "recruiting board lists shared profiles with their clip count"
expect "$(q -c "set role anon; select count(*) from recruit_boards;" 2>&1 | grep -c 'permission denied')" "1" "anon can't read boards directly"
expect "$(q -c "set role anon; select count(*) from push_subs;" 2>&1 | grep -c 'permission denied')" "1" "anon can't read notification subscriptions"
expect "$(q -c "set role anon; select count(*) from records;" 2>&1 | grep -c 'permission denied')" "1" "anon can't read records directly"
check "select schema_version();" "35" "schema version is reported"
check "select abs(server_time() - (extract(epoch from now()) * 1000)::bigint) < 5000;" "t" "server time is in milliseconds"
# row level security as signed-in coaches: A owns a team, B is a stranger until invited as a viewer
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa; B=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
q -c "insert into auth.users values ('$A', 'a@example.com'), ('$B', 'b@example.com');"
as() { q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false); $2" 2>&1 | tail -1; }
expect() { [ "$1" = "$2" ] && echo "ok   $3" || { echo "FAIL $3 (got: $1)"; exit 1; }; }
expect "$(as $A "insert into teams_cloud (id, name) values ('t0', 'Too soon');" | grep -c 'row-level security')" "1" "a coach who isn't verified can't put a team in the cloud"
expect "$(as $A "select coach_request('Ann Lee', 'Clovis North', 'Head coach');")" "pending" "a coach asks to be verified"
q -c "update coach_verify set status = 'approved' where user_id = '$A';"
expect "$(as $A "select coach_status()->>'status';")" "approved" "and is verified by a FloorCall admin"
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
as $A "insert into records (store, id, team_id, data, u) values ('opponents', 'o1', 't2', '{\"name\":\"Them\",\"scout\":\"private\"}', 5), ('drills', 'd1', 't2', '{}', 5), ('matches', 'm9', 't2', '{}', 5);" >/dev/null
expect "$(as $B "select string_agg(store, ',' order by store) from records where team_id = 't2';")" "matches,players" "view-only members (players, families) never see scouting or drills"
expect "$(as $A "select count(*) from records where team_id = 't2';")" "4" "the team's coaches see everything"
expect "$(as $B "select count(*) from members where team_id = 't2';")" "1" "players and families see only their own membership, not other people's emails"
C=12121212-1212-1212-1212-121212121212; q -c "insert into auth.users values ('$C', 'c@example.com');"
as $A "insert into invites (code, team_id, role) values ('COACH1', 't2', 'coach');" >/dev/null
expect "$(as $C "select join_team('coach1');")" "t2" "a coach code joins the team"
expect "$(as $C "select count(*) from records where team_id = 't2';")" "0" "but a new coach sees nothing until the owner approves"
expect "$(as $C "select status from members where team_id = 't2' and user_id = '$C';")" "pending" "and can see they're waiting"
expect "$(q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$C', false); select team_decide_member('t2', '$C', true);" 2>&1 | grep -c 'Only the team')" "1" "a coach can't approve themselves"
as $A "select team_decide_member('t2', '$C', true);" >/dev/null
expect "$(as $C "select count(*) from records where team_id = 't2';")" "4" "once approved they see the team"
expect "$(q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$B', false); select team_decide_member('t2', '$C', false);" 2>&1 | grep -c 'Only the team')" "1" "view-only members can't approve or remove coaches"
as $A "update records set data = '{\"first\":\"Old\"}', u = 3 where id = 'p9';" >/dev/null
expect "$(as $A "select data->>'first' from records where id = 'p9';")" "Ann" "an older edit never overwrites a newer one"
# player fees: the owner and coaches only; view-only members never see them, and they never ride along in the team record
as $A "insert into team_fees (team_id, data, u) values ('t2', '{\"amt\": 450}', 10);" >/dev/null
expect "$(as $A "select data->>'amt' from team_fees where team_id = 't2';")" "450" "a team's owner keeps its fees"
expect "$(as $B "select count(*) from team_fees where team_id = 't2';")" "0" "view-only members can't read fees"
expect "$(as $B "insert into team_fees (team_id, data) values ('t2', '{}') on conflict (team_id) do update set data = '{}';" | grep -c 'row-level security')" "1" "or write them"
expect "$(q -c "set role anon; select count(*) from team_fees;" 2>&1 | grep -c 'permission denied')" "1" "visitors can't touch fees"
q -c "insert into records (store, id, team_id, data, u) values ('teams', 't2', 't2', '{\"name\":\"Mine\",\"fees\":{\"amt\":1}}', 6) on conflict (store, id) do update set data = excluded.data;" >/dev/null
q -f "$(dirname "$0")/schema.sql" >/dev/null 2>&1
expect "$(q -c "select (data ? 'fees')::text || ':' || (data->>'name') from records where store = 'teams' and id = 't2';")" "false:Mine" "running the schema strips fees out of shared team records"
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
expect "$(q -c "select count(*) from app_errors;")" "1" "visitors can send a crash report"
expect "$(q -c "set role anon; select count(*) from app_errors;" 2>&1 | grep -c 'permission denied')" "1" "but not read them"
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
expect "$(q -c "set role anon; select count(*) from recruit_shares;" 2>&1 | grep -c 'permission denied')" "1" "visitors can't read view counts"
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
# college interest: approved staff write to a listed player's coaches; only that team's coaches read it
expect "$(asall $E "select college_contact('R1R1R1', 'hello');" | grep -c 'College staff only')" "1" "only approved college staff can write"
as $D "select college_contact('r1r1r1', 'We would like to see Maya at our January clinic.');" >/dev/null
expect "$(asall $D "select college_contact('R1R1R1', 'again');" | grep -c 'this week')" "1" "one message per player per week"
TEAM_R1=$(q -c "select team_id from recruit_shares where code = 'R1R1R1';")
OWNER_R1=$(q -c "select user_id from members where team_id = '$TEAM_R1' and role = 'owner' limit 1;")
expect "$(as $OWNER_R1 "select college_inbox('$TEAM_R1')->0->>'school';")" "State University" "the team's coach sees who wrote, from which school"
expect "$(as $OWNER_R1 "select college_inbox('$TEAM_R1')->0->>'player';")" "Maya" "and about which player"
expect "$(as $E "select college_inbox('$TEAM_R1') is null;")" "t" "people off the team can't read college messages"
as $OWNER_R1 "select college_inbox_read('$TEAM_R1');" >/dev/null
expect "$(as $OWNER_R1 "select college_inbox('$TEAM_R1')->0->>'new';")" "false" "messages are marked read"
q -c "update recruit_shares set listed = false where code = 'R1R1R1';" >/dev/null
expect "$(asall $D "select college_contact('R1R1R1', 'hi');" | grep -c "isn't listed")" "1" "nobody can write about a player who is no longer listed"
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
# team announcements: coaches post, signed-in followers read by the team page code, coaches see read counts
q -c "insert into season_shares values ('P3P3P3', 't3', 's1');" >/dev/null
PID=$(as $B "select post_send('t3', 'Practice moved to 4pm. Bring both jerseys.', true)->>'id';")
expect "${#PID}" "36" "a coach posts an announcement"
expect "$(asall $E "select post_send('t3', 'hi');" | grep -c "Only the team's coaches")" "1" "people who don't coach the team can't post"
expect "$(asall $B "select post_send('t3', '   ');" | grep -c 'Write a message first')" "1" "empty announcements are refused"
expect "$(q -c "set role anon; select posts_by_code('P3P3P3');" 2>&1 | grep -c 'permission denied')" "1" "announcements need an account"
expect "$(as $D "select posts_by_code('p3p3p3')->0->>'new';")" "true" "a follower reads it by the team code, marked new the first time"
expect "$(as $D "select posts_by_code('P3P3P3')->0->>'new';")" "false" "and not new the second time"
expect "$(as $B "select posts_for_team('t3')->0->>'reads';")" "1" "the coach sees how many have read it"
expect "$(as $E "select posts_for_team('t3') is null;")" "t" "people off the team can't list its announcements with read counts"
expect "$(asall $E "select post_update('$PID', null, true);" | grep -c "Only the team's coaches")" "1" "only coaches delete announcements"
as $B "select post_update('$PID', null, true);" >/dev/null
expect "$(as $D "select jsonb_array_length(posts_by_code('P3P3P3'));")" "0" "a deleted announcement is gone"
expect "$(q -c "insert into push_sent values ('$PID', 'post', 't3') returning kind;" | head -1)" "post" "announcements can be pushed once each"
# availability: followers answer for a scheduled match; counts for everyone signed in, names for the team's coaches only
as $D "select rsvp_set('p3p3p3', 'sc1', 'yes');" >/dev/null
as $E "select rsvp_set('P3P3P3', 'sc1', 'maybe');" >/dev/null
expect "$(as $D "select rsvps_by_code('P3P3P3')->'sc1'->>'yes';")" "1" "a follower's answer is counted"
expect "$(as $D "select rsvps_by_code('P3P3P3')->'sc1'->>'mine';")" "yes" "and comes back as her own answer"
expect "$(as $E "select rsvps_by_code('P3P3P3')->'sc1'->>'mine';")" "maybe" "another follower sees only their own answer"
as $D "select rsvp_set('P3P3P3', 'sc1', 'no');" >/dev/null
expect "$(as $D "select (rsvps_by_code('P3P3P3')->'sc1'->>'yes') || (rsvps_by_code('P3P3P3')->'sc1'->>'no');")" "01" "changing an answer replaces it"
expect "$(asall $D "select rsvp_set('P3P3P3', 'sc1', 'later');" | grep -c 'Choose going')" "1" "only going, can't go or maybe are accepted"
expect "$(q -c "set role anon; select rsvps_by_code('P3P3P3');" 2>&1 | grep -c 'permission denied')" "1" "availability needs an account"
expect "$(as $B "select jsonb_array_length(rsvps_for_team('t3'));")" "2" "the coach sees who answered"
expect "$(as $E "select rsvps_for_team('t3') is null;")" "t" "people off the team can't see names"
as $E "select rsvp_set('P3P3P3', 'sc1', 'no', 'p7');" >/dev/null
expect "$(as $B "select rsvps_for_team('t3')->>0 is not null and exists (select 1 from jsonb_array_elements(rsvps_for_team('t3')) x where x->>'player' = 'p7' and x->>'status' = 'no');")" "t" "an answer can say which player it is for"
as $D "select rsvp_set('P3P3P3', 'sc1', '');" >/dev/null
expect "$(as $B "select jsonb_array_length(rsvps_for_team('t3'));")" "1" "an answer can be taken back"
# tryouts: the head coach shares a code; evaluators rate; only the head coach sees everyone's ratings
TC=$(as $B "select tryout_publish(null, '{\"name\":\"16U\",\"candidates\":[]}');")
expect "${#TC}" "6" "a tryout gets a six-letter code"
expect "$(as $D "select tryout_open(lower('$TC'))->'data'->>'name';")" "16U" "an evaluator opens it by code"
as $D "select tryout_rate('$TC', 'Pat', '{\"c1\":{\"Serve\":4}}');" >/dev/null
as $E "select tryout_rate('$TC', 'Sam', '{\"c1\":{\"Serve\":2}}');" >/dev/null
expect "$(as $D "select tryout_open('$TC')->'mine'->'c1'->>'Serve';")" "4" "evaluators get their own ratings back"
expect "$(as $D "select tryout_all('$TC') is null;")" "t" "evaluators can't see each other's ratings"
expect "$(as $B "select jsonb_array_length(tryout_all('$TC'));")" "2" "the head coach sees everyone's"
expect "$(asall $D "select tryout_publish('$TC', '{}');" | grep -c "isn't yours")" "1" "only the head coach updates the players"
expect "$(q -c "set role anon; select tryout_open('$TC');" 2>&1 | grep -c 'permission denied')" "1" "rating needs an account"
as $B "select tryout_unshare('$TC');" >/dev/null
expect "$(as $D "select tryout_open('$TC') is null;")" "t" "unsharing ends it for evaluators"
# upcoming practices reach the team page: date, time and title only
q -c "insert into records (store, id, team_id, data, u) values ('plans', 'pl1', 't3', '{\"id\":\"pl1\",\"teamId\":\"t3\",\"date\":\"2099-01-05\",\"start\":\"18:00\",\"title\":\"Serve receive\",\"status\":\"planned\",\"blocks\":[{\"drill\":\"secret\"}]}', 1);" >/dev/null
expect "$(q -c "set role anon; select season_view('P3P3P3')->'practices'->0->>'title';")" "Serve receive" "upcoming practices are on the team page"
expect "$(q -c "set role anon; select (season_view('P3P3P3')->'practices'->0) ? 'blocks';")" "f" "but not the drills"
expect "$(q -c "set role anon; select season_view('P3P3P3')->'practices'->0->'plan' = 'null'::jsonb;")" "t" "the plan stays private unless the coach shows it"
q -c "update records set data = data || '{\"share\":true,\"blocks\":[{\"title\":\"Serve receive\",\"minutes\":20,\"notes\":\"secret\"}]}' where id = 'pl1';" >/dev/null
expect "$(q -c "set role anon; select season_view('P3P3P3')->'practices'->0->'plan'->0->>'title';")" "Serve receive" "a shown plan lists its blocks"
expect "$(q -c "set role anon; select (season_view('P3P3P3')->'practices'->0->'plan'->0) ? 'notes';")" "f" "without the coach's notes"
# volunteer jobs: families sign up for a match's jobs; counts for followers, names for the team's coaches
as $D "select job_take('p3p3p3', 'sc1', 'line', true);" >/dev/null
as $E "select job_take('P3P3P3', 'sc1', 'line', true);" >/dev/null
as $E "select job_take('P3P3P3', 'sc1', 'line', true);" >/dev/null
expect "$(as $D "select jobs_by_code('P3P3P3')->'sc1/line'->>'n';")" "2" "sign-ups are counted once per person"
expect "$(as $D "select jobs_by_code('P3P3P3')->'sc1/line'->>'mine';")" "true" "and you see that you signed up"
expect "$(as $B "select jobs_for_team('t3')->0->>'job';")" "line" "the coach sees who signed up for what"
expect "$(as $E "select jobs_for_team('t3') is null;")" "t" "people off the team can't see the names"
as $D "select job_take('P3P3P3', 'sc1', 'line', false);" >/dev/null
expect "$(as $E "select jobs_by_code('P3P3P3')->'sc1/line'->>'n';")" "1" "a volunteer can drop out"
expect "$(q -c "set role anon; select jobs_by_code('P3P3P3');" 2>&1 | grep -c 'permission denied')" "1" "volunteering needs an account"
# team playbook: coaches share plays; signed-in followers read them by the team page code
as $B "select plays_publish('t3', '[{\"id\":\"pl1\",\"name\":\"Slide vs Central\"}]');" >/dev/null
expect "$(as $D "select plays_by_code('p3p3p3')->0->>'name';")" "Slide vs Central" "a follower sees the plays the coaches shared"
expect "$(asall $E "select plays_publish('t3', '[]');" | grep -c "Only the team's coaches")" "1" "only coaches share plays"
expect "$(q -c "set role anon; select plays_by_code('P3P3P3');" 2>&1 | grep -c 'permission denied')" "1" "the playbook needs an account"
as $B "select plays_publish('t3', '[]');" >/dev/null
expect "$(as $D "select jsonb_array_length(plays_by_code('P3P3P3'));")" "0" "sharing nothing takes the plays down"
# beach: a match shared live by link; anyone can watch, only the owner updates or stops it
BC=$(as $B "select beach_publish(null, 'packed-match-1');")
expect "${#BC}" "7" "a signed-in scorer gets a link code for a beach match"
expect "$(q -c "set role anon; select beach_view(lower('$BC'))->>'data';")" "packed-match-1" "anyone with the link can watch, no account"
as $B "select beach_publish('$BC', 'packed-match-2');" >/dev/null
expect "$(q -c "set role anon; select beach_view('$BC')->>'data';")" "packed-match-2" "the owner's updates show up"
expect "$(asall $E "select beach_publish('$BC', 'hijack');" | grep -c "isn't yours")" "1" "nobody else can update it"
expect "$(q -c "set role anon; select beach_publish(null, 'x');" 2>&1 | grep -c 'permission denied')" "1" "sharing needs an account"
as $E "select beach_unshare('$BC');" >/dev/null
expect "$(q -c "set role anon; select beach_view('$BC') is not null;")" "t" "nobody else can take it down"
as $B "select beach_unshare('$BC');" >/dev/null
expect "$(q -c "set role anon; select beach_view('$BC') is null;")" "t" "the owner can stop sharing"
# ---------- FloorCall Lessons: T trains, P is an athlete's parent, B is a stranger ----------
T=eeeeeeee-1111-2222-3333-444444444444; P=dddddddd-1111-2222-3333-444444444444
q -c "insert into auth.users values ('$T', 'trainer@example.com'), ('$P', 'parent@example.com'); insert into coach_verify (user_id, name, status) values ('$T', 'Tess Trainer', 'approved');" >/dev/null
expect "$(q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$B', false); select lesson_save_athlete('{\"id\":\"la1\",\"name\":\"Nope\"}');" 2>&1 | grep -c Verify)" "1" "only verified coaches can train athletes"
asall $T "select lesson_save_athlete('{\"id\":\"la1\",\"name\":\"Mia Torres\",\"grad\":\"2028\",\"notes\":\"secret trainer note\"}');" | grep ERROR || true
asall $T "select lesson_save_athlete('{\"id\":\"la2\",\"name\":\"Other Kid\"}');" | grep ERROR || true
asall $T "select lesson_save_session('{\"id\":\"ls1\",\"starts\":\"2030-01-05T17:00:00Z\",\"kind\":\"group\",\"athletes\":[\"la1\",\"la2\",\"nobody\"],\"focus\":[\"passing\"],\"notes\":\"private plan\",\"shared_note\":\"bring kneepads\",\"capacity\":3}');" | grep ERROR || true
expect "$(asall $T "select cardinality(athletes) from lesson_sessions where id = 'ls1';" | grep -c 'permission denied')" "1" "nobody reads lesson tables directly"
expect "$(as $T "select jsonb_array_length(lesson_trainer_data()->'sessions[0]'->'athletes') is null, (lesson_trainer_data()->'sessions'->0->'athletes')::text;")" "t|[\"la1\", \"la2\"]" "a session keeps only the trainer's own athletes"
expect "$(asall $B "select lesson_save_roster('ls1', 'la1', '{}', true, true);" | grep -c 'Not your')" "1" "strangers can't stat someone else's session"
asall $T "select lesson_save_roster('ls1', 'la1', '{\"passing\":{\"3\":4,\"2\":1}}', true, true);" | grep ERROR || true
CODE="$(as $T "select lesson_invite('la1');")"
expect "$(asall $B "select lesson_invite('la1');" | grep -c 'Not your')" "1" "only the trainer makes invite codes"
expect "$(as $P "select lesson_join('$CODE', 'parent');")" "Mia Torres" "a parent joins with the athlete's code"
expect "$(as $P "select my_lessons()::text ~ '(secret trainer note|private plan|Other Kid|la2)';")" "f" "a parent never sees private notes or the other athletes"
expect "$(as $P "select my_lessons()->'sessions'->0->>'shared_note';")" "bring kneepads" "but does see the shared note"
expect "$(as $P "select my_lessons()->'roster'->0->'reps'->'passing'->>'3';")" "4" "and their athlete's numbers"
expect "$(as $B "select jsonb_array_length(my_lessons()->'sessions');")" "0" "strangers see no sessions"
asall $T "select lesson_save_session('{\"id\":\"ls2\",\"starts\":\"2030-01-06T17:00:00Z\",\"kind\":\"private\",\"open\":true,\"capacity\":1}');" | grep ERROR || true
expect "$(as $P "select my_lessons()->'sessions'->1->>'open';")" "true" "the parent sees the trainer's open slot"
asall $P "select lesson_book('ls2', 'la1');" | grep ERROR || true
expect "$(as $T "select (lesson_trainer_data()->'sessions'->1->'athletes')::text;")" "[\"la1\"]" "and books it"
expect "$(asall $B "select lesson_book('ls2', 'la1');" | grep -c 'Not your')" "1" "strangers can't book for someone else's athlete"
asall $T "select lesson_save_session('{\"id\":\"ls3\",\"starts\":\"2030-02-01T17:00:00Z\",\"kind\":\"clinic\",\"title\":\"Serve clinic\",\"public\":true,\"capacity\":2,\"notes\":\"private plan\"}');" | grep ERROR || true
CC="$(as $T "select lesson_trainer_data()->'sessions'->2->>'code';")"
expect "$(q -c "set role anon; select lesson_public('$CC')->>'title';")" "Serve clinic" "anyone with the link sees a public clinic"
expect "$(q -c "set role anon; select lesson_public('$CC')::text like '%private%';")" "f" "without the trainer's notes"
expect "$(q -c "set role anon; select lesson_public('$CODE') is null;" 2>&1 | tail -1)" "t" "an athlete code isn't a clinic page"
q -c "set role anon; select lesson_signup('$CC', 'Ava Kim', 'ava.mom@example.com');" >/dev/null
q -c "set role anon; select lesson_signup('$CC', 'Bea Lo', 'bea.dad@example.com');" >/dev/null
expect "$(q -c "set role anon; select lesson_signup('$CC', 'Cal Ng', 'cal@example.com');" 2>&1 | grep -c 'full')" "1" "a full clinic turns sign-ups away"
RQ="$(as $T "select lesson_trainer_data()->'requests'->0->>'id';")"
expect "$(asall $B "select lesson_request_decide('$RQ', true);" | grep -c 'Not your')" "1" "only the trainer takes sign-ups"
asall $T "select lesson_request_decide('$RQ', true);" | grep ERROR || true
expect "$(as $T "select cardinality(array(select jsonb_array_elements_text(lesson_trainer_data()->'sessions'->2->'athletes')));")" "1" "a taken sign-up is booked into the clinic"
asall $T "select lesson_save_session('{\"id\":\"ls4\",\"starts\":\"2030-02-02T17:00:00Z\",\"kind\":\"clinic\",\"title\":\"Private clinic\",\"capacity\":10}');" | grep ERROR || true
expect "$(as $T "select lesson_trainer_data()->'sessions'->3->>'code' is null;")" "t" "a private clinic has no public page"
# ---------- version 32: contact form, redeem any code ----------
q -c "set role anon; select support_send('Pat', 'pat@example.com', 'bug', 'The score froze in set 2', 'app');" >/dev/null
expect "$(q -c "set role anon; select support_send('Pat', 'not-an-email', 'bug', 'hello there', 'app');" 2>&1 | grep -c 'email address')" "1" "the contact form needs a reply address"
q -c "set role anon; select support_send('Bot', 'bot@example.com', 'bug', 'buy now', 'app', 'filled');" >/dev/null
expect "$(q -c "select count(*) from support_messages;")" "1" "a filled-in trap field is dropped quietly"
for i in 1 2 3 4; do q -c "set role anon; select support_send('Pat', 'pat@example.com', 'bug', 'again $i', 'app');" >/dev/null; done
expect "$(q -c "set role anon; select support_send('Pat', 'pat@example.com', 'bug', 'sixth one', 'app');" 2>&1 | grep -c 'Too many')" "1" "one address can't flood the inbox"
expect "$(q -c "set role anon; select count(*) from support_messages;" 2>&1 | grep -c 'permission denied')" "1" "nobody reads messages directly"
expect "$(asall $B "select admin_support();" | grep -c 'Admins only')" "1" "only admins read messages"
expect "$(asall $P "select redeem_code('$CODE')->>'kind';" | grep -c lessons)" "1" "a lessons code works in the one code box"
expect "$(asall $P "select redeem_code('NOPE99');" | grep -c "doesn't match")" "1" "a wrong code says so"
expect "$(asall $P "select jsonb_array_length(my_coverage()->'lessons');" | tail -1)" "1" "coverage lists the lessons someone joined"
# ---------- version 33: badges and drill picks ----------
TM=ffffffff-1111-2222-3333-444444444444; q -c "insert into auth.users values ('$TM', 'teamowner@example.com'); insert into coach_verify (user_id, name, status) values ('$TM', 'Owner', 'approved');" >/dev/null
asall $TM "insert into teams_cloud (id, name) values ('tb1', 'Badge Team');" >/dev/null
q -c "insert into members (team_id, user_id, role, status) values ('tb1', '$P', 'viewer', 'active'), ('tb1', '$B', 'coach', 'active') on conflict do nothing;" >/dev/null
expect "$(asall $TM "select (select b->>'badge' from jsonb_array_elements(team_badges('tb1')) b where b->>'user_id' = '$TM');" | tail -1)" "verified" "the verified head coach shows as verified"
expect "$(asall $TM "select (select b->>'badge' from jsonb_array_elements(team_badges('tb1')) b where b->>'user_id' = '$B');" | tail -1)" "assistant" "an approved assistant shows as approved by the head coach"
expect "$(asall $T "select team_badges('tb1')::text;" | tail -1)" "[]" "people off the team see no badges"
asall $TM "select team_pick_drill('tb1', 'passing-1', true, 'Do 10 a day');" | grep ERROR || true
expect "$(asall $P "select team_pick_drill('tb1', 'serving-1', true);" | grep -c "Only the team")" "1" "players can't pick drills"
expect "$(asall $P "select my_drill_picks()->0->>'drill';" | tail -1)" "passing-1" "a player sees the drills their coach picked"
expect "$(asall $T "select jsonb_array_length(team_drill_list('tb1'));" | tail -1)" "0" "people off the team don't"
# ---------- version 34: notes from coaches (one way) ----------
q -c "insert into members (team_id, user_id, role, status) values ('tb1', '$T', 'viewer', 'active') on conflict do nothing;" >/dev/null
N1=$(asall $TM "select team_note_save('tb1', null, 'practice', 'Tuesday practice', null, 'Serve receive', 'Great energy. Passers: hips low.', 'team', '{}');" | tail -1 | tr -d ' ')
expect "$(asall $P "select my_notes()->0->>'title';" | tail -1)" "Serve receive" "a player reads her team's note"
expect "$(asall $P "select team_note_save('tb1', null, 'general', null, null, null, 'hi', 'team', '{}');" | grep -c "Only the team")" "1" "players can't write notes"
expect "$(asall $TM "select team_note_save('tb1', null, 'general', null, null, null, '   ', 'team', '{}');" | grep -c "Write the note")" "1" "an empty note is refused"
asall $TM "select team_note_save('tb1', null, 'game', 'vs Central', 'm1', 'Hitters', 'Swing high line in rotation 3.', 'players', '{p7,p9}', 'Outsides');" | grep ERROR || true
expect "$(asall $P "select count(*) from jsonb_array_elements(my_notes()) x where x->>'title' = 'Hitters';" | tail -1)" "0" "a note for chosen players isn't seen by an account the coach hasn't linked"
expect "$(asall $P "select team_link_member('tb1', '$P', '{p7}');" | grep -c "Only the team")" "1" "players can't link themselves to a player"
asall $TM "select team_link_member('tb1', '$P', '{p7}');" | grep ERROR || true
expect "$(asall $P "select count(*) from jsonb_array_elements(my_notes()) x where x->>'title' = 'Hitters';" | tail -1)" "1" "once linked, the player (or parent) reads notes for her"
expect "$(asall $P "select (select x->'players' from jsonb_array_elements(team_notes_list('tb1')) x where x->>'title' = 'Hitters')::text;" | tail -1)" '["p7"]' "she sees only her own name on a group note"
expect "$(asall $T "select count(*) from jsonb_array_elements(my_notes()) x where x->>'title' = 'Hitters';" | tail -1)" "0" "another family on the team doesn't"
expect "$(asall $T "select count(*) from jsonb_array_elements(my_notes()) x where x->>'title' = 'Serve receive';" | tail -1)" "1" "but does read team-wide notes"
expect "$(asall $E "select jsonb_array_length(team_notes_list('tb1'));" | tail -1)" "0" "people off the team read nothing"
asall $P "select note_read('$N1');" | grep ERROR || true
expect "$(asall $TM "select (select x->>'reads' from jsonb_array_elements(team_notes_list('tb1')) x where x->>'id' = '$N1');" | tail -1)" "1" "coaches see how many have read a note"
asall $TM "select team_note_save('tb1', '$N1', 'practice', 'Tuesday practice', null, 'Serve receive', 'Updated: hips low, eyes up.', 'team', '{}');" | grep ERROR || true
expect "$(asall $P "select (select x->>'read' from jsonb_array_elements(my_notes()) x where x->>'id' = '$N1');" | tail -1)" "false" "an edited note shows as new again"
expect "$(asall $P "select team_note_delete('tb1', '$N1');" | grep -c "Only the team")" "1" "players can't delete notes"
asall $TM "select team_note_delete('tb1', '$N1');" | grep ERROR || true
expect "$(asall $P "select count(*) from jsonb_array_elements(my_notes()) x where x->>'id' = '$N1';" | tail -1)" "0" "a deleted note is gone for everyone"
expect "$(asall $TM "select jsonb_array_length(team_member_links('tb1'));" | tail -1)" "2" "coaches list the player and parent accounts to link"
# ---------- version 35: AI limits per account ----------
ADM=cccccccc-cccc-cccc-cccc-cccccccccccc
expect "$(asall $TM "select my_ai()->>'own_key';" | tail -1)" "false" "a coach can't use their own key until an admin allows it"
expect "$(asall $TM "select admin_ai_grant('teamowner@example.com', 200, true);" | grep -c 'Admins only')" "1" "only admins change AI access"
asall $ADM "select admin_ai_grant('teamowner@example.com', 200, true, 'asked by email');" | grep ERROR || true
expect "$(asall $TM "select my_ai()->>'limit';" | tail -1)" "200" "an admin raises one account's daily AI limit"
expect "$(asall $TM "select my_ai()->>'own_key';" | tail -1)" "true" "and lets it use its own key"
expect "$(q -c "select ai_limit_for('$TM');" | tail -1 | tr -d ' ')" "200" "the ai function reads the account's limit"
expect "$(q -c "select has_function_privilege('authenticated', 'public.ai_limit_for(uuid)', 'execute');" | tail -1 | tr -d ' ')" "f" "nobody signed in can read another account's AI limit"
expect "$(q -c "select has_function_privilege('authenticated', 'public.error_digest(int)', 'execute');" | tail -1 | tr -d ' ')" "f" "the error digest is server-only"
asall $ADM "select admin_ai_grant('teamowner@example.com', null, false);" | grep ERROR || true
expect "$(q -c "select ai_limit_for('$TM');" | tail -1 | tr -d ' ')" "-1" "reset back to the default"
q -c "insert into app_errors (at, message) values (now() - interval '100 days', 'old crash'), (now(), 'new crash');" >/dev/null
q -c "select ops_cleanup();" >/dev/null
expect "$(q -c "select count(*) from app_errors where message in ('old crash', 'new crash');" | tail -1 | tr -d ' ')" "1" "crash reports older than 90 days are deleted"
# ---------- security invariants: these hold for every table and function, including ones added later ----------
expect "$(q -c "select coalesce(string_agg(relname, ','), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;")" "" "every table has row level security"
expect "$(q -c "select coalesce(string_agg(proname, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosecdef and (proconfig is null or not exists (select 1 from unnest(proconfig) x where x like 'search_path=%'));")" "" "every security definer function pins its search_path"
expect "$(q -c "select string_agg(proname, ',' order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');")" "beach_view,lesson_public,lesson_signup,recruit_board,recruit_seen,recruit_view,schema_version,season_view,server_time,support_send,watch" "without an account only the public page functions run"
expect "$(q -c "select coalesce(string_agg(table_name || ':' || privilege_type, ','), '') from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';")" "app_errors:INSERT" "without an account no table can be read or changed"
expect "$(q -c "select has_function_privilege('authenticated', 'public.ai_bump(uuid)', 'execute');")" "f" "the AI counter is server-only"
expect "$(q -c "set role anon; select count(*) from records;" 2>&1 | grep -c 'permission denied')" "1" "anon can't read team data directly"
expect "$(q -c "set role anon; select admin_overview();" 2>&1 | grep -c 'permission denied')" "1" "anon can't call admin functions"
expect "$(q -c "set role authenticated; select set_config('request.jwt.claim.sub', '$E', false); select admin_overview();" 2>&1 | grep -c 'Admins only')" "1" "signed-in non-admins are turned away by admin functions"
# deleting an account takes every row that points at it
G=99999999-9999-9999-9999-999999999999
q -c "insert into auth.users (id, email) values ('$G', 'leaving@example.com');
  insert into team_rsvps (team_id, item_id, user_id, name, status) values ('t1', 'm1', '$G', 'Leaving L', 'yes');
  insert into team_signups (team_id, item_id, job_id, user_id, name) values ('t1', 'm1', 'j1', '$G', 'Leaving L');
  insert into push_subs (endpoint, team_id, p256dh, auth, user_id) values ('https://push.example/leaving', 't1', 'k', 'a', '$G');
  insert into tryouts_cloud (code, owner, data) values ('LEAVE1', '$G', '{}');
  insert into tryout_ratings (code, evaluator, name, ratings) values ('LEAVE1', '$G', 'Leaving L', '{}');
  insert into beach_shares (code, owner, data) values ('LEAVE2', '$G', 'x');
  insert into team_posts (team_id, body, author) values ('t1', 'kept for the team', '$G');" > /dev/null
as $G "select delete_my_account();" > /dev/null
expect "$(q -c "select (select count(*) from team_rsvps where user_id = '$G') + (select count(*) from team_signups where user_id = '$G') + (select count(*) from push_subs where user_id = '$G') + (select count(*) from tryouts_cloud where owner = '$G') + (select count(*) from tryout_ratings where evaluator = '$G') + (select count(*) from beach_shares where owner = '$G') + (select count(*) from auth.users where id = '$G');")" "0" "deleting an account removes its answers, sign-ups, tryouts, shares and subscriptions"
expect "$(q -c "select count(*) from team_posts where body = 'kept for the team' and author is null;")" "1" "the team keeps announcements, without the author's account"
# guessing codes: 20 different wrong codes from one network, then even a right code waits; other networks are unaffected
H1="select set_config('request.headers', '{\"x-forwarded-for\": \"203.0.113.9, 10.0.0.1\"}', false);"
H2="select set_config('request.headers', '{\"cf-connecting-ip\": \"198.51.100.4\"}', false);"
GOOD="$(q -c "select code from season_shares limit 1;")"
q -c "set role anon; $H1 select season_view('NOPE' || g) from generate_series(1, 19) g;" > /dev/null
expect "$(q -c "set role anon; $H1 select season_view('NOPE1') is null; select count(*) >= 0 from (select season_view('NOPE1')) x;" | tail -1)" "t" "the same wrong code again doesn't count twice"
expect "$(q -c "set role anon; $H1 select (season_view('$GOOD'))->'team' is not null;" | tail -1)" "t" "19 different misses still lets the right code in"
q -c "set role anon; $H1 select watch('NOPE20');" > /dev/null
expect "$(q -c "set role anon; $H1 select season_view('$GOOD');" 2>&1 | grep -c 'Too many codes')" "1" "after 20 different wrong codes the network waits"
expect "$(q -c "set role anon; $H1 select beach_view('ZZZZ');" 2>&1 | grep -c 'Too many codes')" "1" "the wait covers every kind of code"
expect "$(q -c "set role anon; $H2 select (season_view('$GOOD'))->'team' is not null;" | tail -1)" "t" "another network is unaffected"
expect "$(q -c "select count(*) from code_misses where code ~ 'NOPE';")" "0" "only hashes of the codes are kept"
expect "$(q -c "set role anon; select count(*) from code_misses;" 2>&1 | grep -c 'permission denied')" "1" "nobody reads the miss list"
expect "$(as $E "select code_miss('x');" 2>&1 | grep -c 'permission denied')" "1" "and nobody adds to it by hand"
q -c "delete from code_misses;"
echo "schema OK"

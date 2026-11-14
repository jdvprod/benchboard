-- Floorcall cloud schema for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Model: the app is local-first. Every record (team, player, match, event log, plan...) is stored as JSON
-- in one `records` table, scoped to a team. Coaches who are members of a team can read and write its records.
-- Parents follow a match through a share code with the `watch` function; they never see anything else.

create table if not exists public.teams_cloud (
  id text primary key,
  name text not null default '',
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  team_id text not null references public.teams_cloud(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'coach',            -- owner | coach | viewer
  email text,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.records (
  store text not null,                            -- teams, players, matches, logs, ...
  id text not null,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  data jsonb,
  u bigint not null default 0,                    -- the editing device's timestamp (ms), for last-write-wins
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),  -- server time, used for incremental pulls
  primary key (store, id)
);
create index if not exists records_team_updated on public.records (team_id, updated_at);

create table if not exists public.invites (
  code text primary key,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  role text not null default 'coach',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.live_shares (
  code text primary key,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  match_id text not null,
  created_at timestamptz not null default now()
);

-- membership check used by every rule (security definer so it can read members under RLS)
create or replace function public.is_member(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid());
$$;
create or replace function public.can_edit(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid() and role in ('owner', 'coach'));
$$;

-- the creator of a cloud team becomes its owner
create or replace function public.add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into members (team_id, user_id, role, email)
  values (new.id, new.owner, 'owner', (select email from auth.users where id = new.owner))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists teams_cloud_owner on public.teams_cloud;
create trigger teams_cloud_owner after insert on public.teams_cloud for each row execute function public.add_owner();

-- last write wins: an older edit never overwrites a newer one; server stamps updated_at
create or replace function public.records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.u < old.u then return old; end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records for each row execute function public.records_lww();

alter table public.teams_cloud enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;
alter table public.invites enable row level security;
alter table public.live_shares enable row level security;

drop policy if exists "teams read" on public.teams_cloud;
create policy "teams read" on public.teams_cloud for select using (is_member(id) or owner = auth.uid());
drop policy if exists "teams create" on public.teams_cloud;
create policy "teams create" on public.teams_cloud for insert with check (owner = auth.uid());
drop policy if exists "teams update" on public.teams_cloud;
create policy "teams update" on public.teams_cloud for update using (can_edit(id));
drop policy if exists "teams delete" on public.teams_cloud;
create policy "teams delete" on public.teams_cloud for delete using (owner = auth.uid());

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select using (is_member(team_id));
drop policy if exists "members leave or remove" on public.members;
create policy "members leave or remove" on public.members for delete using (
  user_id = auth.uid() or exists (select 1 from teams_cloud t where t.id = team_id and t.owner = auth.uid()));

drop policy if exists "records read" on public.records;
create policy "records read" on public.records for select using (is_member(team_id));
drop policy if exists "records insert" on public.records;
create policy "records insert" on public.records for insert with check (can_edit(team_id));
drop policy if exists "records update" on public.records;
create policy "records update" on public.records for update using (can_edit(team_id)) with check (can_edit(team_id));

drop policy if exists "invites read" on public.invites;
create policy "invites read" on public.invites for select using (is_member(team_id));
drop policy if exists "invites create" on public.invites;
create policy "invites create" on public.invites for insert with check (can_edit(team_id));
drop policy if exists "invites delete" on public.invites;
create policy "invites delete" on public.invites for delete using (can_edit(team_id));

drop policy if exists "shares read" on public.live_shares;
create policy "shares read" on public.live_shares for select using (is_member(team_id));
drop policy if exists "shares create" on public.live_shares;
create policy "shares create" on public.live_shares for insert with check (can_edit(team_id));
drop policy if exists "shares delete" on public.live_shares;
create policy "shares delete" on public.live_shares for delete using (can_edit(team_id));

-- join a team with an invite code
create or replace function public.join_team(invite text) returns text
language plpgsql security definer set search_path = public as $$
declare t text; r text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select team_id, role into t, r from invites where code = upper(trim(invite));
  if t is null then raise exception 'That code doesn''t match a team'; end if;
  insert into members (team_id, user_id, role, email)
  values (t, auth.uid(), r, (select email from auth.users where id = auth.uid()))
  on conflict (team_id, user_id) do nothing;
  return t;
end $$;
grant execute on function public.join_team(text) to authenticated;

-- public live view for parents: one match, the roster's names and numbers, nothing else
-- ---------- what public pages may show ----------
-- Plays only: film tags (TAG events) carry coaches' private notes, so they never leave the team.
create or replace function public.public_events(ev jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(coalesce(ev, '[]'::jsonb)) e where e->>'t' is distinct from 'TAG'
$$;
-- A picture link a public page may show: https only (pictures still embedded in a record stay private and heavy).
create or replace function public.public_url(u text) returns text
language sql immutable as $$ select case when u ~ '^https://' then left(u, 600) end $$;
-- A player on a public page: first name and last initial, or only the number when the family asked to keep them off public pages.
-- Photos only for players the family didn't keep off public pages, and only uploaded ones (never pictures embedded in the record).
create or replace function public.public_player(d jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', d->>'id', 'num', d->>'num', 'pos', d->>'pos',
    'first', case when coalesce((d->>'hidePublic')::boolean, false) then '' else coalesce(d->>'first', '') end,
    'last', case when coalesce((d->>'hidePublic')::boolean, false) then '' else left(coalesce(d->>'last', ''), 1) end,
    'photo', case when coalesce((d->>'hidePublic')::boolean, false) then null else public_url(d->>'photo') end)
$$;

create or replace function public.watch(share text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s live_shares; out jsonb;
begin
  select * into s from live_shares where code = upper(trim(share));
  if s.code is null then return null; end if;
  select jsonb_build_object(
    'team', (select jsonb_build_object('name', data->>'name', 'color', data->>'color', 'level', data->>'level', 'logo', public_url(data->>'logo')) from records where store = 'teams' and id = s.team_id and not deleted),
    -- only what the gamecast shows: never the coach's match notes, film link or scouting
    'match', (select jsonb_build_object('id', data->>'id', 'opp', data->>'opp', 'date', data->>'date', 'event', data->>'event', 'status', data->>'status', 'kind', data->>'kind',
                                        'bestOf', data->'bestOf', 'setTo', data->'setTo', 'cap', data->'cap', 'scrim', data->'scrim', 'oppLogo', public_url(data->>'oppLogo'), 'oppRoster', data->'oppRoster')
              from records where store = 'matches' and id = s.match_id and not deleted),
    'logs', coalesce((select jsonb_agg(public_events(data->'events')) from records where store = 'logs' and team_id = s.team_id and data->>'matchId' = s.match_id and not deleted), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(public_player(data)) from records where store = 'players' and team_id = s.team_id and not deleted), '[]'::jsonb),
    'at', now()
  ) into out;
  return out;
end $$;
grant execute on function public.watch(text) to anon, authenticated;

-- ---------- season hub: a public, read-only page for players and parents ----------
create table if not exists public.season_shares (
  code text primary key,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  season_id text not null,
  created_at timestamptz not null default now()
);
alter table public.season_shares enable row level security;
drop policy if exists "season shares read" on public.season_shares;
create policy "season shares read" on public.season_shares for select using (is_member(team_id));
drop policy if exists "season shares create" on public.season_shares;
create policy "season shares create" on public.season_shares for insert with check (can_edit(team_id));
drop policy if exists "season shares delete" on public.season_shares;
create policy "season shares delete" on public.season_shares for delete using (can_edit(team_id));

-- everything the season hub shows: results, schedule, every match's plays, roster with last initials only
create or replace function public.season_view(share text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s season_shares; out jsonb;
begin
  select * into s from season_shares where code = upper(trim(share));
  if s.code is null then return null; end if;
  select jsonb_build_object(
    'team', (select jsonb_build_object('name', data->>'name', 'level', data->>'level', 'color', data->>'color', 'logo', public_url(data->>'logo'), 'schedule', coalesce(data->'schedule', '[]'::jsonb), 'tournaments', coalesce(data->'tournaments', '[]'::jsonb)) from records where store = 'teams' and id = s.team_id and not deleted),
    'season', (select data->>'name' from records where store = 'seasons' and id = s.season_id and not deleted),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', data->>'id', 'opp', data->>'opp', 'date', data->>'date', 'bestOf', data->'bestOf', 'setTo', data->'setTo', 'cap', data->'cap', 'status', data->>'status', 'event', data->>'event', 'site', data->>'site', 'imported', case when data ? 'imported' then jsonb_build_object('season', data->'imported'->'season') end, 'tournamentId', data->>'tournamentId', 'oppLogo', public_url(data->>'oppLogo'), 'oppRoster', data->'oppRoster'))
                         from records where store = 'matches' and team_id = s.team_id and data->>'seasonId' = s.season_id and data->>'kind' = 'match' and not deleted), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('matchId', l.data->>'matchId', 'events', public_events(l.data->'events')))
                      from records l where l.store = 'logs' and l.team_id = s.team_id and not l.deleted
                      and exists (select 1 from records m where m.store = 'matches' and m.id = l.data->>'matchId' and m.data->>'seasonId' = s.season_id and m.data->>'kind' = 'match' and not m.deleted)), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(public_player(data))
                         from records where store = 'players' and team_id = s.team_id and not deleted and coalesce((data->>'active')::boolean, true)), '[]'::jsonb),
    -- gamecast links the coach shared for this team's matches, so the season page can send families to the live game
    'live', coalesce((select jsonb_agg(jsonb_build_object('matchId', match_id, 'code', code)) from live_shares where team_id = s.team_id), '[]'::jsonb),
    'at', now()
  ) into out;
  return out;
end $$;
grant execute on function public.season_view(text) to anon, authenticated;

-- ---------- AI usage: a daily counter per coach, used by the "ai" edge function ----------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage read own" on public.ai_usage;
create policy "ai usage read own" on public.ai_usage for select using (user_id = auth.uid());
-- called only by the edge function with the service role
create or replace function public.ai_bump(uid uuid) returns int
language sql security definer set search_path = public as $$
  insert into ai_usage (user_id, day, n) values (uid, current_date, 1)
  on conflict (user_id, day) do update set n = ai_usage.n + 1
  returning n;
$$;
revoke execute on function public.ai_bump(uuid) from public, anon, authenticated;

-- ---------- recruiting profile links: a snapshot page a coach shares with college coaches ----------
create table if not exists public.recruit_shares (
  code text primary key,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  player_id text not null,
  html text not null,
  updated_at timestamptz not null default now(),
  unique (team_id, player_id)
);
alter table public.recruit_shares enable row level security;
drop policy if exists "recruit read" on public.recruit_shares;
create policy "recruit read" on public.recruit_shares for select using (is_member(team_id));
drop policy if exists "recruit create" on public.recruit_shares;
create policy "recruit create" on public.recruit_shares for insert with check (can_edit(team_id));
drop policy if exists "recruit update" on public.recruit_shares;
create policy "recruit update" on public.recruit_shares for update using (can_edit(team_id));
drop policy if exists "recruit delete" on public.recruit_shares;
create policy "recruit delete" on public.recruit_shares for delete using (can_edit(team_id));
-- the profile as data (stats, game log, highlight clips) for Floorcall Recruit; html stays as the printable sheet
alter table public.recruit_shares add column if not exists data jsonb;
create or replace function public.recruit_view(share text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('html', html, 'data', data, 'updated_at', updated_at) from recruit_shares where code = upper(trim(share));
$$;
grant execute on function public.recruit_view(text) to anon, authenticated;
-- how often a profile is opened, so the family and coach know when colleges are looking (the page counts once per visit)
alter table public.recruit_shares add column if not exists views int not null default 0;
alter table public.recruit_shares add column if not exists last_viewed timestamptz;
create or replace function public.recruit_seen(share text) returns void
language sql volatile security definer set search_path = public as $$
  update recruit_shares set views = views + 1, last_viewed = now() where code = upper(trim(share));
$$;
grant execute on function public.recruit_seen(text) to anon, authenticated;

-- ---------- team recruiting board: one link listing every player whose family agreed to share a profile ----------
create table if not exists public.recruit_boards (
  code text primary key,
  team_id text not null unique references public.teams_cloud(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.recruit_boards enable row level security;
drop policy if exists "boards read" on public.recruit_boards;
create policy "boards read" on public.recruit_boards for select using (is_member(team_id));
drop policy if exists "boards create" on public.recruit_boards;
create policy "boards create" on public.recruit_boards for insert with check (can_edit(team_id));
drop policy if exists "boards delete" on public.recruit_boards;
create policy "boards delete" on public.recruit_boards for delete using (can_edit(team_id));
-- only players who already have a shared profile (which needs the family's consent) appear
create or replace function public.recruit_board(share text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b recruit_boards; out jsonb;
begin
  select * into b from recruit_boards where code = upper(trim(share));
  if b.code is null then return null; end if;
  select jsonb_build_object(
    'team', (select jsonb_build_object('name', data->>'name', 'level', data->>'level') from records where store = 'teams' and id = b.team_id and not deleted),
    'players', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'updated_at', r.updated_at, 'player', r.data->'player', 'profile', jsonb_build_object('club', r.data->'profile'->'club', 'video', r.data->'profile'->'video'), 'season', r.data->'season', 'clips', jsonb_array_length(coalesce(r.data->'clips', '[]'::jsonb))))
                         from recruit_shares r where r.team_id = b.team_id and r.data is not null), '[]'::jsonb)
  ) into out;
  return out;
end $$;
grant execute on function public.recruit_board(text) to anon, authenticated;

-- ---------- schema version: the app's Settings → Setup check compares this with what it expects ----------
-- ---------- match notifications for families (Floorcall Live), used only by the "notify" edge function ----------
create table if not exists public.push_subs (
  endpoint text primary key,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  starts boolean not null default true,
  finals boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.push_subs add column if not exists player text;  -- a player the family follows: their line goes on top of the final
alter table public.push_subs enable row level security; -- no policies: only the notify function (service role) touches it
create table if not exists public.push_sent (
  match_id text not null,
  kind text not null check (kind in ('start', 'final')),
  team_id text not null references public.teams_cloud(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (match_id, kind)
);
alter table public.push_sent enable row level security;

-- ---------- pictures: player photos and team logos (Supabase Storage, public bucket "media") ----------
-- Files live at media/<team id>/...; anyone can view them (they appear on public pages), only a team's coaches can add or change them.
-- Skipped where Storage isn't installed (plain Postgres in the tests).
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('media', 'media', true, 400000, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = true, file_size_limit = 400000, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
    -- uploads replace a file at the same path (upsert), which Storage only allows with read access too
    drop policy if exists "media read" on storage.objects;
    create policy "media read" on storage.objects for select using (bucket_id = 'media');
    drop policy if exists "media add" on storage.objects;
    create policy "media add" on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.can_edit((storage.foldername(name))[1]));
    drop policy if exists "media change" on storage.objects;
    create policy "media change" on storage.objects for update to authenticated using (bucket_id = 'media' and public.can_edit((storage.foldername(name))[1]));
    drop policy if exists "media remove" on storage.objects;
    create policy "media remove" on storage.objects for delete to authenticated using (bucket_id = 'media' and public.can_edit((storage.foldername(name))[1]));
    -- film sessions (version 16): short clips a coach shares with the team, at film/<team id>/<session>/<n>.webm
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('film', 'film', true, 20000000, array['video/webm', 'video/mp4'])
      on conflict (id) do update set public = true, file_size_limit = 20000000, allowed_mime_types = array['video/webm', 'video/mp4'];
    drop policy if exists "film read" on storage.objects;
    create policy "film read" on storage.objects for select using (bucket_id = 'film');
    drop policy if exists "film add" on storage.objects;
    create policy "film add" on storage.objects for insert to authenticated with check (bucket_id = 'film' and public.can_edit((storage.foldername(name))[1]));
    drop policy if exists "film change" on storage.objects;
    create policy "film change" on storage.objects for update to authenticated using (bucket_id = 'film' and public.can_edit((storage.foldername(name))[1]));
    drop policy if exists "film remove" on storage.objects;
    create policy "film remove" on storage.objects for delete to authenticated using (bucket_id = 'film' and public.can_edit((storage.foldername(name))[1]));
  end if;
end $do$;

-- ---------- admin console (the people who run Floorcall) ----------
-- Add yourself once, in the SQL Editor:  insert into public.admins select id from auth.users where email = 'you@example.com';
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade, added_at timestamptz not null default now());
alter table public.admins enable row level security;   -- no policies: only these functions read it
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;
grant execute on function public.is_admin() to authenticated;

-- Crash reports from the app: the error, version and screen only (never team data). Anyone can send one; only admins read them.
create table if not exists public.app_errors (
  id bigserial primary key, at timestamptz not null default now(), uid uuid default auth.uid(),
  version text, message text not null, stack text, page text, agent text
);
alter table public.app_errors enable row level security;
drop policy if exists "errors send" on public.app_errors;
create policy "errors send" on public.app_errors for insert to anon, authenticated
  with check (length(message) <= 300 and length(coalesce(stack, '')) <= 2000 and length(coalesce(page, '')) <= 80 and length(coalesce(agent, '')) <= 200 and length(coalesce(version, '')) <= 20);
grant insert on public.app_errors to anon, authenticated;
grant usage on sequence public.app_errors_id_seq to anon, authenticated;
create index if not exists app_errors_at on public.app_errors (at);

-- How Floorcall is doing: accounts, teams, matches, what's live now, and the most active teams.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare out jsonb;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'users7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'teams', (select count(*) from teams_cloud),
    'activeTeams7', (select count(distinct team_id) from records where updated_at > now() - interval '7 days'),
    'matches', (select count(*) from records where store = 'matches' and not deleted and data->>'kind' = 'match'),
    'matches7', (select count(*) from records where store = 'matches' and not deleted and data->>'kind' = 'match' and updated_at > now() - interval '7 days'),
    'liveNow', (select count(*) from records where store = 'matches' and not deleted and data->>'status' = 'live' and updated_at > now() - interval '3 hours'),
    'teamPages', (select count(*) from season_shares), 'gamecasts', (select count(*) from live_shares), 'recruitProfiles', (select count(*) from recruit_shares),
    'notifyPhones', (select count(*) from push_subs),
    'errors', coalesce((select jsonb_agg(e order by e->>'last' desc) from (
      select jsonb_build_object('message', message, 'count', count(*), 'users', count(distinct uid), 'last', max(at), 'version', max(version), 'page', max(page), 'stack', max(stack)) e
      from app_errors where at > now() - interval '14 days' group by message order by max(at) desc limit 20) q), '[]'::jsonb),
    'recentUsers', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'at', created_at) order by created_at desc) from (select email, created_at from auth.users order by created_at desc limit 12) u), '[]'::jsonb),
    'teamsList', coalesce((select jsonb_agg(x order by x->>'last' desc) from (
      select jsonb_build_object('id', t.id, 'name', t.name, 'members', (select count(*) from members m where m.team_id = t.id),
        'matches', (select count(*) from records r where r.team_id = t.id and r.store = 'matches' and not r.deleted and r.data->>'kind' = 'match'),
        'last', (select max(updated_at) from records r where r.team_id = t.id), 'created', t.created_at) x
      from teams_cloud t order by (select max(updated_at) from records r where r.team_id = t.id) desc nulls last limit 25) q), '[]'::jsonb),
    'at', now()) into out;
  return out;
end $$;
grant execute on function public.admin_overview() to authenticated;

-- Pictures teams uploaded, newest first, so an admin can take down anything that isn't appropriate.
create or replace function public.admin_pictures(lim int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return '[]'::jsonb; end if;
  execute $q$ select coalesce(jsonb_agg(jsonb_build_object('path', o.name, 'at', o.created_at, 'team', (select name from public.teams_cloud t where t.id = (storage.foldername(o.name))[1])) order by o.created_at desc), '[]'::jsonb)
             from (select name, created_at from storage.objects where bucket_id = 'media' order by created_at desc limit $1) o $q$ into out using least(greatest(lim, 1), 200);
  return out;
end $$;
grant execute on function public.admin_pictures(int) to authenticated;

-- Take a picture down everywhere: the file, and every player, team, opponent or match that shows it.
create or replace function public.admin_remove_picture(path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if path is null or path = '' or path like '%..%' then raise exception 'Bad path'; end if;
  if exists (select 1 from pg_namespace where nspname = 'storage') then execute 'delete from storage.objects where bucket_id = ''media'' and name = $1' using path; end if;
  update records set data = data - 'photo', u = (extract(epoch from now()) * 1000)::bigint, updated_at = now() where store = 'players' and data->>'photo' like '%/media/' || path || '%';
  update records set data = data - 'logo', u = (extract(epoch from now()) * 1000)::bigint, updated_at = now() where store in ('teams', 'opponents') and data->>'logo' like '%/media/' || path || '%';
  update records set data = data - 'oppLogo', u = (extract(epoch from now()) * 1000)::bigint, updated_at = now() where store = 'matches' and data->>'oppLogo' like '%/media/' || path || '%';
end $$;
grant execute on function public.admin_remove_picture(text) to authenticated;

-- ---------- college coach search (Floorcall Recruit) ----------
-- A profile appears in search only when its team lists it (on top of the family's consent to share it), and only
-- college staff an admin approved (school .edu email) can search. Search returns summaries; the profile link has the rest.
alter table public.recruit_shares add column if not exists listed boolean not null default false;
create table if not exists public.college_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, name text not null, school text not null, title text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(), decided_at timestamptz
);
alter table public.college_staff enable row level security;
drop policy if exists "staff own row" on public.college_staff;
create policy "staff own row" on public.college_staff for select using (user_id = auth.uid());

create or replace function public.college_request(name text, school text, title text default null) returns text
language plpgsql security definer set search_path = public, auth as $$
declare em text;
begin
  select email into em from auth.users where id = auth.uid();
  if em is null then raise exception 'Sign in first.'; end if;
  if em !~* '\.edu$' then raise exception 'Use your school email (ending in .edu) so we can confirm you coach at a college.'; end if;
  if length(trim(coalesce(name, ''))) < 2 or length(trim(coalesce(school, ''))) < 2 then raise exception 'Add your name and school.'; end if;
  insert into college_staff (user_id, email, name, school, title) values (auth.uid(), em, left(trim(name), 80), left(trim(school), 120), left(trim(coalesce(title, '')), 80))
    on conflict (user_id) do update set name = excluded.name, school = excluded.school, title = excluded.title
    where college_staff.status <> 'approved';
  return (select status from college_staff where user_id = auth.uid());
end $$;
grant execute on function public.college_request(text, text, text) to authenticated;

create or replace function public.college_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('status', status, 'name', name, 'school', school) from college_staff where user_id = auth.uid()), '{"status":"none"}'::jsonb)
$$;
grant execute on function public.college_status() to authenticated;

-- f: { grad: [2027, 2028], pos: ["OH", "S"], q: "text", region: "California", min: { kps, hitting, dps, passAvg, aps, bps, acesPs } }
create or replace function public.recruit_search(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not exists (select 1 from college_staff where user_id = auth.uid() and status = 'approved') then raise exception 'College staff only'; end if;
  select coalesce(jsonb_agg(x order by (x->>'updated') desc), '[]'::jsonb) into out from (
    select jsonb_build_object('code', r.code, 'updated', r.updated_at,
      'player', r.data->'player', 'team', r.data->'team', 'ranks', coalesce(r.data->'ranks', '[]'::jsonb), 'clips', jsonb_array_length(coalesce(r.data->'clips', '[]'::jsonb)),
      'season', (select jsonb_object_agg(k, r.data->'season'->k) from unnest(array['matches', 'sets', 'kps', 'hitting', 'TA', 'dps', 'passAvg', 'R', 'aps', 'bps', 'acesPs', 'serveIn']) k)) x
    from recruit_shares r
    where r.listed and r.data is not null
      and (not (f ? 'grad') or jsonb_array_length(f->'grad') = 0 or (r.data->'player'->'grad') in (select jsonb_array_elements(f->'grad')))
      and (not (f ? 'pos') or jsonb_array_length(f->'pos') = 0 or exists (select 1 from jsonb_array_elements_text(f->'pos') p where (r.data->'player'->>'pos') ilike '%' || p || '%'))
      and (coalesce(f->>'q', '') = '' or (r.data->'player'->>'first') || ' ' || (r.data->'player'->>'last') || ' ' || coalesce(r.data->'team'->>'name', '') || ' ' || coalesce(r.data->'profile'->>'club', '') ilike '%' || (f->>'q') || '%')
      and (coalesce(f->>'region', '') = '' or coalesce(r.data->'team'->>'region', '') ilike f->>'region')
      and not exists (select 1 from jsonb_each(coalesce(f->'min', '{}'::jsonb)) m
        where jsonb_typeof(m.value) = 'number' and coalesce(case when jsonb_typeof(r.data->'season'->m.key) = 'number' then (r.data->'season'->>m.key)::numeric end, -1e9) < (m.value #>> '{}')::numeric)
    order by r.updated_at desc limit 200) q;
  return out;
end $$;
grant execute on function public.recruit_search(jsonb) to authenticated;

create or replace function public.admin_college_staff() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'name', name, 'school', school, 'title', title, 'status', status, 'at', requested_at) order by (status = 'pending') desc, requested_at desc) from college_staff), '[]'::jsonb);
end $$;
grant execute on function public.admin_college_staff() to authenticated;
create or replace function public.admin_decide_college(uid uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update college_staff set status = case when approve then 'approved' else 'denied' end, decided_at = now() where user_id = uid;
end $$;
grant execute on function public.admin_decide_college(uuid, boolean) to authenticated;

-- ---------- accounts (version 16) ----------
-- Everyone has an account now: coaches, athletes, families and fans. Name, who they are ("coach", "athlete", "parent",
-- "fan") and whether they want Floorcall news by email are kept in auth.users.raw_user_meta_data (set at sign-up,
-- changed in Account). Notifications are kept with the account that turned them on.
alter table public.push_subs add column if not exists user_id uuid;
-- Admins: everyone who said yes to news emails (for product updates; every email must have an unsubscribe link).
create or replace function public.admin_email_list() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'name', coalesce(u.raw_user_meta_data->>'name', ''), 'kind', coalesce(u.raw_user_meta_data->>'kind', ''), 'joined', u.created_at) order by u.created_at desc)
    from auth.users u where coalesce(u.raw_user_meta_data->>'email_ok', '') = 'true'), '[]'::jsonb);
end $$;
create or replace function public.admin_accounts() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'byKind', coalesce((select jsonb_object_agg(k, n) from (select coalesce(nullif(raw_user_meta_data->>'kind', ''), 'coach') k, count(*) n from auth.users group by 1) q), '{}'::jsonb),
    'emailOk', (select count(*) from auth.users where coalesce(raw_user_meta_data->>'email_ok', '') = 'true'));
end $$;
revoke all on function public.admin_email_list() from public, anon;
revoke all on function public.admin_accounts() from public, anon;
grant execute on function public.admin_email_list() to authenticated;
grant execute on function public.admin_accounts() to authenticated;

-- ---------- film sessions (version 16) ----------
-- A coach's film session from Film Room: clips (small videos in Storage at media/<team>/film/<session>/), each with the
-- coach's note and drawing. Players and families open it on Floorcall Live by its code, signed in; the coach sees who watched.
create table if not exists public.film_sessions (
  code text primary key,
  team_id text not null references public.teams_cloud(id) on delete cascade,
  session_id text not null,
  data jsonb not null,
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (team_id, session_id)
);
alter table public.film_sessions enable row level security; -- through the functions below only
create table if not exists public.film_views (
  code text not null references public.film_sessions(code) on delete cascade,
  user_id uuid not null,
  watched int[] not null default '{}',
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.film_views enable row level security;

create or replace function public.film_share(t text, sid text, d jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null or not can_edit(t) then raise exception 'Only the team''s coaches can share film'; end if;
  if length(d::text) > 200000 then raise exception 'That session is too big'; end if;
  select code into c from film_sessions where team_id = t and session_id = sid;
  if c is null then
    c := upper(substr(md5(random()::text || clock_timestamp()::text || sid), 1, 8));
    insert into film_sessions (code, team_id, session_id, data, created_by) values (c, t, sid, d, auth.uid());
  else
    update film_sessions set data = d, updated_at = now() where code = c;
  end if;
  return c;
end $$;
create or replace function public.film_open(c text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; w int[];
begin
  if auth.uid() is null then raise exception 'Sign in to watch'; end if;
  select data into d from film_sessions where code = upper(c);
  if d is null then return null; end if;
  insert into film_views (code, user_id) values (upper(c), auth.uid()) on conflict (code, user_id) do update set last_at = now() returning watched into w;
  return d || jsonb_build_object('watched', to_jsonb(coalesce(w, '{}')));
end $$;
create or replace function public.film_watched(c text, n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to watch'; end if;
  update film_views set watched = (select array_agg(distinct x order by x) from unnest(watched || n) x), last_at = now() where code = upper(c) and user_id = auth.uid();
end $$;
create or replace function public.film_viewers(c text) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare t text;
begin
  select team_id into t from film_sessions where code = upper(c);
  if t is null or not can_edit(t) then raise exception 'Only the team''s coaches can see who watched'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)), 'watched', cardinality(v.watched), 'last', v.last_at) order by v.last_at desc)
    from film_views v join auth.users u on u.id = v.user_id where v.code = upper(c)), '[]'::jsonb);
end $$;
create or replace function public.film_unshare(c text) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select team_id into t from film_sessions where code = upper(c);
  if t is null or not can_edit(t) then raise exception 'Only the team''s coaches can take film down'; end if;
  delete from film_sessions where code = upper(c);
end $$;
revoke all on function public.film_share(text, text, jsonb), public.film_open(text), public.film_watched(text, int), public.film_viewers(text), public.film_unshare(text) from public, anon;
grant execute on function public.film_share(text, text, jsonb), public.film_open(text), public.film_watched(text, int), public.film_viewers(text), public.film_unshare(text) to authenticated;

create or replace function public.schema_version() returns int language sql immutable as $$ select 17 $$;
grant execute on function public.schema_version() to anon, authenticated;

-- ---------- server clock: devices correct their clocks so plays from several phones merge in order ----------
create or replace function public.server_time() returns bigint language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
grant execute on function public.server_time() to anon, authenticated;

-- ---------- delete my account: removes the account, every cloud team it owns (with all their data), and its memberships ----------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  delete from public.teams_cloud where owner = me;   -- cascades to members, records, invites and share links
  delete from public.members where user_id = me;
  delete from public.ai_usage where user_id = me;
  delete from auth.users where id = me;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

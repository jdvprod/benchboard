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
-- ---------- guessing share codes (version 28) ----------
-- Share codes are short so families can type them. To stop anyone trying codes until one works, each network may try
-- 20 different wrong codes in 10 minutes, then has to wait. Only a one-way hash of the network address is kept, for an hour.
create table if not exists public.code_misses (k text not null, code text not null, at timestamptz not null default now());
create index if not exists code_misses_k on public.code_misses (k, at);
alter table public.code_misses enable row level security;  -- no policies: only the functions below touch it
create or replace function public.code_key() returns text
language plpgsql stable security definer set search_path = public as $$
declare h jsonb; ip text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  ip := coalesce(h->>'cf-connecting-ip', nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''), h->>'x-real-ip', auth.uid()::text, 'local');
  return md5('floorcall-codes:' || ip);
end $$;
create or replace function public.code_gate() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if (select count(distinct code) from code_misses where k = code_key() and at > now() - interval '10 minutes') >= 20 then
    raise exception 'Too many codes that didn''t match. Wait a few minutes, then check the code with the coach.' using errcode = 'P0429';
  end if;
end $$;
create or replace function public.code_miss(c text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  insert into code_misses (k, code) values (code_key(), md5(upper(trim(coalesce(c, '')))));
  if random() < 0.05 then delete from code_misses where at < now() - interval '1 hour'; end if;
end $$;

create or replace function public.join_team(invite text) returns text
language plpgsql security definer set search_path = public as $$
declare t text; r text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform code_gate();
  select team_id, role into t, r from invites where code = upper(trim(invite));
  if t is null then perform code_miss(invite); return null; end if;  -- the app says the code doesn't match
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
language plpgsql volatile security definer set search_path = public as $$
declare s live_shares; out jsonb;
begin
  perform code_gate();
  select * into s from live_shares where code = upper(trim(share));
  if s.code is null then perform code_miss(share); return null; end if;
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
language plpgsql volatile security definer set search_path = public as $$
declare s season_shares; out jsonb;
begin
  perform code_gate();
  select * into s from season_shares where code = upper(trim(share));
  if s.code is null then perform code_miss(share); return null; end if;
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
    -- upcoming practices: date, start time and title only (the drills stay with the coaches)
    'practices', coalesce((select jsonb_agg(jsonb_build_object('id', data->>'id', 'date', data->>'date', 'start', data->>'start', 'title', left(coalesce(data->>'title', ''), 80),
                             -- the blocks too when the coach chose to show the plan: names and minutes only
                             'plan', case when data->>'share' = 'true' then (select jsonb_agg(jsonb_build_object('title', left(coalesce(b->>'title', ''), 60), 'minutes', b->'minutes')) from jsonb_array_elements(coalesce(data->'blocks', '[]'::jsonb)) b) end) order by data->>'date', data->>'start')
                           from records where store = 'plans' and team_id = s.team_id and not deleted and coalesce(data->>'status', '') <> 'done' and data->>'date' >= to_char(now() at time zone 'America/Los_Angeles' - interval '1 day', 'YYYY-MM-DD')), '[]'::jsonb),
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
language plpgsql volatile security definer set search_path = public as $$
declare out jsonb;
begin
  perform code_gate();
  select jsonb_build_object('html', html, 'data', data, 'updated_at', updated_at) into out from recruit_shares where code = upper(trim(share));
  if out is null then perform code_miss(share); end if;
  return out;
end $$;
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
language plpgsql volatile security definer set search_path = public as $$
declare b recruit_boards; out jsonb;
begin
  perform code_gate();
  select * into b from recruit_boards where code = upper(trim(share));
  if b.code is null then perform code_miss(share); return null; end if;
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
  perform code_gate();
  select data into d from film_sessions where code = upper(c);
  if d is null then perform code_miss(c); return null; end if;
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

-- ---------- Team announcements: coaches post, signed-in followers read (one way; no replies or direct messages) ----------
create table if not exists public.team_posts (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams_cloud(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  author uuid,
  author_name text,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists team_posts_team on public.team_posts (team_id, created_at desc);
alter table public.team_posts enable row level security; -- through the functions below only
create table if not exists public.team_post_reads (
  post_id uuid not null references public.team_posts(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.team_post_reads enable row level security;
alter table public.push_sent drop constraint if exists push_sent_kind_check;
alter table public.push_sent add constraint push_sent_kind_check check (kind in ('start', 'final', 'post'));

create or replace function public.post_send(t text, b text, pin boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.team_posts; nm text;
begin
  if auth.uid() is null or not can_edit(t) then raise exception 'Only the team''s coaches can post announcements'; end if;
  if char_length(btrim(coalesce(b, ''))) = 0 then raise exception 'Write a message first'; end if;
  if (select count(*) from team_posts where team_id = t and created_at > now() - interval '1 day') >= 30 then raise exception 'That''s a lot of announcements for one day. Try again tomorrow.'; end if;
  select coalesce(nullif(raw_user_meta_data->>'name', ''), 'Coach') into nm from auth.users where id = auth.uid();
  insert into team_posts (team_id, body, author, author_name, pinned) values (t, left(btrim(b), 2000), auth.uid(), left(nm, 60), coalesce(pin, false)) returning * into r;
  return jsonb_build_object('id', r.id, 'body', r.body, 'by', r.author_name, 'pinned', r.pinned, 'at', r.created_at, 'reads', 0);
end $$;

create or replace function public.post_update(pid uuid, pin boolean default null, del boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select team_id into t from team_posts where id = pid;
  if t is null or auth.uid() is null or not can_edit(t) then raise exception 'Only the team''s coaches can change announcements'; end if;
  if del then delete from team_posts where id = pid; elsif pin is not null then update team_posts set pinned = pin where id = pid; end if;
end $$;

-- the coach app: this team's announcements with how many followers have read each
create or replace function public.posts_for_team(t text) returns jsonb
language sql security definer set search_path = public stable as $$
  select case when auth.uid() is not null and is_member(t) then coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'body', p.body, 'by', p.author_name, 'pinned', p.pinned, 'at', p.created_at,
      'reads', (select count(*) from team_post_reads r where r.post_id = p.id)) order by p.pinned desc, p.created_at desc)
    from (select * from team_posts where team_id = t order by created_at desc limit 50) p), '[]'::jsonb) end
$$;

-- Floorcall Live: a signed-in follower reads the team's announcements by its team page code (and they count as read)
create or replace function public.posts_by_code(c text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to read team announcements'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'body', p.body, 'by', p.author_name, 'pinned', p.pinned, 'at', p.created_at,
    'new', not exists (select 1 from team_post_reads r where r.post_id = p.id and r.user_id = auth.uid())) order by p.pinned desc, p.created_at desc), '[]'::jsonb)
    into out from (select * from team_posts where team_id = t order by created_at desc limit 30) p;
  insert into team_post_reads (post_id, user_id) select p.id, auth.uid() from team_posts p where p.team_id = t on conflict do nothing;
  return out;
end $$;
revoke all on function public.post_send(text, text, boolean), public.post_update(uuid, boolean, boolean), public.posts_for_team(text), public.posts_by_code(text) from public, anon;
grant execute on function public.post_send(text, text, boolean), public.post_update(uuid, boolean, boolean), public.posts_for_team(text), public.posts_by_code(text) to authenticated;

-- ---------- Availability: followers tell the coaches whether they can make each scheduled match ----------
-- Names are for the team's coaches only; everyone else sees counts and their own answer.
create table if not exists public.team_rsvps (
  team_id text not null references public.teams_cloud(id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 60),
  user_id uuid not null,
  name text not null,
  status text not null check (status in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (team_id, item_id, user_id)
);
alter table public.team_rsvps enable row level security; -- through the functions below only

create or replace function public.rsvp_set(c text, item text, s text) returns void
language plpgsql security definer set search_path = public as $$
declare t text; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in to answer'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then raise exception 'That team page isn''t shared anymore'; end if;
  if coalesce(s, '') = '' then delete from team_rsvps where team_id = t and item_id = item and user_id = auth.uid(); return; end if;
  if s not in ('yes', 'no', 'maybe') then raise exception 'Choose going, can''t go or maybe'; end if;
  if (select count(*) from team_rsvps where team_id = t and user_id = auth.uid()) >= 300 then raise exception 'Too many answers on this team'; end if;
  select coalesce(nullif(raw_user_meta_data->>'name', ''), 'A follower') into nm from auth.users where id = auth.uid();
  insert into team_rsvps (team_id, item_id, user_id, name, status) values (t, left(item, 60), auth.uid(), left(nm, 60), s)
    on conflict (team_id, item_id, user_id) do update set status = excluded.status, name = excluded.name, updated_at = now();
end $$;

-- Floorcall Live: counts for each scheduled match and the signed-in person's own answer (no names)
create or replace function public.rsvps_by_code(c text) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'Sign in to answer'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then return null; end if;
  return coalesce((select jsonb_object_agg(item_id, jsonb_build_object('yes', y, 'no', n, 'maybe', mb, 'mine', mine)) from (
    select item_id, count(*) filter (where status = 'yes') y, count(*) filter (where status = 'no') n, count(*) filter (where status = 'maybe') mb,
      max(status) filter (where user_id = auth.uid()) mine from team_rsvps where team_id = t group by item_id) x), '{}'::jsonb);
end $$;

-- the coach app: who answered what, for the team's coaches and staff
create or replace function public.rsvps_for_team(t text) returns jsonb
language sql security definer set search_path = public stable as $$
  select case when auth.uid() is not null and is_member(t) then coalesce((
    select jsonb_agg(jsonb_build_object('item', item_id, 'name', name, 'status', status, 'at', updated_at) order by item_id, status desc, name)
    from team_rsvps where team_id = t), '[]'::jsonb) end
$$;
revoke all on function public.rsvp_set(text, text, text), public.rsvps_by_code(text), public.rsvps_for_team(text) from public, anon;
grant execute on function public.rsvp_set(text, text, text), public.rsvps_by_code(text), public.rsvps_for_team(text) to authenticated;

-- ---------- College interest: approved college staff write to a listed player's coaches (never to the player) ----------
create table if not exists public.college_interest (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams_cloud(id) on delete cascade,
  code text not null,
  player text,
  from_user uuid not null,
  from_name text, school text, title text, email text,
  body text not null check (char_length(body) between 1 and 1500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists college_interest_team on public.college_interest (team_id, created_at desc);
alter table public.college_interest enable row level security; -- through the functions below only

create or replace function public.college_contact(c text, b text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.college_staff; r public.recruit_shares;
begin
  select * into s from college_staff where user_id = auth.uid() and status = 'approved';
  if s.user_id is null then raise exception 'College staff only'; end if;
  if char_length(btrim(coalesce(b, ''))) = 0 then raise exception 'Write a message first'; end if;
  select * into r from recruit_shares where code = upper(c) and listed;
  if r.code is null then raise exception 'That player isn''t listed anymore'; end if;
  if exists (select 1 from college_interest where from_user = auth.uid() and code = r.code and created_at > now() - interval '7 days') then raise exception 'You wrote to this player''s coaches this week. They have your message.'; end if;
  if (select count(*) from college_interest where from_user = auth.uid() and created_at > now() - interval '1 day') >= 25 then raise exception 'That''s a lot of messages for one day. Try again tomorrow.'; end if;
  insert into college_interest (team_id, code, player, from_user, from_name, school, title, email, body)
    values (r.team_id, r.code, left(btrim(coalesce(r.data->'player'->>'first', '') || ' ' || coalesce(r.data->'player'->>'last', '')), 80), auth.uid(), s.name, s.school, s.title, s.email, left(btrim(b), 1500));
end $$;

-- the coach app: messages from college staff about this team's players, for the team's coaches
create or replace function public.college_inbox(t text) returns jsonb
language sql security definer set search_path = public stable as $$
  select case when auth.uid() is not null and can_edit(t) then coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'player', player, 'code', code, 'name', from_name, 'school', school, 'title', title, 'email', email, 'body', body, 'at', created_at, 'new', read_at is null) order by created_at desc)
    from (select * from college_interest where team_id = t order by created_at desc limit 100) x), '[]'::jsonb) end
$$;
create or replace function public.college_inbox_read(t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not can_edit(t) then return; end if;
  update college_interest set read_at = now() where team_id = t and read_at is null;
end $$;
revoke all on function public.college_contact(text, text), public.college_inbox(text), public.college_inbox_read(text) from public, anon;
grant execute on function public.college_contact(text, text), public.college_inbox(text), public.college_inbox_read(text) to authenticated;

-- ---------- Floorcall Beach: a beach match shared live by a link (anyone with the link can watch; only its owner can update it) ----------
create table if not exists public.beach_shares (
  code text primary key,
  owner uuid not null,
  data text not null check (char_length(data) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists beach_shares_owner on public.beach_shares (owner);
alter table public.beach_shares enable row level security; -- through the functions below only

create or replace function public.beach_publish(c text, d text) returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'Sign in to share a match live'; end if;
  if char_length(coalesce(d, '')) = 0 or char_length(d) > 20000 then raise exception 'That match can''t be shared'; end if;
  if coalesce(c, '') <> '' then
    update beach_shares set data = d, updated_at = now() where code = upper(c) and owner = auth.uid() returning code into k;
    if k is null then raise exception 'That link isn''t yours to update'; end if;
    return k;
  end if;
  if (select count(*) from beach_shares where owner = auth.uid()) >= 300 then raise exception 'You have a lot of shared matches. Stop sharing some old ones first.'; end if;
  k := upper(substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 7));
  insert into beach_shares (code, owner, data) values (k, auth.uid(), d);
  return k;
end $$;
create or replace function public.beach_view(c text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare out jsonb;
begin
  perform code_gate();
  select jsonb_build_object('data', data, 'updated', updated_at) into out from beach_shares where code = upper(trim(c));
  if out is null then perform code_miss(c); end if;
  return out;
end $$;
create or replace function public.beach_unshare(c text) returns void
language sql security definer set search_path = public as $$
  delete from beach_shares where code = upper(c) and owner = auth.uid()
$$;
revoke all on function public.beach_publish(text, text), public.beach_unshare(text) from public, anon;
grant execute on function public.beach_publish(text, text), public.beach_unshare(text) to authenticated;
grant execute on function public.beach_view(text) to anon, authenticated;

-- ---------- Team playbook: plays the coaches chose to share; signed-in followers study them on Floorcall Live ----------
create table if not exists public.team_plays (
  team_id text primary key references public.teams_cloud(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.team_plays enable row level security; -- through the functions below only

create or replace function public.plays_publish(t text, d jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not can_edit(t) then raise exception 'Only the team''s coaches can share plays'; end if;
  if jsonb_typeof(d) <> 'array' or length(d::text) > 100000 then raise exception 'Those plays can''t be shared'; end if;
  if jsonb_array_length(d) = 0 then delete from team_plays where team_id = t; return; end if;
  insert into team_plays (team_id, data) values (t, d) on conflict (team_id) do update set data = excluded.data, updated_at = now();
end $$;
create or replace function public.plays_by_code(c text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'Sign in to see the team''s plays'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then return null; end if;
  return coalesce((select data from team_plays where team_id = t), '[]'::jsonb);
end $$;
revoke all on function public.plays_publish(text, jsonb), public.plays_by_code(text) from public, anon;
grant execute on function public.plays_publish(text, jsonb), public.plays_by_code(text) to authenticated;

-- ---------- Volunteer jobs: the coach lists jobs for a match (line judge, scorebook, snacks); families sign up on Live ----------
-- The jobs themselves travel with the published schedule; this keeps who signed up. Names are for the team's coaches.
create table if not exists public.team_signups (
  team_id text not null references public.teams_cloud(id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 60),
  job_id text not null check (char_length(job_id) between 1 and 40),
  user_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, item_id, job_id, user_id)
);
alter table public.team_signups enable row level security; -- through the functions below only

create or replace function public.job_take(c text, item text, job text, take boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare t text; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in to volunteer'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then raise exception 'That team page isn''t shared anymore'; end if;
  if not take then delete from team_signups where team_id = t and item_id = item and job_id = job and user_id = auth.uid(); return; end if;
  if (select count(*) from team_signups where team_id = t and item_id = item and job_id = job) >= 10 then raise exception 'That job is full'; end if;
  if (select count(*) from team_signups where team_id = t and user_id = auth.uid()) >= 200 then raise exception 'Too many sign-ups on this team'; end if;
  select coalesce(nullif(raw_user_meta_data->>'name', ''), 'A volunteer') into nm from auth.users where id = auth.uid();
  insert into team_signups (team_id, item_id, job_id, user_id, name) values (t, left(item, 60), left(job, 40), auth.uid(), left(nm, 60)) on conflict do nothing;
end $$;

-- Floorcall Live: how many signed up for each job, and whether you did (no names)
create or replace function public.jobs_by_code(c text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'Sign in to volunteer'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then return null; end if;
  return coalesce((select jsonb_object_agg(item_id || '/' || job_id, jsonb_build_object('n', n, 'mine', mine)) from (
    select item_id, job_id, count(*) n, bool_or(user_id = auth.uid()) mine from team_signups where team_id = t group by item_id, job_id) x), '{}'::jsonb);
end $$;

-- the coach app: who signed up for what
create or replace function public.jobs_for_team(t text) returns jsonb
language sql security definer set search_path = public stable as $$
  select case when auth.uid() is not null and is_member(t) then coalesce((
    select jsonb_agg(jsonb_build_object('item', item_id, 'job', job_id, 'name', name, 'at', created_at) order by item_id, job_id, created_at)
    from team_signups where team_id = t), '[]'::jsonb) end
$$;
revoke all on function public.job_take(text, text, text, boolean), public.jobs_by_code(text), public.jobs_for_team(text) from public, anon;
grant execute on function public.job_take(text, text, text, boolean), public.jobs_by_code(text), public.jobs_for_team(text) to authenticated;

-- availability answers can say which player they are for, so coaches know who is out
alter table public.team_rsvps add column if not exists player_id text check (player_id is null or char_length(player_id) <= 60);
drop function if exists public.rsvp_set(text, text, text);
create or replace function public.rsvp_set(c text, item text, s text, p text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t text; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in to answer'; end if;
  select team_id into t from season_shares where code = upper(c);
  if t is null then raise exception 'That team page isn''t shared anymore'; end if;
  if coalesce(s, '') = '' then delete from team_rsvps where team_id = t and item_id = item and user_id = auth.uid(); return; end if;
  if s not in ('yes', 'no', 'maybe') then raise exception 'Choose going, can''t go or maybe'; end if;
  if (select count(*) from team_rsvps where team_id = t and user_id = auth.uid()) >= 300 then raise exception 'Too many answers on this team'; end if;
  select coalesce(nullif(raw_user_meta_data->>'name', ''), 'A follower') into nm from auth.users where id = auth.uid();
  insert into team_rsvps (team_id, item_id, user_id, name, status, player_id) values (t, left(item, 60), auth.uid(), left(nm, 60), s, nullif(left(coalesce(p, ''), 60), ''))
    on conflict (team_id, item_id, user_id) do update set status = excluded.status, name = excluded.name, player_id = excluded.player_id, updated_at = now();
end $$;
create or replace function public.rsvps_for_team(t text) returns jsonb
language sql security definer set search_path = public stable as $$
  select case when auth.uid() is not null and is_member(t) then coalesce((
    select jsonb_agg(jsonb_build_object('item', item_id, 'name', name, 'status', status, 'player', player_id, 'at', updated_at) order by item_id, status desc, name)
    from team_rsvps where team_id = t), '[]'::jsonb) end
$$;
revoke all on function public.rsvp_set(text, text, text, text) from public, anon;
grant execute on function public.rsvp_set(text, text, text, text) to authenticated;

-- ---------- Tryouts shared with evaluators: the head coach shares a code; each evaluator rates on their own phone ----------
-- Evaluators see the players and their own ratings; only the head coach sees everyone's.
create table if not exists public.tryouts_cloud (
  code text primary key,
  owner uuid not null,
  data jsonb not null check (length(data::text) <= 200000),
  updated_at timestamptz not null default now()
);
create table if not exists public.tryout_ratings (
  code text not null references public.tryouts_cloud(code) on delete cascade,
  evaluator uuid not null,
  name text not null,
  ratings jsonb not null check (length(ratings::text) <= 200000),
  updated_at timestamptz not null default now(),
  primary key (code, evaluator)
);
alter table public.tryouts_cloud enable row level security; -- through the functions below only
alter table public.tryout_ratings enable row level security;

create or replace function public.tryout_publish(c text, d jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'Sign in to share a tryout'; end if;
  if jsonb_typeof(d) <> 'object' or length(d::text) > 200000 then raise exception 'That tryout can''t be shared'; end if;
  if coalesce(c, '') <> '' then
    update tryouts_cloud set data = d, updated_at = now() where code = upper(c) and owner = auth.uid() returning code into k;
    if k is null then raise exception 'That tryout isn''t yours to update'; end if;
    return k;
  end if;
  if (select count(*) from tryouts_cloud where owner = auth.uid()) >= 50 then raise exception 'You have a lot of shared tryouts. Stop sharing an old one first.'; end if;
  k := upper(substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 6));
  insert into tryouts_cloud (code, owner, data) values (k, auth.uid(), d);
  return k;
end $$;
-- an evaluator opens the tryout: the players and skills, plus their own ratings
create or replace function public.tryout_open(c text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t tryouts_cloud;
begin
  if auth.uid() is null then raise exception 'Sign in to rate at this tryout'; end if;
  perform code_gate();
  select * into t from tryouts_cloud where code = upper(c);
  if t.code is null then perform code_miss(c); return null; end if;
  return jsonb_build_object('code', t.code, 'data', t.data, 'mine', (select ratings from tryout_ratings where code = t.code and evaluator = auth.uid()), 'owner', t.owner = auth.uid());
end $$;
create or replace function public.tryout_rate(c text, nm text, r jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to rate at this tryout'; end if;
  if not exists (select 1 from tryouts_cloud where code = upper(c)) then raise exception 'That tryout isn''t shared anymore'; end if;
  if jsonb_typeof(r) <> 'object' then raise exception 'Bad ratings'; end if;
  insert into tryout_ratings (code, evaluator, name, ratings) values (upper(c), auth.uid(), left(coalesce(nullif(btrim(nm), ''), 'Evaluator'), 40), r)
    on conflict (code, evaluator) do update set ratings = excluded.ratings, name = excluded.name, updated_at = now();
end $$;
-- the head coach: everyone's ratings
create or replace function public.tryout_all(c text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from tryouts_cloud where code = upper(c) and owner = auth.uid()) then coalesce((
    select jsonb_agg(jsonb_build_object('name', name, 'ratings', ratings, 'at', updated_at) order by name) from tryout_ratings where code = upper(c)), '[]'::jsonb) end
$$;
create or replace function public.tryout_unshare(c text) returns void
language sql security definer set search_path = public as $$ delete from tryouts_cloud where code = upper(c) and owner = auth.uid() $$;
revoke all on function public.tryout_publish(text, jsonb), public.tryout_open(text), public.tryout_rate(text, text, jsonb), public.tryout_all(text), public.tryout_unshare(text) from public, anon;
grant execute on function public.tryout_publish(text, jsonb), public.tryout_open(text), public.tryout_rate(text, text, jsonb), public.tryout_all(text), public.tryout_unshare(text) to authenticated;

-- 25: the team page also lists upcoming practices (see season_view). 26: tryouts shared with evaluators. 27: a practice plan the coach chose to show.
create or replace function public.schema_version() returns int language sql immutable as $$ select 32 $$;
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
  -- everything else kept with the account: answers, sign-ups, ratings, shares, subscriptions, messages sent
  delete from public.team_rsvps where user_id = me;
  delete from public.team_signups where user_id = me;
  delete from public.team_post_reads where user_id = me;
  delete from public.film_views where user_id = me;
  delete from public.push_subs where user_id = me;
  delete from public.tryout_ratings where evaluator = me;
  delete from public.tryouts_cloud where owner = me;
  delete from public.beach_shares where owner = me;
  delete from public.college_interest where from_user = me;
  -- the team keeps its announcements and invite codes; they just stop pointing at this account
  update public.team_posts set author = null where author = me;
  update public.invites set created_by = null where created_by = me;
  update public.app_errors set uid = null where uid = me;
  delete from auth.users where id = me;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- player fees (version 29) ----------
-- A team's fee ledger is for its owner and coaches only. View-only members get every other team record, so fees
-- travel in their own table instead of inside the team record.
create table if not exists public.team_fees (
  team_id text primary key references public.teams_cloud(id) on delete cascade,
  data jsonb,
  u bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.team_fees enable row level security;
drop policy if exists "fees: coaches" on public.team_fees;
create policy "fees: coaches" on public.team_fees for all to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));
grant select, insert, update, delete on public.team_fees to authenticated;
-- fees never belong in the shared team record
update public.records set data = data - 'fees' where store = 'teams' and data ? 'fees';

-- ---------- verified coaches and team approval (version 30) ----------
-- Who may do what:
--   Floorcall admins (the admins table) verify team admins: the coaches who may put a team in the cloud.
--   A team's owner (its team admin) approves every coach who joins with a coach code; until then they see nothing.
--   View-only members (players and families) see stats, never the coaches' scouting, drills, practice plans or boards.
alter table public.members add column if not exists status text not null default 'active';
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_status_check') then
    alter table public.members add constraint members_status_check check (status in ('active', 'pending'));
  end if;
end $do$;

create table if not exists public.coach_verify (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '', name text not null default '', org text not null default '', title text, phone text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(), decided_at timestamptz
);
alter table public.coach_verify enable row level security;
drop policy if exists "coach verify own row" on public.coach_verify;
create policy "coach verify own row" on public.coach_verify for select using (user_id = auth.uid());
-- coaches who already own a team keep working
insert into public.coach_verify (user_id, email, title, status, decided_at)
  select distinct on (m.user_id) m.user_id, coalesce(m.email, ''), 'Team owner', 'approved', now() from public.members m where m.role = 'owner'
  on conflict (user_id) do nothing;

create or replace function public.coach_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from coach_verify where user_id = auth.uid() and status = 'approved')
$$;
create or replace function public.is_member(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid() and status = 'active');
$$;
create or replace function public.can_edit(t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid() and status = 'active' and role in ('owner', 'coach'));
$$;

drop policy if exists "teams create" on public.teams_cloud;
create policy "teams create" on public.teams_cloud for insert with check (owner = auth.uid() and public.coach_ok());
drop policy if exists "members read" on public.members;
-- coaches see who's on the team; players and families see only their own membership (no one else's email)
create policy "members read" on public.members for select using (can_edit(team_id) or user_id = auth.uid());
drop policy if exists "records read" on public.records;
create policy "records read" on public.records for select using (
  is_member(team_id) and (can_edit(team_id) or store not in ('opponents', 'drills', 'plans', 'boards')));

-- A coach code puts the coach on the team as pending until the team's owner approves them. View-only codes work at once.
create or replace function public.join_team(invite text) returns text
language plpgsql security definer set search_path = public as $$
declare t text; r text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform code_gate();
  select team_id, role into t, r from invites where code = upper(trim(invite));
  if t is null then perform code_miss(invite); return null; end if;  -- the app says the code doesn't match
  insert into members (team_id, user_id, role, email, status)
  values (t, auth.uid(), r, (select email from auth.users where id = auth.uid()), case when r = 'viewer' then 'active' else 'pending' end)
  on conflict (team_id, user_id) do nothing;
  return t;
end $$;
grant execute on function public.join_team(text) to authenticated;

-- The team's owner approves or turns down a coach waiting to join.
create or replace function public.team_decide_member(t text, uid uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from members where team_id = t and user_id = auth.uid() and role = 'owner' and status = 'active') then
    raise exception 'Only the team''s owner can approve coaches'; end if;
  if approve then update members set status = 'active' where team_id = t and user_id = uid and status = 'pending';
  else delete from members where team_id = t and user_id = uid and status = 'pending'; end if;
end $$;
grant execute on function public.team_decide_member(text, uuid, boolean) to authenticated;

-- A coach asks to be verified as a team admin.
create or replace function public.coach_request(name text, org text, title text default null, phone text default null) returns text
language plpgsql security definer set search_path = public, auth as $$
declare em text;
begin
  select email into em from auth.users where id = auth.uid();
  if em is null then raise exception 'Sign in first.'; end if;
  if length(trim(coalesce(name, ''))) < 2 or length(trim(coalesce(org, ''))) < 2 then raise exception 'Add your name and your school or club.'; end if;
  insert into coach_verify (user_id, email, name, org, title, phone) values (auth.uid(), em, left(trim(name), 80), left(trim(org), 120), left(trim(coalesce(title, '')), 80), left(trim(coalesce(phone, '')), 30))
    on conflict (user_id) do update set name = excluded.name, org = excluded.org, title = excluded.title, phone = excluded.phone, requested_at = now(),
      status = case when coach_verify.status = 'denied' then 'pending' else coach_verify.status end
    where coach_verify.status <> 'approved';
  return (select status from coach_verify where user_id = auth.uid());
end $$;
grant execute on function public.coach_request(text, text, text, text) to authenticated;

create or replace function public.coach_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_admin() then '{"status":"approved","admin":true}'::jsonb else
    coalesce((select jsonb_build_object('status', status, 'name', name, 'org', org) from coach_verify where user_id = auth.uid()), '{"status":"none"}'::jsonb) end
$$;
grant execute on function public.coach_status() to authenticated;

create or replace function public.admin_coach_requests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'name', name, 'org', org, 'title', title, 'phone', phone, 'status', status, 'at', requested_at)
    order by (status = 'pending') desc, requested_at desc) from coach_verify), '[]'::jsonb);
end $$;
grant execute on function public.admin_coach_requests() to authenticated;
create or replace function public.admin_decide_coach(uid uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update coach_verify set status = case when approve then 'approved' else 'denied' end, decided_at = now() where user_id = uid;
end $$;
grant execute on function public.admin_decide_coach(uuid, boolean) to authenticated;

-- ---------- Floorcall Lessons (version 31): private lessons, small groups and clinics ----------
-- A trainer's athletes come from anywhere, so lessons aren't team records. Trainers (verified coaches) keep their
-- athletes and sessions here; each athlete or parent joins with a personal code and sees only their own athlete's
-- sessions, shared notes and numbers. Everything goes through the functions below; nobody reads these tables directly.
create table if not exists public.lesson_athletes (
  id text primary key, trainer uuid not null references auth.users(id) on delete cascade,
  name text not null, grad text, position text, club text, contact text, notes text,
  code text unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists lesson_athletes_trainer on public.lesson_athletes (trainer);
create table if not exists public.lesson_access (
  athlete_id text not null references public.lesson_athletes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'athlete' check (role in ('athlete', 'parent')),
  joined_at timestamptz not null default now(), primary key (athlete_id, user_id)
);
create table if not exists public.lesson_sessions (
  id text primary key, trainer uuid not null references auth.users(id) on delete cascade,
  starts timestamptz not null, minutes int not null default 60 check (minutes between 5 and 600),
  kind text not null default 'private' check (kind in ('private', 'group', 'clinic')),
  title text, place text, capacity int check (capacity between 1 and 500), focus text[] not null default '{}',
  athletes text[] not null default '{}', open boolean not null default false, public boolean not null default false,
  code text unique, price text, notes text, shared_note text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'canceled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists lesson_sessions_trainer on public.lesson_sessions (trainer, starts);
-- who came, what they did (reps per skill) and whether it's paid
create table if not exists public.lesson_roster (
  session_id text not null references public.lesson_sessions(id) on delete cascade,
  athlete_id text not null references public.lesson_athletes(id) on delete cascade,
  reps jsonb not null default '{}', attended boolean, paid boolean not null default false,
  updated_at timestamptz not null default now(), primary key (session_id, athlete_id)
);
-- sign-ups from a clinic's public page, for the trainer to accept
create table if not exists public.lesson_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.lesson_sessions(id) on delete cascade,
  name text not null, contact text, note text, status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
alter table public.lesson_athletes enable row level security;
alter table public.lesson_access enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.lesson_roster enable row level security;
alter table public.lesson_requests enable row level security;
revoke all on public.lesson_athletes, public.lesson_access, public.lesson_sessions, public.lesson_roster, public.lesson_requests from anon, authenticated;

create or replace function public.lesson_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6)
$$;

-- The trainer's whole book: athletes (with who has joined), sessions, roster rows and clinic sign-ups.
create or replace function public.lesson_trainer_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'athletes', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('joined', (select coalesce(jsonb_agg(jsonb_build_object('role', x.role, 'email', u.email)), '[]') from lesson_access x join auth.users u on u.id = x.user_id where x.athlete_id = a.id)) order by a.name) from lesson_athletes a where a.trainer = me), '[]'),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.starts) from lesson_sessions s where s.trainer = me), '[]'),
    'roster', coalesce((select jsonb_agg(to_jsonb(r)) from lesson_roster r join lesson_sessions s on s.id = r.session_id where s.trainer = me), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at) from lesson_requests q join lesson_sessions s on s.id = q.session_id where s.trainer = me and q.status = 'pending'), '[]'),
    'verified', coach_ok());
end $$;

create or replace function public.lesson_save_athlete(a jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); owner uuid;
begin
  if not coach_ok() then raise exception 'Verify your coach account first: Floorcall checks every trainer before they add athletes.'; end if;
  if length(trim(coalesce(a->>'name', ''))) < 1 then raise exception 'Add the athlete''s name.'; end if;
  select trainer into owner from lesson_athletes where id = a->>'id';
  if owner is not null and owner <> me then raise exception 'Not your athlete.'; end if;
  insert into lesson_athletes (id, trainer, name, grad, position, club, contact, notes)
  values (a->>'id', me, left(trim(a->>'name'), 80), left(a->>'grad', 10), left(a->>'position', 20), left(a->>'club', 80), left(a->>'contact', 120), left(a->>'notes', 2000))
  on conflict (id) do update set name = excluded.name, grad = excluded.grad, position = excluded.position, club = excluded.club,
    contact = excluded.contact, notes = excluded.notes, updated_at = now();
end $$;

create or replace function public.lesson_delete_athlete(aid text) returns void
language sql security definer set search_path = public as $$
  update lesson_sessions set athletes = array_remove(athletes, aid), updated_at = now() where trainer = auth.uid() and aid = any(athletes);
  delete from lesson_athletes where id = aid and trainer = auth.uid();
$$;

-- A personal code for an athlete (or their parent) to join with. Made once; "new code" replaces it.
create or replace function public.lesson_invite(aid text, fresh boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select code into c from lesson_athletes where id = aid and trainer = auth.uid();
  if not found then raise exception 'Not your athlete.'; end if;
  if c is null or fresh then
    loop c := lesson_code(); exit when not exists (select 1 from lesson_athletes where code = c); end loop;
    update lesson_athletes set code = c, updated_at = now() where id = aid;
  end if;
  return c;
end $$;

create or replace function public.lesson_save_session(x jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); owner uuid; ids text[]; c text;
begin
  if not coach_ok() then raise exception 'Verify your coach account first.'; end if;
  select trainer, code into owner, c from lesson_sessions where id = x->>'id';
  if owner is not null and owner <> me then raise exception 'Not your session.'; end if;
  -- only the trainer's own athletes
  select coalesce(array_agg(a.id), '{}') into ids from lesson_athletes a where a.trainer = me and a.id in (select jsonb_array_elements_text(coalesce(x->'athletes', '[]')));
  if coalesce((x->>'public')::boolean, false) and c is null then
    loop c := lesson_code(); exit when not exists (select 1 from lesson_sessions where code = c); end loop;
  end if;
  insert into lesson_sessions (id, trainer, starts, minutes, kind, title, place, capacity, focus, athletes, open, public, code, price, notes, shared_note, status)
  values (x->>'id', me, (x->>'starts')::timestamptz, coalesce((x->>'minutes')::int, 60), coalesce(x->>'kind', 'private'), left(x->>'title', 100), left(x->>'place', 120),
    nullif(x->>'capacity', '')::int, coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(x->'focus', '[]')) v), '{}'), ids,
    coalesce((x->>'open')::boolean, false), coalesce((x->>'public')::boolean, false), c, left(x->>'price', 40), left(x->>'notes', 4000), left(x->>'shared_note', 2000), coalesce(x->>'status', 'scheduled'))
  on conflict (id) do update set starts = excluded.starts, minutes = excluded.minutes, kind = excluded.kind, title = excluded.title, place = excluded.place,
    capacity = excluded.capacity, focus = excluded.focus, athletes = excluded.athletes, open = excluded.open, public = excluded.public,
    code = coalesce(lesson_sessions.code, excluded.code), price = excluded.price, notes = excluded.notes, shared_note = excluded.shared_note, status = excluded.status, updated_at = now();
end $$;

create or replace function public.lesson_delete_session(sid text) returns void
language sql security definer set search_path = public as $$ delete from lesson_sessions where id = sid and trainer = auth.uid(); $$;

create or replace function public.lesson_save_roster(sid text, aid text, reps jsonb, attended boolean, paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from lesson_sessions where id = sid and trainer = auth.uid()) or not exists (select 1 from lesson_athletes where id = aid and trainer = auth.uid()) then
    raise exception 'Not your session.'; end if;
  insert into lesson_roster (session_id, athlete_id, reps, attended, paid) values (sid, aid, coalesce(reps, '{}'), attended, coalesce(paid, false))
  on conflict (session_id, athlete_id) do update set reps = excluded.reps, attended = excluded.attended, paid = excluded.paid, updated_at = now();
end $$;

-- An athlete or parent joins with their personal code.
create or replace function public.lesson_join(invite text, as_role text default 'athlete') returns text
language plpgsql security definer set search_path = public as $$
declare aid text; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform code_gate();
  select id, name into aid, nm from lesson_athletes where code = upper(trim(invite));
  if aid is null then perform code_miss(invite); raise exception 'That code doesn''t match. Check it with your trainer.'; end if;
  insert into lesson_access (athlete_id, user_id, role) values (aid, auth.uid(), case when as_role = 'parent' then 'parent' else 'athlete' end)
  on conflict (athlete_id, user_id) do update set role = excluded.role;
  return nm;
end $$;

-- What an athlete or parent sees: their athletes, those athletes' sessions (no other athletes' names, no private
-- notes), their numbers, and open sessions from the same trainers they can book.
create or replace function public.my_lessons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'athletes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'role', x.role, 'trainer', coalesce(u.raw_user_meta_data->>'name', 'Your trainer'))) from lesson_access x join lesson_athletes a on a.id = x.athlete_id join auth.users u on u.id = a.trainer where x.user_id = me), '[]'),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'starts', s.starts, 'minutes', s.minutes, 'kind', s.kind, 'title', s.title, 'place', s.place, 'focus', s.focus,
        'shared_note', s.shared_note, 'status', s.status, 'price', s.price, 'mine', (select coalesce(jsonb_agg(m), '[]') from unnest(s.athletes) m where m in (select athlete_id from lesson_access where user_id = me)),
        'spots', case when s.capacity is null then null else greatest(s.capacity - cardinality(s.athletes), 0) end, 'open', s.open) order by s.starts)
      from lesson_sessions s where s.status <> 'canceled' and (s.athletes && (select coalesce(array_agg(athlete_id), '{}') from lesson_access where user_id = me)
        or (s.open and s.starts > now() and s.trainer in (select a.trainer from lesson_access x join lesson_athletes a on a.id = x.athlete_id where x.user_id = me)))), '[]'),
    'roster', coalesce((select jsonb_agg(jsonb_build_object('session_id', r.session_id, 'athlete_id', r.athlete_id, 'reps', r.reps, 'attended', r.attended, 'paid', r.paid))
      from lesson_roster r where r.athlete_id in (select athlete_id from lesson_access where user_id = me)), '[]'));
end $$;

-- Book (or leave) an open session for one of your athletes.
create or replace function public.lesson_book(sid text, aid text, join_it boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare s lesson_sessions;
begin
  if not exists (select 1 from lesson_access where athlete_id = aid and user_id = auth.uid()) then raise exception 'Not your athlete.'; end if;
  select * into s from lesson_sessions where id = sid for update;
  if s.id is null or s.trainer <> (select trainer from lesson_athletes where id = aid) then raise exception 'That session isn''t available.'; end if;
  if join_it then
    if not s.open or s.status <> 'scheduled' or s.starts < now() then raise exception 'That session isn''t open for booking.'; end if;
    if s.capacity is not null and cardinality(s.athletes) >= s.capacity and not aid = any(s.athletes) then raise exception 'That session is full.'; end if;
    update lesson_sessions set athletes = array_append(array_remove(athletes, aid), aid), updated_at = now() where id = sid;
  else
    if s.starts < now() then raise exception 'That session has already started.'; end if;
    update lesson_sessions set athletes = array_remove(athletes, aid), updated_at = now() where id = sid;
  end if;
end $$;

-- A clinic's public page: anyone with the link sees what, when, where and how many spots are left, and can sign up.
create or replace function public.lesson_public(c text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', s.title, 'starts', s.starts, 'minutes', s.minutes, 'place', s.place, 'focus', s.focus, 'price', s.price, 'shared_note', s.shared_note,
    'spots', case when s.capacity is null then null else greatest(s.capacity - cardinality(s.athletes) - (select count(*) from lesson_requests q where q.session_id = s.id and q.status = 'pending'), 0) end,
    'trainer', coalesce((select raw_user_meta_data->>'name' from auth.users where id = s.trainer), 'Floorcall trainer'), 'status', s.status)
  from lesson_sessions s where s.code = upper(trim(c)) and s.public
$$;
create or replace function public.lesson_signup(c text, who text, contact text, note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare sid text; cap int; n int;
begin
  select id, capacity, cardinality(athletes) into sid, cap, n from lesson_sessions where code = upper(trim(c)) and public and status = 'scheduled' and starts > now();
  if sid is null then raise exception 'Sign-ups for this clinic are closed.'; end if;
  if length(trim(coalesce(who, ''))) < 2 or length(trim(coalesce(contact, ''))) < 5 then raise exception 'Add the player''s name and a parent''s email or phone.'; end if;
  if (select count(*) from lesson_requests where session_id = sid) >= 300 then raise exception 'Sign-ups for this clinic are closed.'; end if;
  if cap is not null and n + (select count(*) from lesson_requests where session_id = sid and status = 'pending') >= cap then raise exception 'This clinic is full.'; end if;
  insert into lesson_requests (session_id, name, contact, note) values (sid, left(trim(who), 80), left(trim(contact), 120), left(note, 500));
end $$;
-- The trainer takes a sign-up: it becomes one of their athletes, booked into the clinic.
create or replace function public.lesson_request_decide(rid uuid, accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare q lesson_requests; aid text;
begin
  select q2.* into q from lesson_requests q2 join lesson_sessions s on s.id = q2.session_id where q2.id = rid and s.trainer = auth.uid();
  if q.id is null then raise exception 'Not your clinic.'; end if;
  update lesson_requests set status = case when accept then 'accepted' else 'declined' end where id = rid;
  if not accept then return null; end if;
  aid := 'la_' || replace(gen_random_uuid()::text, '-', '');
  insert into lesson_athletes (id, trainer, name, contact) values (aid, auth.uid(), q.name, q.contact);
  update lesson_sessions set athletes = array_append(athletes, aid), updated_at = now() where id = q.session_id;
  return aid;
end $$;

-- ---------- version 32: contact form, and one place to redeem any code from a coach or trainer ----------
-- Messages from the Contact page (getfloorcall.com/contact.html) and the Help links in each site. Anyone can send
-- one, signed in or not; only admins read them (Admin console → Messages).
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  name text, email text not null, topic text not null default 'question', message text not null, site text,
  status text not null default 'open' check (status in ('open', 'done'))
);
create index if not exists support_messages_open on public.support_messages (status, created_at desc);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon, authenticated;

create or replace function public.support_send(who text, email text, topic text, msg text, site text default null, trap text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(email, '')));
begin
  if coalesce(trap, '') <> '' then return; end if;  -- a field people never see; bots fill it in
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Add an email address we can reply to.'; end if;
  if length(trim(coalesce(msg, ''))) < 5 then raise exception 'Add a message.'; end if;
  if (select count(*) from support_messages where support_messages.email = e and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from support_messages where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Too many messages just now. Try again in an hour, or email support@getfloorcall.com.'; end if;
  insert into support_messages (user_id, name, email, topic, message, site)
  values (auth.uid(), left(trim(who), 80), left(e, 160),
    case when topic in ('question', 'bug', 'billing', 'club', 'privacy', 'idea') then topic else 'question' end,
    left(trim(msg), 4000), left(site, 40));
end $$;

create or replace function public.admin_support() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(to_jsonb(m) order by (m.status = 'open') desc, m.created_at desc) from (select * from support_messages order by created_at desc limit 300) m), '[]'::jsonb);
end $$;
create or replace function public.admin_support_done(mid uuid, done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update support_messages set status = case when done then 'done' else 'open' end where id = mid;
end $$;

-- A player or parent types whatever code their coach or trainer gave them: a team's code (joins the team, so the
-- team's plan covers them) or a Floorcall Lessons code (joins that athlete's lessons). One box, either kind.
create or replace function public.redeem_code(invite text, as_role text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := upper(trim(coalesce(invite, ''))); t text; r text; aid text; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform code_gate();
  select team_id, role into t, r from invites where code = c;
  if t is not null then
    insert into members (team_id, user_id, role, email, status)
    values (t, auth.uid(), r, (select email from auth.users where id = auth.uid()), case when r = 'viewer' then 'active' else 'pending' end)
    on conflict (team_id, user_id) do nothing;
    return jsonb_build_object('kind', 'team', 'id', t, 'name', (select name from teams_cloud where id = t), 'role', r);
  end if;
  select id, name into aid, nm from lesson_athletes where code = c;
  if aid is not null then
    insert into lesson_access (athlete_id, user_id, role)
    values (aid, auth.uid(), case when coalesce(as_role, (select raw_user_meta_data->>'kind' from auth.users where id = auth.uid())) = 'parent' then 'parent' else 'athlete' end)
    on conflict (athlete_id, user_id) do nothing;
    return jsonb_build_object('kind', 'lessons', 'id', aid, 'name', nm);
  end if;
  perform code_miss(invite);
  raise exception 'That code doesn''t match. Check it with your coach or trainer.';
end $$;

-- What a signed-in person is part of through someone else: teams they've joined and trainers whose lessons they're in.
-- Once billing is on, a team's plan (or a trainer's) covers its players and families; this is how a site knows.
create or replace function public.my_coverage() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', m.team_id, 'name', tc.name, 'role', m.role) order by tc.name) from members m join teams_cloud tc on tc.id = m.team_id where m.user_id = auth.uid() and m.status = 'active'), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('athlete', a.name, 'trainer', coalesce(u.raw_user_meta_data->>'name', 'Your trainer'))) from lesson_access x join lesson_athletes a on a.id = x.athlete_id join auth.users u on u.id = a.trainer where x.user_id = auth.uid()), '[]'::jsonb))
$$;

-- ---------- hardening (version 28): least privilege, re-applied every time this file runs ----------
-- Postgres lets everyone run every function, and Supabase hands anon and authenticated every table, by default.
-- Row security already guards the tables; this takes the defaults away as well and gives back exactly what each role uses.
-- Anyone (no account): the public pages only.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.watch(text), public.season_view(text), public.recruit_view(text), public.recruit_seen(text),
  public.recruit_board(text), public.beach_view(text), public.schema_version(), public.server_time(),
  public.lesson_public(text), public.lesson_signup(text, text, text, text), public.support_send(text, text, text, text, text, text) to anon;
-- Signed in: every function (each checks who is calling), except the server-only AI counter.
grant execute on all functions in schema public to authenticated;
revoke execute on function public.ai_bump(uuid), public.code_key(), public.code_gate(), public.code_miss(text) from authenticated;
-- Functions added later start closed to anyone without an account.
alter default privileges in schema public revoke execute on functions from public, anon;
-- Tables: no account needed only to send a crash report; everything else goes through the functions above.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant insert on public.app_errors to anon;
grant usage on sequence public.app_errors_id_seq to anon;
-- Uploaded pictures and film: anyone can open a file by its link (they're on public pages), but listing a bucket's
-- contents is for the team's own staff. Uploads need read access to replace a file, so staff keep it.
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    drop policy if exists "media read" on storage.objects;
    create policy "media read" on storage.objects for select to authenticated using (bucket_id = 'media' and public.is_member((storage.foldername(name))[1]));
    drop policy if exists "film read" on storage.objects;
    create policy "film read" on storage.objects for select to authenticated using (bucket_id = 'film' and public.is_member((storage.foldername(name))[1]));
  end if;
end $do$;

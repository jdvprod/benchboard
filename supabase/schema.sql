-- Benchboard cloud schema for Supabase.
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
-- A player on a public page: first name and last initial, or only the number when the family asked to keep them off public pages.
create or replace function public.public_player(d jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', d->>'id', 'num', d->>'num', 'pos', d->>'pos',
    'first', case when coalesce((d->>'hidePublic')::boolean, false) then '' else coalesce(d->>'first', '') end,
    'last', case when coalesce((d->>'hidePublic')::boolean, false) then '' else left(coalesce(d->>'last', ''), 1) end)
$$;

create or replace function public.watch(share text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s live_shares; out jsonb;
begin
  select * into s from live_shares where code = upper(trim(share));
  if s.code is null then return null; end if;
  select jsonb_build_object(
    'team', (select jsonb_build_object('name', data->>'name', 'color', data->>'color', 'level', data->>'level') from records where store = 'teams' and id = s.team_id and not deleted),
    -- only what the gamecast shows: never the coach's match notes, film link or scouting
    'match', (select jsonb_build_object('id', data->>'id', 'opp', data->>'opp', 'date', data->>'date', 'event', data->>'event', 'status', data->>'status', 'kind', data->>'kind',
                                        'bestOf', data->'bestOf', 'setTo', data->'setTo', 'cap', data->'cap', 'scrim', data->'scrim')
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
    'team', (select jsonb_build_object('name', data->>'name', 'level', data->>'level', 'schedule', coalesce(data->'schedule', '[]'::jsonb)) from records where store = 'teams' and id = s.team_id and not deleted),
    'season', (select data->>'name' from records where store = 'seasons' and id = s.season_id and not deleted),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', data->>'id', 'opp', data->>'opp', 'date', data->>'date', 'bestOf', data->'bestOf', 'setTo', data->'setTo', 'cap', data->'cap', 'status', data->>'status', 'event', data->>'event', 'site', data->>'site'))
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
create or replace function public.recruit_view(share text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('html', html, 'updated_at', updated_at) from recruit_shares where code = upper(trim(share));
$$;
grant execute on function public.recruit_view(text) to anon, authenticated;

-- ---------- schema version: the app's Settings → Setup check compares this with what it expects ----------
create or replace function public.schema_version() returns int language sql immutable as $$ select 9 $$;
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

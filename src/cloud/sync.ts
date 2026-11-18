/**
 * Two-way sync between this device and the cloud, per team.
 * Local changes are queued (survives reloads) and pushed in batches; other devices' changes are pulled
 * incrementally by server time. Conflicts: the most recent edit wins. Match event logs are per device,
 * so two coaches tracking the same match never overwrite each other; their logs merge.
 */
import { siteUrl } from "./links";
import { announce } from "./notify";
import { uploadPending } from "./media";
import { autoLogo } from "./autoLogo";
import { all, emit, get, hooks, remove, save, setClockOffset, state } from "../data/store";
import { StoreName } from "../data/model";
import { CloudError, cloudAvailable, currentUser, rest, rpc, upsert } from "./client";

const KEY = "bs-sync";
const SYNCED: StoreName[] = ["teams", "seasons", "players", "matches", "logs", "opponents", "drills", "plans", "boards"];
interface Dirty { store: StoreName; id: string; team: string; deleted: boolean; u: number }
interface SyncState { teams: string[]; since: Record<string, string>; dirty: Record<string, Dirty>; roles?: Record<string, string>; rolesFor?: string;
  /** Player fees, synced apart from the team record: the version this device has, and versions waiting to go up. */
  feesU?: Record<string, number>; feesDirty?: Record<string, number> }

const load = (): SyncState => { try { return { teams: [], since: {}, dirty: {}, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { teams: [], since: {}, dirty: {} }; } };
const S: SyncState = load();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } };

export const status = { state: "idle" as "idle" | "syncing" | "error", error: "", last: 0 };
const setStatus = (p: Partial<typeof status>) => { Object.assign(status, p); emit(); };

export const isLinked = (teamId: string | null | undefined) => !!teamId && S.teams.includes(teamId);
export const pendingCount = () => Object.keys(S.dirty).length;
/** Your role on a synced team ("owner", "coach" or "viewer"), once known. */
/** Teams this account asked to join with a coach code, still waiting for the owner. */
export const pendingTeams = () => Object.entries(S.roles || {}).filter(([t, r]) => r === "pending" && S.teams.includes(t)).map(([t]) => t);
export const joinedMsg = (teamId: string) => (get("teams", teamId) ? "Joined the team" : "Asked to join. The head coach approves you on their Team tab, then the team appears here.");
export const roleOn = (teamId: string | null | undefined) => (teamId && S.roles?.[teamId]) || null;

/** Which team a record belongs to. */
export function teamOf(store: StoreName, v: any): string | null {
  if (store === "teams") return v.id;
  if (store === "logs") return get("matches", v.matchId)?.teamId || null;
  return v.teamId || null;
}

function markDirty(store: StoreName, v: any, deleted: boolean) {
  if (!SYNCED.includes(store)) return;
  const team = teamOf(store, v); if (!team || !isLinked(team)) return;
  S.dirty[store + "|" + v.id] = { store, id: v.id, team, deleted, u: v._u || Date.now() };
  persist(); schedulePush();
}

let pushTimer: any = null;
function schedulePush(ms = 1500) { if (pushTimer) clearTimeout(pushTimer); pushTimer = setTimeout(() => { pushTimer = null; syncNow(); }, ms); }

/* ---------- push / pull ---------- */
async function push() {
  const byTeam = new Map<string, Dirty[]>();
  for (const d of Object.values(S.dirty)) { const l = byTeam.get(d.team) || []; l.push(d); byTeam.set(d.team, l); }
  let blocked = 0;
  for (const [team, items] of byTeam) {
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      const rows = chunk.map((d) => {
        const cur: any = d.deleted ? null : get(d.store, d.id);
        return { store: d.store, id: d.id, team_id: d.team, data: d.store === "teams" ? withoutFees(cur) : cur, u: cur?._u || d.u, deleted: d.deleted || !cur };
      });
      try { await upsert("records", rows, "store,id"); }
      catch (e) {
        // View-only (or removed from the team): the server will never accept these, so stop retrying them
        // instead of blocking every other change behind them.
        if (e instanceof CloudError && e.status === 403) { for (const d of chunk) delete S.dirty[d.store + "|" + d.id]; blocked += chunk.length; persist(); break; }
        throw e;
      }
      for (const d of chunk) { const k = d.store + "|" + d.id; if (S.dirty[k] && S.dirty[k].u <= d.u) delete S.dirty[k]; }
      persist();
    }
    void team;
  }
  return blocked;
}

/** Measure this device's clock against the server's (every 10 minutes at most). */
let clockChecked = 0;
async function checkClock() {
  if (Date.now() - clockChecked < 600000) return; clockChecked = Date.now();
  const t0 = Date.now(), server = +(await rpc("server_time", {}, true)), t1 = Date.now();
  if (server > 0 && t1 - t0 < 4000) setClockOffset(server - (t0 + t1) / 2);
}

async function loadRoles() {
  const me = currentUser(); if (!me) return;
  if (S.rolesFor !== me.id) { S.roles = {}; S.rolesFor = me.id; }
  const missing = S.teams.filter((t) => !S.roles?.[t] || S.roles[t] === "pending"); if (!missing.length) return;
  // a coach who joined with a coach code is "pending" until the team's owner approves them (database version 30)
  const rows: any[] = await rest(`members?select=team_id,role,status&user_id=eq.${me.id}`).catch(() => rest(`members?select=team_id,role&user_id=eq.${me.id}`));
  const was = S.roles || {};
  S.roles = { ...was }; for (const r of rows) S.roles[r.team_id] = r.status === "pending" ? "pending" : r.role;
  persist();
  if (missing.some((t) => was[t] === "pending" && S.roles?.[t] !== "pending")) { for (const t of missing) S.since[t] = "1970-01-01T00:00:00Z"; persist(); emit(); }
}

export function applyRemote(r: { store: StoreName; id: string; data: any; u: number; deleted: boolean }) {
  if (!SYNCED.includes(r.store)) return false;
  const local: any = get(r.store, r.id);
  const pending = S.dirty[r.store + "|" + r.id];
  if (pending && pending.u > r.u) return false;           // our unsent edit is newer
  if (local && (local._u || 0) >= r.u) return false;        // already have this version or a newer one
  if (r.deleted) { if (local) { remove(r.store, r.id, true, true); return true; } return false; }
  if (!r.data) return false;
  // a team record never carries fees (they sync on their own, coaches only): keep this device's
  const data = r.store === "teams" ? { ...withoutFees(r.data), ...(local?.fees !== undefined ? { fees: local.fees } : {}) } : r.data;
  save(r.store, { ...data, _u: r.u }, true, true);
  return true;
}

async function pull(teamId: string) {
  let since = S.since[teamId] || "1970-01-01T00:00:00Z", changed = false;
  // Look back a little: a slow write can commit with a timestamp just before rows we already pulled.
  // Re-reading a few rows is harmless (applyRemote skips versions we already have).
  let from = new Date(Math.max(0, new Date(since).getTime() - 15000)).toISOString();
  for (let page = 0; page < 50; page++) {
    const rows: any[] = await rest(`records?select=store,id,data,u,deleted,updated_at&team_id=eq.${encodeURIComponent(teamId)}&updated_at=gte.${encodeURIComponent(from)}&order=updated_at.asc&limit=500`);
    // teams and matches first so logs can find their match
    const order: Record<string, number> = { teams: 0, seasons: 1, players: 1, matches: 2 };
    for (const r of rows.slice().sort((a, b) => (order[a.store] ?? 3) - (order[b.store] ?? 3))) changed = applyRemote(r) || changed;
    if (rows.length) { since = rows[rows.length - 1].updated_at; from = since; }
    if (rows.length < 500) break;
  }
  S.since[teamId] = since; persist();
  return changed;
}

let running: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  if (!cloudAvailable() || !currentUser() || !S.teams.length) return Promise.resolve();
  running ||= (async () => {
    setStatus({ state: "syncing", error: "" });
    try {
      await checkClock().catch(() => {});
      await loadRoles().catch(() => {});
      const blocked = await push();
      let changed = false;
      for (const t of S.teams) changed = (await pull(t)) || changed;
      for (const t of S.teams) changed = (await syncFees(t).catch(() => false)) || changed;
      if (changed) { if (!state.prefs.teamId || !get("teams", state.prefs.teamId)) state.prefs.teamId = S.teams.find((t) => get("teams", t)) || state.prefs.teamId; }
      setStatus(blocked ? { state: "error", error: "You have view-only access to this team, so changes made on this device stay here." } : { state: "idle", last: Date.now() });
      if (!blocked) await announce((t) => roleOn(t), (t) => S.teams.includes(t)).catch(() => {});
      if (!blocked) await streamLinks().catch(() => {});
      if (!blocked) await uploadPending(S.teams, (t) => roleOn(t) === "owner" || roleOn(t) === "coach").catch(() => {});
    } catch (e) {
      setStatus({ state: "error", error: e instanceof CloudError ? e.message : "Sync failed. It will try again." });
    } finally { running = null; }
  })();
  return running;
}

/* ---------- team actions ---------- */
/** Upload a team that only lives on this device, so other coaches can join it. */
export async function linkTeam(teamId: string) {
  const t = get("teams", teamId); if (!t) return;
  try { await rest("teams_cloud", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ id: t.id, name: t.name }) }); }
  catch (e) { if (!(e instanceof CloudError && e.status === 409)) throw e; }
  if (!S.teams.includes(teamId)) S.teams.push(teamId);
  for (const s of SYNCED) for (const v of all(s) as any[]) if (teamOf(s, v) === teamId) S.dirty[s + "|" + v.id] = { store: s, id: v.id, team: teamId, deleted: false, u: v._u || Date.now() };
  persist(); emit();
  await syncNow();
  if (status.state === "error") throw new CloudError(0, status.error);
}

export async function joinWithCode(code: string): Promise<string> {
  const teamId: string | null = await rpc("join_team", { invite: code.trim().toUpperCase() });
  if (!teamId) throw new CloudError(400, "That code doesn't match a team. Check it with the coach.");
  if (!S.teams.includes(teamId)) S.teams.push(teamId);
  S.since[teamId] = "1970-01-01T00:00:00Z"; persist();
  await syncNow();
  if (get("teams", teamId)) { state.prefs.teamId = teamId; try { localStorage.setItem("bs-prefs", JSON.stringify(state.prefs)); } catch { /* ignore */ } }
  else { S.roles = { ...(S.roles || {}), [teamId]: "pending" }; persist(); } // a coach code: the owner approves them first
  emit();
  return teamId;
}

/** After signing in on a new device: bring down every team this account belongs to. */
export async function restoreTeams(): Promise<number> {
  const me = currentUser(); if (!me) return 0;
  const rows: { team_id: string }[] = await rest(`members?select=team_id&user_id=eq.${me.id}`);
  let added = 0;
  for (const r of rows) if (!S.teams.includes(r.team_id)) { S.teams.push(r.team_id); S.since[r.team_id] = "1970-01-01T00:00:00Z"; added++; }
  persist();
  if (added) await syncNow();
  if ((!state.prefs.teamId || !get("teams", state.prefs.teamId)) && rows.length) {
    const first = rows.map((r) => r.team_id).find((id) => get("teams", id));
    if (first) { state.prefs.teamId = first; try { localStorage.setItem("bs-prefs", JSON.stringify(state.prefs)); } catch { /* ignore */ } }
  }
  emit();
  return added;
}

export function unlinkTeam(teamId: string) {
  S.teams = S.teams.filter((t) => t !== teamId); delete S.since[teamId];
  for (const k of Object.keys(S.dirty)) if (S.dirty[k].team === teamId) delete S.dirty[k];
  persist(); emit();
}

const code = (n = 6) => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; const r = crypto.getRandomValues(new Uint32Array(n)); for (const x of r) s += a[x % a.length]; return s; };

export async function createInvite(teamId: string, role: "coach" | "viewer" = "coach") {
  const c = code(6);
  await rest("invites", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ code: c, team_id: teamId, role }) });
  return c;
}
export type Member = { user_id: string; role: string; email: string | null; status?: "active" | "pending" };
export async function members(teamId: string): Promise<Member[]> {
  const q = (cols: string) => rest(`members?select=${cols}&team_id=eq.${encodeURIComponent(teamId)}&order=joined_at.asc`);
  return q("user_id,role,email,status").catch(() => q("user_id,role,email"));
}
/** The team's owner lets a coach who joined with a coach code in, or turns them away. */
export async function decideMember(teamId: string, userId: string, approve: boolean) {
  await rpc("team_decide_member", { t: teamId, uid: userId, approve });
}

/* ---------- verified coaches (database version 30) ---------- */
export type CoachStatus = { status: "none" | "pending" | "approved" | "denied"; admin?: boolean; name?: string; org?: string };
/** Whether this account may put teams in the cloud. Before version 30 there's no check, so everyone may. */
export async function coachStatus(): Promise<CoachStatus> {
  try { return (await rpc("coach_status", {})) || { status: "none" }; }
  catch (e) { if (e instanceof CloudError && (e.status === 404 || /coach_status/.test(e.message))) return { status: "approved" }; throw e; }
}
export async function coachRequest(p: { name: string; org: string; title: string; phone: string }): Promise<CoachStatus["status"]> {
  return rpc("coach_request", { name: p.name, org: p.org, title: p.title || null, phone: p.phone || null });
}
export async function removeMember(teamId: string, userId: string) {
  await rest(`members?team_id=eq.${encodeURIComponent(teamId)}&user_id=eq.${userId}`, { method: "DELETE" });
}

/** A public link parents can open to follow one match live. */
export async function shareLive(teamId: string, matchId: string) {
  const r = await ensureLiveShare(teamId, matchId);
  await syncNow();
  return r;
}
/** Live matches on synced teams get their gamecast link without the coach doing anything (for the recap text and families). */
async function streamLinks() {
  for (const m of all("matches")) {
    if (m.kind !== "match" || m.status !== "live" || m.imported || !S.teams.includes(m.teamId)) continue;
    const t = all("teams").find((x) => x.id === m.teamId), role = roleOn(m.teamId);
    if (!t || (role !== "owner" && role !== "coach")) continue;
    try { if (localStorage.getItem("bs-live-url-" + m.id)) continue; } catch { /* private mode */ }
    if (Date.now() - m.createdAt > 6 * 3600_000) continue;
    await ensureLiveShare(m.teamId, m.id);
  }
}
/** The gamecast link for a match, made once. Remembered on this device for TV mode's QR code. */
export async function ensureLiveShare(teamId: string, matchId: string) {
  const existing: any[] = await rest(`live_shares?select=code&team_id=eq.${encodeURIComponent(teamId)}&match_id=eq.${encodeURIComponent(matchId)}&limit=1`);
  const c = existing[0]?.code || code(6);
  if (!existing[0]) await rest("live_shares", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ code: c, team_id: teamId, match_id: matchId }) });
  const url = siteUrl("live", "g/" + c);
  try { localStorage.setItem("bs-live-url-" + matchId, url); } catch { /* private mode */ }
  return { code: c, url };
}

/** A read-only season page for players and parents: results, schedule, leaders and every player's line. */
export async function shareSeason(teamId: string, seasonId: string) {
  const existing: any[] = await rest(`season_shares?select=code&team_id=eq.${encodeURIComponent(teamId)}&season_id=eq.${encodeURIComponent(seasonId)}&limit=1`);
  const c = existing[0]?.code || code(6);
  if (!existing[0]) await rest("season_shares", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ code: c, team_id: teamId, season_id: seasonId }) });
  await syncNow();
  return { code: c, url: siteUrl("live", "t/" + c) };
}

/** Publish (or refresh) a player's recruiting page. The page is a snapshot: tap again after new matches. */
export async function shareRecruit(teamId: string, playerId: string, html: string, data?: unknown, listed = false) {
  const existing: any[] = await rest(`recruit_shares?select=code&team_id=eq.${encodeURIComponent(teamId)}&player_id=eq.${encodeURIComponent(playerId)}&limit=1`);
  let c = existing[0]?.code;
  if (c) await rest(`recruit_shares?code=eq.${c}`, { method: "PATCH", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ html, data: data ?? null, listed, updated_at: new Date().toISOString() }) });
  else { c = code(6); await rest("recruit_shares", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ code: c, team_id: teamId, player_id: playerId, html, data: data ?? null, listed }) }); }
  return { code: c as string, url: siteUrl("recruit", "p/" + c) };
}
/** One link for college coaches listing every player on the team with a shared recruiting profile. */
export async function shareBoard(teamId: string) {
  const existing: any[] = await rest(`recruit_boards?select=code&team_id=eq.${encodeURIComponent(teamId)}&limit=1`);
  const c = existing[0]?.code || code(6);
  if (!existing[0]) await rest("recruit_boards", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ code: c, team_id: teamId }) });
  return { code: c as string, url: siteUrl("recruit", "b/" + c) };
}
/** Show or hide a shared profile in college coach search. */
export async function setRecruitListed(teamId: string, playerId: string, listed: boolean) {
  await rest(`recruit_shares?team_id=eq.${encodeURIComponent(teamId)}&player_id=eq.${encodeURIComponent(playerId)}`, { method: "PATCH", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ listed }) });
}
/** How many times the player's shared profile was opened, and when last. */
export async function recruitViews(teamId: string, playerId: string): Promise<{ views: number; last: string | null } | null> {
  const r: any[] = await rest(`recruit_shares?select=views,last_viewed&team_id=eq.${encodeURIComponent(teamId)}&player_id=eq.${encodeURIComponent(playerId)}&limit=1`);
  return r[0] ? { views: r[0].views || 0, last: r[0].last_viewed || null } : null;
}
export async function unshareRecruit(teamId: string, playerId: string) {
  await rest(`recruit_shares?team_id=eq.${encodeURIComponent(teamId)}&player_id=eq.${encodeURIComponent(playerId)}`, { method: "DELETE" });
}

/* ---------- start ---------- */
let started = false;
export function startSync() {
  if (started) return; started = true;
  hooks.change = markDirty;
  hooks.who = () => currentUser()?.email || null;
  hooks.teamRemoved = (id) => unlinkTeam(id);
  hooks.newOpponent = (o) => { autoLogo(o).catch(() => {}); };
  const tick = () => { if (document.visibilityState === "visible") syncNow(); };
  setInterval(() => {
    const live = all("matches").some((m) => m.status === "live" && isLinked(m.teamId));
    if (live || Date.now() - status.last > 30_000) tick();
  }, 8_000);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("online", () => { emit(); tick(); });
  window.addEventListener("offline", () => emit());
  setTimeout(tick, 500);
}

/** Delete this account in the cloud: the user, the cloud teams they own and their memberships. Local data stays unless erased too. */
export async function deleteAccount() {
  await rpc("delete_my_account", {});
  S.teams = []; S.since = {}; S.dirty = {}; S.roles = {}; persist();
}

/* ---------- player fees: owner and coaches only ---------- */
const withoutFees = (v: any) => { if (!v || !("fees" in v)) return v; const { fees, ...rest } = v; void fees; return rest; };
/** Call after changing a team's fees on this device. */
export function markFeesDirty(teamId: string) {
  if (!isLinked(teamId)) return;
  const u = Date.now(); S.feesDirty = { ...(S.feesDirty || {}), [teamId]: u }; S.feesU = { ...(S.feesU || {}), [teamId]: u }; persist(); schedulePush();
}
/** Push this device's fees if they changed, otherwise take the newer copy from the cloud. Viewers never ask. */
async function syncFees(teamId: string): Promise<boolean> {
  const role = roleOn(teamId); if (role !== "owner" && role !== "coach") return false;
  const t: any = get("teams", teamId); if (!t) return false;
  const dirty = S.feesDirty?.[teamId];
  if (dirty) {
    await upsert("team_fees", [{ team_id: teamId, data: t.fees ?? null, u: dirty }], "team_id");
    if (S.feesDirty?.[teamId] === dirty) { const d = { ...S.feesDirty }; delete d[teamId]; S.feesDirty = d; persist(); }
    return false;
  }
  const rows: any[] = await rest(`team_fees?select=data,u&team_id=eq.${encodeURIComponent(teamId)}`);
  const r = rows[0]; if (!r || +r.u <= (S.feesU?.[teamId] || 0)) return false;
  save("teams", { ...t, fees: r.data ?? null }, true, true);
  S.feesU = { ...(S.feesU || {}), [teamId]: +r.u }; persist();
  return true;
}

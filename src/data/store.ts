/**
 * App state. Everything is loaded into memory at start (a season of volleyball is small),
 * changes are written through to IndexedDB, and React re-renders from a version counter.
 */
import { useSyncExternalStore } from "react";
import * as db from "./db";
import { DEFAULT_SETTINGS, Drill, EventLog, Lineup, Match, Opponent, Player, PracticePlan, Prefs, Season, StoreName, StoreTypes, Team, Board } from "./model";
import { mergeLogs, MatchEvent, replay, Replay } from "../sports/volleyball/engine";

type Tables = { [K in StoreName]: Map<string, StoreTypes[K]> };

export const state = {
  ready: false,
  persistent: true,
  tables: Object.fromEntries(["teams", "seasons", "players", "matches", "logs", "opponents", "drills", "plans", "boards", "kv"].map((s) => [s, new Map()])) as Tables,
  prefs: loadPrefs(),
  toast: null as null | { msg: string; at: number; action?: { label: string; fn: () => void } },
};

/* ---------- subscriptions ---------- */
let version = 0;
const listeners = new Set<() => void>();
export function emit() { version++; listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
/** Re-render when anything changes. */
export function useVersion() { return useSyncExternalStore(subscribe, () => version); }

/* ---------- ids and devices ---------- */
/** Device clock corrected to the server's, so plays from several coaches' phones merge in the right order. */
let clockOffset = 0;
export const now = () => Date.now() + clockOffset;
export function setClockOffset(ms: number) { clockOffset = Math.abs(ms) > 750 ? Math.round(ms) : 0; }
export const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const DEVICE = (() => {
  let d: string | null = null;
  try { d = localStorage.getItem("bs-device"); } catch { /* ignore */ }
  if (!d) { d = "d" + Math.random().toString(36).slice(2, 9); try { localStorage.setItem("bs-device", d); } catch { /* ignore */ } }
  return d;
})();
let seq = 0;
export const eventId = () => DEVICE + "-" + Date.now().toString(36) + (seq++).toString(36);
export const isMine = (id: string) => id.startsWith(DEVICE + "-");

/* ---------- prefs (per device) ---------- */
function loadPrefs(): Prefs {
  try { return Object.assign({ theme: "system", size: "normal", teamId: null }, JSON.parse(localStorage.getItem("bs-prefs") || "{}")); }
  catch { return { theme: "system", size: "normal", teamId: null }; }
}
export function setPrefs(p: Partial<Prefs>) {
  state.prefs = { ...state.prefs, ...p };
  try { localStorage.setItem("bs-prefs", JSON.stringify(state.prefs)); } catch { /* ignore */ }
  emit();
}

/* ---------- generic table access ---------- */
export function all<K extends StoreName>(s: K): StoreTypes[K][] { return Array.from(state.tables[s].values()) as StoreTypes[K][]; }
export function get<K extends StoreName>(s: K, id: string | null | undefined): StoreTypes[K] | undefined { return id ? (state.tables[s].get(id) as StoreTypes[K] | undefined) : undefined; }
/** Cloud sync listens here: every local change (not ones that came from the cloud). */
export const hooks = { who: null as null | (() => string | null), change: null as null | ((s: StoreName, v: any, deleted: boolean) => void), paused: false, teamRemoved: null as null | ((teamId: string) => void) };

export function save<K extends StoreName>(s: K, v: StoreTypes[K], silent = false, fromCloud = false) {
  if (!fromCloud) (v as any)._u = Math.max(now(), ((state.tables[s].get((v as any).id) as any)?._u || 0) + 1);
  (state.tables[s] as Map<string, StoreTypes[K]>).set((v as any).id, v);
  db.put(s, v);
  if (s === "logs") replayCache.delete((v as unknown as EventLog).matchId);
  if (!fromCloud && !hooks.paused) hooks.change?.(s, v, false);
  if (!silent) emit();
}
export function remove(s: StoreName, id: string, silent = false, fromCloud = false) {
  const v: any = state.tables[s].get(id);
  state.tables[s].delete(id); db.del(s, id);
  if (s === "logs" && v) replayCache.delete(v.matchId);
  if (!fromCloud && !hooks.paused && v) hooks.change?.(s, { ...v, _u: now() }, true);
  if (!silent) emit();
}
export function patch<K extends StoreName>(s: K, id: string, p: Partial<StoreTypes[K]>) {
  const v = get(s, id); if (!v) return;
  save(s, { ...(v as any), ...p });
}

export function toast(msg: string, action?: { label: string; fn: () => void }) { state.toast = { msg, at: Date.now(), action }; emit(); }
db.setStorageErrorHandler((m: string) => toast(m));

/* ---------- loading ---------- */
export async function init() {
  const data = await db.loadAll();
  state.persistent = await db.isPersistent();
  for (const s of Object.keys(data) as StoreName[]) for (const v of data[s]) (state.tables[s] as Map<string, any>).set(v.id, v);
  // migrate settings added in later versions
  for (const t of all("teams")) t.settings = { ...DEFAULT_SETTINGS, ...t.settings };
  if (state.prefs.teamId && !get("teams", state.prefs.teamId)) state.prefs.teamId = null;
  if (!state.prefs.teamId) state.prefs.teamId = all("teams").sort((a, b) => a.createdAt - b.createdAt)[0]?.id || null;
  state.ready = true;
  db.requestPersistence();
  emit();
}

/* ---------- selectors ---------- */
export const team = (): Team | undefined => get("teams", state.prefs.teamId);
export const teamPlayers = (teamId = state.prefs.teamId): Player[] => all("players").filter((p) => p.teamId === teamId).sort((a, b) => (+a.num || 0) - (+b.num || 0) || a.num.localeCompare(b.num));
export const activePlayers = (teamId = state.prefs.teamId) => teamPlayers(teamId).filter((p) => p.active);
export const player = (id: string | null | undefined) => get("players", id);
export const seasonsOf = (teamId = state.prefs.teamId): Season[] => all("seasons").filter((s) => s.teamId === teamId).sort((a, b) => b.createdAt - a.createdAt);
export const matchesOf = (teamId = state.prefs.teamId): Match[] => all("matches").filter((m) => m.teamId === teamId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
export const opponentsOf = (teamId = state.prefs.teamId): Opponent[] => all("opponents").filter((o) => o.teamId === teamId).sort((a, b) => a.name.localeCompare(b.name));
export const drillsOf = (teamId = state.prefs.teamId): Drill[] => all("drills").filter((d) => d.teamId === teamId).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
export const plansOf = (teamId = state.prefs.teamId): PracticePlan[] => all("plans").filter((p) => p.teamId === teamId).sort((a, b) => b.date.localeCompare(a.date));
export const currentMatch = (): Match | undefined => { const t = team(); return t ? get("matches", t.currentMatchId) : undefined; };
export const boardOf = (name: Board["name"], teamId = state.prefs.teamId): Board => get("boards", teamId + ":" + name) || { id: teamId + ":" + name, teamId: teamId || "", name, strokes: [] };

export function playerName(id: string | null | undefined, style: "short" | "full" | "first" = "short"): string {
  const p = player(id);
  if (!p) return "Removed player";
  if (style === "first") return p.first || p.last;
  const n = p.num ? `#${p.num} ` : "";
  if (style === "full") return `${n}${p.first} ${p.last}`.trim();
  return `${n}${p.first || p.last}`.trim();
}

/* ---------- events and replay ---------- */
export function logsOf(matchId: string): EventLog[] { return all("logs").filter((l) => l.matchId === matchId); }
export function eventsOf(matchId: string): MatchEvent[] { return mergeLogs(logsOf(matchId).map((l) => l.events)); }

const replayCache = new Map<string, { R: Replay; key: string }>();
export function replayOf(m: Match | undefined | null): Replay | null {
  if (!m) return null;
  const key = m.bestOf + "|" + (m.setTo || 25) + "|" + (m.cap || 0) + "|" + JSON.stringify(m.scrim);
  const hit = replayCache.get(m.id);
  if (hit && hit.key === key) return hit.R;
  const R = replay(eventsOf(m.id), { id: m.id, bestOf: m.bestOf, scrim: m.scrim, setTo: m.setTo, cap: m.cap });
  replayCache.set(m.id, { R, key });
  return R;
}

export function appendEvents(matchId: string, evs: Partial<MatchEvent>[]): MatchEvent | null {
  const id = matchId + "|" + DEVICE;
  const log = { ...(get("logs", id) || { id, matchId, device: DEVICE, events: [] }), ...stamp(matchId) };
  let ts = now();
  const lastTs = log.events.length ? log.events[log.events.length - 1].ts : 0;
  if (ts <= lastTs) ts = lastTs + 1;
  const added = evs.map((e) => ({ ...e, id: e.id || eventId(), ts: e.ts || ts++ }) as MatchEvent);
  save("logs", { ...log, events: log.events.concat(added) });
  return added[added.length - 1] || null;
}
/** This device's name and job, written on its event log for the match. */
function stamp(matchId: string): Partial<EventLog> {
  const m = get("matches", matchId), job = m && m.kind === "match" && !m.scrim ? state.prefs.job || "all" : "all";
  return { by: hooks.who?.() || undefined, job, groups: job === "stats" ? state.prefs.jobGroups : undefined, seen: now() };
}
/** Re-stamp this device's log after the job changes, so other coaches see it right away. */
export function stampLog(matchId: string) {
  const id = matchId + "|" + DEVICE, log = get("logs", id) || { id, matchId, device: DEVICE, events: [] };
  save("logs", { ...log, ...stamp(matchId) });
}
export function patchEvent(matchId: string, eventIdToPatch: string, p: Record<string, any>) {
  const log = get("logs", matchId + "|" + DEVICE); if (!log) return;
  save("logs", { ...log, events: log.events.map((e) => (e.id === eventIdToPatch ? ({ ...e, ...p } as MatchEvent) : e)) });
}
export function deleteEvent(matchId: string, ref: string) { appendEvents(matchId, [{ t: "DEL", ref } as any]); }

/** Change any event, including another coach's: delete it and add a copy at the same moment. */
export function replaceEvent(matchId: string, old: MatchEvent, p: Record<string, any>) {
  const copy: any = { ...old, ...p, id: eventId(), ts: old.ts };
  for (const k of Object.keys(copy)) if (copy[k] === undefined) delete copy[k];
  appendEvents(matchId, [{ t: "DEL", ref: old.id } as any, copy]);
}
/** Add a missed play just before another one. */
export function insertBefore(matchId: string, before: MatchEvent, e: Partial<MatchEvent>) {
  appendEvents(matchId, [{ ...e, ts: before.ts - 1 } as any]);
}

/** Undo the last thing this device recorded. */
export function undoLast(matchId: string): MatchEvent | null {
  const evs = eventsOf(matchId);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (!isMine(e.id)) continue;
    if (e.t === "NS" && evs.filter((x) => x.t === "NS").length === 1) return null;
    deleteEvent(matchId, e.id);
    return e;
  }
  return null;
}

/* ---------- teams ---------- */
export function createTeam(p: { name: string; level?: string; color?: string; sample?: boolean }): Team {
  const t: Team = { id: uid("t"), name: p.name, level: p.level || "", color: p.color || "#2A78AE", createdAt: Date.now(), activeSeasonId: null, currentMatchId: null, settings: { ...DEFAULT_SETTINGS }, defLineup: null, sample: p.sample };
  const s: Season = { id: uid("s"), teamId: t.id, name: defaultSeasonName(), createdAt: Date.now() };
  t.activeSeasonId = s.id;
  save("seasons", s, true); save("teams", t, true);
  setPrefs({ teamId: t.id });
  return t;
}
export function defaultSeasonName(d = new Date()) { const m = d.getMonth(); return (m >= 6 ? "Fall " : m <= 1 ? "Winter " : "Spring ") + d.getFullYear(); }

/** Removes a team from this device. A team synced to the cloud stays in the cloud for the other coaches. */
export function deleteTeam(teamId: string) {
  hooks.paused = true;
  for (const s of ["seasons", "players", "matches", "opponents", "drills", "plans", "boards"] as StoreName[])
    for (const v of all(s) as any[]) if (v.teamId === teamId) remove(s, v.id, true);
  const matchIds = new Set(all("matches").filter((m) => m.teamId === teamId).map((m) => m.id));
  for (const l of all("logs")) if (matchIds.has(l.matchId)) remove("logs", l.id, true);
  remove("teams", teamId, true);
  hooks.paused = false;
  hooks.teamRemoved?.(teamId);
  if (state.prefs.teamId === teamId) state.prefs.teamId = all("teams")[0]?.id || null;
  setPrefs({ teamId: state.prefs.teamId });
}

export function deleteMatch(matchId: string) {
  for (const l of logsOf(matchId)) remove("logs", l.id, true);
  const m = get("matches", matchId);
  remove("matches", matchId, true);
  if (m) { const t = get("teams", m.teamId); if (t && t.currentMatchId === matchId) save("teams", { ...t, currentMatchId: null }, true); }
  emit();
}

/** A date as YYYY-MM-DD in the coach's own time zone (toISOString would give tomorrow's date on a US evening). */
export const localISO = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const todayISO = () => localISO(new Date());

export function newMatch(o: Partial<Match> & { serve?: "us" | "them"; events?: MatchEvent[]; lineup?: Lineup | null }): Match {
  const t = team()!;
  const prev = currentMatch();
  if (prev && prev.status !== "done") save("matches", { ...prev, status: "done" }, true);
  const m: Match = {
    id: uid("m"), teamId: t.id, seasonId: t.activeSeasonId, kind: o.kind || "match", opp: o.opp || (o.kind === "match" || !o.kind ? "Opponent" : "Practice"),
    date: o.date || todayISO(), bestOf: o.bestOf || t.settings.bestOf, setTo: o.setTo, cap: o.cap ?? null, status: "live", site: o.site || "", event: o.event || "", notes: o.notes || "",
    oppPlayers: o.oppPlayers || [], scrim: o.scrim || null, filmStart: null, nextLu: null, report: "", reportAt: null, planId: o.planId || null, createdAt: Date.now(), sample: o.sample,
  };
  save("matches", m, true);
  if (m.kind === "match") ensureOpponent(m.opp);
  save("teams", { ...t, currentMatchId: m.id }, true);
  const lu = o.lineup !== undefined ? o.lineup : m.kind === "match" ? t.defLineup : null;
  const first: any = { t: "NS", serve: o.serve || "us" };
  if (lu && lu.lu.length === 6) Object.assign(first, { lu: lu.lu.slice(), lib: lu.lib, libSrv: lu.libSrv });
  appendEvents(m.id, o.events || [first]);
  return m;
}

export const oppKey = (name: string) => name.toLowerCase().replace(/\(sample\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export function ensureOpponent(name: string): Opponent {
  const t = team()!; const k = oppKey(name);
  const ex = opponentsOf(t.id).find((o) => oppKey(o.name) === k);
  if (ex) return ex;
  const o: Opponent = { id: uid("o"), teamId: t.id, name: name.replace(/\s*\(sample\)/i, ""), notes: "", scout: "", scoutAt: null };
  save("opponents", o, true);
  return o;
}

export function setTeamPatch(p: Partial<Team>) { const t = team(); if (t) save("teams", { ...t, ...p }); }
export function setSettings(p: Partial<Team["settings"]>) { const t = team(); if (t) save("teams", { ...t, settings: { ...t.settings, ...p } }); }

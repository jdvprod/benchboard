/** Backups: save everything to one file, restore it anywhere. Also imports the first version's backups. */
import { Match, Player, StoreName } from "./model";
import { all, appendEvents, createTeam, emit, localISO, get, save, setPrefs, team, uid } from "./store";
import { addStarterDrills } from "./seed";

const TABLES: StoreName[] = ["teams", "seasons", "players", "matches", "logs", "opponents", "drills", "plans", "boards"];

export function exportAll(teamId?: string) {
  const out: any = { app: "bench-stats", version: 2, exportedAt: Date.now() };
  const teamIds = new Set(all("teams").filter((t) => !teamId || t.id === teamId).map((t) => t.id));
  const matchIds = new Set(all("matches").filter((m) => teamIds.has(m.teamId)).map((m) => m.id));
  for (const s of TABLES) {
    out[s] = (all(s) as any[]).filter((v) => (s === "teams" ? teamIds.has(v.id) : s === "logs" ? matchIds.has(v.matchId) : teamIds.has(v.teamId)));
  }
  return JSON.stringify(out);
}

export interface ImportResult { ok: boolean; message: string }

export function importBackup(text: string): ImportResult {
  let d: any;
  try { d = JSON.parse(text); } catch { return { ok: false, message: "That file isn't a Benchboard backup." }; }
  if (!d || d.app !== "bench-stats") return { ok: false, message: "That file isn't a Benchboard backup." };
  if (d.version === 1 || (!d.version && d.cfg)) return importV1(d);
  let added = 0, skipped = 0, firstTeam: string | null = null;
  for (const s of TABLES) for (const v of d[s] || []) { if (s === "teams" && !firstTeam) firstTeam = v.id; if (get(s, v.id)) { skipped++; continue; } save(s, v, true); added++; }
  // on a new device there's no team open yet: open the first restored one
  if (firstTeam && !team()) setPrefs({ teamId: firstTeam });
  emit();
  return { ok: true, message: `Restored ${added} records${skipped ? `, skipped ${skipped} you already had` : ""}.` };
}

/** First version (single-file app) backup: one team, its matches and practices. */
function importV1(d: any): ImportResult {
  const cfg = d.cfg || {};
  const t = createTeam({ name: cfg.team || "My Team", level: "" });
  addStarterDrills(t.id);
  const players = (cfg.roster || []) as any[];
  for (const r of players) {
    const parts = String(r.name || "").trim().split(/\s+/);
    const p: Player = { id: r.id, teamId: t.id, num: String(r.num || ""), first: parts[0] || "", last: parts.slice(1).join(" "), pos: r.pos || "OH", grad: null, height: "", active: r.active !== false, goals: [], notes: "" };
    if (!get("players", p.id)) save("players", p, true);
  }
  const settings = { ...t.settings };
  if (cfg.subLimit != null) settings.subLimit = +cfg.subLimit;
  if (cfg.bestOf) settings.bestOf = +cfg.bestOf;
  if (cfg.askLoc != null) settings.askLoc = !!cfg.askLoc;
  if (cfg.askOpp != null) settings.askOpp = !!cfg.askOpp;
  const defL = cfg.defLineup && Array.isArray(cfg.defLineup.lu) ? { lu: cfg.defLineup.lu, lib: cfg.defLineup.lib || null, libSrv: cfg.defLineup.libSrv || null } : null;
  save("teams", { ...t, settings, defLineup: defL, scrimSplit: cfg.scrimSplit || null }, true);
  let count = 0;
  for (const it of d.matches || []) {
    const mm = it && it.meta; if (!mm || !Array.isArray(it.events)) continue;
    const kind = mm.scrim ? "scrimmage" : mm.practice ? "drills" : "match";
    const m: Match = {
      id: mm.id || uid("m"), teamId: t.id, seasonId: t.activeSeasonId, kind, opp: String(mm.opp || "").replace(/^Scrimmage:\s*/, kind === "scrimmage" ? "Scrimmage: " : ""),
      date: mm.date || localISO(new Date(mm.createdAt || Date.now())), bestOf: mm.bestOf || 5, status: "done", site: "", event: "",
      notes: mm.notes || "", oppPlayers: mm.oppPlayers || [], scrim: mm.scrim || null, filmStart: mm.filmStart || null, nextLu: null,
      report: mm.report || "", reportAt: mm.reportAt || null, planId: null, createdAt: mm.createdAt || Date.now(), sample: !!mm.sample,
    };
    if (get("matches", m.id)) continue;
    save("matches", m, true);
    appendEvents(m.id, it.events.map((e: any) => ({ ...e })));
    count++;
  }
  for (const k in d.opps || {}) {
    const o = d.opps[k];
    save("opponents", { id: uid("o"), teamId: t.id, name: o.name || k, notes: o.notes || "", scout: o.scout || "", scoutAt: o.scoutAt || null }, true);
  }
  for (const name of ["hit", "serve", "def"] as const) {
    const strokes = d.boards && d.boards[name];
    if (Array.isArray(strokes) && strokes.length) save("boards", { id: t.id + ":" + name, teamId: t.id, name, strokes }, true);
  }
  emit();
  return { ok: true, message: `Imported "${t.name}" with ${players.length} players and ${count} matches and practices.` };
}

/** Club operations, pure parts (unit tested): one calendar for every team, home-gym clashes, a calendar file for the
 * whole club, and leaderboards across teams. */
import type { ScheduleItem } from "../../data/model";
import type { Tournament } from "../../tournament/model";

export interface ClubTeam { id: string; name: string; level?: string; schedule?: ScheduleItem[]; tournaments?: Tournament[]; practices?: { id: string; date: string; start: string; title: string }[] }
export type EventKind = "match" | "tournament" | "practice";
export interface ClubEvent { id: string; date: string; end?: string; time: string; teamId: string; team: string; kind: EventKind; title: string; site: string; where: string }
export interface Clash { date: string; ids: string[]; teams: string[]; why: string }

const teamLabel = (t: ClubTeam) => (t.level ? `${t.name} ${t.level}` : t.name);
const mins = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ""); return m ? +m[1] * 60 + +m[2] : null; };

/** Everything every team has coming up from `from` for `days` days, in date and time order. */
export function clubEvents(teams: ClubTeam[], from: string, days = 60): ClubEvent[] {
  const until = addDays(from, days), out: ClubEvent[] = [];
  for (const t of teams) {
    const team = teamLabel(t);
    for (const s of t.schedule || []) if (s.date >= from && s.date <= until)
      out.push({ id: "m:" + t.id + ":" + s.id, date: s.date, time: s.time || "", teamId: t.id, team, kind: "match", title: `${s.site === "away" ? "at" : "vs"} ${s.opp}`, site: s.site || "", where: s.event || "" });
    for (const tn of t.tournaments || []) { const end = tn.end || tn.start; if (end >= from && tn.start <= until)
      out.push({ id: "t:" + t.id + ":" + tn.id, date: tn.start < from ? from : tn.start, end: end !== tn.start ? end : undefined, time: "", teamId: t.id, team, kind: "tournament", title: tn.name, site: "", where: tn.site || "" }); }
    for (const p of t.practices || []) if (p.date >= from && p.date <= until)
      out.push({ id: "p:" + t.id + ":" + p.id, date: p.date, time: p.start || "", teamId: t.id, team, kind: "practice", title: p.title || "Practice", site: "home", where: "" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99") || a.team.localeCompare(b.team));
}

/** Home events (matches at home and practices) that need the gym at the same time: on the same day, starting within
 * two hours of each other, or with no time set (then they might clash, so they're flagged too). */
export function homeClashes(events: ClubEvent[]): Clash[] {
  const home = events.filter((e) => (e.kind === "match" && e.site === "home") || e.kind === "practice"), out: Clash[] = [];
  const byDay = new Map<string, ClubEvent[]>(); for (const e of home) byDay.set(e.date, (byDay.get(e.date) || []).concat(e));
  for (const [date, list] of byDay) {
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; if (a.teamId === b.teamId) continue;
      const ma = mins(a.time), mb = mins(b.time), close = ma === null || mb === null || Math.abs(ma - mb) < 120;
      if (!close) continue;
      const k = [a.id, b.id].sort().join("|"); if (seen.has(k)) continue; seen.add(k);
      out.push({ date, ids: [a.id, b.id], teams: [a.team, b.team], why: ma === null || mb === null ? "both home, one has no start time" : "both need the gym within two hours" });
    }
  }
  return out;
}

/** One calendar file with every team's matches, tournaments and practices. */
export function clubIcs(events: ClubEvent[], club = "Floorcall club"): string {
  const esc = (x: string) => x.replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const d = (s: string) => s.replace(/-/g, ""), stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ev = events.map((e) => {
    const m = mins(e.time); let when: string;
    if (m !== null) { const end = Math.min(m + (e.kind === "practice" ? 120 : 120), 23 * 60 + 59), hm = (x: number) => String(Math.floor(x / 60)).padStart(2, "0") + String(x % 60).padStart(2, "0"); when = `DTSTART:${d(e.date)}T${hm(m)}00\r\nDTEND:${d(e.date)}T${hm(end)}00`; }
    else when = `DTSTART;VALUE=DATE:${d(e.date)}\r\nDTEND;VALUE=DATE:${d(addDays(e.end || e.date, 1))}`;
    const summary = `${e.team}: ${e.kind === "practice" ? e.title : e.kind === "tournament" ? e.title : e.title}`;
    return `BEGIN:VEVENT\r\nUID:${e.id.replace(/[^\w:-]/g, "")}@floorcall\r\nDTSTAMP:${stamp}\r\n${when}\r\nSUMMARY:${esc(summary)}\r\n${e.where ? "LOCATION:" + esc(e.where) + "\r\n" : ""}END:VEVENT`;
  }).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Floorcall//Club//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:${esc(club)}\r\n${ev}${ev ? "\r\n" : ""}END:VCALENDAR\r\n`;
}

export interface LeaderRow { id: string; name: string; num: string; team: string; v: number; sets: number }
/** The top `n` across the club for one number, among players with at least `minSets` sets. */
export function clubLeaders(rows: LeaderRow[], n = 10, minSets = 6): LeaderRow[] {
  return rows.filter((r) => r.sets >= minSets && isFinite(r.v) && r.v > 0).sort((a, b) => b.v - a.v || b.sets - a.sets || a.name.localeCompare(b.name)).slice(0, n);
}

export function addDays(iso: string, n: number): string { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

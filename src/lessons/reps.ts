/** FloorCall Lessons: what a trainer counts in a session, the numbers that come out of it, and calendar files. */

export type SkillId = "serving" | "passing" | "setting" | "hitting" | "defense";
export type Reps = Partial<Record<SkillId, Record<string, number>>>;

/** The buttons a trainer taps for each skill, best result first. */
export const REP_KINDS: Record<SkillId, { name: string; kinds: [string, string][]; measure: string }> = {
  serving: { name: "Serving", kinds: [["ace", "Ace"], ["in", "In"], ["out", "Error"]], measure: "Serves in" },
  passing: { name: "Passing", kinds: [["3", "3"], ["2", "2"], ["1", "1"], ["0", "0"]], measure: "Pass average" },
  setting: { name: "Setting", kinds: [["good", "On target"], ["off", "Off"]], measure: "Sets on target" },
  hitting: { name: "Hitting", kinds: [["kill", "Kill"], ["play", "In play"], ["err", "Error"]], measure: "Hitting efficiency" },
  defense: { name: "Defense", kinds: [["up", "Dug up"], ["down", "Not up"]], measure: "Digs up" },
};
export const SKILL_IDS = Object.keys(REP_KINDS) as SkillId[];

const n = (r: Record<string, number> | undefined, k: string) => Math.max(0, Math.floor(+(r?.[k] || 0)));
export const total = (r: Reps, s: SkillId) => REP_KINDS[s].kinds.reduce((a, [k]) => a + n(r[s], k), 0);
export const allReps = (r: Reps) => SKILL_IDS.reduce((a, s) => a + total(r, s), 0);

/** One number per skill (null with no reps): the number a player is told to move. */
export function measure(r: Reps, s: SkillId): number | null {
  const t = total(r, s), x = r[s];
  if (!t) return null;
  switch (s) {
    case "serving": return (n(x, "in") + n(x, "ace")) / t;
    case "passing": return (3 * n(x, "3") + 2 * n(x, "2") + n(x, "1")) / t;
    case "setting": return n(x, "good") / t;
    case "hitting": return (n(x, "kill") - n(x, "err")) / t;
    case "defense": return n(x, "up") / t;
  }
}
/** How that number is written: a pass average to two places, hitting efficiency like .312, the rest as percentages. */
export function fmtMeasure(s: SkillId, v: number | null): string {
  if (v == null) return "–";
  if (s === "passing") return v.toFixed(2);
  if (s === "hitting") return (v < 0 ? "-" : "") + Math.abs(v).toFixed(3).replace(/^0/, "");
  return Math.round(v * 100) + "%";
}
/** "12 serves: 2 aces, 8 in, 2 errors" style detail. */
export function detail(r: Reps, s: SkillId): string {
  const t = total(r, s);
  if (!t) return "";
  return REP_KINDS[s].kinds.filter(([k]) => n(r[s], k)).map(([k, label]) => `${n(r[s], k)} ${s === "passing" ? "× " + label : label.toLowerCase()}`).join(", ");
}

export function tap(r: Reps, s: SkillId, k: string, by = 1): Reps {
  const cur = { ...(r[s] || {}) };
  cur[k] = Math.max(0, n(cur, k) + by);
  if (!cur[k]) delete cur[k];
  const out = { ...r, [s]: cur };
  if (!Object.keys(cur).length) delete out[s];
  return out;
}

/** Adds up several sessions' reps (for an athlete's totals). */
export function sum(list: Reps[]): Reps {
  let out: Reps = {};
  for (const r of list) for (const s of SKILL_IDS) for (const [k] of REP_KINDS[s].kinds) if (n(r[s], k)) out = tap(out, s, k, n(r[s], k));
  return out;
}

/** The points for a progress chart: one per session with reps for that skill, oldest first. */
export function trend(rows: { starts: string; reps: Reps }[], s: SkillId): { at: string; v: number; reps: number }[] {
  return rows.filter((x) => total(x.reps, s) > 0).sort((a, b) => a.starts.localeCompare(b.starts)).map((x) => ({ at: x.starts, v: measure(x.reps, s)!, reps: total(x.reps, s) }));
}

/* ---------- calendar ---------- */
export interface CalSession { id: string; starts: string; minutes: number; title?: string | null; kind: string; place?: string | null; focus?: string[]; shared_note?: string | null; status?: string }
const KIND_NAME: Record<string, string> = { private: "Private lesson", group: "Group training", clinic: "Clinic" };
export const sessionName = (x: { title?: string | null; kind: string }) => x.title?.trim() || KIND_NAME[x.kind] || "Lesson";
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
/** RFC 5545 lines fold at 75 octets. */
const fold = (line: string) => { const out: string[] = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };

export function ics(list: CalSession[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FloorCall//Lessons//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const x of list) {
    const start = new Date(x.starts), end = new Date(start.getTime() + (x.minutes || 60) * 60000);
    const desc = [x.focus?.length ? "Focus: " + x.focus.map((f) => REP_KINDS[f as SkillId]?.name || f).join(", ") : "", x.shared_note || ""].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:${x.id}@lessons.getfloorcall.com`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, fold("SUMMARY:" + esc(sessionName(x))));
    if (x.place) lines.push(fold("LOCATION:" + esc(x.place)));
    if (desc) lines.push(fold("DESCRIPTION:" + esc(desc)));
    if (x.status === "canceled") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** "Tue, Jan 6 · 5:00 PM" in the viewer's own time zone. */
export const when = (iso: string, opts: { year?: boolean } = {}) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

/** The text a trainer sends with a session: when, where, what to work on. */
export function message(x: CalSession, who?: string): string {
  const focus = x.focus?.length ? `\nWe'll work on: ${x.focus.map((f) => REP_KINDS[f as SkillId]?.name.toLowerCase() || f).join(", ")}.` : "";
  return `${who ? "Hi " + who + ", here's" : "Here's"} your ${sessionName(x).toLowerCase()}: ${when(x.starts)} (${x.minutes} min)${x.place ? " at " + x.place : ""}.${focus}${x.shared_note ? "\n" + x.shared_note : ""}`;
}

/** Weekly repeats: the same time of day, n weeks in a row (the first is the date given). */
export function weekly(startsIso: string, weeks: number): string[] {
  const d = new Date(startsIso), out: string[] = [];
  for (let i = 0; i < Math.max(1, Math.min(weeks, 26)); i++) { const x = new Date(d); x.setDate(d.getDate() + 7 * i); out.push(x.toISOString()); }
  return out;
}

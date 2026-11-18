/** When two coaches stat the same match on their own devices, the same play can get entered twice (both tap
 * "Maya · Dig" in one rally). Plays from different devices that match on set, rally, player and action are almost
 * certainly one play, so we flag them; the coach removes the extra with one tap. Kills, aces and blocks can't
 * happen twice for one player in one rally; digs, passes and sets can, so those are flagged only as "likely". */
import type { LogEntry } from "./engine";

type Stat = Extract<LogEntry, { kind: "stat" }>;
export type Double = { keep: Stat; extra: Stat; sure: boolean };
const deviceOf = (id: string) => id.split("-")[0];
const ONCE = new Set(["K", "KT", "AE", "AB", "SA", "SE", "SEN", "SEO", "SI", "BS", "BA", "BE", "P3", "P2", "P1", "P0", "OK", "OA", "OE", "TP", "UP"]);

/** The rally a play belongs to: the score before that rally ended. */
const rallyOf = (e: Stat) => `${e.set}:${e.us - (e.w === "us" ? 1 : 0)}-${e.them - (e.w === "them" ? 1 : 0)}`;

export function findDoubles(log: LogEntry[]): Double[] {
  const seen = new Map<string, Stat>(), out: Double[] = [];
  for (const e of log) {
    if (e.kind !== "stat" || (!e.p && !e.op && !["OK", "OA", "OE", "TP", "UP"].includes(e.t))) continue;
    const k = [rallyOf(e), e.t, e.p || "", e.op || ""].join("|");
    const first = seen.get(k);
    if (first && deviceOf(first.id) !== deviceOf(e.id)) out.push({ keep: first, extra: e, sure: ONCE.has(e.t) });
    else if (!first) seen.set(k, e);
  }
  return out;
}

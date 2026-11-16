/** How film clips and searches are put into words, shared by Film Room and season search. */
import { playerName } from "../../data/store";
import { LogEntry } from "../../sports/volleyball/engine";
import { ACTIONS } from "../../sports/volleyball/actions";
import { Clip, LOCAL, playName } from "../../film/clips";
import { localVideo } from "../../film/localVideos";
import { ClipQuery, QueryPlayer } from "../../film/query";

/** Where a clip's video plays from: a file picked on this device, or its link. */
export const resolve = (c: Clip) => (c.url.startsWith(LOCAL) ? localVideo(c.matchId) : c.url);
export const label = (l: LogEntry) => l.kind === "tag" ? "Tag: " + l.note + (l.p ? " · " + playerName(l.p) : "") : l.kind === "stat" ? (l.p ? playerName(l.p) + " · " : l.op ? "Their #" + l.op + " · " : "") + playName(l.t, (ACTIONS as any)[l.t]?.long) + (l.z && l.z !== "out" ? " → area " + l.z : "") : "";
/** Chips for a query the AI filled in. */
export function describe(q: ClipQuery, roster: QueryPlayer[]): string[] {
  const out: string[] = [];
  if (q.codes) out.push(q.codes.map((c) => playName(c, (ACTIONS as any)[c]?.long)).filter((v, i, a) => a.indexOf(v) === i).join(", "));
  for (const id of q.players) { const p = roster.find((r) => r.id === id); if (p) out.push(`#${p.num} ${p.first}`); }
  for (const n of q.opp) out.push("Their #" + n);
  if (q.zones.length) out.push("To area " + q.zones.join(", "));
  if (q.sets.length) out.push("Set " + q.sets.join(", "));
  if (q.rots.length) out.push("Rotation " + q.rots.join(", "));
  if (q.won) out.push(q.won === "us" ? "Points we won" : "Points they won");
  if (q.serving) out.push(q.serving === "us" ? "On our serve" : "In serve receive");
  if (q.ctx) out.push("Context " + q.ctx.join(", "));
  if (q.clutch) out.push("At 20+");
  if (q.tags) out.push("Film tags");
  return out.length ? out : ["Everything"];
}

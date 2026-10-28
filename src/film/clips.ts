/** Clips: every tracked play is a few seconds of the match video. Times come from when the play was entered,
 * lined up with "First serve at" on the Film card. Pure functions, so the app and Benchboard Recruit share them. */
import type { LogEntry, MatchEvent, Replay } from "../sports/volleyball/engine";

export interface Clip { id: string; matchId: string; url: string; start: number; end: number; label: string; t: string; p?: string; date: string; opp: string; score?: string; set?: number }
export type VideoKind = "youtube" | "vimeo" | "file" | "local" | "other";

export const LOCAL = "local:"; // a video file on this device, never uploaded
export function videoKind(url: string): VideoKind {
  if (!url) return "other";
  if (url.startsWith(LOCAL) || url.startsWith("blob:")) return "local";
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : "https://localhost/");
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|youtube-nocookie\.com$/.test(u.hostname)) return "youtube";
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) return "vimeo";
    if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(u.pathname)) return "file";
  } catch { /* not a URL */ }
  return "other";
}
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/); return m ? m[1] : null;
  } catch { return null; }
}
export function vimeoId(url: string): string | null { const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/); return m ? m[1] : null; }
/** Clips from this video can be shared on a public profile (a local file can't). */
export const shareable = (url: string) => ["youtube", "vimeo", "file"].includes(videoKind(url));

export interface FilmTiming { base: number; offset: number; ts: Map<string, number> }
export function filmTiming(m: { filmStart?: number | null; videoOffset?: number }, R: Replay, events: MatchEvent[]): FilmTiming {
  const ts = new Map(events.map((e) => [e.id, e.ts]));
  return { base: m.filmStart || R.firstTs || events[0]?.ts || 0, offset: m.videoOffset || 0, ts };
}
/** Seconds into the video for a play. */
export const videoTime = (T: FilmTiming, id: string) => ((T.ts.get(id) ?? T.base) - T.base) / 1000 + T.offset;

const HIGHLIGHT: Record<string, number> = { K: 5, KT: 5, SA: 5, BS: 5, BA: 4, D: 2, AST: 1, P3: 1 };
const NAMES: Record<string, string> = { K: "Kill", KT: "Kill off the block", SA: "Ace", BS: "Solo block", BA: "Block", D: "Dig", AST: "Set for a kill", P3: "Perfect pass", AE: "Attack error", AB: "Blocked", SEN: "Serve error", SEO: "Serve error", P0: "Shanked pass", DE: "Dig error", OK: "Their kill", OA: "Their ace", OE: "Their error" };
export const playName = (t: string, long?: string) => NAMES[t] || long || t;

/** Clips for the plays in `log` that pass `keep`, against the match video. lead/tail in seconds. */
export function clipsFrom(m: { id: string; video?: string; date: string; opp: string }, T: FilmTiming, log: LogEntry[], keep: (l: LogEntry) => boolean, name: (l: LogEntry) => string, lead = 8, tail = 2): Clip[] {
  if (!m.video) return [];
  return log.filter((l) => (l.kind === "stat" || l.kind === "tag") && keep(l)).map((l) => {
    const at = videoTime(T, l.id), s = l as any;
    return { id: m.id + ":" + l.id, matchId: m.id, url: m.video!, start: Math.max(0, Math.round((at - lead) * 10) / 10), end: Math.round((at + tail) * 10) / 10, label: name(l), t: s.t || "TAG", p: s.p, date: m.date, opp: m.opp, score: s.w ? `${s.us}–${s.them}` : undefined, set: s.set };
  });
}

/** A player's best moments for a highlight reel: kills, aces and blocks first, then digs and great sets; at most `max`. */
export function highlightPick(clips: Clip[], max = 12): Clip[] {
  return clips.filter((c) => HIGHLIGHT[c.t]).map((c, i) => ({ c, i, w: HIGHLIGHT[c.t] })).sort((a, b) => b.w - a.w || a.i - b.i).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.c);
}

export const clock = (sec: number) => { let s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s %= 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };

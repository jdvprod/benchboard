/** Data for Benchboard Live: the public season hub and single-game links, polled while a match is live. */
import { useEffect, useRef, useState } from "react";
import { cloudAvailable, rpc } from "../cloud/client";
import { mergeLogs, replay, Replay } from "../sports/volleyball/engine";

export interface LPlayer { id: string; num: string; first: string; last: string; pos: string }
export interface LMatch { id: string; opp: string; date: string; bestOf?: number; setTo?: number; cap?: number | null; status: string; event?: string; site?: string; kind?: string; scrim?: any }
export interface LSched { id: string; date: string; time: string; opp: string; site: string; event: string }
export interface SeasonData { team: { name: string; level: string; color?: string; schedule: LSched[] } | null; season: string | null; matches: LMatch[]; logs: { matchId: string; events: any[] }[]; players: LPlayer[]; live?: { matchId: string; code: string }[]; at: string }
export interface WatchData { team: { name: string; color: string; level: string } | null; match: LMatch; logs: any[][]; players: LPlayer[]; at: string }
export interface Game { m: LMatch; R: Replay }

export const isLive = (g: Game) => g.m.status === "live" && !g.R.matchOver;
export const replayOf = (m: LMatch, logs: any[][]): Replay => replay(mergeLogs(logs), { id: m.id, bestOf: m.bestOf || 5, scrim: m.scrim, setTo: m.setTo, cap: m.cap });

/** Polls an RPC: every `fast` ms while `live(data)` is true and the page is visible, every `slow` ms otherwise. */
function usePoll<T>(fnName: string, code: string, isActive: (r: T) => boolean, fast: number, slow: number, missing: string) {
  const [d, setD] = useState<T | null>(null), [err, setErr] = useState(""), [got, setGot] = useState(0), live = useRef(false);
  useEffect(() => {
    let stop = false, timer: any;
    const load = async () => {
      try {
        const r: T | null = await rpc(fnName, { share: code }, true); if (stop) return;
        if (!r || !isActive(r)) setErr(missing); else { live.current = (r as any).__live ?? false; setD(r); setGot(Date.now()); setErr(""); }
      } catch { if (!stop) setErr((e) => e || "Reconnecting…"); }
      if (!stop) timer = setTimeout(load, document.visibilityState === "visible" && live.current ? fast : slow);
    };
    if (cloudAvailable()) load(); else setErr("Live links aren't set up for this site yet.");
    const wake = () => { if (document.visibilityState === "visible") { clearTimeout(timer); load(); } };
    document.addEventListener("visibilitychange", wake);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [code]);
  return { d, err, got };
}

export function useSeason(code: string) {
  return usePoll<SeasonData>("season_view", code, (r) => { (r as any).__live = r.matches.some((m) => m.status === "live"); return !!r.team; }, 8000, 60000, "We couldn't find that team. Check the link or code with the coach.");
}
export function useWatch(code: string) {
  return usePoll<WatchData>("watch", code, (r) => { (r as any).__live = r.match?.status === "live"; return !!r.match; }, 5000, 20000, "This game link isn't active. Ask the coach for a new one.");
}

/** Games in a season, newest first; a live match shows even before its first point. */
export function seasonGames(d: SeasonData): Game[] {
  return d.matches.map((m) => ({ m, R: replayOf(m, d.logs.filter((l) => l.matchId === m.id).map((l) => l.events || [])) }))
    .filter((g) => g.m.status === "live" || g.R.sets.some((s) => s.us + s.them > 0))
    .sort((a, b) => b.m.date.localeCompare(a.m.date));
}

export const fmtDay = (d: string) => { const x = new Date(d + "T12:00:00"); return isNaN(+x) ? d : x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
export const fmtTime = (t: string) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** "#7 Maya C." (or "#7" for a player kept off public pages) */
export const pname = (p?: LPlayer | null, full = true) => !p ? "" : p.first ? `#${p.num} ${p.first}${full && p.last ? " " + p.last + "." : ""}` : `#${p.num}`;

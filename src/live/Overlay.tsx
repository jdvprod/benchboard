/** Stream overlay: a broadcast score bug for live streams (OBS, Streamlabs, vMix "browser source"), on a see-through page.
 *   #/g/CODE/overlay   one match            #/t/CODE/overlay   the team's live match, all season (set it up once)
 * Options after "?": size=s|m|l, pos=bl|br|tl|tr, us=CN, them=BUC (short names), sets=0 (hide the set scores), plays=0 (no play captions). */
import { useEffect, useRef, useState } from "react";
import { Replay } from "../sports/volleyball/engine";
import { applyTheme } from "../app/theme";
import { Game, LMatch, LPlayer, replayOf, seasonGames, useSeason, useWatch } from "./data";
import { playText } from "./GameView";

export interface OverlayOpts { size: "s" | "m" | "l"; pos: "bl" | "br" | "tl" | "tr"; us?: string; them?: string; sets: boolean; plays: boolean }
export function overlayOpts(q: string): OverlayOpts {
  const p = new URLSearchParams(q), pick = <T extends string>(k: string, ok: T[], d: T) => (ok.includes(p.get(k) as T) ? (p.get(k) as T) : d);
  const nm = (k: string) => (p.get(k) || "").trim().slice(0, 14) || undefined;
  return { size: pick("size", ["s", "m", "l"], "m"), pos: pick("pos", ["bl", "br", "tl", "tr"], "bl"), us: nm("us"), them: nm("them"), sets: p.get("sets") !== "0", plays: p.get("plays") !== "0" };
}

/** Long school and club names shortened for the bug: "Buchanan Bears Volleyball Club" → "Buchanan Bears", then "Buchanan". */
export function shortTeam(name: string, max = 14) {
  let n = name.trim().replace(/\s+(high school|hs|volleyball club|volleyball|vbc|club|academy|athletics)$/i, "").trim();
  if (n.length <= max) return n;
  const w = n.split(/\s+/), two = w.slice(0, 2).join(" ");
  return w[0].length <= 4 && two.length <= max ? two : w[0].length <= max ? w[0] : n.slice(0, max);
}

function useSeeThrough() {
  useEffect(() => { document.documentElement.classList.add("ov-page"); return () => document.documentElement.classList.remove("ov-page"); }, []);
}

/** The point total pulses when it changes, so viewers catch the point. */
function Pts({ n }: { n: number }) {
  const prev = useRef(n), [k, setK] = useState(0);
  useEffect(() => { if (prev.current !== n) { prev.current = n; setK((x) => x + 1); } }, [n]);
  return <b className="ov-pts" key={k} data-bump={k ? "1" : undefined}>{n}</b>;
}

/** The play that just scored, as a caption under the bug for a few seconds ("#7 Maya · Kill"). Nothing on first load. */
function useCaption(R: Replay, us: string, them: string, players: LPlayer[], on: boolean) {
  const last = R.log.filter((l) => l.kind === "stat" && l.w).slice(-1)[0], seen = useRef<string | null>(null), [cap, setCap] = useState<{ id: string; text: string; side: string } | null>(null);
  useEffect(() => {
    if (!on) return;
    if (seen.current === null) { seen.current = last?.id || ""; return; } // what was already there when the page opened
    if (!last || seen.current === last.id) return;
    seen.current = last.id;
    const text = playText(last, us, them, new Map(players.map((p) => [p.id, p])));
    setCap({ id: last.id, text, side: (last as any).w }); const t = setTimeout(() => setCap((c) => (c?.id === last.id ? null : c)), 5000); return () => clearTimeout(t);
  }, [last?.id, on]);
  return cap;
}

export function ScoreBug({ R, m, us, them, o, logo, players = [] }: { R: Replay; m: LMatch; us: string; them: string; o: OverlayOpts; logo?: string | null; players?: LPlayer[] }) {
  const cap = useCaption(R, o.us || shortTeam(us), o.them || shortTeam(them), players, o.plays && m.status === "live");
  const logos = { us: logo, them: m.oppLogo }, withLogos = !!(logo || m.oppLogo);
  const c = R.cur, live = m.status === "live" && !R.matchOver;
  const done = R.sets.filter((s) => s.winner && s !== c || (s === c && c.over));
  const between = live && !!c?.over, final = !live && (R.matchOver || R.sets.some((s) => s.us + s.them));
  const side = (k: "us" | "them") => {
    const nm = k === "us" ? o.us || shortTeam(us) : o.them || shortTeam(them), won = k === "us" ? R.wonUs : R.wonThem;
    const pts = final || between ? won : c ? c[k] : 0, serving = live && c && !c.over && c.serve === k;
    return <div className={"ov-row " + k + (final && (k === "us" ? R.wonUs > R.wonThem : R.wonThem > R.wonUs) ? " win" : "")}>
      {withLogos && (logos[k] ? <img className="ov-logo" src={logos[k]!} alt="" referrerPolicy="no-referrer" /> : <span className="ov-logo none" aria-hidden="true">{nm.slice(0, 1)}</span>)}
      <span className="ov-nm">{nm}</span>
      <span className="ov-srv" aria-label={serving ? "serving" : undefined}>{serving ? "●" : ""}</span>
      <span className={"ov-won" + (final || between ? " off" : "")} aria-label={final || between ? undefined : "sets won"}>{final || between ? "" : won}</span>
      {o.sets && <span className="ov-sets">{done.map((s) => <span key={s.n} className={s.winner === k ? "w" : ""}>{s[k]}</span>)}</span>}
      <Pts n={pts} />
    </div>;
  };
  const tag = final ? "Final" : between ? `End of set ${c!.n}` : c ? `Set ${c.n}` : "Starting soon";
  return <div className={`ov ov-${o.size} ov-${o.pos}`} role="img" aria-label={`${us} ${R.wonUs}, ${them} ${R.wonThem}${c && live ? `, set ${c.n} ${c.us}–${c.them}` : ""}`}>
    <div className={"ov-box" + (withLogos ? " logos" : "")}>{side("us")}{side("them")}</div>
    <div className="ov-tag"><span className={live && !between ? "on" : ""}>{tag}</span><small>Jumpset Live</small></div>
    {cap && <div key={cap.id} className={"ov-cap " + cap.side} role="status">{cap.text}</div>}
  </div>;
}

/** Nothing shows on the stream while loading; a problem with the link shows so whoever sets up the stream can fix it. */
function Waiting({ text }: { text: string }) { return text && text !== "Loading…" ? <p className="ov-wait">{text}</p> : null; }

export function GameOverlay({ code, q }: { code: string; q: string }) {
  useSeeThrough();
  const o = overlayOpts(q), { d, err } = useWatch(code, 3000, true);
  useEffect(() => { if (d?.team?.color) applyTheme(d.team.color, "dark", "normal", null); }, [d?.team?.color]);
  if (!d) return <Waiting text={err || "Loading…"} />;
  return <ScoreBug R={replayOf(d.match, d.logs || [])} m={d.match} us={d.team?.name || "Us"} them={d.match.opp || "Opponent"} o={o} logo={d.team?.logo} players={d.players} />;
}

/** Follows whichever match is live; shows the last result between matches. A live gamecast link (if shared) updates fastest. */
export function TeamOverlay({ code, q }: { code: string; q: string }) {
  useSeeThrough();
  const o = overlayOpts(q), { d, err } = useSeason(code, 20000, 30000, true);
  useEffect(() => { if (d?.team?.color) applyTheme(d.team.color, "dark", "normal", null); }, [d?.team?.color]);
  const games = d ? seasonGames(d) : [], live = games.find((g) => g.m.status === "live" && !g.R.matchOver);
  const gameCode = live ? d!.live?.find((x) => x.matchId === live.m.id)?.code || "" : "";
  const w = useWatch(gameCode, 3000, true);
  if (!d) return <Waiting text={err || "Loading…"} />;
  const g: Game | undefined = w.d && live && w.d.match.id === live.m.id ? { m: w.d.match, R: replayOf(w.d.match, w.d.logs || []) } : live || games.find((x) => !x.m.imported);
  if (!g) return null; // nothing to show yet: stays see-through
  return <ScoreBug R={g.R} m={g.m} us={d.team?.name || "Us"} them={g.m.opp || "Opponent"} o={o} logo={d.team?.logo} players={w.d?.players || d.players} />;
}

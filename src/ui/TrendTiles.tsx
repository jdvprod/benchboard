/** Key numbers with their trend: a value, a small line across matches, and a green ▲ or red ▼ for how the last
 * three matches compare with the rest of the season. Tap a tile for the last 3, 5 or 10 matches (or the season) on
 * a bigger chart, with the average, the best and the worst match in that stretch. Used on a player's page and the
 * team's Stats overview. */
import { useState } from "react";
import { LineChart } from "./charts";
import "./trendtiles.css";

export interface TrendStat {
  key: string; label: string; fmt: (v: number) => string;
  /** smaller is better (errors, aced %) */
  lowerBetter?: boolean;
  /** a change smaller than this is "about the same" */
  step: number;
  /** one value per match, oldest first (null when the stat didn't come up that match) */
  per: { label: string; sub: string; v: number | null }[];
  /** the stat over the last n matches (n = 0: the whole season), from the combined numbers, not an average of matches */
  over: (n: number) => number | null;
  /** the stat over every match except the last n (for "last 3 vs before") */
  except?: (n: number) => number | null;
  /** a line under the value: "48 K · 12 E · 140 TA" */
  sub?: string;
}

/** How the last 3 matches compare with the matches before them. Pure. */
export function trendOf(s: Pick<TrendStat, "lowerBetter" | "step" | "per" | "over" | "except">, recent = 3): { dir: "up" | "down" | "flat"; good: boolean | null; recent: number | null; before: number | null } {
  const have = s.per.filter((x) => x.v != null).length;
  if (have < recent + 2) return { dir: "flat", good: null, recent: null, before: null };
  const r = s.over(recent), all = s.over(0);
  // "before" = the season without the recent stretch, approximated from per-match values where needed
  const olderVals = s.per.slice(0, -recent).map((x) => x.v).filter((v): v is number => v != null);
  const before = s.except ? s.except(recent) : olderVals.length ? olderVals.reduce((a, b) => a + b, 0) / olderVals.length : all;
  if (r == null || before == null) return { dir: "flat", good: null, recent: r, before };
  const d = r - before;
  if (Math.abs(d) < s.step) return { dir: "flat", good: null, recent: r, before };
  const up = d > 0;
  return { dir: up ? "up" : "down", good: s.lowerBetter ? !up : up, recent: r, before };
}

function Spark({ vals, good }: { vals: (number | null)[]; good: boolean | null }) {
  const pts = vals.map((v, i) => [i, v] as const).filter((x): x is readonly [number, number] => x[1] != null);
  if (pts.length < 2) return <svg className="tt-spark" viewBox="0 0 100 28" aria-hidden="true" />;
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), span = hi - lo || 1;
  const x = (i: number) => 3 + (i * 94) / Math.max(1, vals.length - 1), y = (v: number) => 24 - ((v - lo) / span) * 20;
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return <svg className={"tt-spark" + (good === true ? " good" : good === false ? " bad" : "")} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
    <path d={d} vectorEffect="non-scaling-stroke" /><circle cx={x(last[0])} cy={y(last[1])} r="2.6" />
  </svg>;
}

const WINDOWS: [number, string][] = [[3, "Last 3"], [5, "Last 5"], [10, "Last 10"], [0, "Season"]];

export function TrendTiles({ stats, unit = "match", title }: { stats: TrendStat[]; unit?: string; title?: string }) {
  const [open, setOpen] = useState<string | null>(null), [win, setWin] = useState(5);
  const s = stats.find((x) => x.key === open);
  return <div className="tt">
    {title && <h2 className="tt-title">{title}</h2>}
    <div className="tt-grid">{stats.map((x) => {
      const t = trendOf(x), season = x.over(0);
      return <button key={x.key} className={"tt-tile" + (open === x.key ? " on" : "")} aria-expanded={open === x.key} onClick={() => setOpen(open === x.key ? null : x.key)}>
        <span className="tt-label">{x.label}</span>
        <span className="tt-row"><b className="tt-val num">{season == null ? "–" : x.fmt(season)}</b>
          {t.dir !== "flat" && <span className={"tt-chip " + (t.good ? "good" : "bad")} title={`Last 3 ${x.label.toLowerCase()}: ${t.recent == null ? "–" : x.fmt(t.recent)}, before that: ${t.before == null ? "–" : x.fmt(t.before)}`}>{t.dir === "up" ? "▲" : "▼"} {t.recent == null ? "" : x.fmt(t.recent)}<span className="sr-only"> over the last 3, {t.good ? "better" : "worse"}</span></span>}
          {t.dir === "flat" && t.recent != null && <span className="tt-chip flat">steady</span>}</span>
        <Spark vals={x.per.map((p) => p.v)} good={t.good} />
        {x.sub && <span className="tt-sub">{x.sub}</span>}
      </button>; })}</div>
    {s && (() => {
      const n = win, pts = n ? s.per.slice(-n) : s.per, vals = pts.map((p) => p.v).filter((v): v is number => v != null);
      const w = s.over(n), season = s.over(0);
      const best = vals.length ? pts.reduce((a, b) => (b.v != null && (a.v == null || (s.lowerBetter ? b.v < a.v : b.v > a.v)) ? b : a)) : null;
      const worst = vals.length ? pts.reduce((a, b) => (b.v != null && (a.v == null || (s.lowerBetter ? b.v > a.v : b.v < a.v)) ? b : a)) : null;
      const cmp = w != null && season != null && n ? (Math.abs(w - season) < s.step ? "flat" : (w > season) !== !!s.lowerBetter ? "good" : "bad") : null;
      return <section className="tt-detail" aria-label={s.label + " trend"}>
        <div className="tt-dhead"><h3>{s.label}</h3>
          <div className="tt-wins" role="group" aria-label="How many matches">{WINDOWS.map(([k, l]) => <button key={k} aria-pressed={win === k} onClick={() => setWin(k)} disabled={!!k && s.per.length < 2}>{l}</button>)}</div>
          <button className="tt-x" onClick={() => setOpen(null)} aria-label="Close">×</button></div>
        <div className="tt-facts">
          <div><span>{n ? `Last ${Math.min(n, s.per.length)} ${unit === "match" ? "matches" : unit + "s"}` : "Season"}</span><b className={"num " + (cmp || "")}>{w == null ? "–" : s.fmt(w)}</b></div>
          {n > 0 && <div><span>Season</span><b className="num">{season == null ? "–" : s.fmt(season)}</b></div>}
          {best?.v != null && <div><span>Best</span><b className="num">{s.fmt(best.v)}</b><small>{best.label} {best.sub}</small></div>}
          {worst?.v != null && worst !== best && <div><span>Lowest</span><b className="num">{s.fmt(worst.v)}</b><small>{worst.label} {worst.sub}</small></div>}
        </div>
        {vals.length >= 2 ? <LineChart points={pts} format={s.fmt} height={200} /> : <p className="empty">Needs two or more {unit === "match" ? "matches" : unit + "es"} with this stat.</p>}
      </section>;
    })()}
  </div>;
}

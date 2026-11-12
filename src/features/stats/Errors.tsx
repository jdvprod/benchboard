/** Stats → Errors: every point we gave away, by kind, by player, by rotation and over time, in one place. */
import { useState } from "react";
import { aggregate, Agg, Stat } from "../../sports/volleyball/engine";
import { fmtNum, fmtPct, ratio, serveErrors } from "../../sports/volleyball/metrics";
import { player, playerName, teamPlayers } from "../../data/store";
import { Card, Kpi, Seg } from "../../ui/kit";
import { LineChart } from "../../ui/charts";
import { go } from "../../app/router";
import { Scope } from "./scope";
import { totalErrors } from "./catalog";

/** Kinds of error, how to count each from a stat line, and which rally endings they are. */
const KINDS: { key: string; label: string; short: string; get: (s: Stat) => number; ends: string[] }[] = [
  { key: "att", label: "Attack errors", short: "Attack", get: (s) => s.AE - s.AB, ends: [] },
  { key: "blk", label: "Got blocked", short: "Blocked", get: (s) => s.AB, ends: [] },
  { key: "srv", label: "Serve errors", short: "Serve", get: (s) => serveErrors(s), ends: ["SE", "SEN", "SEO"] },
  { key: "rec", label: "Reception errors", short: "Receive", get: (s) => s.P0, ends: ["P0"] },
  { key: "bhe", label: "Ball-handling errors", short: "Handling", get: (s) => s.BHE, ends: ["BHE"] },
  { key: "dig", label: "Dig errors", short: "Dig", get: (s) => s.DE, ends: ["DE"] },
  { key: "net", label: "Block and net errors", short: "Net", get: (s) => s.BE, ends: ["BE"] },
  { key: "misc", label: "Communication, effort, positioning", short: "Misc", get: (s) => s.CE + s.EE + s.PE, ends: ["CE", "EE", "PE"] },
];
/** Rally endings that are our errors (blocked attacks end as AE). */
export const ERROR_ENDS = new Set(["AE", "SE", "SEN", "SEO", "P0", "BHE", "DE", "BE", "CE", "EE", "PE"]);

export function ErrorsView({ S, A }: { S: Scope; A: Agg }) {
  const [by, setBy] = useState<"count" | "perset">("count");
  const total = totalErrors(A.T), sets = A.sets || 1;
  const lost = A.rallies.filter((r) => r.w === "them"), given = lost.filter((r) => ERROR_ENDS.has(r.end)).length;
  const theirs = A.rallies.filter((r) => r.w === "us" && r.end === "OE").length;
  const late = lost.filter((r) => ERROR_ENDS.has(r.end) && (r.us || 0) >= 20 && (r.them || 0) >= 20).length;
  const kinds = KINDS.map((k) => ({ ...k, n: k.get(A.T) })).filter((k) => k.n > 0).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...kinds.map((k) => k.n));
  const ids = teamPlayers().map((p) => p.id).filter((id) => A.ps[id] && totalErrors(A.ps[id]) > 0).sort((a, b) => totalErrors(A.ps[b]) - totalErrors(A.ps[a]));
  const v = (n: number, id?: string) => (by === "count" ? String(n) : fmtNum(n / ((id ? A.setsPlayed[id] : A.sets) || 1), 2));
  const rot = [1, 2, 3, 4, 5, 6].map((r) => { const all = A.rallies.filter((x) => x.rot === r), e = all.filter((x) => x.w === "them" && ERROR_ENDS.has(x.end)).length; return { r, e, n: all.length }; });
  const worstRot = rot.filter((x) => x.n >= 8).sort((a, b) => b.e / b.n - a.e / a.n)[0];
  const over = S.single
    ? S.single.R.sets.map((s) => ({ label: "Set " + s.n, v: totalErrors(aggregate([s]).T) }))
    : S.items.slice().sort((a, b) => a.m.date.localeCompare(b.m.date)).map(({ m, R }) => { const a = aggregate(R.sets); return { label: m.date.slice(5).replace("-", "/"), sub: m.opp, v: a.sets ? totalErrors(a.T) / a.sets : null }; });

  return <>
    <Card title="Errors">
      <div className="kpis">
        <Kpi label="Our errors" value={total} sub={fmtNum(total / sets, 1) + " per set"} />
        <Kpi label="Their points that were our errors" value={fmtPct(ratio(given, lost.length))} sub={`${given} of their ${lost.length} points`} />
        <Kpi label="Their errors" value={theirs} sub={theirs > given ? "They gave away more than we did" : theirs < given ? `We gave away ${given - theirs} more` : "Even"} />
        <Kpi label="Late in sets" value={late} sub="Errors with both teams at 20 or more" />
      </div>
    </Card>
    <Card title="By kind">
      {!kinds.length ? <p className="empty">No errors in this selection.</p> : <div className="errbars">{kinds.map((k) => <div key={k.key} className="errbar">
        <span className="errbar-l">{k.label}</span>
        <span className="errbar-track"><i style={{ width: (100 * k.n) / max + "%" }} /></span>
        <b>{k.n}</b><span className="muted small">{fmtPct(ratio(k.n, total))}</span>
      </div>)}</div>}
    </Card>
    <Card title="By player" actions={<Seg value={by} onChange={setBy} options={[["count", "Totals"], ["perset", "Per set"]]} label="Show" />}>
      <div className="tbl"><table>
        <thead><tr><th className="l">#</th><th className="l">Player</th>{KINDS.map((k) => <th key={k.key} title={k.label}>{k.short}</th>)}<th>Total</th></tr></thead>
        <tbody>{ids.map((id) => { const s = A.ps[id], p = player(id)!; return <tr key={id} className="click" onClick={() => go("player", id)}>
          <td className="l">{p.num}</td><td className="l">{p.first} {p.last}</td>{KINDS.map((k) => <td key={k.key}>{k.get(s) ? v(k.get(s), id) : "·"}</td>)}<td><b>{v(totalErrors(s), id)}</b></td></tr>; })}</tbody>
        <tfoot><tr><td /><td className="l">Team</td>{KINDS.map((k) => <td key={k.key}>{v(k.get(A.T))}</td>)}<td><b>{v(total)}</b></td></tr></tfoot>
      </table></div>
      <p className="keys" style={{ marginTop: 8 }}>Team includes errors marked without a player. Tap a player for their page.</p>
    </Card>
    <div className="grid2">
      <Card title="By rotation">
        <div className="tbl"><table><thead><tr><th className="l">Rotation</th><th>Errors</th><th>Rallies</th><th>Error rate</th></tr></thead>
          <tbody>{rot.map((x) => <tr key={x.r} className={worstRot && worstRot.r === x.r ? "cmp-worst" : ""}><td className="l"><b>R{x.r}</b></td><td>{x.e}</td><td>{x.n}</td><td>{fmtPct(ratio(x.e, x.n))}</td></tr>)}</tbody></table></div>
        {worstRot && <p className="keys" style={{ marginTop: 8 }}>Rotation {worstRot.r} gives away the most: {fmtPct(ratio(worstRot.e, worstRot.n))} of its rallies end in our error.</p>}
      </Card>
      <Card title={S.single ? "By set" : "Errors per set, by match"}>
        <LineChart points={over} format={(n) => fmtNum(n, 1)} height={190} />
      </Card>
    </div>
    {ids[0] && <p className="keys">Most errors: {playerName(ids[0])} with {totalErrors(A.ps[ids[0]])}{kinds[0] ? `. Most common kind: ${kinds[0].label.toLowerCase()}` : ""}.</p>}
  </>;
}

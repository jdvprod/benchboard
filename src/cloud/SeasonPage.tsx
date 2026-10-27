/** #/season/CODE: the public season hub for players and parents. Results, schedule, leaders and every player's line. No account needed. */
import { useEffect, useMemo, useState } from "react";
import { rpc, cloudAvailable } from "./client";
import { LEGAL } from "../app/legal";
import { aggregate, mergeLogs, recordOf, replay, Replay, resultOf, Stat } from "../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, hitting, passAvg, playerMetrics, serveAttempts } from "../sports/volleyball/metrics";

interface P { id: string; num: string; first: string; last: string; pos: string }
interface M { id: string; opp: string; date: string; bestOf: number; setTo?: number; cap?: number | null; status: string; event: string; site: string }
interface Data { team: { name: string; level: string; schedule: { id: string; date: string; time: string; opp: string; site: string; event: string }[] } | null; season: string | null; matches: M[]; logs: { matchId: string; events: any[] }[]; players: P[]; at: string }

const fmtD = (d: string) => { const x = new Date(d + "T12:00:00"); return isNaN(+x) ? d : x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
const fmtT = (t: string) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

export function SeasonPage({ code }: { code: string }) {
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState(""), [sel, setSel] = useState<string | null>(null), [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let stop = false, timer: any;
    const load = async () => {
      try { const r: Data | null = await rpc("season_view", { share: code }, true); if (stop) return; if (!r || !r.team) setErr("This season link isn't active. Ask the coach for a new one."); else { setD(r); setErr(""); } }
      catch { if (!stop) setErr((e) => e || "Couldn't load the season. Check your connection."); }
      if (!stop) timer = setTimeout(load, 60000);
    };
    if (cloudAvailable()) load(); else setErr("Season links aren't set up in this version of the app.");
    return () => { stop = true; clearTimeout(timer); };
  }, [code]);

  const games = useMemo(() => {
    if (!d) return [] as { m: M; R: Replay }[];
    return d.matches.map((m) => ({ m, R: replay(mergeLogs(d.logs.filter((l) => l.matchId === m.id).map((l) => l.events || [])), { id: m.id, bestOf: m.bestOf || 5, setTo: m.setTo, cap: m.cap }) }))
      .filter((x) => x.R.sets.some((s) => s.us + s.them > 0)).sort((a, b) => b.m.date.localeCompare(a.m.date));
  }, [d]);

  if (!d) return <div className="watch"><div className="page" style={{ maxWidth: 820, margin: "0 auto" }}><p className="empty" style={{ padding: 30 }}>{err || "Loading the season…"}</p></div></div>;

  const P = new Map(d.players.map((p) => [p.id, p]));
  const nm = (id: string) => { const p = P.get(id); return p ? `#${p.num} ${p.first} ${p.last ? p.last + "." : ""}`.trim() : ""; };
  const A = aggregate(games.flatMap((g) => g.R.sets));
  const rec = recordOf(games.map((g) => g.R));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (d.team?.schedule || []).filter((x) => x.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3);
  const leader = (f: (s: Stat) => number, label: string) => { const top = Object.entries(A.ps).filter(([id]) => P.has(id)).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? <div key={label} className="sh-lead"><span className="label">{label}</span><b>{+top[1].toFixed(1)}</b><button className="linkish small" onClick={() => setSel(top[0])}>{nm(top[0])}</button></div> : null; };
  const roster = d.players.filter((p) => A.ps[p.id] || A.pm[p.id]).sort((a, b) => (+a.num || 0) - (+b.num || 0));
  const box = (R: Replay) => { const a = aggregate(R.sets); return Object.entries(a.ps).filter(([id]) => P.has(id)).sort((x, y) => (+P.get(x[0])!.num || 0) - (+P.get(y[0])!.num || 0)); };

  if (sel && P.has(sel)) {
    const p = P.get(sel)!, s: Stat | undefined = A.ps[sel], pm = playerMetrics(A, sel);
    const rows = games.map((g) => ({ g, s: aggregate(g.R.sets).ps[sel] })).filter((x) => x.s);
    return <div className="watch"><div className="page" style={{ maxWidth: 820, margin: "0 auto" }}>
      <button className="btn sm" onClick={() => setSel(null)}>← {d.team?.name}</button>
      <section className="card sh-player">
        <div className="sh-num">{p.num}</div>
        <div><h1 style={{ margin: 0 }}>{p.first} {p.last ? p.last + "." : ""}</h1><p className="muted" style={{ margin: 0 }}>{p.pos} · {d.team?.name} · {d.season || "This season"}</p></div>
      </section>
      <section className="card"><div className="sh-k">
        {[["Kills", s?.K ?? 0, pm.kps != null ? fmtNum(pm.kps, 2) + " per set" : ""], ["Hitting", s && s.TA ? fmtHit(hitting(s)) : "—", s ? `${s.TA} swings` : ""], ["Aces", s?.SA ?? 0, s && serveAttempts(s) ? fmtPct(pm.serveIn) + " in" : ""], ["Passing", s && s.R ? fmtAvg(passAvg(s)) : "—", s?.R ? s.R + " passes" : ""], ["Digs", s?.D ?? 0, pm.dps != null ? fmtNum(pm.dps, 2) + " per set" : ""], ["Blocks", s ? fmtNum(blocks(s)) : 0, ""], ["Assists", s?.AST ?? 0, ""], ["Sets played", pm.sets, ""]].map(([l, v, sub]) =>
          <div key={l as string}><span className="label">{l}</span><b>{v}</b>{sub ? <small>{sub}</small> : null}</div>)}
      </div></section>
      <section className="card"><div className="label" style={{ marginBottom: 6 }}>Match by match</div><div className="tbl"><table>
        <thead><tr><th className="l">Date</th><th className="l">Opponent</th><th>K</th><th>Hit %</th><th>Ace</th><th>Pass</th><th>Dig</th><th>Blk</th><th>Ast</th></tr></thead>
        <tbody>{rows.map(({ g, s }) => <tr key={g.m.id}><td className="l">{fmtD(g.m.date)}</td><td className="l">{g.m.opp}</td><td>{s!.K}</td><td>{s!.TA ? fmtHit(hitting(s!)) : "—"}</td><td>{s!.SA}</td><td>{s!.R ? fmtAvg(passAvg(s!)) : "—"}</td><td>{s!.D}</td><td>{fmtNum(blocks(s!))}</td><td>{s!.AST}</td></tr>)}</tbody>
      </table></div></section>
      <p className="small muted" style={{ textAlign: "center" }}>Stats by Benchboard · <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy</a></p>
    </div></div>;
  }

  return <div className="watch"><div className="page" style={{ maxWidth: 820, margin: "0 auto" }}>
    <section className="card sh-hero">
      <div><h1>{d.team?.name}</h1><p>{d.season || "Season"}{d.team?.level ? " · " + d.team.level : ""}</p></div>
      <div className="sh-rec"><b>{rec.text}</b><span>Record</span></div>
    </section>
    {upcoming.length > 0 && <section className="card"><div className="label" style={{ marginBottom: 6 }}>Coming up</div>
      <ul className="sh-list">{upcoming.map((x) => <li key={x.id}><span className="sh-date">{fmtD(x.date)}{x.time ? " · " + fmtT(x.time) : ""}</span><b>{x.site === "away" ? "at " : "vs "}{x.opp}</b><span className="small muted">{x.event}</span></li>)}</ul></section>}
    <section className="card"><div className="label" style={{ marginBottom: 6 }}>Results</div>
      {games.length ? <ul className="sh-list">{games.map(({ m, R }) => { const isOpen = open === m.id; return <li key={m.id} className="click" onClick={() => setOpen(isOpen ? null : m.id)}>
        <span className="sh-date">{fmtD(m.date)}</span>
        <b>{m.site === "away" ? "at " : "vs "}{m.opp}</b>
        <span className={"sh-res " + (resultOf(R) === "W" ? "w" : resultOf(R) === "L" ? "l" : "")}>{resultOf(R) ? `${resultOf(R)} ${R.wonUs}–${R.wonThem}` : m.status === "live" && R.cur ? `Live · set ${R.cur.n}, ${R.cur.us}–${R.cur.them}` : `${R.wonUs}–${R.wonThem}`}</span>
        <span className="small muted sh-sets">{R.sets.filter((s) => s.us + s.them).map((s) => `${s.us}-${s.them}`).join(", ")}</span>
        {isOpen && <div className="tbl sh-box" onClick={(e) => e.stopPropagation()}><table><thead><tr><th className="l">Player</th><th>K</th><th>Ace</th><th>Dig</th><th>Blk</th><th>Ast</th></tr></thead>
          <tbody>{box(R).map(([id, s]) => <tr key={id}><td className="l"><button className="linkish" onClick={() => setSel(id)}>{nm(id)}</button></td><td>{s.K}</td><td>{s.SA}</td><td>{s.D}</td><td>{fmtNum(blocks(s))}</td><td>{s.AST}</td></tr>)}</tbody></table></div>}
      </li>; })}</ul> : <p className="empty">No results yet.</p>}
    </section>
    {games.length > 0 && <section className="card"><div className="label" style={{ marginBottom: 8 }}>Season leaders</div><div className="sh-leads">
      {leader((s) => s.K, "Kills")}{leader((s) => s.SA, "Aces")}{leader((s) => s.D, "Digs")}{leader((s) => blocks(s), "Blocks")}{leader((s) => s.AST, "Assists")}
    </div></section>}
    {roster.length > 0 && <section className="card"><div className="label" style={{ marginBottom: 8 }}>Players</div><div className="sh-roster">
      {roster.map((p) => <button key={p.id} className="pl" onClick={() => setSel(p.id)}><span className="n">{p.num}</span><span className="nm">{p.first}</span><span className="ps">{p.pos}</span></button>)}
    </div></section>}
    <p className="small muted" style={{ textAlign: "center" }}>{d.team?.name} · Stats by Benchboard · <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy</a></p>
  </div></div>;
}

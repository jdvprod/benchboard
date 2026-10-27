/** #/watch/CODE: the public gamecast parents open. No account needed; refreshes every few seconds. */
import { useEffect, useState } from "react";
import { rpc, cloudAvailable } from "./client";
import { LEGAL } from "../app/legal";
import { aggregate, LogEntry, mergeLogs, momentum, replay, runOf, serverOf, Stat } from "../sports/volleyball/engine";
import { ACTIONS } from "../sports/volleyball/actions";
import { blocks, fmtHit, hitting } from "../sports/volleyball/metrics";
import { MomentumChart } from "../ui/charts";
import { applyTheme } from "../app/theme";

interface WatchData { team: { name: string; color: string; level: string } | null; match: any; logs: any[][]; players: { id: string; num: string; first: string; last: string; pos: string }[]; at: string }

export function WatchPage({ code }: { code: string }) {
  const [d, setD] = useState<WatchData | null>(null), [err, setErr] = useState(""), [tick, setTick] = useState(0);
  const fkey = "bs-follow-" + code;
  const [follow, setFollowState] = useState<string>(() => { try { return localStorage.getItem(fkey) || ""; } catch { return ""; } });
  const [onlyMine, setOnlyMine] = useState(false);
  const setFollow = (id: string) => { setFollowState(id); try { if (id) localStorage.setItem(fkey, id); else localStorage.removeItem(fkey); } catch { /* private mode */ } };
  useEffect(() => {
    let stop = false, timer: any;
    const load = async () => {
      try { const r: WatchData | null = await rpc("watch", { share: code }, true); if (stop) return; if (!r || !r.match) setErr("This live link isn't active. Ask the coach for a new one."); else { setD(r); setErr(""); } }
      catch { if (!stop) setErr((e) => e || "Reconnecting…"); }
      if (!stop) timer = setTimeout(load, document.visibilityState === "visible" ? 5000 : 20000);
    };
    if (cloudAvailable()) load(); else setErr("Live links aren't set up in this version of the app.");
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { stop = true; clearTimeout(timer); clearInterval(t); };
  }, [code]);
  useEffect(() => { if (d?.team?.color) applyTheme(d.team.color, "system", "normal", null); }, [d?.team?.color]);

  if (!d) return <div className="watch"><div className="page" style={{ maxWidth: 760, margin: "0 auto" }}><p className="empty" style={{ padding: 30 }}>{err || "Loading the game…"}</p></div></div>;
  const m = d.match, R = replay(mergeLogs(d.logs || []), { id: m.id, bestOf: m.bestOf, scrim: m.scrim, setTo: m.setTo, cap: m.cap });
  const c = R.cur, A = aggregate(R.sets), us = d.team?.name || "Us", them = m.opp || "Opponent";
  const P = new Map(d.players.map((p) => [p.id, p]));
  const nm = (id?: string | null) => { const p = id ? P.get(id) : null; return p ? `#${p.num} ${p.first}` : ""; };
  const live = m.status === "live" && !R.matchOver;
  const run = runOf(c), srv = c ? serverOf(c) : null;
  const text = (l: LogEntry) => {
    if (l.kind === "set") return `Set ${l.set} started · ${l.serve === "us" ? us : them} serving`;
    if (l.kind === "to") return `Timeout · ${l.v === "us" ? us : them}`;
    if (l.kind === "sub") return `Sub: ${nm(l.in)} in for ${nm(l.out)}`;
    if (l.kind !== "stat") return "";
    const a: any = ACTIONS[l.t]; let s = (l.p ? nm(l.p) + " · " : "") + (a?.long || l.t);
    if (l.op) s += ` · their #${l.op}`;
    return s.replace(/^Opponent /, them + " ");
  };
  const fp = follow ? P.get(follow) : undefined, fs: Stat | undefined = fp ? A.ps[follow] : undefined;
  const mine = (l: LogEntry) => (l.kind === "stat" && l.p === follow) || (l.kind === "sub" && (l.in === follow || l.out === follow));
  const plays = R.log.filter((l) => onlyMine && fp ? l.kind === "stat" || l.kind === "sub" ? mine(l) : l.kind === "set" : (l.kind === "stat" && l.w) || l.kind === "set" || l.kind === "to" || l.kind === "sub").slice(-40).reverse();
  const leader = (f: (s: Stat) => number, label: string) => { const top = Object.entries(A.ps).map(([id, s]) => [id, f(s)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0]; return top ? <div key={label}><div className="label">{label}</div><b style={{ fontFamily: "var(--display)", fontSize: 26 }}>{+top[1].toFixed(1)}</b><div className="small">{nm(top[0])}</div></div> : null; };
  const ago = Math.max(0, Math.round((Date.now() - new Date(d.at).getTime()) / 1000)); void tick;

  return <div className="watch"><div className="page" style={{ maxWidth: 760, margin: "0 auto" }}>
    <div className="row between">
      <div className="row"><span className="tag" style={{ marginLeft: 0, background: live ? "var(--accent)" : "var(--surface-2)", color: live ? "var(--accent-ink)" : "var(--muted)" }}>{live ? "● Live" : "Final"}</span><span className="small muted">{m.date}{m.event ? " · " + m.event : ""}</span></div>
      <span className="small muted">{err ? err : live ? `Updated ${ago < 8 ? "just now" : ago + "s ago"}` : ""}</span>
    </div>
    <section className="card" style={{ background: "var(--bar)", color: "var(--bar-ink)", borderColor: "transparent" }}>
      <div className="gc-score">
        <div><div className="nm" style={{ color: "var(--us-bright)" }}>{us}</div><div className="small" style={{ color: "var(--bar-muted)" }}>Sets {R.wonUs}</div></div>
        <div className="row" style={{ gap: 14, justifyContent: "center" }}><span className="big" style={{ color: "var(--us-bright)" }}>{c?.us ?? 0}</span><span style={{ color: "var(--bar-muted)", fontSize: 24 }}>–</span><span className="big" style={{ color: "var(--them-bright)" }}>{c?.them ?? 0}</span></div>
        <div><div className="nm" style={{ color: "var(--them-bright)" }}>{them}</div><div className="small" style={{ color: "var(--bar-muted)" }}>Sets {R.wonThem}</div></div>
      </div>
      <div className="row" style={{ justifyContent: "center", marginTop: 10, gap: 8 }}>
        {c && <span className="chip"><span className="k">Set</span>{c.n}</span>}
        {live && c && <span className="chip"><span className="k">Serving</span>{c.serve === "us" ? nm(srv) || us : them}</span>}
        {run.n >= 3 && <span className={"chip run-" + run.side}>{run.n}-0 run</span>}
      </div>
    </section>
    <section className="card">
      <div className="row between" style={{ marginBottom: fp ? 10 : 0 }}>
        <span className="label">Follow a player</span>
        <select className="input" style={{ width: "auto" }} value={follow} onChange={(e) => setFollow(e.target.value)} aria-label="Follow a player">
          <option value="">Choose…</option>{d.players.slice().sort((a, b) => (+a.num || 0) - (+b.num || 0)).map((p) => <option key={p.id} value={p.id}>#{p.num} {p.first} {p.last ? p.last + "." : ""}</option>)}
        </select>
      </div>
      {fp && <div className="follow">
        <div className="follow-nm"><b>#{fp.num} {fp.first}</b><span className="small muted">{fp.pos}{c?.lu?.includes(follow) || c?.lib === follow ? " · on court now" : ""}</span></div>
        <div className="follow-k">{[["Kills", fs?.K || 0], ["Aces", fs?.SA || 0], ["Digs", fs?.D || 0], ["Blocks", fs ? +blocks(fs).toFixed(1) : 0], ["Assists", fs?.AST || 0]].map(([l, v]) => <div key={l as string}><b>{v}</b><span>{l}</span></div>)}</div>
        {fs && fs.TA > 0 && <p className="small muted" style={{ margin: "6px 0 0" }}>Hitting {fmtHit(hitting(fs))} on {fs.TA} swings</p>}
      </div>}
    </section>
    <section className="card"><div className="tbl"><table>
      <thead><tr><th className="l">Team</th>{R.sets.map((s) => <th key={s.n}>{s.n}</th>)}<th>Sets</th></tr></thead>
      <tbody><tr><td className="l"><b style={{ color: "var(--us)" }}>{us}</b></td>{R.sets.map((s) => <td key={s.n} style={{ fontWeight: s.winner === "us" ? 800 : undefined }}>{s.us}</td>)}<td><b>{R.wonUs}</b></td></tr>
        <tr><td className="l"><b style={{ color: "var(--them)" }}>{them}</b></td>{R.sets.map((s) => <td key={s.n} style={{ fontWeight: s.winner === "them" ? 800 : undefined }}>{s.them}</td>)}<td><b>{R.wonThem}</b></td></tr></tbody></table></div></section>
    {c && c.rallies.length > 1 && <section className="card"><div className="label" style={{ marginBottom: 6 }}>Momentum · set {c.n}</div><MomentumChart diffs={momentum(c)} /></section>}
    <section className="card"><div className="label" style={{ marginBottom: 8 }}>Leaders</div><div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))" }}>
      {leader((s) => s.K, "Kills")}{leader((s) => s.SA, "Aces")}{leader((s) => s.D, "Digs")}{leader((s) => blocks(s), "Blocks")}{leader((s) => s.AST, "Assists")}
    </div><p className="small muted" style={{ marginTop: 8 }}>Team hitting {fmtHit(hitting(A.T))} · {A.T.SA} aces · {A.team.OE} opponent errors</p></section>
    <section className="card"><div className="label" style={{ marginBottom: 6 }}>Player stats</div>
      <div className="tbl"><table><thead><tr><th className="l">Player</th><th title="Kills">K</th><th title="Aces">Ace</th><th title="Digs">Dig</th><th title="Blocks">Blk</th><th title="Assists">Ast</th></tr></thead>
        <tbody>{Object.entries(A.ps).filter(([id]) => P.has(id)).sort((a, b) => (+P.get(a[0])!.num || 0) - (+P.get(b[0])!.num || 0)).map(([id, s]) => <tr key={id} className={id === follow ? "follow-row" : undefined}><td className="l">{nm(id)} {P.get(id)!.last ? P.get(id)!.last + "." : ""}</td><td>{s.K}</td><td>{s.SA}</td><td>{s.D}</td><td>{+blocks(s).toFixed(1)}</td><td>{s.AST}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card"><div className="row between" style={{ marginBottom: 6 }}><span className="label">Play by play</span>{fp && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only #{fp.num}</label>}</div>
      <ul className="pbp">{plays.map((l) => <li key={l.id} className={follow && mine(l) ? "mine" : undefined}><span className={"sc " + (l.kind === "stat" && l.w ? "pt-" + l.w : "")}>{l.kind === "stat" && l.w ? `${l.us}–${l.them}` : ""}</span><span className={l.kind !== "stat" ? "small muted" : ""}>{text(l)}</span></li>)}</ul>
    </section>
    <p className="small muted" style={{ textAlign: "center" }}>{d.team?.name}{d.team?.level ? " · " + d.team.level : ""} · Live stats by Benchboard · <a href={LEGAL.privacy} target="_blank" rel="noopener">Privacy</a></p>
  </div></div>;
}

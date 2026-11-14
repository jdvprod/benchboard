/** Floorcall Beach: score and stat a beach volleyball match, two players a side. Its own site, beside the indoor app.
 *   #/         your matches, start a new one
 *   #/m/ID     the match: scoreboard, sand court, one-tap stats, box score
 * Matches are kept on this device. */
import "../styles/app.css";
import "./beach.css";
import { type FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { watchErrors } from "../app/errors";
import { BeachEvent, BeachMatch, BeachState, Code, Format, FORMATS, hitPct, Line, pairLine, replay, scoreLine, Side, summary } from "../sports/beach/engine";
import { SiteSwitch } from "../ui/SiteSwitch";

const KEY = "fc-beach";
const load = (): BeachMatch[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const store = (list: BeachMatch[]) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window: the match lives until the tab closes */ } };
const parse = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
const fmtHit = (l: Line) => { const h = hitPct(l); return h === null ? "–" : (h < 0 ? "-" : "") + Math.abs(h).toFixed(3).replace(/^0/, ""); };
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function App() {
  const [route, setRoute] = useState(parse()), [list, setList] = useState(load);
  useEffect(() => { const f = () => { setRoute(parse()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const save = (next: BeachMatch[]) => { setList(next); store(next); };
  const m = route[0] === "m" ? list.find((x) => x.id === route[1]) : null;
  return <div className="bv">
    <header className="bv-top"><a className="bv-brand" href="#/"><b>Floorcall</b><span>Beach</span></a><SiteSwitch here="beach" /></header>
    <main className="bv-main">
      {m ? <Match m={m} onChange={(n) => save(list.map((x) => (x.id === n.id ? n : x)))} />
        : <Home list={list} onNew={(n) => { save([n, ...list]); location.hash = "#/m/" + n.id; }} onDelete={(id) => save(list.filter((x) => x.id !== id))} />}
    </main>
    <footer className="bv-foot">Matches are saved on this device. <a href="../legal/privacy.html">Privacy</a> · <a href="../legal/terms.html">Terms</a></footer>
  </div>;
}

function Home({ list, onNew, onDelete }: { list: BeachMatch[]; onNew: (m: BeachMatch) => void; onDelete: (id: string) => void }) {
  const [a, setA] = useState(""), [b, setB] = useState(""), [c, setC] = useState(""), [d, setD] = useState("");
  const [format, setFormat] = useState<Format>("bo3"), [first, setFirst] = useState<Side>("us");
  const start = (e: FormEvent) => {
    e.preventDefault();
    const names: [string, string, string, string] = [a.trim() || "Player 1", b.trim() || "Player 2", c.trim() || "Opponent 1", d.trim() || "Opponent 2"];
    onNew({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), format, us: names[0] + " / " + names[1], them: c.trim() || d.trim() ? names[2] + " / " + names[3] : "Opponents", names, first, firstServer: [0, 2], events: [] });
  };
  return <>
    <section className="bv-hero">
      <h1>Beach volleyball, scored and statted in one tap.</h1>
      <p>Two players a side. Floorcall Beach keeps the score, tells you who serves next and when to switch sides, and builds a box score for each player as you go.</p>
    </section>
    <form className="card bv-new" onSubmit={start}>
      <h2>Start a match</h2>
      <div className="bv-pairs">
        <fieldset><legend>Your pair</legend>
          <input className="input" value={a} onChange={(e) => setA(e.target.value)} placeholder="Player 1" aria-label="Your player 1" maxLength={24} />
          <input className="input" value={b} onChange={(e) => setB(e.target.value)} placeholder="Player 2" aria-label="Your player 2" maxLength={24} /></fieldset>
        <fieldset><legend>Their pair (optional)</legend>
          <input className="input" value={c} onChange={(e) => setC(e.target.value)} placeholder="Opponent 1" aria-label="Opponent 1" maxLength={24} />
          <input className="input" value={d} onChange={(e) => setD(e.target.value)} placeholder="Opponent 2" aria-label="Opponent 2" maxLength={24} /></fieldset>
      </div>
      <div className="bv-opts">
        <label>Format<select className="input" value={format} onChange={(e) => setFormat(e.target.value as Format)}>{(Object.keys(FORMATS) as Format[]).map((k) => <option key={k} value={k}>{FORMATS[k].label}</option>)}</select></label>
        <label>Serves first<select className="input" value={first} onChange={(e) => setFirst(e.target.value as Side)}><option value="us">Your pair</option><option value="them">Their pair</option></select></label>
        <button className="btn primary" type="submit">Start match</button>
      </div>
    </form>
    {list.length > 0 && <section className="card">
      <h2>Your matches</h2>
      <ul className="bv-list">{list.map((m) => { const S = replay(m); return <li key={m.id}>
        <a href={"#/m/" + m.id}><b>{m.us}</b> <span className="muted">vs</span> <b>{m.them}</b><span className="bv-meta">{day(m.at)} · {S.over ? (S.winner === "us" ? "Won " : "Lost ") + S.setsWon.us + "–" + S.setsWon.them : "In progress"}{scoreLine(S) ? " · " + scoreLine(S) : ""}</span></a>
        <button className="btn sm" onClick={() => { if (confirm("Delete this match?")) onDelete(m.id); }} aria-label={`Delete ${m.us} vs ${m.them}`}>Delete</button>
      </li>; })}</ul>
    </section>}
    <Totals list={list} />
  </>;
}

/** Everyone who has played on "your pair" across the matches on this device, added up. */
function Totals({ list }: { list: BeachMatch[] }) {
  const by = new Map<string, { name: string; n: number; w: number; l: Line }>();
  for (const m of list) { const S = replay(m); if (!S.log.length) continue;
    for (const p of [0, 1]) { const k = m.names[p].trim().toLowerCase(); if (/^player [12]$/.test(k)) continue;
      const e = by.get(k) || { name: m.names[p], n: 0, w: 0, l: { K: 0, AE: 0, TA: 0, A: 0, SE: 0, SV: 0, B: 0, D: 0, E: 0, PTS: 0 } };
      e.n++; if (S.over && S.winner === "us") e.w++; for (const c of Object.keys(e.l) as (keyof Line)[]) e.l[c] += S.players[p][c]; by.set(k, e); } }
  const rows = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  if (!rows.length) return null;
  return <section className="card">
    <h2>Player totals</h2>
    <div className="tbl"><table className="bv-box">
      <thead><tr><th className="l">Player</th><th title="Matches played">MP</th><th title="Matches won">W</th><th title="Kills">K</th><th title="Attack errors">E</th><th title="Total attacks">TA</th><th title="Hitting percentage">PCT</th><th title="Aces">A</th><th title="Serve errors">SE</th><th title="Blocks">B</th><th title="Digs">D</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.name}><td className="l">{r.name}</td><td>{r.n}</td><td>{r.w}</td><td>{r.l.K}</td><td>{r.l.AE}</td><td>{r.l.K + r.l.AE + r.l.TA}</td><td>{fmtHit(r.l)}</td><td>{r.l.A}</td><td>{r.l.SE}</td><td>{r.l.B}</td><td>{r.l.D}</td></tr>)}</tbody>
    </table></div>
    <p className="keys">Totals for your players across every match saved on this device, matched by name.</p>
  </section>;
}

/** The buttons under each player. Ace and serve error only show for whoever is serving. */
const TOUCH: [Code, string, string][] = [["K", "Kill", "pt"], ["B", "Block", "pt"], ["D", "Dig", ""], ["TA", "Attack in play", ""], ["AE", "Attack error", "err"], ["E", "Error", "err"]];

function Match({ m, onChange }: { m: BeachMatch; onChange: (m: BeachMatch) => void }) {
  const S = replay(m), cur = S.sets[S.set], f = FORMATS[m.format];
  const [copied, setCopied] = useState(false);
  const add = (e: BeachEvent) => onChange({ ...m, events: [...m.events, e] });
  const undo = () => onChange({ ...m, events: m.events.slice(0, -1) });
  const last = S.log[S.log.length - 1];
  const share = async () => { try { await navigator.clipboard.writeText(summary(m, S)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  const setServer = (side: Side, p: number) => onChange({ ...m, firstServer: side === "us" ? [p, m.firstServer[1]] : [m.firstServer[0], p] });
  const fresh = m.events.every((e) => e.t === "to");

  return <>
    <section className="bv-board" aria-label="Score">
      <div className={"bv-team" + (S.serving === "us" && !S.over ? " srv" : "")}><span className="bv-name">{m.us}</span><span className="bv-pts num">{cur.us}</span></div>
      <div className="bv-mid"><span className="bv-set">{S.over ? "Final" : "Set " + (S.set + 1)}</span><span className="bv-sets num">{S.setsWon.us}–{S.setsWon.them}</span>
        <span className="bv-prev num">{S.sets.filter((s) => s.done).map((s) => `${s.us}-${s.them}`).join("  ")}</span></div>
      <div className={"bv-team r" + (S.serving === "them" && !S.over ? " srv" : "")}><span className="bv-name">{m.them}</span><span className="bv-pts num">{cur.them}</span></div>
    </section>

    {S.over ? <p className="bv-note win" role="status">{S.winner === "us" ? m.us : m.them} win{" "}{S.setsWon[S.winner!]}–{S.setsWon[S.winner === "us" ? "them" : "us"]} ({scoreLine(S)}).</p>
      : S.switchNow ? <p className="bv-note sw" role="status">Switch sides. {cur.us + cur.them} points played; the next switch is at {cur.us + cur.them + f.sw[S.set]}.</p>
      : <p className="bv-note" role="status"><b>{m.names[S.server]}</b> serves. {last ? "Last point: " + last.text + "." : `Set to ${f.to[S.set]}, win by 2. Sides switch every ${f.sw[S.set]} points.`}</p>}

    <Sand m={m} S={S} />

    {!S.over && <section className="bv-pads" aria-label="Record a touch">
      {[0, 1, 2, 3].map((p) => <div key={p} className={"card bv-pad " + (p < 2 ? "us" : "them")}>
        <h3>{m.names[p]}{S.server === p && <span className="bv-ball" title="Serving">serving</span>}</h3>
        <div className="bv-keys">
          {S.server === p && <><button className="pt" onClick={() => add({ t: "stat", c: "A", p })}>Ace</button><button className="err" onClick={() => add({ t: "stat", c: "SE", p })}>Serve error</button></>}
          {TOUCH.map(([c, l, cls]) => <button key={c} className={cls} onClick={() => add({ t: "stat", c, p })}>{l}</button>)}
        </div>
      </div>)}
    </section>}

    <section className="bv-bar">
      {!S.over && <><button className="btn" onClick={() => add({ t: "pt", w: "us" })}>+1 {m.us}</button><button className="btn" onClick={() => add({ t: "pt", w: "them" })}>+1 {m.them}</button>
        <button className="btn" onClick={() => add({ t: "to", w: "us" })} disabled={S.timeouts.us >= 1}>Timeout {S.timeouts.us}/1</button>
        <button className="btn" onClick={() => add({ t: "to", w: "them" })} disabled={S.timeouts.them >= 1}>Their timeout {S.timeouts.them}/1</button></>}
      <span className="bv-gap" />
      <button className="btn" onClick={undo} disabled={!m.events.length}>Undo</button>
      <button className="btn" onClick={share}>{copied ? "Copied" : "Copy summary"}</button>
      <button className="btn" onClick={() => print()}>Print</button>
    </section>

    {fresh && <section className="card bv-first">
      <h2>Who serves first for each pair?</h2>
      <div className="bv-opts">
        <label>{m.us}<select className="input" value={m.firstServer[0]} onChange={(e) => setServer("us", +e.target.value)}><option value={0}>{m.names[0]}</option><option value={1}>{m.names[1]}</option></select></label>
        <label>{m.them}<select className="input" value={m.firstServer[1]} onChange={(e) => setServer("them", +e.target.value)}><option value={2}>{m.names[2]}</option><option value={3}>{m.names[3]}</option></select></label>
      </div>
    </section>}

    <Box m={m} S={S} />

    {S.log.length > 0 && <section className="card">
      <h2>Point by point</h2>
      <ol className="bv-log">{S.log.slice().reverse().slice(0, 60).map((l, i) => <li key={S.log.length - i} className={l.w}><span className="num">{l.us}–{l.them}</span><span>{l.text}</span><span className="muted">Set {l.set + 1}</span></li>)}</ol>
    </section>}
  </>;
}

/** The court from above: sand, the net across the middle, each pair on its side. Pairs trade ends when sides switch. */
function Sand({ m, S }: { m: BeachMatch; S: BeachState }) {
  const near = S.swapped ? [2, 3] : [0, 1], far = S.swapped ? [0, 1] : [2, 3];
  const chip = (p: number, x: number, y: number) => <g key={p} transform={`translate(${x} ${y})`} className={"bv-chip " + (p < 2 ? "us" : "them") + (S.server === p && !S.over ? " srv" : "")}>
    <circle r={17} /><text textAnchor="middle" dominantBaseline="central">{m.names[p].slice(0, 1).toUpperCase()}</text><text y={31} textAnchor="middle" className="nm">{m.names[p].slice(0, 12)}</text>
    {S.server === p && !S.over && <circle cx={20} cy={-16} r={6} className="ball" />}
  </g>;
  return <svg className="bv-sand" viewBox="0 0 360 250" role="img" aria-label={`${m.us} on the ${S.swapped ? "far" : "near"} side, ${m.them} on the ${S.swapped ? "near" : "far"} side`}>
    <rect width={360} height={250} rx={14} className="bg" />
    <rect x={100} y={25} width={160} height={200} className="court" />
    <line x1={88} y1={125} x2={272} y2={125} className="net" />
    <text x={285} y={129} className="cap">Net</text>
    {chip(far[0], 140, 62)}{chip(far[1], 220, 62)}{chip(near[0], 140, 172)}{chip(near[1], 220, 172)}
  </svg>;
}

function Box({ m, S }: { m: BeachMatch; S: BeachState }) {
  const row = (name: string, l: Line, total = false) => <tr key={name} className={total ? "tot" : ""}><td className="l">{name}</td><td>{l.PTS}</td><td>{l.K}</td><td>{l.AE}</td><td>{l.K + l.AE + l.TA}</td><td>{fmtHit(l)}</td><td>{l.A}</td><td>{l.SE}</td><td>{l.B}</td><td>{l.D}</td><td>{l.E}</td></tr>;
  return <section className="card">
    <h2>Box score</h2>
    <div className="tbl"><table className="bv-box">
      <thead><tr><th className="l">Player</th><th title="Points won">PTS</th><th title="Kills">K</th><th title="Attack errors">E</th><th title="Total attacks">TA</th><th title="Hitting percentage">PCT</th><th title="Aces">A</th><th title="Serve errors">SE</th><th title="Blocks">B</th><th title="Digs">D</th><th title="Other errors">ERR</th></tr></thead>
      <tbody>{row(m.names[0], S.players[0])}{row(m.names[1], S.players[1])}{row(m.us, pairLine(S, "us"), true)}{row(m.names[2], S.players[2])}{row(m.names[3], S.players[3])}{row(m.them, pairLine(S, "them"), true)}</tbody>
    </table></div>
    <p className="keys">PCT is hitting percentage: kills minus attack errors, divided by total attacks. Points added with the +1 buttons count in the score but not for a player.</p>
  </section>;
}

watchErrors();
createRoot(document.getElementById("root")!).render(<App />);

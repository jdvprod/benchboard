/** Benchboard Recruit: player profiles and team recruiting boards for college coaches. Separate from the coaching app.
 *   #/p/CODE  a player's profile     #/b/CODE  a team's recruiting board     #/  what this is, enter a code */
import "../styles/app.css";
import "./recruit.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { cloudAvailable, rpc } from "../cloud/client";
import { ClipPlayer } from "../ui/ClipPlayer";
import { Clip, videoKind } from "../film/clips";
import { fmtAvg, fmtHit, fmtNum, fmtPct } from "../sports/volleyball/metrics";
import type { RecruitData } from "../features/player/recruitData";

const parse = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
function useRoute() { const [r, setR] = useState(parse()); useEffect(() => { const f = () => { setR(parse()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []); return r; }
const day = (d: string | number) => { const x = typeof d === "number" ? new Date(d) : new Date(d + "T12:00:00"); return isNaN(+x) ? String(d) : x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const safeUrl = (u?: string) => { const v = (u || "").trim(); if (!v) return ""; try { const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : "https://" + v); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };
const mail = (e?: string) => (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) ? "mailto:" + e.trim() : "");

function Shell({ children, crumb }: { children: any; crumb?: string }) {
  return <div className="rc">
    <header className="rc-top"><a className="rc-brand" href="#/"><b>Benchboard</b><span>Recruit</span></a>{crumb && <span className="rc-crumb">{crumb}</span>}</header>
    <main className="rc-main">{children}</main>
    <footer className="rc-foot">Profiles are shared by the player's coach with the family's permission. Stats are recorded live by the team's coaching staff with Benchboard. · <a href="../legal/privacy.html">Privacy</a> · <a href="../legal/terms.html">Terms</a></footer>
  </div>;
}

function useRpc<T>(fn: string, code: string, ok: (r: T) => boolean, missing: string) {
  const [d, setD] = useState<T | null>(null), [err, setErr] = useState("");
  useEffect(() => {
    if (!cloudAvailable()) { setErr("This site isn't connected yet."); return; }
    rpc(fn, { share: code }, true).then((r: any) => (r && ok(r) ? setD(r) : setErr(missing))).catch(() => setErr("Couldn't load it. Check your connection."));
  }, [code]);
  return { d, err };
}

/* ---------- a player's profile ---------- */
function Profile({ code }: { code: string }) {
  const { d, err } = useRpc<{ html: string; data: RecruitData | null; updated_at: string }>("recruit_view", code, (r) => !!(r.html || r.data), "This profile isn't shared right now. Ask the player's coach for a current link.");
  useEffect(() => { if (d?.data) document.title = `${d.data.player.first} ${d.data.player.last} · Class of ${d.data.player.grad || "—"} · Benchboard Recruit`; }, [d]);
  if (!d) return <Shell><p className="rc-empty">{err || "Loading the profile…"}</p></Shell>;
  if (!d.data) return <Shell><iframe className="recruit-frame" title="Recruiting profile" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={d.html.replace("<head>", '<head><base target="_blank">')} /></Shell>;
  const { player: p, team: t, profile: pr, season: s, games, clips } = d.data;
  const video = safeUrl(pr.video), vk = video ? videoKind(video) : "other";
  const fullVideo: Clip[] = video && (vk === "youtube" || vk === "vimeo") ? [{ id: "full", matchId: "", url: video, start: 0, end: 36000, label: "Highlight video", t: "VID", date: "", opp: "" }] : [];
  // only what the staff recorded: a team that doesn't track digs shouldn't make a player look like she has none
  const tiles: [string, string, string, number][] = [
    ["Kills / set", fmtNum(s.kps, 2), `${s.K} kills`, s.K + s.TA], ["Hitting %", s.TA ? fmtHit(s.hitting) : "—", `${s.TA} swings, ${s.AE} errors`, s.TA], ["Aces / set", fmtNum(s.acesPs, 2), `${s.SA} aces`, s.SA + s.SE], ["Serve in", fmtPct(s.serveIn), `${s.SE} serve errors`, s.serveIn != null ? 1 : 0],
    ["Pass average", s.R ? fmtAvg(s.passAvg) : "—", `0–3 scale, ${s.R} passes`, s.R], ["Digs / set", fmtNum(s.dps, 2), `${s.D} digs`, s.D], ["Blocks / set", fmtNum(s.bps, 2), `${s.BS} solo, ${s.BA} assists`, s.BS + s.BA], ["Assists / set", fmtNum(s.aps, 2), `${s.AST} assists`, s.AST],
  ];
  const shown = tiles.filter((x) => x[3] > 0);
  const measure: [string, string | undefined][] = [["Height", p.height], ["Standing reach", pr.reach], ["Approach jump", pr.approach], ["Block jump", pr.block], ["Dominant hand", pr.hand], ["GPA", pr.gpa], ["Club", pr.club]];
  const contact = mail(pr.email);
  type G = RecruitData["games"][number];
  const allCols: [string, (g: G) => string | number, (g: G) => number][] = [["SP", (g) => g.sets, () => 1], ["K", (g) => g.K, (g) => g.K + g.TA], ["E", (g) => g.AE, (g) => g.TA], ["TA", (g) => g.TA, (g) => g.TA], ["Hit%", (g) => (g.TA ? fmtHit((g.K - g.AE) / g.TA) : "–"), (g) => g.TA],
    ["A", (g) => g.SA, (g) => g.SA + g.SE], ["Rec", (g) => g.R, (g) => g.R], ["Pass", (g) => (g.R ? fmtAvg(g.RS / g.R) : "–"), (g) => g.R], ["D", (g) => g.D, (g) => g.D], ["Blk", (g) => fmtNum(g.BS + g.BA / 2), (g) => g.BS + g.BA], ["Ast", (g) => g.AST, (g) => g.AST]];
  // columns the staff never recorded for this player are left out
  const cols = allCols.filter(([, , has]) => games.some((g) => has(g) > 0)).map(([h, f]) => [h, f] as [string, (g: G) => string | number]);
  return <Shell crumb={t.name}>
    <section className="rc-hero">
      <span className="rc-num" aria-label={"Number " + p.num}>{p.num}</span>
      <div className="rc-id"><h1>{p.first} {p.last}</h1>
        <p className="rc-meta">{[p.grad ? "Class of " + p.grad : "", p.pos, p.height].filter(Boolean).join(" · ")}</p>
        <p className="rc-meta">{[t.name, t.level, pr.club ? "Club: " + pr.club : ""].filter(Boolean).join(" · ")}</p></div>
      <div className="rc-acts">{contact && <a className="btn primary" href={contact}>Email {p.first}</a>}<button className="btn" onClick={() => print()}>Print or save PDF</button></div>
    </section>
    <p className="rc-verified"><b>✓ Verified stats</b> recorded live by {t.name}'s coaching staff{t.season ? ` · ${t.season}` : ""} · {s.matches} {s.matches === 1 ? "match" : "matches"}, {s.sets} sets · updated {day(d.data.updated)}</p>
    {(clips.length > 0 || fullVideo.length > 0) && <section className="rc-card"><h2>Highlights</h2>
      {clips.length > 0 && <ClipPlayer clips={clips} title={`${clips.length} plays from tracked matches`} />}
      {fullVideo.length > 0 && <div style={{ marginTop: clips.length ? 14 : 0 }}><ClipPlayer clips={fullVideo} title="Highlight video" /></div>}
      {video && vk === "other" && <p><a href={video} target="_blank" rel="noopener">Watch the highlight video</a></p>}
      <ul className="rc-print-clips">{clips.map((c) => <li key={c.id}>{c.label} · vs {c.opp} · {day(c.date)}</li>)}</ul>
    </section>}
    {shown.length > 0 && <section className="rc-card"><h2>Season numbers</h2><div className="rc-tiles">{shown.map(([l, v, sub]) => <div key={l}><span>{l}</span><b>{v}</b><small>{sub}</small></div>)}</div></section>}
    <div className="rc-two">
      {measure.some(([, v]) => v) && <section className="rc-card"><h2>Measurables and academics</h2><dl className="rc-dl">{measure.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>}
      <section className="rc-card"><h2>Contact</h2><dl className="rc-dl">
        {pr.email && <div><dt>Player email</dt><dd>{contact ? <a href={contact}>{pr.email}</a> : pr.email}</dd></div>}
        {pr.phone && <div><dt>Player phone</dt><dd><a href={"tel:" + pr.phone.replace(/[^\d+]/g, "")}>{pr.phone}</a></dd></div>}
        {pr.coachContact && <div><dt>Coach</dt><dd>{pr.coachContact}</dd></div>}
        {!pr.email && !pr.phone && !pr.coachContact && <p className="rc-note">Contact the player through {t.name}'s coaching staff.</p>}
      </dl></section>
    </div>
    {pr.about && <section className="rc-card"><h2>About {p.first}</h2><p className="rc-about">{pr.about}</p></section>}
    {games.length > 0 && <section className="rc-card"><h2>Game log</h2><div className="tbl rc-log"><table>
      <thead><tr><th className="l">Date</th><th className="l">Opponent</th><th className="l">Result</th>{cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{games.map((g, i) => <tr key={i}><td className="l">{day(g.date)}</td><td className="l">{g.opp}</td><td className="l">{g.res}</td>{cols.map(([h, f]) => <td key={h}>{f(g)}</td>)}</tr>)}</tbody>
    </table></div><p className="rc-note">SP sets played · Hit% (kills − errors) ÷ attempts · Pass on a 0–3 scale · Blk = solo + half of each assist.</p></section>}
  </Shell>;
}

/* ---------- a team's recruiting board ---------- */
interface BoardRow { code: string; updated_at: string; player: RecruitData["player"]; profile: { club?: string; video?: string }; season: RecruitData["season"]; clips: number }
function Board({ code }: { code: string }) {
  const { d, err } = useRpc<{ team: { name: string; level: string } | null; players: BoardRow[] }>("recruit_board", code, (r) => !!r.team, "This recruiting board isn't shared right now. Ask the coach for a current link.");
  const [grad, setGrad] = useState(""), [pos, setPos] = useState("");
  useEffect(() => { if (d?.team) document.title = `${d.team.name} recruiting · Benchboard Recruit`; }, [d]);
  if (!d) return <Shell><p className="rc-empty">{err || "Loading the board…"}</p></Shell>;
  const grads = [...new Set(d.players.map((x) => x.player.grad).filter(Boolean))].sort() as number[];
  const poss = [...new Set(d.players.map((x) => x.player.pos).filter(Boolean))].sort();
  const rows = d.players.filter((x) => (!grad || String(x.player.grad) === grad) && (!pos || x.player.pos === pos)).sort((a, b) => (a.player.grad || 9999) - (b.player.grad || 9999) || a.player.last.localeCompare(b.player.last));
  const key = (x: BoardRow): [string, string][] => { const s = x.season, p = x.player.pos;
    if (p === "S") return [["Ast/set", fmtNum(s.aps, 2)], ["Aces/set", fmtNum(s.acesPs, 2)], ["Digs/set", fmtNum(s.dps, 2)]];
    if (p === "L" || p === "DS") return [["Pass", s.R ? fmtAvg(s.passAvg) : "—"], ["Digs/set", fmtNum(s.dps, 2)], ["Serve in", fmtPct(s.serveIn)]];
    if (p === "MB") return [["Kills/set", fmtNum(s.kps, 2)], ["Hit%", s.TA ? fmtHit(s.hitting) : "—"], ["Blk/set", fmtNum(s.bps, 2)]];
    return [["Kills/set", fmtNum(s.kps, 2)], ["Hit%", s.TA ? fmtHit(s.hitting) : "—"], ["Pass", s.R ? fmtAvg(s.passAvg) : "—"]]; };
  return <Shell crumb={d.team?.name}>
    <section className="rc-boardhead"><h1>{d.team?.name}</h1><p>{d.team?.level ? d.team.level + " · " : ""}Recruiting board · {d.players.length} {d.players.length === 1 ? "player" : "players"} with verified stats</p></section>
    {d.players.length > 1 && <div className="rc-filters">
      <label>Class <select className="input" value={grad} onChange={(e) => setGrad(e.target.value)}><option value="">All</option>{grads.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
      <label>Position <select className="input" value={pos} onChange={(e) => setPos(e.target.value)}><option value="">All</option>{poss.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
    </div>}
    {rows.length ? <div className="rc-grid">{rows.map((x) => <a key={x.code} className="rc-pc" href={`#/p/${x.code}`}>
      <span className="rc-num sm">{x.player.num}</span>
      <span className="rc-pc-id"><b>{x.player.first} {x.player.last}</b><small>{[x.player.grad ? "Class of " + x.player.grad : "", x.player.pos, x.player.height].filter(Boolean).join(" · ")}</small>{x.profile.club && <small>Club: {x.profile.club}</small>}</span>
      <span className="rc-pc-k">{key(x).map(([l, v]) => <span key={l}><b>{v}</b><small>{l}</small></span>)}</span>
      <span className="rc-pc-f">{x.clips ? `▶ ${x.clips} highlight clips` : "Stats only"} · {x.season.sets} sets</span>
    </a>)}</div> : <p className="rc-empty">{d.players.length ? "No players match those filters." : "No profiles are shared yet."}</p>}
  </Shell>;
}

function Landing() {
  const [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length < 4) { setErr("Codes are 6 letters and numbers."); return; }
    setBusy(true); setErr("");
    try { const p: any = await rpc("recruit_view", { share: c }, true); if (p?.html || p?.data) { location.hash = "#/p/" + c; return; } const b: any = await rpc("recruit_board", { share: c }, true); if (b?.team) { location.hash = "#/b/" + c; return; } setErr("No profile or board uses that code."); }
    catch { setErr("Couldn't check the code. Check your connection."); }
    setBusy(false);
  };
  return <Shell><section className="rc-landing">
    <h1>Verified stats and film for high school and club volleyball recruits.</h1>
    <p>Every number on a Benchboard Recruit profile was recorded live by the player's own coaching staff, match by match, with clips of the plays behind them. Profiles are shared only with the family's permission.</p>
    <form className="rc-code" onSubmit={(e) => { e.preventDefault(); go(); }}><label htmlFor="rc-code">Profile or board code</label>
      <div><input id="rc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7Q2XM" maxLength={12} autoComplete="off" spellCheck={false} /><button className="btn primary" disabled={busy}>{busy ? "Finding…" : "Open"}</button></div>
      {err && <p className="rc-err" role="alert">{err}</p>}</form>
  </section></Shell>;
}

function RecruitApp() {
  const r = useRoute();
  if (r[0] === "p" && r[1]) return <Profile key={r[1]} code={r[1].toUpperCase()} />;
  if (r[0] === "b" && r[1]) return <Board key={r[1]} code={r[1].toUpperCase()} />;
  return <Landing />;
}
createRoot(document.getElementById("root")!).render(<RecruitApp />);

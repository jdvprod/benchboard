/** Film Room → Scout an opponent: watch one of their games and tap a jersey number, then what happened
 * (kill, hitting error, ace, serve error, block, dig, other error). Every tap keeps its video time, so each one is a clip.
 * Saved on the opponent, so the Matchup page shows it too. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureOpponent, get, opponentsOf, patch, toast, todayISO, uid, useVersion } from "../../data/store";
import type { Opponent, OppFilm, ScoutEv } from "../../data/model";
import { Card, fmtDate, plural } from "../../ui/kit";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { go } from "../../app/router";
import { Clip, clock, LOCAL, videoKind } from "../../film/clips";
import { localVideo, setLocalVideo } from "../../film/localVideos";
import { SCOUT_CODES, scoutLine, scoutLong, scoutNumbers, scoutTotals } from "../../film/scout";
import { resolve } from "./words";

const key = (f: OppFilm) => "scout:" + f.id;
const srcOf = (f: OppFilm) => (f.video.startsWith(LOCAL) ? localVideo(key(f)) : videoKind(f.video) === "file" ? f.video : null);
export const scoutRoute = (o: Opponent, f: OppFilm) => "scout:" + o.id + ":" + f.id;

/** Film Room home: start scouting a new opponent game, or reopen one. */
export function ScoutStart() {
  const opps = opponentsOf();
  const [opp, setOpp] = useState(""), [vs, setVs] = useState(""), [date, setDate] = useState(todayISO());
  const [file, setFile] = useState<File | null>(null), [link, setLink] = useState("");
  const films = opps.flatMap((o) => (o.films || []).map((f) => ({ o, f }))).sort((a, b) => b.f.at - a.f.at).slice(0, 8);
  const start = () => {
    if (!opp.trim()) { toast("Name the team you're scouting."); return; }
    if (!file && !link.trim()) { toast("Pick their game video first."); return; }
    const o = ensureOpponent(opp.trim());
    const f: OppFilm = { id: uid("sf"), date, vs: vs.trim(), video: file ? LOCAL + file.name : link.trim(), evs: [], at: Date.now() };
    if (file) setLocalVideo(key(f), file);
    patch("opponents", o.id, { films: [...(get("opponents", o.id)?.films || []), f] });
    go("film", scoutRoute(o, f));
  };
  return <Card title="Scout an opponent from film" className="sf-start">
    <div className="stack">
      <p className="small muted">Watch one of their games and tap their jersey number, then what happened: kill, error, ace, block or dig. You get their dangerous players, with a clip of every play.</p>
      <label className={"fr-drop" + (file ? " has" : "")}>
        <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setLink(""); } }} aria-label="Video of their game" />
        <b>{file ? file.name : "Choose their game video"}</b>
        <span className="small muted">{file ? "Stays on this device, never uploaded" : "MP4 or MOV, or a Hudl or YouTube download"}</span>
      </label>
      {!file && <input className="input" placeholder="…or paste a direct link to a video file (.mp4)" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Their video link" />}
      <div className="two">
        <label className="field"><span className="label">Team you're scouting</span><input list="sf-opps" value={opp} onChange={(e) => setOpp(e.target.value)} placeholder="e.g. Central" /><datalist id="sf-opps">{opps.map((o) => <option key={o.id} value={o.name} />)}</datalist></label>
        <label className="field"><span className="label">Playing against (optional)</span><input value={vs} onChange={(e) => setVs(e.target.value)} placeholder="e.g. Clovis West" /></label>
      </div>
      <label className="field" style={{ maxWidth: 220 }}><span className="label">Date of their game</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="row"><button className="btn primary" onClick={start}>Start scouting</button></div>
      {films.length > 0 && <><span className="label" style={{ marginTop: 6 }}>Scouted games</span>
        <ul className="fr-list">{films.map(({ o, f }) => <li key={f.id}><button onClick={() => go("film", scoutRoute(o, f))}><b>{o.name}{f.vs ? ` vs ${f.vs}` : ""}</b><span className="small muted">{fmtDate(f.date)} · {plural(f.evs.length, "play")}</span></button></li>)}</ul></>}
    </div>
  </Card>;
}

/** The scouting workspace for one of their games. */
export function ScoutWork({ oppId, filmId }: { oppId: string; filmId: string }) {
  useVersion();
  const o = get("opponents", oppId), f = o?.films?.find((x) => x.id === filmId);
  const vid = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(() => (f ? srcOf(f) : null));
  const [num, setNum] = useState(""), [typed, setTyped] = useState(""), [watch, setWatch] = useState<{ title: string; clips: Clip[] } | null>(null);
  const typedAt = useRef(0);
  const nums = useMemo(() => (o && f ? scoutNumbers(o.roster, o.films || []) : []), [o, f]);
  const totals = useMemo(() => (f ? scoutTotals([f]) : []), [f]);

  const save = (evs: ScoutEv[]) => { if (!o || !f) return; patch("opponents", o.id, { films: (get("opponents", o.id)?.films || []).map((x) => (x.id === f.id ? { ...x, evs, at: Date.now() } : x)) }); };
  const record = (t: ScoutEv["t"]) => {
    if (!f) return;
    const n = (typed || num).replace(/\D/g, "").slice(0, 3);
    if (!n && t !== "E") { toast("Pick their number first."); return; }
    const vt = Math.round((vid.current?.currentTime || 0) * 100) / 100;
    save([...f.evs, { id: uid("se"), vt, n, t }]);
    if (typed) { setNum(n); setTyped(""); }
    toast(`${n ? "#" + n + " " : ""}${scoutLong(t)} at ${clock(vt)}`);
  };
  const undo = () => { if (f?.evs.length) { const last = f.evs[f.evs.length - 1]; save(f.evs.slice(0, -1)); toast(`Removed ${last.n ? "#" + last.n + " " : ""}${scoutLong(last.t)}`); } };
  const seek = (t: number) => { const v = vid.current; if (v) v.currentTime = Math.max(0, t); };

  // keys: type a number, then K kill · E hit error · A ace · S serve error · B block · D dig · X error; Space play/pause; ←/→ 5 s; Backspace undoes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement, v = vid.current;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); const fresh = Date.now() - typedAt.current > 1500; typedAt.current = Date.now(); setTyped((x) => (fresh ? e.key : (x + e.key).slice(-2))); return; }
      const c = SCOUT_CODES.find((x) => x.key === e.key.toLowerCase());
      if (c) { e.preventDefault(); record(c.t); return; }
      if (!v) return;
      if (e.key === " ") { e.preventDefault(); if (v.paused) v.play().catch(() => {}); else v.pause(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); seek(v.currentTime + (e.key === "ArrowLeft" ? -5 : 5)); }
      else if (e.key === "Backspace" && !typed) { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!o || !f) return <div className="page"><Card><p>That scouting film isn't here anymore.</p><button className="btn" style={{ marginTop: 8 }} onClick={() => go("film")}>Back to Film Room</button></Card></div>;
  const clipsFor = (pick: (e: ScoutEv) => boolean): Clip[] => f.evs.filter(pick).map((e) => ({ id: e.id, matchId: key(f), url: f.video, start: Math.max(0, e.vt - 6), end: e.vt + 2, label: `${e.n ? "#" + e.n + " " : ""}${scoutLong(e.t)}`, t: e.t, date: f.date, opp: o.name }));
  const show = (title: string, clips: Clip[]) => setWatch(clips.length ? { title, clips } : null);
  const current = typed || num;
  return <div className="page sf-work">
    <div className="pagehead">
      <div><button className="btn sm ghost" onClick={() => go("film")}>‹ Film Room</button><h1>Scouting {o.name}</h1><p className="small muted">{f.vs ? `vs ${f.vs} · ` : ""}{fmtDate(f.date)} · {plural(f.evs.length, "play")} · their players, by number</p></div>
      <button className="btn" onClick={() => go("matchup", o.id)}>Open in Matchup</button>
    </div>
    <div className="sf-grid">
      <div className="sf-video">
        {src ? <video ref={vid} src={src} controls playsInline preload="metadata" />
          : <label className="fr-drop"><input type="file" accept="video/*" onChange={(e) => { const x = e.target.files?.[0]; if (x) setSrc(setLocalVideo(key(f), x)); }} aria-label="Pick the video again" /><b>Pick {f.video.startsWith(LOCAL) ? f.video.slice(LOCAL.length) : "the video"} again</b><span className="small muted">Videos stay on the device they were picked on.</span></label>}
        <p className="keys">Keys: type a number, then <b>K</b> kill · <b>E</b> hit error · <b>A</b> ace · <b>S</b> serve error · <b>B</b> block · <b>D</b> dig · <b>X</b> error. Space plays or pauses, ←/→ skip 5 s, Backspace undoes.</p>
      </div>
      <div className="sf-pad">
        <div className="sf-num">
          <span className="label">Their number</span>
          <div className="sf-chips" role="group" aria-label="Their numbers">
            {nums.map((n) => <button key={n} aria-pressed={current === n} onClick={() => { setNum(n); setTyped(""); }}>{n}</button>)}
            <input className="input" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="#" aria-label="Type their number" />
          </div>
        </div>
        <div className="sf-acts">{SCOUT_CODES.map((c) => <button key={c.t} className={"act " + (c.t === "K" || c.t === "SA" || c.t === "B" ? "them" : c.t === "D" ? "" : "us")} onClick={() => record(c.t)}>{c.label}{current && c.t !== "E" ? <small>#{current}</small> : null}</button>)}</div>
        <div className="row"><button className="btn sm" disabled={!f.evs.length} onClick={undo}>Undo</button><span className="small muted">Points they win show dark; points they give away show blue.</span></div>
        {f.evs.length > 0 && <ul className="log sf-recent">{f.evs.slice(-6).reverse().map((e) => <li key={e.id}><button className="sf-t num" onClick={() => seek(Math.max(0, e.vt - 5))}>{clock(e.vt)}</button><span>{e.n ? "#" + e.n + " " : ""}{scoutLong(e.t)}</span><button className="btn sm ghost" aria-label="Delete" onClick={() => save(f.evs.filter((x) => x.id !== e.id))}>×</button></li>)}</ul>}
      </div>
    </div>
    {watch && <Card title={watch.title} actions={<button className="btn sm" onClick={() => setWatch(null)}>Close</button>}><ClipPlayer key={watch.title} clips={watch.clips} resolve={resolve} title={watch.title} /></Card>}
    <Card title="Their players in this game">{totals.length ? <ScoutTable lines={totals} onWatch={(n) => show(`#${n}'s plays`, clipsFor((e) => (e.n || "?") === n))} roster={o.roster} />
      : <p className="empty">Nothing yet. Pick a number and tap what happened.</p>}
      {f.evs.length > 0 && <div className="row" style={{ marginTop: 10 }}>{SCOUT_CODES.filter((c) => f.evs.some((e) => e.t === c.t)).map((c) => <button key={c.t} className="btn sm" onClick={() => show(`Every ${c.long}`, clipsFor((e) => e.t === c.t))}>Every {c.long}</button>)}</div>}
    </Card>
  </div>;
}

export function ScoutTable({ lines, roster, onWatch }: { lines: ReturnType<typeof scoutTotals>; roster?: Opponent["roster"]; onWatch?: (n: string) => void }) {
  return <div className="tablewrap"><table className="sf-table">
    <thead><tr><th>Player</th><th className="num">Kills</th><th className="num">Hit err</th><th className="num">Aces</th><th className="num">Serve err</th><th className="num">Blocks</th><th className="num">Digs</th><th className="num">Other err</th>{onWatch && <th />}</tr></thead>
    <tbody>{lines.map((x) => <tr key={x.n}><td><b>#{x.n}</b>{roster?.[x.n]?.name ? " " + roster[x.n].name : ""}{roster?.[x.n]?.pos ? <span className="muted"> {roster[x.n].pos}</span> : null}</td>
      <td className="num">{x.K}</td><td className="num">{x.AE}</td><td className="num">{x.SA}</td><td className="num">{x.SE}</td><td className="num">{x.B}</td><td className="num">{x.D}</td><td className="num">{x.E}</td>
      {onWatch && <td><button className="btn sm" onClick={() => onWatch(x.n)}>Watch</button></td>}</tr>)}</tbody>
  </table></div>;
}

/** Matchup page: what their film says, across every game of theirs you scouted. */
export function ScoutSummary({ o }: { o: Opponent }) {
  const films = o.films || [];
  if (!films.some((f) => f.evs.length)) return null;
  const lines = scoutTotals(films);
  return <Card title="From their film" actions={<button className="btn sm" onClick={() => go("film", scoutRoute(o, films[films.length - 1]))}>Open film</button>}>
    <p className="small muted" style={{ marginBottom: 8 }}>{plural(films.length, "game")} of theirs scouted. Most dangerous first: {lines.slice(0, 3).map((x) => `#${x.n} (${scoutLine(x)})`).join("; ")}.</p>
    <ScoutTable lines={lines} roster={o.roster} />
  </Card>;
}

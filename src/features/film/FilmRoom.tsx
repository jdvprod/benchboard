/** Film Room: stat a whole game from its video, find every rally from the referee's whistle, and pull any set of clips
 * by asking in plain words ("all solo blocks", "kills to area 1", "Maya's digs in set 2").
 * Every play statted here carries its exact video time, so every stat is a clip. */
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { eventsOf, hooks, matchesOf, newMatch, opponentsOf, patch, player, playerName, replayOf, team, teamPlayers, toast, todayISO, useVersion } from "../../data/store";
import { Match } from "../../data/model";
import { aggregate, LogEntry, Replay } from "../../sports/volleyball/engine";
import { ACTIONS } from "../../sports/volleyball/actions";
import { teamMetrics } from "../../sports/volleyball/metrics";
import { Card, fmtDate, plural, Seg } from "../../ui/kit";
import { fmtAvg, fmtHit, fmtPct } from "../../sports/volleyball/metrics";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { Tracker } from "../track/Tracker";
import { FORMATS, parseScoring, SCORING } from "../track/TrackPage";
import { go } from "../../app/router";
import { Clip, clipsFrom, clock, filmTiming, LOCAL, playName, videoKind, videoTime } from "../../film/clips";
import { localFile, localVideo, setLocalVideo } from "../../film/localVideos";
import { ClipQuery, matchQuery, parseQuery, aiQueryPrompt, cleanAiQuery, QueryPlayer } from "../../film/query";
import { crossedEnd, DECODE_LIMIT, findWhistles, Frame, frameFromAnalyser, rallyCheck, ralliesFrom, scanFile } from "../../film/rallies";
import { ReelMaker } from "../../film/ReelMaker";
import { aiAvailable, askJson } from "../../ai/client";
import { addToSession, sessionsOf, SessionsPanel } from "./Sessions";
import { itemFrom } from "../../film/session";

const resolve = (c: Clip) => (c.url.startsWith(LOCAL) ? localVideo(c.matchId) : c.url);
const srcOf = (m: Match) => (!m.video ? null : m.video.startsWith(LOCAL) ? localVideo(m.id) : videoKind(m.video) === "file" ? m.video : null);
const label = (l: LogEntry) => l.kind === "tag" ? "Tag: " + l.note + (l.p ? " · " + playerName(l.p) : "") : l.kind === "stat" ? (l.p ? playerName(l.p) + " · " : l.op ? "Their #" + l.op + " · " : "") + playName(l.t, (ACTIONS as any)[l.t]?.long) + (l.z && l.z !== "out" ? " → area " + l.z : "") : "";

export function FilmRoom({ id }: { id?: string }) {
  useVersion();
  const m = id ? matchesOf().find((x) => x.id === id) : undefined;
  if (id && m) return <FilmWork key={m.id} m={m} />;
  return <FilmHome />;
}

/* ---------- start: new game from film, or open a match ---------- */
function FilmHome() {
  const t = team()!, opps = opponentsOf();
  const [opp, setOpp] = useState(""), [date, setDate] = useState(todayISO()), [bestOf, setBestOf] = useState(t.settings.bestOf), [scoring, setScoring] = useState(t.settings.scoring || "25");
  const [file, setFile] = useState<File | null>(null), [link, setLink] = useState("");
  const withFilm = matchesOf().filter((x) => x.kind === "match" && (x.film || x.video));
  const tracked = matchesOf().filter((x) => x.kind === "match" && !x.film && !x.video && !x.imported).slice(0, 12);
  const start = (serve: "us" | "them") => {
    if (!file && !link.trim()) { toast("Pick the game video first."); return; }
    const video = file ? LOCAL + file.name : link.trim();
    const m = newMatch({ kind: "match", film: true, video, opp: opp.trim() || "Opponent", date, bestOf, serve, ...parseScoring(scoring) } as any);
    if (file) setLocalVideo(m.id, file);
    go("film", m.id);
  };
  return <div className="page film-home">
    <header className="fr-hero">
      <h1>Film Room</h1>
      <p>Stat a whole game from its video. Floorcall finds every rally from the referee's whistle, skips the dead time, and turns every stat into a clip you can pull by asking: “all solo blocks”, “kills to area 1”, “Maya's digs in set 2”.</p>
    </header>
    <div className="grid2" style={{ alignItems: "start" }}>
      <Card title="Stat a game from film">
        <div className="stack">
          <label className={"fr-drop" + (file ? " has" : "")}>
            <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setLink(""); } }} aria-label="Game video file" />
            <b>{file ? file.name : "Choose the game video"}</b>
            <span className="small muted">{file ? `${(file.size / 1048576).toFixed(0)} MB · stays on this device, never uploaded` : "MP4 or MOV from a phone, camera, Hudl or YouTube download"}</span>
          </label>
          {!file && <input className="input" placeholder="…or paste a direct link to a video file (.mp4)" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Video file link" />}
          <label className="field"><span className="label">Opponent</span><input list="fr-opps" value={opp} onChange={(e) => setOpp(e.target.value)} placeholder="e.g. Buchanan" /><datalist id="fr-opps">{opps.map((o) => <option key={o.id} value={o.name} />)}</datalist></label>
          <div className="two">
            <label className="field"><span className="label">Date played</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="field"><span className="label">Scoring</span><select value={scoring} onChange={(e) => setScoring(e.target.value)}>{SCORING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <Seg value={bestOf} onChange={setBestOf} options={FORMATS} label="Format" />
          <div className="row"><button className="btn primary" onClick={() => start("us")}>Start · we serve first</button><button className="btn" onClick={() => start("them")}>Start · they serve first</button></div>
          <p className="small muted">Film games count in season stats like any match, but families aren't notified.</p>
        </div>
      </Card>
      <div className="stack">
        <Card title="Your film">{withFilm.length ? <ul className="fr-list">{withFilm.map((x) => { const R = replayOf(x); return <li key={x.id}><button onClick={() => go("film", x.id)}>
          <b>vs {x.opp}</b><span className="small muted">{fmtDate(x.date)} · {x.film ? "Statted from film" : "Tracked live"}{R && R.wonUs + R.wonThem ? ` · ${R.wonUs}–${R.wonThem}` : ""}{x.rallies?.length ? ` · ${x.rallies.length} rallies` : ""}</span></button></li>; })}</ul>
          : <p className="empty">Games you stat from film, and matches with a video, show up here.</p>}</Card>
        {tracked.length > 0 && <Card title="Add film to a match you tracked live">
          <p className="small muted" style={{ marginBottom: 8 }}>Line the video up with your live stats and every play becomes a clip.</p>
          <ul className="fr-list">{tracked.map((x) => <li key={x.id}><button onClick={() => go("film", x.id)}><b>vs {x.opp}</b><span className="small muted">{fmtDate(x.date)}</span></button></li>)}</ul>
        </Card>}
      </div>
    </div>
  </div>;
}

/* ---------- the workspace ---------- */
type Tab = "stat" | "find" | "rallies" | "sessions";
function FilmWork({ m }: { m: Match }) {
  const R = replayOf(m)!, evs = eventsOf(m.id), T = filmTiming(m, R, evs);
  const vid = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(() => srcOf(m));
  const [tab, setTab] = useState<Tab>(m.film ? "stat" : "find");
  const [skip, setSkip] = useState(true), [rate, setRate] = useState(1), [now, setNow] = useState(0), [dur, setDur] = useState(0);
  const [scan, setScan] = useState<{ text: string; f: number } | null>(null), stopScan = useRef<(() => void) | null>(null);
  const userSeek = useRef(0), lastT = useRef(0);
  const [stopEach, setStopEach] = useState(true), [waiting, setWaiting] = useState(-1), [openSession, setOpenSession] = useState<string | null>(null);
  const rallies = m.rallies || [];
  const statting = !!m.film;

  // every play entered while this page is open carries the video time
  useEffect(() => {
    if (!statting) return;
    hooks.extra = (mid) => (mid === m.id && vid.current && src ? { vt: Math.round(vid.current.currentTime * 100) / 100 } : null);
    return () => { hooks.extra = null; };
  }, [m.id, src, statting]);

  // video keys: Space play/pause, ←/→ 5 s (Shift 1 s), [ ] rallies, ↑/↓ speed
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = vid.current, el = e.target as HTMLElement; if (!v || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(el.tagName))) return;
      if (e.key === " ") { e.preventDefault(); playPause(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); seek(v.currentTime + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 5)); }
      else if (e.key === "[" || e.key === "]") { e.preventDefault(); jumpRally(e.key === "]" ? 1 : -1); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const rs = [0.5, 0.75, 1, 1.25, 1.5, 2], i = rs.indexOf(rate); const n = rs[Math.max(0, Math.min(rs.length - 1, (i < 0 ? 2 : i) + (e.key === "ArrowUp" ? 1 : -1)))]; setRate(n); v.playbackRate = n; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => () => stopScan.current?.(), []);

  const seek = (t: number) => { const v = vid.current; if (!v) return; userSeek.current = Date.now(); v.currentTime = Math.max(0, Math.min(v.duration || t, t)); setNow(v.currentTime); };
  const jumpRally = (d: number) => {
    const v = vid.current; if (!v || !rallies.length) return;
    const t = v.currentTime, i = rallies.findIndex((r) => r.start > t + 0.5);
    const cur = i < 0 ? rallies.length : i; // index of the next rally
    const target = d > 0 ? rallies[cur] : rallies[Math.max(0, cur - 2)];
    if (target) seek(target.start);
  };
  /** Space / Play: after the video stopped at a rally's end, go straight to the next rally's serve. */
  const playPause = () => {
    const v = vid.current; if (!v) return;
    if (!v.paused) { v.pause(); return; }
    if (waiting >= 0 && rallies[waiting + 1] && Math.abs(v.currentTime - rallies[waiting].end) < 1.5) { seek(rallies[waiting + 1].start); }
    setWaiting(-1); v.play().catch(() => {});
  };
  const onTime = () => {
    const v = vid.current; if (!v) return; setNow(v.currentTime);
    const prev = lastT.current; lastT.current = v.currentTime;
    if (statting && stopEach && rallies.length && !v.paused) { const i = crossedEnd(rallies, prev, v.currentTime); if (i >= 0) { v.pause(); setWaiting(i); return; } }
    if (!skip || !rallies.length || v.paused || Date.now() - userSeek.current < 1500) return;
    const t = v.currentTime, inside = rallies.some((r) => t >= r.start - 0.3 && t <= r.end);
    if (inside) return;
    const next = rallies.find((r) => r.start > t);
    if (next && next.start - t > 1.5) { v.currentTime = next.start; }
  };

  const pick = (f?: File) => { if (!f) return; const u = setLocalVideo(m.id, f); patch("matches", m.id, { video: LOCAL + f.name }); setSrc(u); };

  /* rally finder */
  const findRallies = async () => {
    const v = vid.current; if (!v || !src) return;
    let blob: Blob | null = localFile(m.id);
    if (!blob && !src.startsWith("blob:")) { try { const r = await fetch(src); if (r.ok) blob = await r.blob(); } catch { blob = null; } } // a linked file the site allows us to read
    if (blob && blob.size <= DECODE_LIMIT) {
      const ac = new AbortController(); stopScan.current = () => ac.abort();
      try {
        const { whistles, duration } = await scanFile(blob, (text, f) => setScan({ text, f }), ac.signal);
        saveRallies(whistles, duration); return;
      } catch (e: any) { if (e?.name === "AbortError") { setScan(null); return; } /* fall through to listening */ }
    }
    listenScan();
  };
  const saveRallies = (whistles: number[], duration: number) => {
    const rs = ralliesFrom(whistles, duration);
    patch("matches", m.id, { rallies: rs }); setScan(null); stopScan.current = null;
    toast(rs.length ? `Found ${plural(rs.length, "rally", "rallies")}. Skipping dead time is on.` : "No referee whistles heard in this video. You can still stat and clip it.");
  };
  /** Longer films: play a hidden copy fast and listen. */
  const listenScan = () => {
    if (!src) return;
    const v = document.createElement("video"); v.src = src; v.muted = false; v.preload = "auto"; (v as any).playsInline = true;
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext; const ctx = new AC();
    const node = ctx.createMediaElementSource(v), an = ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); // not connected to the speakers: silent
    const frames: Frame[] = [], db = new Float32Array(an.frequencyBinCount); let timer: any = 0, stopped = false;
    const stop = () => { stopped = true; clearInterval(timer); v.pause(); v.removeAttribute("src"); v.load(); ctx.close().catch(() => {}); };
    stopScan.current = () => { stop(); setScan(null); };
    v.addEventListener("loadedmetadata", () => {
      v.playbackRate = 4; v.play().catch(() => { stop(); setScan(null); toast("Couldn't listen to this video in this browser."); });
      timer = setInterval(() => {
        if (stopped) return;
        an.getFloatFrequencyData(db); frames.push(frameFromAnalyser(v.currentTime, db, ctx.sampleRate, an.fftSize));
        if (frames.length % 30 === 0) setScan({ text: `Listening for whistles at 4× · ${clock(v.duration - v.currentTime)} of film left`, f: v.currentTime / (v.duration || 1) });
      }, 15);
    }, { once: true });
    v.addEventListener("ended", () => { const d = v.duration; stop(); saveRallies(findWhistles(frames, { minDur: 0.2 }), d); }, { once: true });
    setScan({ text: "Getting the film ready…", f: 0 });
    ctx.resume?.();
  };

  /* line up a live-tracked match: the first serve is now */
  const firstSet = R.log.find((l) => l.kind === "set");
  const lineUp = () => { const v = vid.current; if (!v || !firstSet) return; const cur = ((T.ts.get(firstSet.id) ?? T.base) - T.base) / 1000; patch("matches", m.id, { videoOffset: Math.round((v.currentTime - cur) * 10) / 10 }); toast("Lined up. Every tracked play now points at its moment in the video."); };

  const marks = useMemo(() => R.log.filter((l) => l.kind === "stat" || l.kind === "tag").map((l) => ({ id: l.id, t: videoTime(T, l.id), w: l.kind === "stat" ? l.w : null })), [R, m.videoOffset]);
  const inRally = rallies.findIndex((r) => now >= r.start && now <= r.end);

  return <div className="page film-work">
    <div className="fr-top">
      <button className="btn sm" onClick={() => go("film")}>‹ Film Room</button>
      <h1>vs {m.opp} <span className="muted small">{fmtDate(m.date)}</span></h1>
      {R.wonUs + R.wonThem > 0 && <span className="fr-score num">{R.wonUs}–{R.wonThem}</span>}
    </div>
    <div className={"fr-grid" + (tab === "stat" ? " stat" : "")}>
      <section className="fr-stage" aria-label="Game video">
        {src ? <>
          <video ref={vid} src={src} controls playsInline preload="auto" onTimeUpdate={onTime} onLoadedMetadata={(e) => setDur((e.target as HTMLVideoElement).duration || 0)} onSeeking={() => { userSeek.current = Date.now(); }} />
          {waiting >= 0 && <div className="fr-wait" role="status"><b>Rally {waiting + 1} over.</b> Enter what happened, then press Space for rally {waiting + 2 <= rallies.length ? waiting + 2 : "…"}.</div>}
          <Timeline dur={dur} now={now} rallies={rallies} marks={marks} onSeek={seek} />
          <div className="fr-transport">
            <button className="btn sm" onClick={() => jumpRally(-1)} disabled={!rallies.length} title="Previous rally ( [ )">‹ Rally</button>
            <button className="btn sm" onClick={() => seek(now - 5)} title="Back 5 s (←)">−5 s</button>
            <button className="btn sm primary fr-play" onClick={playPause} title="Play / pause (Space)">{waiting >= 0 ? "Next rally" : "Play / pause"}</button>
            <button className="btn sm" onClick={() => seek(now + 5)} title="Forward 5 s (→)">+5 s</button>
            <button className="btn sm" onClick={() => jumpRally(1)} disabled={!rallies.length} title="Next rally ( ] )">Rally ›</button>
            <select className="input fr-rate" value={rate} onChange={(e) => { const n = +e.target.value; setRate(n); if (vid.current) vid.current.playbackRate = n; }} aria-label="Speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</select>
            <span className="num small muted fr-clock">{clock(now)}{inRally >= 0 ? ` · rally ${inRally + 1}` : ""}</span>
          </div>
          <div className="fr-tools">
            {scan ? <div className="fr-scan"><div className="fr-bar"><i style={{ width: Math.round(scan.f * 100) + "%" }} /></div><span className="small">{scan.text}</span><button className="btn sm" onClick={() => stopScan.current?.()}>Stop</button></div>
              : <button className="btn sm" onClick={findRallies}>{rallies.length ? `Find rallies again (${rallies.length} found)` : "Find rallies from the whistle"}</button>}
            {statting && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={stopEach} onChange={(e) => setStopEach(e.target.checked)} disabled={!rallies.length} /> Pause after each rally</label>}
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} disabled={!rallies.length} /> Skip dead time</label>
            {!m.film && firstSet && <button className="btn sm" onClick={lineUp} title="Pause the video at the first serve of set 1, then tap">First serve is now</button>}
          </div>
        </> : <div className="fr-need">
          <p><b>{m.video ? "Pick the video file again" : "Add this game's video"}</b></p>
          <p className="small muted">{m.video && m.video.startsWith(LOCAL) ? `Videos stay on the device they were picked on. Choose ${m.video.slice(LOCAL.length)} to keep going.` : m.video ? "Film Room works with the video file itself. Hudl and YouTube both let you download your own game film." : "A phone or camera recording works. It stays on this device."}</p>
          <label className="btn primary" style={{ cursor: "pointer" }}>Choose video<input type="file" accept="video/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
        </div>}
        <p className="keys">Space play/pause · ← → 5 s (Shift 1 s) · [ ] previous/next rally · ↑ ↓ speed{statting ? " · jersey number then a letter to stat (? for keys)" : ""}</p>
      </section>
      <section className="fr-side">
        <div className="fr-tabs" role="tablist">
          {(statting ? [["stat", "Stat"], ["find", "Find clips"], ["rallies", "Rallies"], ["sessions", "Film sessions"]] : [["find", "Find clips"], ["rallies", "Rallies"], ["sessions", "Film sessions"]]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k as Tab)}>{l}</button>)}
        </div>
        {tab === "stat" && statting && <div className="stack">
          <FilmNumbers R={R} />
          {src ? <Tracker m={m} /> : <p className="empty">Add the video to start statting.</p>}
        </div>}
        {tab === "find" && <FindClips m={m} R={R} T={T} onSeek={(t) => { seek(t); vid.current?.play().catch(() => {}); }} onAdded={(sid) => { setOpenSession(sid); setTab("sessions"); }} />}
        {tab === "sessions" && <SessionsPanel m={m} src={src} open={openSession} setOpen={setOpenSession} nowAt={() => vid.current?.currentTime || 0} lead={m.film ? 5 : 8} />}
        {tab === "rallies" && <RallyList m={m} R={R} T={T} rallies={rallies} now={now} onSeek={(t) => { seek(t); vid.current?.play().catch(() => {}); }} />}
      </section>
    </div>
  </div>;
}

function Timeline({ dur, now, rallies, marks, onSeek }: { dur: number; now: number; rallies: { start: number; end: number }[]; marks: { id: string; t: number; w: string | null }[]; onSeek: (t: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  if (!dur) return null;
  const pct = (t: number) => Math.max(0, Math.min(100, (t / dur) * 100)) + "%";
  const click = (e: MouseEvent) => { const b = bar.current!.getBoundingClientRect(); onSeek(((e.clientX - b.left) / b.width) * dur); };
  return <div className="fr-tl" ref={bar} onClick={click} role="slider" aria-label="Game timeline" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(now)} tabIndex={-1}>
    {rallies.map((r, i) => <span key={i} className="fr-rally" style={{ left: pct(r.start), width: `calc(${pct(r.end - r.start)} + 1px)` }} />)}
    {marks.map((k) => <span key={k.id} className={"fr-mark" + (k.w ? " " + k.w : "")} style={{ left: pct(k.t) }} />)}
    <span className="fr-head" style={{ left: pct(now) }} />
  </div>;
}

/** The numbers a coach checks between sets, live as the film is statted. */
function FilmNumbers({ R }: { R: Replay }) {
  const A = aggregate(R.sets), M = teamMetrics(A);
  const tiles: [string, string][] = [["Hitting", fmtHit(M.hitting)], ["Pass avg", fmtAvg(M.passAvg)], ["Side-out", fmtPct(M.sideOut)], ["Serve in", fmtPct(M.serveIn)], ["In system", fmtPct(M.inSystemPct)], ["Dig success", fmtPct(M.digSuccess)]];
  return <div className="fr-nums">{tiles.map(([l, v]) => <div key={l}><b className="num">{v}</b><span>{l}</span></div>)}</div>;
}

/* ---------- ask for clips ---------- */
const EXAMPLES = ["All solo blocks", "Blocking reps", "Kills to area 1", "Aces", "Our errors", "Kills off perfect passes", "Shanked passes", "Their kills", "Serve errors at 20+", "Digs in set 2"];
function FindClips({ m, R, T, onSeek, onAdded }: { m: Match; R: Replay; T: ReturnType<typeof filmTiming>; onSeek: (t: number) => void; onAdded: (sessionId: string) => void }) {
  const [to, setTo] = useState("new");
  const roster: QueryPlayer[] = teamPlayers(m.teamId).map((p) => ({ id: p.id, first: p.first, last: p.last, num: String(p.num) }));
  const [text, setText] = useState(""), [q, setQ] = useState<{ q: ClipQuery; chips: string[]; by?: "ai" } | null>(null), [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(m.film ? 5 : 8), [tail, setTail] = useState(2), [play, setPlay] = useState(false), [reelFor, setReelFor] = useState<string | null>(null), [miss, setMiss] = useState("");
  const run = async (s: string) => {
    setText(s); setPlay(false); setMiss("");
    const p = parseQuery(s, roster);
    if (!p.empty) { setQ({ q: p.q, chips: p.chips }); return; }
    if (!aiAvailable()) { setQ(null); setMiss("Try naming a play (kills, aces, blocks, digs, passes, errors), a player, an area, a set or a rotation."); return; }
    setBusy(true);
    try { const x = await askJson<any>(aiQueryPrompt(s, roster), { tier: "quick" }); const cq = cleanAiQuery(x, roster); setQ({ q: cq, chips: describe(cq, roster), by: "ai" }); }
    catch { setMiss("Couldn't work that out. Try naming a play, a player, an area or a set."); setQ(null); }
    setBusy(false);
  };
  const rows = q ? R.log.filter((l) => matchQuery(q.q, l)) : [];
  const clips = q && m.video ? clipsFrom(m, T, rows, () => true, label, lead, tail) : [];
  const playable = clips.filter((c) => resolve(c));
  const onePlayer = q && q.q.players.length === 1 ? q.q.players[0] : null;
  const title = text.trim() ? text.trim()[0].toUpperCase() + text.trim().slice(1) : "Clips";
  return <div className="stack fr-find">
    <form className="fr-ask" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(text.trim()); }}>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask for clips: “Maya's kills to area 1 in set 2”" aria-label="Ask for clips" />
      <button className="btn primary" disabled={busy || !text.trim()}>{busy ? "Thinking…" : "Find"}</button>
    </form>
    <div className="fr-examples">{EXAMPLES.map((x) => <button key={x} className="fr-ex" onClick={() => run(x)}>{x}</button>)}</div>
    {miss && <p className="small muted">{miss}</p>}
    {q && <>
      <div className="fr-understood"><span className="small muted">{q.by === "ai" ? "Read as" : "Looking for"}</span>{q.chips.map((c) => <span key={c} className="fr-chip">{c}</span>)}</div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{rows.length ? plural(rows.length, "play") : "No plays match"}</b>
        <span className="row small" style={{ gap: 6 }}>Clip from <input className="input" type="number" min={0} max={20} value={lead} onChange={(e) => setLead(Math.max(0, Math.min(20, +e.target.value || 0)))} style={{ width: 56 }} aria-label="Seconds before" /> s before to <input className="input" type="number" min={0} max={10} value={tail} onChange={(e) => setTail(Math.max(0, Math.min(10, +e.target.value || 0)))} style={{ width: 52 }} aria-label="Seconds after" /> s after</span>
      </div>
      {rows.length > 0 && <div className="row">
        {playable.length > 0 && <button className={"btn" + (play ? "" : " primary")} onClick={() => setPlay(!play)}>{play ? "Hide clips" : `Watch ${plural(playable.length, "clip")} back to back`}</button>}
        {onePlayer && playable.length > 0 && player(onePlayer) && <button className="btn" onClick={() => setReelFor(onePlayer)}>Make {player(onePlayer)!.first}'s highlight video</button>}
        {!m.video && <span className="small muted">Add the video to watch these as clips.</span>}
      </div>}
      {rows.length > 0 && m.video && <div className="row fr-add">
        <select className="input" style={{ width: "auto" }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Film session"><option value="new">New film session</option>{sessionsOf(m).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
        <button className="btn" onClick={() => { const s = addToSession(m, to, clips.map(itemFrom), title); toast(`Added to “${s.title}”`); onAdded(s.id); }}>Add {plural(clips.length, "clip")} to a film session</button>
      </div>}
      {play && <ClipPlayer key={text + lead + tail} clips={playable} resolve={resolve} allowSave title={`${title} · vs ${m.opp}`} fileName={(c) => `${title} vs ${m.opp}${c ? " " + c.label : ""}`.replace(/[^\w\- .#]+/g, "")} />}
      {reelFor && <ReelMaker id={reelFor} pool={playable} onClose={() => setReelFor(null)} />}
      <ul className="log film fr-rows">{rows.slice(0, 400).map((l) => { const at = videoTime(T, l.id); const s = l as any;
        return <li key={l.id}><button className="num fr-time" onClick={() => onSeek(Math.max(0, at - lead))} disabled={!m.video}>{clock(Math.max(0, at - lead))}</button><span>{label(l)}</span><span className={"small " + (s.w ? "pt-" + s.w : "muted")}>{s.w ? `${s.us}–${s.them}` : "S" + l.set}</span></li>; })}</ul>
    </>}
  </div>;
}
function describe(q: ClipQuery, roster: QueryPlayer[]): string[] {
  const out: string[] = [];
  if (q.codes) out.push(q.codes.map((c) => playName(c, (ACTIONS as any)[c]?.long)).filter((v, i, a) => a.indexOf(v) === i).join(", "));
  for (const id of q.players) { const p = roster.find((r) => r.id === id); if (p) out.push(`#${p.num} ${p.first}`); }
  for (const n of q.opp) out.push("Their #" + n);
  if (q.zones.length) out.push("To area " + q.zones.join(", "));
  if (q.sets.length) out.push("Set " + q.sets.join(", "));
  if (q.rots.length) out.push("Rotation " + q.rots.join(", "));
  if (q.won) out.push(q.won === "us" ? "Points we won" : "Points they won");
  if (q.serving) out.push(q.serving === "us" ? "On our serve" : "In serve receive");
  if (q.ctx) out.push("Context " + q.ctx.join(", "));
  if (q.clutch) out.push("At 20+");
  if (q.tags) out.push("Film tags");
  return out.length ? out : ["Everything"];
}

/* ---------- rallies ---------- */
function RallyList({ m, R, T, rallies, now, onSeek }: { m: Match; R: Replay; T: ReturnType<typeof filmTiming>; rallies: { start: number; end: number }[]; now: number; onSeek: (t: number) => void }) {
  const plays = R.log.filter((l) => l.kind === "stat").map((l) => ({ l: l as Extract<LogEntry, { kind: "stat" }>, t: videoTime(T, l.id) }));
  if (!rallies.length) return <div className="stack"><p className="empty">No rallies found yet. Tap “Find rallies from the whistle” under the video: Floorcall listens for the referee's whistle, marks every rally and skips the dead time between them.</p>
    {plays.length > 0 && <p className="small muted">{plural(plays.length, "play")} statted so far.</p>}</div>;
  const check = rallyCheck(rallies, plays.map((p) => ({ t: p.t, point: !!p.l.w })));
  return <div className="stack">
    {m.film && (check.missing.length ? <div className="banner warn"><p><b>{plural(check.missing.length, "rally", "rallies")} with no point statted yet.</b> {R.sets.reduce((a, s) => a + s.us + s.them, 0)} points statted, {rallies.length} rallies found.</p><button className="btn sm" onClick={() => onSeek(rallies[check.missing[0]].start)}>Go to rally {check.missing[0] + 1}</button></div>
      : <p className="small muted">Every rally found has a point statted.</p>)}
    <ol className="fr-rallies">{rallies.map((r, i) => {
    const inside = plays.filter((p) => p.t >= r.start - 1 && p.t <= r.end + 1), end = inside.find((p) => p.l.w);
    const on = now >= r.start && now <= r.end;
    return <li key={i} className={(on ? "on" : "") + (m.film && !check.scored[i] ? " gap" : "")}><button onClick={() => onSeek(r.start)}>
      <span className="num fr-time">{clock(r.start)}</span>
      <span className="fr-rl"><b>Rally {i + 1}</b> <span className="small muted">{Math.round(r.end - r.start)} s</span>
        {inside.length ? <span className="small">{inside.map((p) => label(p.l)).join(" → ")}</span> : <span className="small muted">{m.film ? "Not statted yet" : "No plays here"}</span>}</span>
      {end ? <span className={"small pt-" + end.l.w}>{end.l.us}–{end.l.them}</span> : m.film ? <span className="small fr-nopt">No point</span> : null}
    </button></li>; })}</ol></div>;
}

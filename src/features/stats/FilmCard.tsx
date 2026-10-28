/** Film index for one match: every play with its video time, filterable by player and play type, linked to the match video. */
import { useState } from "react";
import { eventsOf, patch, player, playerName, team, toast } from "../../data/store";
import { Match } from "../../data/model";
import { Replay, LogEntry } from "../../sports/volleyball/engine";
import { ACTIONS } from "../../sports/volleyball/actions";
import { Card, copyText, download } from "../../ui/kit";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { clipsFrom, filmTiming, LOCAL } from "../../film/clips";
import { localVideo, setLocalVideo } from "../../film/localVideos";

type Filter = "points" | "kills" | "errors" | "serve" | "pass" | "defense" | "theirs" | "tags" | "all";
const FILTERS: [Filter, string][] = [["points", "Every point"], ["kills", "Kills"], ["errors", "Our errors"], ["serve", "Serves"], ["pass", "Passes"], ["defense", "Digs & blocks"], ["theirs", "Their points"], ["tags", "Film tags"], ["all", "Everything"]];
const OUR_ERR = new Set(["AE", "AB", "SEN", "SEO", "SE", "BE", "BHE", "P0", "DE", "CE", "EE", "PE"]);
const match = (f: Filter, l: LogEntry): boolean => {
  if (l.kind === "tag") return f === "tags" || f === "all";
  if (l.kind === "set") return f === "points" || f === "all";
  if (l.kind !== "stat") return f === "all";
  const t = l.t;
  switch (f) {
    case "points": return !!l.w;
    case "kills": return t === "K" || t === "KT";
    case "errors": return OUR_ERR.has(t);
    case "serve": return ["SA", "SI", "SEN", "SEO", "SE"].includes(t);
    case "pass": return ["P3", "P2", "P1", "P0"].includes(t);
    case "defense": return ["D", "DE", "BS", "BA", "BE"].includes(t);
    case "theirs": return l.w === "them";
    default: return true;
  }
};

export const clock = (sec: number) => { let s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s %= 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
const parseClock = (x: string): number | null => { const p = x.trim().split(":").map((v) => +v); if (!p.length || p.some((v) => Number.isNaN(v))) return null; return p.reduce((a, v) => a * 60 + v, 0); };

/** A link that opens the video at a time, for YouTube, Vimeo and plain video files. Hudl and others just open. */
export function videoAt(url: string, sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  try {
    const u = new URL(url);
    if (/youtu\.?be/.test(u.hostname)) { u.searchParams.set("t", s + "s"); return u.toString(); }
    if (/vimeo\.com/.test(u.hostname)) { u.hash = "t=" + s + "s"; return u.toString(); }
    if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) { u.hash = "t=" + s; return u.toString(); }
    return u.toString();
  } catch { return url; }
}

export function FilmCard({ m, R }: { m: Match; R: Replay }) {
  const [f, setF] = useState<Filter>("points"), [who, setWho] = useState(""), [lead, setLead] = useState(8), [reel, setReel] = useState(false), [, bump] = useState(0);
  const evs = eventsOf(m.id), ts = new Map(evs.map((e) => [e.id, e.ts]));
  const base = m.filmStart || R.firstTs || evs[0]?.ts || 0;
  const offset = m.videoOffset || 0; // seconds into the video when the clock base happened
  const at = (id: string) => (((ts.get(id) || base) - base) / 1000) + offset;
  const rows = R.log.filter((l) => match(f, l) && (!who || ((l.kind === "stat" || l.kind === "tag") && l.p === who)));
  const label = (l: LogEntry) => {
    if (l.kind === "set") return `Set ${l.set} starts`;
    if (l.kind === "tag") return "Tag: " + l.note + (l.p ? " · " + playerName(l.p) : "");
    if (l.kind === "stat") { const a: any = ACTIONS[l.t]; return (l.p ? playerName(l.p) + " · " : "") + (a?.long || l.t) + (l.op ? " · their #" + l.op : ""); }
    return l.kind;
  };
  const ids = [...new Set(R.log.filter((l) => (l.kind === "stat" || l.kind === "tag") && l.p).map((l) => (l as any).p as string))].filter((id) => player(id)).sort((a, b) => (+player(a)!.num || 0) - (+player(b)!.num || 0));
  const chapters = () => R.log.filter((l) => l.kind === "set" || l.kind === "tag").map((l) => `${clock(Math.max(0, at(l.id) - (l.kind === "tag" ? lead : 0)))} ${label(l)}`);
  const firstSet = R.log.find((l) => l.kind === "set");
  const [first, setFirst] = useState(firstSet ? clock(at(firstSet.id)) : "0:00");
  const isLocal = !!m.video && m.video.startsWith(LOCAL), localReady = isLocal && !!localVideo(m.id);
  const clips = clipsFrom(m, filmTiming(m, R, evs), rows, () => true, label, lead, 2);
  const pickFile = (file?: File) => { if (!file) return; setLocalVideo(m.id, file); patch("matches", m.id, { video: LOCAL + file.name }); bump((x) => x + 1); toast("Video ready. It stays on this device."); };

  return <Card title="Film" actions={<span className="small muted">{rows.length} plays</span>}>
    <div className="stack">
      <div className="row">
        <input key={m.video || ""} className="input grow" style={{ flexBasis: 260 }} placeholder="Paste the match video link (YouTube, Vimeo, Hudl, file)" defaultValue={isLocal ? "" : m.video || ""} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.video || "")) { patch("matches", m.id, { video: v }); toast(v ? "Video linked" : "Video link removed"); } }} aria-label="Video link" />
        <label className="row small" style={{ gap: 6 }}>First serve at
          <input className="input" style={{ width: 84 }} value={first} onChange={(e) => setFirst(e.target.value)} onBlur={() => {
            const sec = parseClock(first); if (sec == null || !firstSet) return;
            const cur = ((ts.get(firstSet.id) || base) - base) / 1000; patch("matches", m.id, { videoOffset: Math.round(sec - cur) }); toast("Video times lined up");
          }} aria-label="Time of first serve in the video" /></label>
      </div>
      <div className="row">
        <label className="btn sm" style={{ cursor: "pointer" }}>{isLocal ? "Choose a different video file" : "Use a video file on this device"}<input type="file" accept="video/*" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {isLocal && <span className="small muted">{localReady ? "Using " : "Pick the file again to play clips: "}{m.video!.slice(LOCAL.length)}</span>}
      </div>
      <div className="row">
        <select className="input" style={{ width: "auto" }} value={f} onChange={(e) => setF(e.target.value as Filter)} aria-label="Plays">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" style={{ width: "auto" }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Player"><option value="">Everyone</option>{ids.map((id) => <option key={id} value={id}>{playerName(id)}</option>)}</select>
        <label className="row small" style={{ gap: 6 }}>Start clips <input className="input" type="number" min={0} max={30} style={{ width: 64 }} value={lead} onChange={(e) => setLead(Math.max(0, Math.min(30, +e.target.value || 0)))} /> s early</label>
      </div>
      {m.video && (!isLocal || localReady) && clips.length > 0 && <div className="row"><button className={"btn sm" + (reel ? "" : " primary")} onClick={() => setReel(!reel)}>{reel ? "Hide clips" : `Watch ${clips.length === 1 ? "this as a clip" : `these ${clips.length} plays as clips`}`}</button></div>}
      {reel && <ClipPlayer key={f + who + lead} clips={clips} resolve={(c) => (c.url.startsWith(LOCAL) ? localVideo(c.matchId) : c.url)} allowSave
        title={`${who ? playerName(who) + " · " : ""}${FILTERS.find((x) => x[0] === f)![1]} · vs ${m.opp}`} fileName={(c) => `${team()!.name} vs ${m.opp} ${c ? c.label : (who ? playerName(who) + " " : "") + "reel"}`.replace(/[^\w\- .#]+/g, "")} />}
      <ul className="log film">{rows.slice(0, 300).map((l) => {
        const sec = Math.max(0, at(l.id) - (l.kind === "stat" || l.kind === "tag" ? lead : 0));
        const sc = l.kind === "stat" && l.w ? `${l.us}–${l.them}` : "";
        return <li key={l.id}>
          {m.video && !isLocal ? <a className="num" href={videoAt(m.video, sec)} target="_blank" rel="noopener">{clock(sec)}</a> : <b className="num">{clock(sec)}</b>}
          <span className={l.kind === "set" ? "muted" : ""}>{label(l)}</span>
          <span className={"small " + (l.kind === "stat" && l.w ? "pt-" + l.w : "muted")}>{sc || (l.kind !== "set" ? "S" + (l as any).set : "")}</span>
        </li>; })}</ul>
      {!rows.length && <p className="empty">No plays match.</p>}
      <div className="row">
        <button className="btn sm" onClick={() => copyText(chapters().join("\n")).then((ok) => toast(ok ? "Chapters copied. Paste them into the YouTube description." : "Couldn't copy here"))}>Copy YouTube chapters</button>
        <button className="btn sm" onClick={() => download(`${team()!.name} vs ${m.opp} ${m.date} film.csv`.replace(/[^\w\- .]+/g, ""), "time,seconds,set,score,play\n" + rows.map((l) => { const sec = Math.max(0, at(l.id) - (l.kind === "set" ? 0 : lead)); return [clock(sec), Math.round(sec), (l as any).set, l.kind === "stat" && l.w ? `${l.us}-${l.them}` : "", '"' + label(l).replace(/"/g, '""') + '"'].join(","); }).join("\n"), "text/csv")}>Download list (CSV)</button>
      </div>
      <p className="keys">Times come from when each play was entered, so set “First serve at” to the moment set 1 begins in your video and everything lines up. Tap a time to open the video there.</p>
    </div>
  </Card>;
}

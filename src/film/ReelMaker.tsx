/** Player page → Make highlight video: pick plays, choose how long each runs, and get a finished video
 * (title card, captioned plays, closing card with verified numbers) to send to college coaches or post. */
import { useMemo, useRef, useState } from "react";
import { eventsOf, matchesOf, player, replayOf, team, toast } from "../data/store";
import { ACTIONS } from "../sports/volleyball/actions";
import { aggregate } from "../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtNum, hitting, passAvg, playerMetrics } from "../sports/volleyball/metrics";
import { Seg, download } from "../ui/kit";
import { Clip, clipsFrom, filmTiming, highlightPick, LOCAL, playName, videoKind } from "./clips";
import { localVideo } from "./localVideos";
import { canMakeReel, reelLength, renderReel } from "./reel";

/** Every play of this player's this season with a video the browser can cut (a file on this device or a direct video link). */
export function reelClips(id: string): { clips: Clip[]; elsewhere: number } {
  const t = team()!, out: Clip[] = []; let elsewhere = 0;
  for (const m of matchesOf().filter((x) => x.kind === "match" && x.video && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).reverse()) {
    const R = replayOf(m); if (!R) continue;
    const cs = clipsFrom(m, filmTiming(m, R, eventsOf(m.id)), R.log, (l) => l.kind === "stat" && l.p === id, (l) => playName((l as any).t, (ACTIONS as any)[(l as any).t]?.long));
    const k = videoKind(m.video!); if (k === "file" || k === "local") out.push(...cs); else elsewhere += cs.length;
  }
  return { clips: out, elsewhere };
}
const resolve = (c: Clip) => (c.url.startsWith(LOCAL) ? localVideo(c.matchId) : c.url);

export function ReelMaker({ id, onClose }: { id: string; onClose: () => void }) {
  const p = player(id)!, t = team()!;
  const { clips, elsewhere } = useMemo(() => reelClips(id), [id]);
  const pool = useMemo(() => highlightPick(clips, 40), [clips]);
  const [order, setOrder] = useState<string[]>(() => pool.slice(0, 10).map((c) => c.id)), [len, setLen] = useState<5 | 7 | 10>(7);
  const [busy, setBusy] = useState(""), [frac, setFrac] = useState(0), [out, setOut] = useState<{ url: string; blob: Blob } | null>(null);
  const preview = useRef<HTMLCanvasElement>(null), abort = useRef<AbortController | null>(null);
  const byId = new Map(pool.map((c) => [c.id, c]));
  const chosen = order.map((x) => byId.get(x)).filter(Boolean).map((c) => ({ ...c!, start: Math.max(0, c!.end - len) }));
  const missing = chosen.filter((c) => !resolve(c)).length;
  const toggle = (cid: string) => setOrder((o) => (o.includes(cid) ? o.filter((x) => x !== cid) : o.concat(cid)));
  const move = (cid: string, d: number) => setOrder((o) => { const i = o.indexOf(cid), j = i + d; if (i < 0 || j < 0 || j >= o.length) return o; const n = o.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; });

  const stats = () => {
    const sets = matchesOf().filter((m) => m.kind === "match" && (!t.activeSeasonId || m.seasonId === t.activeSeasonId)).flatMap((m) => replayOf(m)?.sets || []);
    const A = aggregate(sets), s = A.ps[id], pm = playerMetrics(A, id); if (!s) return [];
    return ([["Kills / set", pm.kps != null && s.K ? fmtNum(pm.kps, 2) : null], ["Hitting", s.TA >= 10 ? fmtHit(hitting(s)) : null], ["Assists / set", pm.aps != null && s.AST ? fmtNum(pm.aps, 2) : null], ["Digs / set", pm.dps != null && s.D ? fmtNum(pm.dps, 2) : null], ["Aces", s.SA ? String(s.SA) : null], ["Pass avg", s.R >= 10 ? fmtAvg(passAvg(s)) : null]] as [string, string | null][])
      .filter(([, v]) => v).slice(0, 4).map(([label, value]) => ({ label, value: value! }));
  };
  const make = async () => {
    setBusy("Starting…"); setFrac(0); setOut(null); abort.current = new AbortController();
    try {
      const blob = await renderReel(chosen.filter((c) => resolve(c)), resolve, {
        player: { first: p.first, last: p.last, num: p.num, pos: p.pos, grad: p.grad, height: p.height, photo: p.photo },
        team: { name: t.name, logo: t.logo, level: t.level }, stats: stats(), link: p.profile?.sharedUrl,
      }, { preview: preview.current, signal: abort.current.signal, onProgress: (txt, f) => { setBusy(txt); setFrac(f); } });
      setOut({ url: URL.createObjectURL(blob), blob }); setBusy("");
    } catch (e: any) { setBusy(""); if (e?.name !== "AbortError") toast(e?.message || "Couldn't make the video in this browser. Try Chrome or Edge on a computer."); }
  };
  const fileName = `${p.first} ${p.last} highlights`.replace(/[^\w\- .]+/g, "").trim();
  const save = async () => {
    if (!out) return; const ext = out.blob.type.includes("mp4") ? "mp4" : "webm", file = new File([out.blob], `${fileName}.${ext}`, { type: out.blob.type }), nav: any = navigator;
    if (nav.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) { try { await nav.share({ files: [file], title: fileName }); return; } catch { /* save instead */ } }
    download(`${fileName}.${ext}`, out.blob, out.blob.type); toast("Video saved. Upload it to YouTube or Hudl and paste the link in Highlight video link.");
  };

  if (!canMakeReel()) return <div className="reel"><p className="small">This browser can't make videos. Use Chrome or Edge on a computer, or Safari 17 or later.</p><button className="btn sm" onClick={onClose}>Close</button></div>;
  if (!pool.length) return <div className="reel"><p className="small">{elsewhere ? `${p.first || "This player"}'s plays are on YouTube or Vimeo, which can't be cut here. On Stats → One match → Film, pick the match video file instead (it stays on this device), then come back.` : `Link a match video on Stats → One match → Film, and ${p.first || "this player"}'s plays become clips for a highlight video.`}</p><button className="btn sm" onClick={onClose}>Close</button></div>;
  return <div className="reel">
    <div className="row between"><b>Highlight video</b><button className="btn sm ghost" onClick={() => { abort.current?.abort(); onClose(); }}>Close</button></div>
    <p className="small muted" style={{ margin: 0 }}>A title card, each play with its caption, and a closing card with {p.first || "the player"}'s verified numbers. Best plays are picked; change them below.</p>
    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}><span className="small">Each play</span><Seg value={len} onChange={setLen} label="Length of each play" options={[[5, "5 s"], [7, "7 s"], [10, "10 s"]]} />
      <span className="small muted">{chosen.length} plays · about {Math.round(reelLength(chosen))} seconds</span></div>
    <ol className="reel-list">{pool.map((c) => { const on = order.includes(c.id); return <li key={c.id} className={on ? "on" : ""}>
      <label><input type="checkbox" checked={on} onChange={() => toggle(c.id)} disabled={!!busy} /> <b>{c.label}</b> <span className="small muted">{[c.opp ? "vs " + c.opp : "", c.set ? "Set " + c.set : "", c.score].filter(Boolean).join(" · ")}</span></label>
      {on && <span className="row" style={{ gap: 4 }}><span className="small muted">#{order.indexOf(c.id) + 1}</span><button className="btn sm ghost" aria-label={"Move " + c.label + " earlier"} disabled={!!busy || order.indexOf(c.id) === 0} onClick={() => move(c.id, -1)}>↑</button><button className="btn sm ghost" aria-label={"Move " + c.label + " later"} disabled={!!busy || order.indexOf(c.id) === order.length - 1} onClick={() => move(c.id, 1)}>↓</button></span>}
    </li>; })}</ol>
    {missing > 0 && <p className="small" style={{ color: "var(--warn)", margin: 0 }}>{missing} {missing === 1 ? "play is" : "plays are"} from a video file that isn't open on this device; pick the file again on that match's Film card, or they're skipped.</p>}
    {elsewhere > 0 && <p className="keys" style={{ margin: 0 }}>{elsewhere} more plays are on YouTube or Vimeo, which can't be cut here.</p>}
    <canvas ref={preview} className="reel-preview" width={640} height={360} hidden={!busy} aria-label="Video being made" />
    {busy && <div className="stack" style={{ gap: 4 }}><div className="meter"><i style={{ width: Math.round(frac * 100) + "%" }} /></div><span className="small muted" role="status">{busy} · keep this screen open</span></div>}
    {out && <video className="reel-out" src={out.url} controls playsInline aria-label="Finished highlight video" />}
    <div className="row">
      {!busy ? <button className="btn primary" disabled={!chosen.length} onClick={make}>{out ? "Make it again" : "Make highlight video"}</button> : <button className="btn" onClick={() => abort.current?.abort()}>Stop</button>}
      {out && <button className="btn" onClick={save}>Save video</button>}
    </div>
  </div>;
}

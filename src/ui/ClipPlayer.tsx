/** Plays clips back to back: video files (from a link or this device), YouTube and Vimeo.
 * From a video file it can also save one clip, or the whole reel, as a video file (where the browser can record video). */
import { useEffect, useRef, useState } from "react";
import { Clip, clock, videoKind, vimeoId, youtubeId } from "../film/clips";

export interface ClipPlayerProps {
  clips: Clip[];
  /** Turns a stored video link into something playable (e.g. "local:…" → the file picked on this device). */
  resolve?: (c: Clip) => string | null;
  /** Shown above the clip list, e.g. "Maya · 12 highlights". */
  title?: string;
  /** Show "Save clip" / "Save reel" when the source can be recorded. */
  allowSave?: boolean;
  fileName?: (c: Clip | null) => string;
}

const recordable = () => typeof MediaRecorder !== "undefined" && typeof (HTMLMediaElement.prototype as any).captureStream === "function";
const pickMime = () => ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || "";

export function ClipPlayer({ clips, resolve, title, allowSave, fileName }: ClipPlayerProps) {
  const [i, setI] = useState(0), [auto, setAuto] = useState(true), [note, setNote] = useState(""), [saving, setSaving] = useState<string>("");
  const vid = useRef<HTMLVideoElement>(null), frame = useRef<HTMLIFrameElement>(null), busy = useRef(false);
  const c = clips[Math.min(i, clips.length - 1)];
  const src = c ? (resolve ? resolve(c) : c.url) : null;
  const kind = src ? videoKind(src) : "other";
  const next = () => setI((x) => (x < clips.length - 1 ? x + 1 : x));
  useEffect(() => { if (i >= clips.length) setI(0); }, [clips.length]);

  // video files: seek to the clip, play, stop (or move on) at its end
  useEffect(() => {
    const v = vid.current; if (!v || !c || (kind !== "file" && kind !== "local") || busy.current) return;
    setNote("");
    const go = () => { v.currentTime = c.start; v.play().catch(() => setNote("Tap play to start the clip.")); };
    if (v.readyState >= 1) go(); else { v.addEventListener("loadedmetadata", go, { once: true }); return () => v.removeEventListener("loadedmetadata", go); }
  }, [c?.id, src]);
  const onTime = () => {
    const v = vid.current; if (!v || !c || busy.current) return;
    if (v.currentTime >= c.end) { if (auto && i < clips.length - 1) next(); else v.pause(); }
  };

  // YouTube and Vimeo: the player stops at the clip's end; move on when it reports "ended" (or after the clip's length)
  useEffect(() => {
    if (!c || (kind !== "youtube" && kind !== "vimeo")) return;
    const onMsg = (e: MessageEvent) => {
      if (!/youtube|vimeo/.test(e.origin)) return;
      let d: any = e.data; try { if (typeof d === "string") d = JSON.parse(d); } catch { return; }
      const ended = (d?.event === "onStateChange" && d.info === 0) || (d?.event === "infoDelivery" && d.info?.playerState === 0) || d?.event === "finish" || d?.event === "ended";
      if (ended && auto) next();
    };
    addEventListener("message", onMsg);
    const t = auto && i < clips.length - 1 ? setTimeout(next, (c.end - c.start + 4) * 1000) : null;
    return () => { removeEventListener("message", onMsg); if (t) clearTimeout(t); };
  }, [c?.id, kind, auto]);
  const listen = () => { try { frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"); frame.current?.contentWindow?.postMessage(JSON.stringify({ method: "addEventListener", value: "finish" }), "*"); } catch { /* ignore */ } };

  /** Records clips from the playing video into one file. */
  const save = async (list: Clip[]) => {
    const v = vid.current as any; if (!v || !list.length) return;
    busy.current = true; setSaving(list.length > 1 ? `Saving reel: clip 1 of ${list.length}…` : "Saving clip…");
    try {
      const stream: MediaStream = v.captureStream(), mime = pickMime(), rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), parts: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      const stopped = new Promise((res) => (rec.onstop = res));
      for (let k = 0; k < list.length; k++) {
        const x = list[k]; setI(clips.indexOf(x)); setSaving(list.length > 1 ? `Saving reel: clip ${k + 1} of ${list.length}…` : "Saving clip…");
        v.pause(); v.currentTime = x.start; await new Promise((res) => v.addEventListener("seeked", res, { once: true }));
        if (rec.state === "inactive") rec.start(250); else rec.resume();
        await v.play();
        await new Promise<void>((res) => { const f = () => { if (v.currentTime >= x.end || v.ended) { v.removeEventListener("timeupdate", f); res(); } }; v.addEventListener("timeupdate", f); });
        v.pause(); rec.pause();
      }
      rec.stop(); await stopped;
      const blob = new Blob(parts, { type: mime.split(";")[0] || "video/webm" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (fileName ? fileName(list.length === 1 ? list[0] : null) : "clip") + (blob.type.includes("mp4") ? ".mp4" : ".webm");
      a.hidden = true; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      setSaving(""); setNote(list.length > 1 ? `Saved a reel of ${list.length} clips.` : "Clip saved.");
    } catch { setSaving(""); setNote("This browser can't save clips. Try Chrome, Edge or Firefox on a computer."); }
    busy.current = false;
  };

  if (!clips.length || !c) return <p className="empty">No clips yet. Link the match video and line up “First serve at”, then every play becomes a clip.</p>;
  const canSave = allowSave && (kind === "file" || kind === "local") && recordable() && (kind === "local" || (() => { try { return new URL(src!, location.href).origin === location.origin; } catch { return false; } })());
  const sameSource = clips.every((x) => (resolve ? resolve(x) : x.url) === src);
  const yt = kind === "youtube" ? youtubeId(src!) : null, vm = kind === "vimeo" ? vimeoId(src!) : null;

  return <div className="clips">
    {title && <div className="clip-title">{title}</div>}
    <div className="clip-stage">
      {(kind === "file" || kind === "local") && <video ref={vid} src={src!} controls playsInline preload="metadata" onTimeUpdate={onTime} aria-label={"Clip: " + c.label} />}
      {yt && <iframe ref={frame} key={c.id} title={"Clip: " + c.label} onLoad={listen} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
        src={`https://www.youtube-nocookie.com/embed/${yt}?start=${Math.floor(c.start)}&end=${Math.ceil(c.end)}&autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`} />}
      {vm && <iframe ref={frame} key={c.id} title={"Clip: " + c.label} onLoad={listen} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen src={`https://player.vimeo.com/video/${vm}?autoplay=1&api=1#t=${Math.floor(c.start)}s`} />}
      {((kind === "youtube" && !yt) || (kind === "vimeo" && !vm) || kind === "other") && <div className="clip-ext"><p>This video plays on its own site.</p><a className="btn" href={src || c.url} target="_blank" rel="noopener">Open the video ({clock(c.start)})</a></div>}
    </div>
    <div className="clip-now"><b>{c.label}</b><span>{[c.opp ? "vs " + c.opp : "", c.set ? "Set " + c.set : "", c.score, clock(c.start)].filter(Boolean).join(" · ")}</span><span className="clip-count">{i + 1} of {clips.length}</span></div>
    <div className="row clip-ctrl">
      <button className="btn sm" disabled={i === 0 || !!saving} onClick={() => setI(i - 1)}>‹ Previous</button>
      <button className="btn sm" disabled={i >= clips.length - 1 || !!saving} onClick={next}>Next ›</button>
      <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Play all</label>
      {canSave && <button className="btn sm" disabled={!!saving} onClick={() => save([c])}>Save clip</button>}
      {canSave && clips.length > 1 && <button className="btn sm" disabled={!!saving || !sameSource} title={sameSource ? undefined : "A reel can only be saved from one video"} onClick={() => save(clips)}>Save reel</button>}
    </div>
    {(saving || note) && <p className="small muted" role="status" style={{ margin: "6px 0 0" }}>{saving || note}</p>}
    <ol className="clip-list">{clips.map((x, k) => <li key={x.id}><button aria-current={k === i ? "true" : undefined} disabled={!!saving} onClick={() => setI(k)}><span>{x.label}</span><small>{[x.opp ? "vs " + x.opp : "", x.score].filter(Boolean).join(" · ")}</small></button></li>)}</ol>
  </div>;
}

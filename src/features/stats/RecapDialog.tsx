/** Recap video: a looping preview of the vertical recap, then record it and share or save the file. */
import { useEffect, useRef, useState } from "react";
import { Match } from "../../data/model";
import { team, toast } from "../../data/store";
import { Replay } from "../../sports/volleyball/engine";
import { download } from "../../ui/kit";
import { canMakeRecap, drawRecap, recapData, RecapData, recapLength, renderRecapVideo, RH, RW } from "./recapVideo";

export function RecapVideo({ m, R, onClose }: { m: Match; R: Replay; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null), abort = useRef<AbortController | null>(null);
  const [d, setD] = useState<RecapData | null>(null), [frac, setFrac] = useState(-1);
  useEffect(() => { let on = true; recapData(m, R).then((x) => on && setD(x)); return () => { on = false; abort.current?.abort(); }; }, [m.id]);
  // the preview loops; it is the same drawing the recording uses
  useEffect(() => {
    if (!d || !cv.current) return; const g = cv.current.getContext("2d")!, len = recapLength(d), t0 = performance.now(); let raf = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => { drawRecap(g, d, still ? 1.6 : ((performance.now() - t0) / 1000) % (len + 0.6)); if (!still) raf = requestAnimationFrame(step); };
    step(); return () => cancelAnimationFrame(raf);
  }, [d]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", f); return () => removeEventListener("keydown", f); }, []);
  const make = async () => {
    if (!d) return; abort.current = new AbortController(); setFrac(0);
    try {
      const b = await renderRecapVideo(d, { onProgress: setFrac, signal: abort.current.signal });
      const ext = b.type.includes("mp4") ? "mp4" : "webm", name = `${team()!.name} vs ${m.opp} ${m.date} recap.${ext}`.replace(/[^\w\- .]+/g, "");
      const file = new File([b], name, { type: b.type }), nav: any = navigator;
      if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); setFrac(-1); return; } catch { /* cancelled: save it instead */ } }
      download(name, b, b.type); toast(ext === "mp4" ? "Recap video saved. Post it as a Reel, TikTok or Short." : "Recap video saved as WebM. Instagram and TikTok want MP4: make it in Safari, or convert the file.");
    } catch (e: any) { if (e?.name !== "AbortError") toast("Couldn't make the video here."); }
    setFrac(-1);
  };
  const busy = frac >= 0, len = d ? Math.round(recapLength(d)) : 0;
  return <div className="rv-back" role="dialog" aria-modal="true" aria-label="Recap video" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="rv">
      <canvas ref={cv} width={RW} height={RH} className="rv-cv" aria-label="Preview of the recap video" />
      <div className="rv-side">
        <h2>Recap video</h2>
        <p className="small muted">A {len}-second vertical video for Reels, TikTok, Shorts and stories: the result, each set, your top performers and the team's numbers. Players marked as kept off public pages are left out.</p>
        {canMakeRecap()
          ? busy ? <div className="stack" style={{ gap: 4 }}><div className="meter"><i style={{ width: Math.round(frac * 100) + "%" }} /></div><span className="small muted" role="status">Recording, {Math.round(frac * 100)}% · keep this screen open</span></div>
            : <button className="btn primary" onClick={make} disabled={!d}>Make the video</button>
          : <p className="small">This browser can't record video. Use Chrome or Edge on a computer, or Safari 17 or later.</p>}
        <button className="btn" onClick={() => { abort.current?.abort(); onClose(); }}>{busy ? "Stop" : "Close"}</button>
      </div>
    </div>
  </div>;
}

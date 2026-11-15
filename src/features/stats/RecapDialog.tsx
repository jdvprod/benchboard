/** Recap video: a looping preview of the vertical recap, then record it and share or save the file. */
import { useEffect, useRef, useState } from "react";
import { Match } from "../../data/model";
import { team, toast } from "../../data/store";
import { Replay } from "../../sports/volleyball/engine";
import { download } from "../../ui/kit";
import { canMakeRecap, drawRecap, recapData, RecapData, recapLength, recapPlays, recapPlaysAt, renderRecapVideo, RH, RW, T_PLAY } from "./recapVideo";

export function RecapVideo({ m, R, onClose }: { m: Match; R: Replay; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null), abort = useRef<AbortController | null>(null);
  const [d, setD] = useState<RecapData | null>(null), [frac, setFrac] = useState(-1);
  const hasFilm = recapPlays(m, R).length > 0, [plays, setPlays] = useState(true);
  useEffect(() => { let on = true; recapData(m, R, plays).then((x) => on && setD(x)); return () => { on = false; }; }, [m.id, plays]);
  useEffect(() => () => abort.current?.abort(), []);
  // the preview loops; it is the same drawing the recording uses
  useEffect(() => {
    if (!d || !cv.current) return; const g = cv.current.getContext("2d")!, len = recapLength(d), t0 = performance.now(); let raf = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // the film follows the preview's clock during the plays
    const film = d.plays.length ? document.createElement("video") : null, p0 = recapPlaysAt(d);
    if (film) { film.muted = true; film.playsInline = true; film.preload = "auto"; film.crossOrigin = "anonymous"; }
    const step = () => {
      const t = still ? 1.6 : ((performance.now() - t0) / 1000) % (len + 0.6), i = Math.floor((t - p0) / T_PLAY), pl = film && t >= p0 ? d.plays[i] : null;
      if (film && pl) { const want = pl.start + (t - p0 - i * T_PLAY); if (film.src !== new URL(pl.src, location.href).href) film.src = pl.src; if (Math.abs(film.currentTime - want) > 0.6) film.currentTime = want; if (film.paused) film.play().catch(() => {}); }
      else if (film && !film.paused) film.pause();
      drawRecap(g, d, t, film); if (!still) raf = requestAnimationFrame(step);
    };
    step(); return () => { cancelAnimationFrame(raf); if (film) { film.pause(); film.removeAttribute("src"); } };
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
        <p className="small muted">A {len}-second vertical video for Reels, TikTok, Shorts and stories: the result, each set, your top performers{d?.plays.length ? `, ${d.plays.length} ${d.plays.length === 1 ? "play" : "plays"} from the film` : ""} and the team's numbers. Players marked as kept off public pages are left out.</p>
        {hasFilm ? <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={plays} onChange={(e) => setPlays(e.target.checked)} disabled={frac >= 0} /> Include plays from the match film (no sound)</label>
          : m.video ? <p className="keys" style={{ margin: 0 }}>To add plays from the film, pick the match video file on this match's Film card first. YouTube and Vimeo links can't be cut here.</p> : null}
        {canMakeRecap()
          ? busy ? <div className="stack" style={{ gap: 4 }}><div className="meter"><i style={{ width: Math.round(frac * 100) + "%" }} /></div><span className="small muted" role="status">Recording, {Math.round(frac * 100)}% · keep this screen open</span></div>
            : <button className="btn primary" onClick={make} disabled={!d} autoFocus>Make the video</button>
          : <p className="small">This browser can't record video. Use Chrome or Edge on a computer, or Safari 17 or later.</p>}
        <button className="btn" onClick={() => { abort.current?.abort(); onClose(); }}>{busy ? "Stop" : "Close"}</button>
      </div>
    </div>
  </div>;
}

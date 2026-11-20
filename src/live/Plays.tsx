/** The team's playbook on FloorCall Live: plays the coaches chose to share, on the 3D court. Signed-in followers pick a
 * play, turn the court, and run the movement. Read only. */
import { useEffect, useRef, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../cloud/client";
import { MiniAuth } from "../cloud/MiniAuth";
import { tr } from "../lib/i18n";
import { cleanPlays, Play } from "../sports/volleyball/playbook";
import { along, Court3D } from "../ui/Court3D";
import { svgToPng } from "../lib/svgPng";

export function TeamPlays({ code, team }: { code: string; team: string }) {
  const [, bump] = useState(0), [plays, setPlays] = useState<Play[] | null>(null), [i, setI] = useState(0), signed = !!currentUser();
  const [k, setK] = useState(0), raf = useRef(0);
  useEffect(() => { if (signed && cloudAvailable()) rpc("plays_by_code", { c: code }).then((d) => setPlays(cleanPlays(d))).catch(() => setPlays([])); }, [code, signed]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  if (!cloudAvailable()) return null;
  if (!signed) return <section className="lv-card lv-plays"><div className="lv-h"><h2>{tr("Playbook")}</h2></div>
    <p className="lv-note">{tr("{team}'s coaches share plays here for players and families. Sign in or create a free account to see them.", { team })}</p>
    <MiniAuth kind="athlete" title={tr("See the team's plays")} onIn={() => bump((x) => x + 1)} t={tr} /></section>;
  if (!plays) return <p className="lv-empty">{tr("Loading…")}</p>;
  if (!plays.length) return <section className="lv-card lv-plays"><div className="lv-h"><h2>{tr("Playbook")}</h2></div><p className="lv-note">{tr("The coaches haven't shared any plays yet.")}</p></section>;
  const play = plays[Math.min(i, plays.length - 1)], hasRoutes = play.spots.some((s) => s.to), running = k > 0, ease = k * k * (3 - 2 * k);
  const run = () => { cancelAnimationFrame(raf.current); const t0 = performance.now(); const step = (now: number) => { const e = now - t0; setK(e < 1100 ? e / 1100 : e < 2300 ? 1 : 0); if (e < 2300) raf.current = requestAnimationFrame(step); }; raf.current = requestAnimationFrame(step); };
  const pegs = play.spots.map((s) => { const [x, y] = s.to ? along(s.x, s.y, s.to, s.via, ease) : [s.x, s.y]; return { num: s.r, name: s.name, lib: s.lib, x, y, to: running ? null : s.to, via: s.via }; });
  return <section className="lv-card lv-plays">
    <div className="lv-h"><h2>{tr("Playbook")}</h2><span className="lv-note">{plays.length} {tr(plays.length === 1 ? "play" : "plays")}</span></div>
    <div className="lv-play-pick" role="group" aria-label={tr("Plays")}>{plays.map((p, n) => <button key={p.id + n} aria-pressed={n === i} onClick={() => { cancelAnimationFrame(raf.current); setK(0); setI(n); }}>{p.name}</button>)}</div>
    <Court3D pegs={pegs} ball={play.ball} label={`${play.name}: ${play.spots.map((s) => s.name).join(", ")}`} />
    <div className="lv-play-bar"><b>{play.name}</b><span className="row" style={{ gap: 6 }}>{hasRoutes && <button className="btn primary" onClick={run} disabled={running}>{tr("Run it")}</button>}<button className="btn" disabled={running} onClick={async () => {
      const svg = document.querySelector<SVGSVGElement>(".lv-plays .c3d"); if (!svg) return;
      try { const b = await svgToPng(svg, 2, "#0B1117", { title: play.name, sub: team.toUpperCase() }), name = `${play.name}.png`.replace(/[^\w\- .]+/g, ""), file = new File([b], name, { type: "image/png" }), nav: any = navigator;
        if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: play.name }); return; } catch { /* save instead */ } }
        const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch { /* picture not available in this browser */ }
    }}>{tr("Save picture")}</button></span></div>
    {play.note && <p className="lv-play-note">{play.note}</p>}
  </section>;
}

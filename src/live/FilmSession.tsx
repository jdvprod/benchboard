/** Floorcall Live #/film/CODE: a film session the coach sent the team. Signed in: watch each clip with the coach's
 * note and drawing; watched clips are ticked off (and the coach sees who watched). */
import { useEffect, useRef, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../cloud/client";
import { MiniAuth, SignedIn } from "../cloud/MiniAuth";
import { tr } from "../lib/i18n";

interface Item { label: string; note?: string; url: string; secs: number }
interface Session { title: string; note?: string; team: string; logo?: string | null; opp?: string; date?: string; items: Item[]; watched: number[] }
const safe = (u: string) => (/^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) ? u : "");

export function FilmSessionView({ code, Shell }: { code: string; Shell: any }) {
  const [, bump] = useState(0), [s, setS] = useState<Session | null | undefined>(undefined), [err, setErr] = useState(""), [i, setI] = useState(0);
  const vid = useRef<HTMLVideoElement>(null);
  const signed = !!currentUser();
  useEffect(() => {
    if (!signed || !cloudAvailable()) return;
    rpc("film_open", { c: code }).then((d) => setS(d || null)).catch((e) => { setErr(e?.message || tr("Couldn't open the film. Check your connection.")); setS(null); });
  }, [code, signed]);
  if (!cloudAvailable()) return <Shell><p className="lv-empty">{tr("This site isn't connected yet.")}</p></Shell>;
  if (!signed) return <Shell><section className="lv-film-gate">
    <h1>{tr("Team film")}</h1><p>{tr("Your coach shared film with the team. Sign in or create a free account to watch.")}</p>
    <MiniAuth kind="athlete" title={tr("Watch the film")} onIn={() => bump((x) => x + 1)} t={tr} />
  </section></Shell>;
  if (s === undefined) return <Shell><p className="lv-empty">{tr("Loading…")}</p></Shell>;
  if (!s) return <Shell><p className="lv-empty">{err || tr("This film isn't shared anymore. Ask your coach for a new link.")}</p></Shell>;
  const it = s.items[i], watched = new Set(s.watched || []);
  const mark = (n: number) => { if (watched.has(n)) return; setS({ ...s, watched: [...watched, n] }); rpc("film_watched", { c: code, n }).catch(() => {}); };
  const next = () => { if (i < s.items.length - 1) setI(i + 1); };
  return <Shell team={s.team}><section className="lv-film">
    <div className="lv-film-hd"><h1>{s.title}</h1><p className="lv-note">{[s.opp && "vs " + s.opp, s.date].filter(Boolean).join(" · ")}{s.items.length ? ` · ${tr("{n} of {all} watched", { n: String(watched.size), all: String(s.items.length) })}` : ""}</p>
      {s.note && <p className="lv-film-note">{s.note}</p>}</div>
    {it && <div className="lv-film-player">
      <video ref={vid} key={it.url} src={safe(it.url)} controls playsInline autoPlay onEnded={() => { mark(i); next(); }} onTimeUpdate={(e) => { const v = e.target as HTMLVideoElement; if (v.duration && v.currentTime / v.duration > 0.8) mark(i); }} />
      <div className="lv-film-cap"><b>{i + 1}. {it.label}</b>{it.note && <p>{it.note}</p>}</div>
      <div className="row"><button className="btn" disabled={!i} onClick={() => setI(i - 1)}>‹ {tr("Previous")}</button><button className="btn primary" disabled={i >= s.items.length - 1} onClick={next}>{tr("Next clip")} ›</button></div>
    </div>}
    <ol className="lv-film-list">{s.items.map((x, n) => <li key={n} className={(n === i ? "on " : "") + (watched.has(n) ? "done" : "")}><button onClick={() => setI(n)}>
      <span className="lv-film-n">{watched.has(n) ? "✓" : n + 1}</span><span><b>{x.label}</b>{x.note && <small>{x.note}</small>}</span><span className="lv-note">{x.secs}s</span></button></li>)}</ol>
    <SignedIn onOut={() => location.reload()} t={tr} />
  </section></Shell>;
}

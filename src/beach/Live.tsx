/** Floorcall Beach, live: the scorer shares a match by link and it updates as points are entered; anyone with the link
 * watches the score, the court and the box score with no account. Sharing needs a free account so a link has an owner. */
import { ReactNode, useEffect, useRef, useState } from "react";
import { cloudAvailable, currentUser, rpc } from "../cloud/client";
import { MiniAuth } from "../cloud/MiniAuth";
import { BeachMatch, pack, unpack } from "../sports/beach/engine";

export const liveUrl = (code: string) => location.href.split("#")[0] + "#/live/" + code;

/** The scorer's controls: start sharing, the link, stop. While sharing, every change is sent a moment after it's made. */
export function GoLive({ m, onChange }: { m: BeachMatch; onChange: (m: BeachMatch) => void }) {
  const [ask, setAsk] = useState(false), [, bump] = useState(0), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [copied, setCopied] = useState(false);
  const sent = useRef(""), signed = !!currentUser();
  // keep the shared copy up to date
  useEffect(() => {
    if (!m.live || !signed) return; const d = pack(m); if (d === sent.current) return;
    const t = setTimeout(() => { rpc("beach_publish", { c: m.live, d }).then(() => { sent.current = d; setMsg(""); }).catch((e) => setMsg(navigator.onLine === false ? "No connection. The link will catch up when you're back online." : e?.message || "Couldn't update the live link.")); }, 700);
    return () => clearTimeout(t);
  }, [m.events.length, m.live, signed, m.firstServer.join()]);
  // back online: send whatever was missed
  useEffect(() => { const f = () => bump((x) => x + 1); addEventListener("online", f); return () => removeEventListener("online", f); }, []);
  if (!cloudAvailable()) return null;
  const start = async () => {
    setBusy(true); setMsg("");
    try { const d = pack(m), code: string = await rpc("beach_publish", { c: null, d }); sent.current = d; onChange({ ...m, live: code }); }
    catch (e: any) { setMsg(e?.message || "Couldn't start sharing. Check your connection."); }
    setBusy(false);
  };
  const stop = async () => { try { await rpc("beach_unshare", { c: m.live }); } catch { /* it stops updating either way */ } onChange({ ...m, live: undefined }); };
  const copy = async () => { const url = liveUrl(m.live!); try { if ((navigator as any).share) await (navigator as any).share({ title: `${m.us} vs ${m.them}, live`, url }); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } } catch { /* cancelled */ } };

  if (m.live) return <section className="card bv-live">
    <h2><span className="bv-dot" aria-hidden="true" />Sharing live</h2>
    <p className="small">Anyone with this link sees the score, the players' names and the box score as you enter points. No account needed to watch.</p>
    <p className="bv-link"><a href={liveUrl(m.live)} target="_blank" rel="noopener">{liveUrl(m.live).replace(/^https?:\/\//, "")}</a></p>
    <div className="bv-bar"><button className="btn primary" onClick={copy}>{copied ? "Link copied" : "Share the live link"}</button><button className="btn" onClick={stop}>Stop sharing</button></div>
    {msg && <p className="small bv-warn" role="status">{msg}</p>}
  </section>;
  if (ask && !signed) return <section className="card bv-live">
    <h2>Share this match live</h2>
    <p className="small">A free account keeps the live link yours. Watching never needs one.</p>
    <MiniAuth kind="fan" title="Sign in to share live" onIn={() => { bump((x) => x + 1); start(); }} />
    <button className="btn" onClick={() => setAsk(false)}>Not now</button>
  </section>;
  return <section className="bv-bar bv-golive">
    <button className="btn" onClick={() => (signed ? start() : setAsk(true))} disabled={busy}>{busy ? "Starting…" : "Go live"}</button>
    <span className="small muted">Families follow the score as you enter it.</span>
    {msg && <span className="small bv-warn" role="status">{msg}</span>}
  </section>;
}

/** The watcher's side: fetch the match every few seconds while the page is showing. */
export function Watch({ code, render }: { code: string; render: (m: BeachMatch, fresh: boolean) => ReactNode }) {
  const [m, setM] = useState<BeachMatch | null | undefined>(undefined), [fresh, setFresh] = useState(true), last = useRef("");
  useEffect(() => {
    let on = true, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) {
        try { const r = await rpc("beach_view", { c: code }, true); if (!on) return;
          if (!r) setM(null); else if (r.data !== last.current) { last.current = r.data; setM(unpack(r.data)); }
          setFresh(true);
        } catch { if (on) setFresh(false); }
      }
      if (on) timer = setTimeout(tick, 4000);
    };
    tick(); const vis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { on = false; clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [code]);
  if (!cloudAvailable()) return <section className="card"><h2>Live isn't set up here</h2><p>This copy of Floorcall Beach isn't connected. <a href="#/">Score a match of your own</a>.</p></section>;
  if (m === undefined) return <p className="bv-note" role="status">Loading the match…</p>;
  if (!m) return <section className="card"><h2>This match isn't being shared</h2><p>The scorer stopped sharing it, or the link is mistyped. <a href="#/">Score a match of your own</a>.</p></section>;
  return <>{render(m, fresh)}</>;
}

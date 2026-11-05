/** "Get notified": families follow a team and get a phone notification when a match starts and when it ends. */
import { useEffect, useState } from "react";
import { fn } from "../cloud/client";
import { tr } from "../lib/i18n";
import { LPlayer } from "./data";

type Saved = { endpoint: string; starts: boolean; finals: boolean; player?: string };
const KEY = (code: string) => "bbl-notify-" + code;
const read = (code: string): Saved | null => { try { return JSON.parse(localStorage.getItem(KEY(code)) || "null"); } catch { return null; } };
const write = (code: string, v: Saved | null) => { try { v ? localStorage.setItem(KEY(code), JSON.stringify(v)) : localStorage.removeItem(KEY(code)); } catch { /* private window */ } };
const bytes = (b64: string) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration() { return navigator.serviceWorker.register("sw.js", { scope: "./" }).then(() => navigator.serviceWorker.ready); }

export function NotifyCard({ code, team, players = [] }: { code: string; team: string; players?: LPlayer[] }) {
  const [saved, setSaved] = useState<Saved | null>(() => read(code)), [starts, setStarts] = useState(saved?.starts ?? true), [finals, setFinals] = useState(saved?.finals ?? true), [player, setPlayer] = useState(saved?.player || "");
  const named = players.filter((p) => p.first).sort((a, b) => (+a.num || 0) - (+b.num || 0)), followed = named.find((p) => p.id === saved?.player);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [editing, setEditing] = useState(false);
  // the browser may have dropped the subscription (site data cleared, permission revoked): show the truth
  useEffect(() => {
    if (!saved || !pushSupported()) return;
    if (Notification.permission !== "granted") { write(code, null); setSaved(null); return; }
    navigator.serviceWorker.getRegistration("./").then((r) => r?.pushManager.getSubscription()).then((s) => { if (s === null) { write(code, null); setSaved(null); } }).catch(() => {});
  }, [code]);

  if (!pushSupported()) {
    if (ios() && !standalone()) return <section className="lv-card lv-notify" aria-label={tr("Get notified")}>
      <div className="lv-h"><h2>{tr("Get notified")}</h2></div>
      <p className="lv-note" style={{ marginTop: 0 }}>{tr("On iPhone and iPad, notifications work once this page is on your Home Screen: tap Share, then Add to Home Screen, open {team} from there and turn them on.", { team })}</p>
    </section>;
    return null;
  }

  const on = async () => {
    if (!starts && !finals) { setMsg(tr("Pick at least one: match starts or final scores.")); return; }
    setBusy(true); setMsg("");
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") { setMsg(perm === "denied" ? tr("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.") : tr("Notifications weren't allowed.")); setBusy(false); return; }
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) { const { key } = await fn("notify", { action: "key" }); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) }); }
      const pl = finals && player ? player : undefined;
      await fn("notify", { action: "subscribe", code, sub: sub.toJSON(), starts, finals, ...(pl ? { player: pl } : {}) });
      const v = { endpoint: sub.endpoint, starts, finals, ...(pl ? { player: pl } : {}) }; write(code, v); setSaved(v); setEditing(false);
    } catch (e: any) {
      setMsg(e?.status === 404 || e?.status === 503 ? tr("Notifications aren't available for this team yet.") : e?.status === 0 ? tr("Couldn't connect. Check your connection and try again.") : "Couldn't turn on notifications: " + (e?.message || "unknown error") + ".");
    }
    setBusy(false);
  };
  const off = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("./"), sub = await reg?.pushManager.getSubscription();
      await fn("notify", { action: "unsubscribe", endpoint: saved?.endpoint || sub?.endpoint }).catch(() => {});
      // other teams followed on this phone share the subscription: keep it if any are left
      const others = Object.keys(localStorage).some((k) => k.startsWith("bbl-notify-") && k !== KEY(code));
      if (sub && !others) await sub.unsubscribe().catch(() => {});
    } catch { /* turned off locally either way */ }
    write(code, null); setSaved(null); setBusy(false); setMsg("");
  };

  const what = (s: Saved) => tr(s.starts && s.finals ? "match starts and final scores" : s.starts ? "match starts" : "final scores");
  return <section className="lv-card lv-notify" aria-label={tr("Get notified")}>
    <div className="lv-h"><h2>{tr(saved ? "Notifications on" : "Get notified")}</h2>{saved && !editing && <button className="btn sm ghost" onClick={() => setEditing(true)}>{tr("Change")}</button>}</div>
    {saved && !editing ? <p className="lv-note" style={{ marginTop: 0 }}>{tr("You'll get {team}'s {what} on this {device}.", { team, what: what(saved), device: tr(ios() ? "phone" : "device") })}{followed ? " " + tr("Finals start with {name}'s numbers.", { name: followed.first }) : ""}</p>
      : <>
        {!saved && <p className="lv-note" style={{ marginTop: 0 }}>{tr("Get a notification on this {device} when {team} starts a match and when it ends. No account needed.", { device: tr(ios() ? "phone" : "device"), team })}</p>}
        <div className="lv-filters" style={{ margin: "10px 0" }}>
          <label><input type="checkbox" checked={starts} onChange={(e) => setStarts(e.target.checked)} /> {tr("Match starts")}</label>
          <label><input type="checkbox" checked={finals} onChange={(e) => setFinals(e.target.checked)} /> {tr("Final scores")}</label>
        </div>
        {finals && named.length > 0 && <label className="lv-notify-pl"><span>{tr("Your player (optional)")}</span>
          <select className="input" value={player} onChange={(e) => setPlayer(e.target.value)} aria-label={tr("Your player (optional)")}><option value="">{tr("No one in particular")}</option>{named.map((p) => <option key={p.id} value={p.id}>#{p.num} {p.first}{p.last ? " " + p.last + "." : ""}</option>)}</select>
          <small>{tr("Their kills, digs and more come with every final.")}</small></label>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={busy} onClick={on}>{tr(busy ? "Turning on…" : saved ? "Save" : "Turn on notifications")}</button>
          {saved && <button className="btn" disabled={busy} onClick={off}>{tr("Turn off")}</button>}
          {saved && <button className="btn ghost" onClick={() => setEditing(false)}>{tr("Cancel")}</button>}
        </div>
      </>}
    {msg && <p className="lv-err" role="alert">{msg}</p>}
  </section>;
}

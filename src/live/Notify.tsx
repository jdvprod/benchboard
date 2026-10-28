/** "Get notified": families follow a team and get a phone notification when a match starts and when it ends. */
import { useEffect, useState } from "react";
import { fn } from "../cloud/client";

type Saved = { endpoint: string; starts: boolean; finals: boolean };
const KEY = (code: string) => "bbl-notify-" + code;
const read = (code: string): Saved | null => { try { return JSON.parse(localStorage.getItem(KEY(code)) || "null"); } catch { return null; } };
const write = (code: string, v: Saved | null) => { try { v ? localStorage.setItem(KEY(code), JSON.stringify(v)) : localStorage.removeItem(KEY(code)); } catch { /* private window */ } };
const bytes = (b64: string) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration() { return navigator.serviceWorker.register("sw.js", { scope: "./" }).then(() => navigator.serviceWorker.ready); }

export function NotifyCard({ code, team }: { code: string; team: string }) {
  const [saved, setSaved] = useState<Saved | null>(() => read(code)), [starts, setStarts] = useState(saved?.starts ?? true), [finals, setFinals] = useState(saved?.finals ?? true);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [editing, setEditing] = useState(false);
  // the browser may have dropped the subscription (site data cleared, permission revoked): show the truth
  useEffect(() => {
    if (!saved || !pushSupported()) return;
    if (Notification.permission !== "granted") { write(code, null); setSaved(null); return; }
    navigator.serviceWorker.getRegistration("./").then((r) => r?.pushManager.getSubscription()).then((s) => { if (s === null) { write(code, null); setSaved(null); } }).catch(() => {});
  }, [code]);

  if (!pushSupported()) {
    if (ios() && !standalone()) return <section className="lv-card lv-notify" aria-label="Get notified">
      <div className="lv-h"><h2>Get notified</h2></div>
      <p className="lv-note" style={{ marginTop: 0 }}>On iPhone and iPad, notifications work once this page is on your Home Screen: tap <b>Share</b>, then <b>Add to Home Screen</b>, open {team} from there and turn them on.</p>
    </section>;
    return null;
  }

  const on = async () => {
    if (!starts && !finals) { setMsg("Pick at least one: match starts or final scores."); return; }
    setBusy(true); setMsg("");
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") { setMsg(perm === "denied" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." : "Notifications weren't allowed."); setBusy(false); return; }
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) { const { key } = await fn("notify", { action: "key" }); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) }); }
      await fn("notify", { action: "subscribe", code, sub: sub.toJSON(), starts, finals });
      const v = { endpoint: sub.endpoint, starts, finals }; write(code, v); setSaved(v); setEditing(false);
    } catch (e: any) {
      setMsg(e?.status === 404 || e?.status === 503 ? "Notifications aren't available for this team yet." : e?.status === 0 ? "Couldn't connect. Check your connection and try again." : "Couldn't turn on notifications: " + (e?.message || "unknown error") + ".");
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

  const what = (s: Saved) => s.starts && s.finals ? "match starts and final scores" : s.starts ? "match starts" : "final scores";
  return <section className="lv-card lv-notify" aria-label="Get notified">
    <div className="lv-h"><h2>{saved ? "Notifications on" : "Get notified"}</h2>{saved && !editing && <button className="btn sm ghost" onClick={() => setEditing(true)}>Change</button>}</div>
    {saved && !editing ? <p className="lv-note" style={{ marginTop: 0 }}>You'll get {team}'s {what(saved)} on this {ios() ? "phone" : "device"}.</p>
      : <>
        {!saved && <p className="lv-note" style={{ marginTop: 0 }}>Get a notification on this {ios() ? "phone" : "device"} when {team} starts a match and when it ends. No account needed.</p>}
        <div className="lv-filters" style={{ margin: "10px 0" }}>
          <label><input type="checkbox" checked={starts} onChange={(e) => setStarts(e.target.checked)} /> Match starts</label>
          <label><input type="checkbox" checked={finals} onChange={(e) => setFinals(e.target.checked)} /> Final scores</label>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={busy} onClick={on}>{busy ? "Turning on…" : saved ? "Save" : "Turn on notifications"}</button>
          {saved && <button className="btn" disabled={busy} onClick={off}>Turn off</button>}
          {saved && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
      </>}
    {msg && <p className="lv-err" role="alert">{msg}</p>}
  </section>;
}

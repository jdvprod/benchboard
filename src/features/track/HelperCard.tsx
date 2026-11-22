/** Hand tracking to a parent: a link for this one match, opened on FloorCall Live with no account. */
import { useEffect, useState } from "react";
import { CloudError, cloudAvailable, currentUser, rpc } from "../../cloud/client";
import { isLinked, roleOn, syncNow } from "../../cloud/sync";
import { siteUrl } from "../../cloud/links";
import { Match } from "../../data/model";
import { setPrefs, state, stampLog, team, toast } from "../../data/store";
import { ConfirmButton, copyText } from "../../ui/kit";
import { QrButton } from "../../ui/QrButton";
import { go } from "../../app/router";
import { useSignups } from "../matchup/Availability";
import { oppKey } from "../../data/store";

type Mode = "points" | "basic" | "stats";
interface Status { code: string; mode: Mode; name: string; expires_at: string; last_at: string | null }
const MODES: [Mode, string, string][] = [
  ["points", "Points only", "who won each point: easy for anyone"],
  ["basic", "Basic stats and score", "kills, aces, errors, blocks, digs"],
  ["stats", "Basic stats, I keep score", "they add the box score; you tap points"],
];
const MODE_LABEL: Record<Mode, string> = { points: "points only", basic: "basic stats and score", stats: "basic stats (you keep score)" };
const errText = (e: unknown) => (e instanceof CloudError ? e.message : "Couldn't reach FloorCall. Check your connection.");
export const helperUrl = (code: string) => siteUrl("live", "h/" + code);
const ago = (iso: string | null) => { if (!iso) return "no plays yet"; const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? "last play just now" : s < 3600 ? `last play ${Math.round(s / 60)} min ago` : "last play over an hour ago"; };

export function HelperCard({ m }: { m: Match }) {
  const t = team()!, role = roleOn(t.id);
  const [st, setSt] = useState<Status | null | undefined>(undefined), [name, setName] = useState(""), [mode, setMode] = useState<Mode>("points"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  // whoever signed up for "Stats helper" on this match's schedule entry
  const signups = useSignups(), item = (t.schedule || []).find((x) => x.date === m.date && oppKey(x.opp) === oppKey(m.opp));
  const job = item?.jobs?.find((j) => /stat/i.test(j.name)), volunteer = job ? (signups || []).find((x) => x.item === item!.id && x.job === job.id)?.name || "" : "";
  useEffect(() => { if (volunteer && !name) setName(volunteer); }, [volunteer]);
  const ready = cloudAvailable() && !!currentUser() && isLinked(t.id) && (role === "owner" || role === "coach") && !t.sample;
  const load = async () => { try { setSt((await rpc("helper_status", { t: t.id, m: m.id })) || null); } catch { setSt((x) => (x === undefined ? null : x)); } };
  useEffect(() => { if (!ready) return; load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [ready, m.id]);

  if (!ready) return <div className="helper-card"><b>Hand off to a parent</b>
    <span className="small muted">A parent can track this match on their phone from a link, no account needed. {t.sample ? "Make your own team to try it." : <>First sync the team: <button className="linkish" onClick={() => go("team")}>Team tab</button>.</>}</span></div>;

  const make = async () => {
    setBusy(true); setErr("");
    try {
      await syncNow();
      const r: Status = await rpc("helper_create", { t: t.id, m: m.id, md: mode, who: name.trim() });
      setSt({ ...r, last_at: null });
      if (mode !== "stats" && (state.prefs.job || "all") !== "stats") { setPrefs({ job: "stats" }); stampLog(m.id); }
      const ok = await copyText(helperUrl(r.code));
      toast(ok ? "Helper link copied. Text it to them." : "Helper link: " + helperUrl(r.code));
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const stop = async () => { setBusy(true); try { await rpc("helper_stop", { t: t.id, m: m.id }); setSt(null); toast("Helper link stopped"); } catch (e) { setErr(errText(e)); } setBusy(false); };

  if (st === undefined) return <div className="helper-card"><b>Hand off to a parent</b><span className="small muted">Checking…</span></div>;
  if (st) {
    const url = helperUrl(st.code), sms = `sms:?&body=${encodeURIComponent(`Can you track our match on your phone? Open ${url} and tap who wins each point. Thanks!`)}`;
    return <div className="helper-card on">
      <b>{st.name || "A helper"} is tracking: {MODE_LABEL[st.mode]}</b>
      <span className="small muted">{ago(st.last_at)}. The link works for this match only{st.mode !== "stats" ? "; their points count, so don't tap points here" : "; you keep the score here"}.</span>
      <div className="row">
        <button className="btn sm primary" onClick={() => copyText(url).then((ok) => toast(ok ? "Link copied" : url))}>Copy link</button>
        <a className="btn sm" href={sms}>Text it</a>
        <QrButton url={url} title="Scan to track this match" label="QR code" />
        <ConfirmButton className="btn sm ghost" confirmText="Tap again to stop" onConfirm={stop}>Stop link</ConfirmButton>
      </div>
      <span className="small muted helper-url">{url.replace(/^https?:\/\//, "")}</span>
      {err && <span className="hint warn">{err}</span>}
    </div>;
  }
  return <div className="helper-card">
    <b>Hand off to a parent</b>
    <span className="small muted">Send a parent a link and they track this match on their phone: no account, no app. You get every play here and families see it on Live.</span>
    <label className="field"><span className="label">Who's helping? (optional)</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dana (Maya's mom)" /></label>
    <div className="pick" role="group" aria-label="What the helper tracks">{MODES.map(([k, l, d]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}<small style={{ display: "block", fontWeight: 400 }}>{d}</small></button>)}</div>
    <div className="row"><button className="btn sm primary" disabled={busy} onClick={make}>{busy ? "Making…" : "Make helper link"}</button></div>
    {mode !== "stats" && <span className="small muted">This device switches to stats only, so points aren't counted twice.</span>}
    {err && <span className="hint warn">{err}</span>}
  </div>;
}

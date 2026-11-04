/** Live tab: a score bug for the team's live stream. One link for the whole season; paste it into OBS, Streamlabs or vMix once. */
import { useState } from "react";
import { currentMatch, setTeamPatch, team, toast } from "../data/store";
import { Card, copyText, Seg } from "../ui/kit";
import { cloudAvailable, currentUser } from "./client";
import { ensureLiveShare, isLinked, roleOn, shareSeason } from "./sync";
import { go } from "../app/router";

type Size = "s" | "m" | "l"; type Pos = "bl" | "br" | "tl" | "tr";
const short = (name: string) => { const w = name.trim().split(/\s+/); return (w.length > 1 ? w.map((x) => x[0]).join("") : name.slice(0, 4)).toUpperCase().slice(0, 4); };
const KEY = (id: string) => "bs-overlay-" + id;

export function StreamOverlay() {
  const t = team()!, [base, setBase] = useState(() => { try { return localStorage.getItem(KEY(t.id)) || ""; } catch { return ""; } });
  const [size, setSize] = useState<Size>("m"), [pos, setPos] = useState<Pos>("bl"), [us, setUs] = useState(""), [sets, setSets] = useState(true), [busy, setBusy] = useState(false);
  if (!cloudAvailable() || t.sample) return null;
  const ready = !!currentUser() && isLinked(t.id) && (roleOn(t.id) === "owner" || roleOn(t.id) === "coach");
  const q = new URLSearchParams({ size, pos, ...(us.trim() ? { us: us.trim() } : {}), ...(sets ? {} : { sets: "0" }) }).toString();
  const url = base ? `${base}/overlay?${q}` : "";
  const make = async () => {
    setBusy(true);
    try {
      const r = await shareSeason(t.id, t.activeSeasonId!);
      setBase(r.url); try { localStorage.setItem(KEY(t.id), r.url); } catch { /* private mode */ }
      setTeamPatch({ streamOverlay: true });
      const m = currentMatch(); if (m && m.status === "live" && m.kind === "match") await ensureLiveShare(t.id, m.id);
      const ok = await copyText(`${r.url}/overlay?${q}`); toast(ok ? "Overlay link copied. Paste it into a Browser source." : "Overlay link made.");
    } catch (e: any) { toast(e?.message || "Couldn't make the link."); }
    setBusy(false);
  };
  return <Card title="Stream overlay">
    <p className="small" style={{ marginTop: 0 }}>Put the live score on your team's stream. In OBS, Streamlabs or vMix, add a <b>Browser source</b> with this link at 1920 × 1080. The background is see-through, it follows whichever match you're tracking all season, and it updates within a few seconds of each point.</p>
    {!ready ? <div className="row"><span className="small muted">Sign in and sync this team first (Team tab).</span><button className="btn sm" onClick={() => go("team")}>Go to Team</button></div> : <div className="stack">
      <div className="ov-opts">
        <div className="field"><span className="label">Size</span><Seg value={size} onChange={setSize} label="Overlay size" options={[["s", "Small"], ["m", "Medium"], ["l", "Large"]]} /></div>
        <div className="field"><span className="label">Corner</span><Seg value={pos} onChange={setPos} label="Overlay corner" options={[["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]]} /></div>
        <label className="field"><span className="label">Short name</span><input className="input" value={us} maxLength={14} onChange={(e) => setUs(e.target.value)} placeholder={short(t.name)} /></label>
        <label className="small row" style={{ gap: 6, alignSelf: "end" }}><input type="checkbox" checked={sets} onChange={(e) => setSets(e.target.checked)} /> Show finished set scores</label>
      </div>
      <div className="row">
        <button className={"btn sm" + (url ? "" : " primary")} disabled={busy || !t.activeSeasonId} onClick={make}>{busy ? "Making link…" : url ? "Copy overlay link" : "Make overlay link"}</button>
        {url && <a className="btn sm" href={url} target="_blank" rel="noopener">Preview</a>}
      </div>
      {url && <code className="ov-url">{url}</code>}
      {url && <p className="keys" style={{ margin: 0 }}>Opponent names come from each match. Change the size or corner here and copy the link again, or set them in the link: size=s|m|l, pos=bl|br|tl|tr.</p>}
    </div>}
  </Card>;
}

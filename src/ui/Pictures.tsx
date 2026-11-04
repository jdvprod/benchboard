/** Player photos and team logos: how they show, and the pickers that set them. */
import { useState } from "react";
import { Player } from "../data/model";
import { patch, team, toast } from "../data/store";
import { headShot, logoImage } from "../lib/image";
import { findLogos, LogoHit, regionOf } from "../lib/logoSearch";
import { storePicture, PicKind } from "../cloud/media";
import { isLinked, roleOn } from "../cloud/sync";
import { Avatar, TeamLogo } from "./Logo";
export { Avatar, TeamLogo };

const canUpload = (teamId: string) => isLinked(teamId) && (roleOn(teamId) === "owner" || roleOn(teamId) === "coach");
/** Take or choose a player's photo. Shows only with the family's permission (the note says so). */
export function PhotoPicker({ p, compact }: { p: Player; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File | null) => {
    if (!f) return; setBusy(true);
    try { const b = await headShot(f); patch("players", p.id, { photo: await storePicture(p.teamId, "player", p.id, b, canUpload(p.teamId)) }); toast(`Photo added for ${p.first || "#" + p.num}.`); }
    catch (e: any) { toast(e?.message || "Couldn't use that picture."); }
    setBusy(false);
  };
  const label = `${p.photo ? "Change" : "Add"} photo for ${p.first || "#" + p.num}`;
  return <span className="row" style={{ gap: 6 }}>
    <label className={"btn sm" + (compact ? " ghost icon-btn" : "")} style={{ cursor: "pointer" }} aria-label={compact ? label : undefined} title={compact ? label : undefined}>
      {compact ? <Avatar photo={p.photo} num={p.num} size={32} /> : busy ? "Saving…" : p.photo ? "Change photo" : "Add photo"}
      <input type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {!compact && p.photo && <button className="btn sm ghost" onClick={() => patch("players", p.id, { photo: undefined })}>Remove photo</button>}
  </span>;
}

/** Find a logo by name (Wikipedia, the school's Wikidata logo, its website icon) or upload one. */
export function LogoPicker({ kind, id, name, value, onPick, region }: { kind: PicKind; id: string; name: string; value?: string; onPick: (url: string | undefined, hit?: LogoHit) => void; region?: string }) {
  const t = team()!, [open, setOpen] = useState(false), [q, setQ] = useState(name), [hits, setHits] = useState<LogoHit[] | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const search = async (text = q) => {
    setBusy(true); setErr(""); setHits(null);
    try { const h = await findLogos(text, { region }); setHits(h); if (!h.length) setErr("No logos found. Try the school's full name, or upload one."); }
    catch { setErr("Couldn't search right now. Check your connection, or upload a logo."); }
    setBusy(false);
  };
  const upload = async (f?: File | null) => {
    if (!f) return; setBusy(true);
    try { onPick(await storePicture(t.id, kind, id, await logoImage(f), canUpload(t.id))); setOpen(false); } catch (e: any) { setErr(e?.message || "Couldn't use that picture."); }
    setBusy(false);
  };
  return <div className="logo-pick">
    <div className="row" style={{ gap: 10 }}>
      <TeamLogo src={value} name={name} size={48} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => { const o = !open; setOpen(o); if (o && !hits) { setQ(name); search(name); } }} aria-expanded={open}>{value ? "Change logo" : "Find logo"}</button>
        {value && <button className="btn sm ghost" onClick={() => onPick(undefined)}>Remove</button>}
      </div>
    </div>
    {open && <div className="logo-find">
      <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} aria-label="School or team name" placeholder="School or club name" />
        <button className="btn sm" disabled={busy || !q.trim()}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {hits && hits.length > 0 && <div className="logo-grid" role="list">{hits.map((h) => <button key={h.url} role="listitem" className={"logo-hit" + (value === h.url ? " on" : "")} onClick={() => { onPick(h.url, h); setOpen(false); }} aria-label={"Use " + h.label} title={h.label}>
        <img src={h.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLElement).closest(".logo-hit") as HTMLElement).style.display = "none"} /><span>{h.source === "Website" ? "Website icon" : h.title}</span></button>)}</div>}
      {err && <p className="small muted" style={{ margin: 0 }}>{err}</p>}
      <div className="row" style={{ gap: 8 }}>
        <label className="btn sm ghost" style={{ cursor: "pointer" }}>Upload a logo<input type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <span className="keys">From Wikipedia and school websites. Logos belong to their schools.</span>
      </div>
    </div>}
  </div>;
}

/** Our team's logo picker; picking a school from Wikipedia also remembers its region to find opponents' logos. */
export const teamLogoPick = (url: string | undefined, hit?: LogoHit) => { const t = team()!; patch("teams", t.id, { logo: url, ...(hit ? { region: regionOf(hit.title, hit.desc) || t.region } : {}) }); };

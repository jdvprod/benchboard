/** Player photos and team logos: the pickers that set them. Only coaches change them (on a synced team, the owner and
 * coaches; view-only accounts and the public sites only see them). Photos are framed in an editor; logos are trimmed
 * and centered so every logo sits the same way on its tile. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Player } from "../data/model";
import { patch, team, toast } from "../data/store";
import { canvasImage, cleanLogo, cropGeometry, framedPhoto, imageSize } from "../lib/image";
import { findLogos, LogoHit, regionOf } from "../lib/logoSearch";
import { storePicture, PicKind } from "../cloud/media";
import { isLinked, roleOn } from "../cloud/sync";
import { Avatar, TeamLogo } from "./Logo";
export { Avatar, TeamLogo };

const coach = (teamId: string) => roleOn(teamId) === "owner" || roleOn(teamId) === "coach";
const canUpload = (teamId: string) => isLinked(teamId) && coach(teamId);
/** Who may change pictures: anyone on a team that only lives on this device, otherwise its owner and coaches. */
export const canEditPictures = (teamId: string) => !isLinked(teamId) || coach(teamId);

/** Frame a photo: drag to move, zoom to fit the face, inside the same circle every photo uses. */
export function PhotoCropper({ file, name, onSave, onCancel }: { file: File; name: string; onSave: (b: Blob) => void; onCancel: () => void }) {
  const FRAME = 260, [url] = useState(() => URL.createObjectURL(file)), [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1), [off, setOff] = useState({ dx: 0, dy: 0 }), drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const g = nat ? cropGeometry(nat.w, nat.h, { zoom, dx: off.dx, dy: off.dy, frame: FRAME }) : null;
  const onLoad = (e: any) => { const w = e.target.naturalWidth, h = e.target.naturalHeight; setNat({ w, h }); if (h > w) { const s = FRAME / w; setOff({ dx: 0, dy: (h * s - FRAME) * 0.22 }); } };
  const move = (e: { clientX: number; clientY: number }) => { if (!drag.current) return; setOff({ dx: drag.current.dx + e.clientX - drag.current.x, dy: drag.current.dy + e.clientY - drag.current.y }); };
  const save = async () => { if (!g) return; setBusy(true); try { onSave(await framedPhoto(file, { zoom, dx: g.dx, dy: g.dy, frame: FRAME })); } catch (e: any) { toast(e?.message || "Couldn't save the photo."); setBusy(false); } };
  return createPortal(<div className="crop-back" role="dialog" aria-modal="true" aria-label={"Frame the photo of " + name} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
    <div className="crop-box">
      <h3 style={{ margin: 0 }}>Frame the photo</h3>
      <p className="small muted" style={{ margin: 0 }}>Drag to move. Head and shoulders inside the circle looks best.</p>
      <div className="crop-frame" style={{ width: FRAME, height: FRAME }} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, dx: g?.dx || 0, dy: g?.dy || 0 }; }} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <img src={url} alt="" draggable={false} onLoad={onLoad} style={g ? { width: nat!.w * g.scale, height: nat!.h * g.scale, transform: `translate(calc(-50% + ${g.dx}px), calc(-50% + ${g.dy}px))` } : { opacity: 0 }} />
        <span className="crop-ring" aria-hidden="true" />
      </div>
      <label className="field"><span className="label">Zoom</span><input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(+e.target.value)} aria-label="Zoom" /></label>
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={!g || busy} onClick={save}>{busy ? "Saving…" : "Save photo"}</button></div>
    </div>
  </div>, document.body);
}

/** Take or choose a player's photo (coaches only). */
export function PhotoPicker({ p, compact }: { p: Player; compact?: boolean }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false);
  const who = p.first || "#" + p.num;
  if (!canEditPictures(p.teamId)) return compact ? <Avatar photo={p.photo} num={p.num} size={32} /> : null;
  const choose = async (f?: File | null) => {
    if (!f) return;
    try { const s = await imageSize(f); if (Math.min(s.w, s.h) < 200) { toast("That picture is too small to look sharp. Use one at least 200 pixels across."); return; } setFile(f); }
    catch (e: any) { toast(e?.message || "Couldn't open that picture."); }
  };
  const save = async (b: Blob) => {
    setBusy(true);
    try { patch("players", p.id, { photo: await storePicture(p.teamId, "player", p.id, b, canUpload(p.teamId)) }); toast(`Photo saved for ${who}.`); }
    catch (e: any) { toast(e?.message || "Couldn't save the photo."); }
    setFile(null); setBusy(false);
  };
  const label = `${p.photo ? "Change" : "Add"} photo for ${who}`;
  return <span className="row" style={{ gap: 6 }}>
    <label className={"btn sm" + (compact ? " ghost icon-btn" : "")} style={{ cursor: "pointer" }} aria-label={compact ? label : undefined} title={compact ? label : undefined}>
      {compact ? <Avatar photo={p.photo} num={p.num} size={32} /> : busy ? "Saving…" : p.photo ? "Change photo" : "Add photo"}
      <input type="file" accept="image/*" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {!compact && p.photo && <button className="btn sm ghost" onClick={() => patch("players", p.id, { photo: undefined })}>Remove photo</button>}
    {file && <PhotoCropper file={file} name={who} onSave={save} onCancel={() => setFile(null)} />}
  </span>;
}

/** Find a logo by name (Wikipedia, the school's Wikidata logo, its website icon) or upload one (coaches only). */
export function LogoPicker({ kind, id, name, value, onPick, region }: { kind: PicKind; id: string; name: string; value?: string; onPick: (url: string | undefined, hit?: LogoHit) => void; region?: string }) {
  const t = team()!, [open, setOpen] = useState(false), [q, setQ] = useState(name), [hits, setHits] = useState<LogoHit[] | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [small, setSmall] = useState<Set<string>>(new Set());
  if (!canEditPictures(t.id)) return <TeamLogo src={value} name={name} size={48} />;
  const search = async (text = q) => {
    setBusy(true); setErr(""); setHits(null); setSmall(new Set());
    try { const h = await findLogos(text, { region }); setHits(h); if (!h.length) setErr("No logos found. Try the school's full name, or upload one."); }
    catch { setErr("Couldn't search right now. Check your connection, or upload a logo."); }
    setBusy(false);
  };
  // a found logo is trimmed, centered and saved as the team's own copy when its site allows it; otherwise it's linked
  const choose = async (h: LogoHit) => {
    setBusy(true);
    try { const img = await canvasImage(h.url); onPick(img ? await storePicture(t.id, kind, id, await cleanLogo(img), canUpload(t.id)) : h.url, h); setOpen(false); }
    catch { onPick(h.url, h); setOpen(false); }
    setBusy(false);
  };
  const upload = async (f?: File | null) => {
    if (!f) return; setBusy(true);
    try { onPick(await storePicture(t.id, kind, id, await cleanLogo(f), canUpload(t.id))); setOpen(false); } catch (e: any) { setErr(e?.message || "Couldn't use that picture."); }
    setBusy(false);
  };
  const shown = (hits || []).filter((h) => !small.has(h.url));
  return <div className="logo-pick">
    <div className="row" style={{ gap: 10 }}>
      <TeamLogo src={value} name={name} size={52} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => { const o = !open; setOpen(o); if (o && !hits) { setQ(name); search(name); } }} aria-expanded={open}>{value ? "Change logo" : "Find logo"}</button>
        {value && <button className="btn sm ghost" onClick={() => onPick(undefined)}>Remove</button>}
      </div>
    </div>
    {open && <div className="logo-find">
      <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} aria-label="School or team name" placeholder="School or club name" />
        <button className="btn sm" disabled={busy || !q.trim()}>{busy ? "Working…" : "Search"}</button>
      </form>
      {shown.length > 0 && <div className="logo-grid" role="list">{shown.map((h) => <button key={h.url} role="listitem" className="logo-hit" disabled={busy} onClick={() => choose(h)} aria-label={"Use " + h.label} title={h.label}>
        <span className="tlogo" style={{ width: 72, height: 72 }}><img src={h.url} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={(e) => { const i = e.target as HTMLImageElement; if (Math.max(i.naturalWidth, i.naturalHeight) < 48) setSmall((s) => new Set(s).add(h.url)); }} onError={() => setSmall((s) => new Set(s).add(h.url))} /></span>
        <span>{h.source === "Website" ? "Website icon" : h.title}</span></button>)}</div>}
      {hits && hits.length > 0 && !shown.length && <p className="small muted" style={{ margin: 0 }}>Nothing sharp enough came up. Upload the school's logo instead.</p>}
      {err && <p className="small muted" style={{ margin: 0 }}>{err}</p>}
      <div className="row" style={{ gap: 8 }}>
        <label className="btn sm ghost" style={{ cursor: "pointer" }}>Upload a logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <span className="keys">Best: a PNG with a see-through background. Found logos come from Wikipedia and school websites and belong to their schools.</span>
      </div>
    </div>}
  </div>;
}

/** Our team's logo picker; picking a school from Wikipedia also remembers its region to find opponents' logos. */
export const teamLogoPick = (url: string | undefined, hit?: LogoHit) => { const t = team()!; patch("teams", t.id, { logo: url, ...(hit ? { region: regionOf(hit.title, hit.desc) || t.region } : {}) }); };

/** Virtual Film Room, coach side: film sessions built from Film Room clips. Each clip gets a note and a drawing on a
 * frozen frame (telestrator); "Send to team" records every clip as a small video, uploads it and shares the session on
 * Jumpset Live, where players and families watch signed in and the coach sees who watched. */
import { PointerEvent, useEffect, useRef, useState } from "react";
import { patch, team, toast } from "../../data/store";
import { Match } from "../../data/model";
import { Card, copyText, plural } from "../../ui/kit";
import { QrButton } from "../../ui/QrButton";
import { clock } from "../../film/clips";
import { drawStrokes, FilmItem, FilmSession, FREEZE, itemLength, PENS, recordItem, sessionLength, Stroke, Tool } from "../../film/session";
import { cloudAvailable, currentUser, publicFileUrl, rpc, uploadFile } from "../../cloud/client";
import { isLinked, roleOn } from "../../cloud/sync";
import { siteUrl } from "../../cloud/links";

const sid = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
export const sessionsOf = (m: Match): FilmSession[] => m.sessions || [];
export function saveSession(m: Match, s: FilmSession) { const list = sessionsOf(m); patch("matches", m.id, { sessions: list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : list.concat(s) }); }
/** Add items to a session (a new one when `to` is "new"). Returns the session. */
export function addToSession(m: Match, to: string, items: FilmItem[], title: string): FilmSession {
  const cur = sessionsOf(m).find((x) => x.id === to);
  const s: FilmSession = cur ? { ...cur, items: cur.items.concat(items.filter((i) => !cur.items.some((c) => c.start === i.start && c.label === i.label))) } : { id: sid(), title: title || "Film session", items };
  saveSession(m, s); return s;
}

export function SessionsPanel({ m, src, open, setOpen, nowAt, lead }: { m: Match; src: string | null; open: string | null; setOpen: (id: string | null) => void; nowAt: () => number; lead: number }) {
  const list = sessionsOf(m), s = list.find((x) => x.id === open) || null;
  if (s) return <SessionEditor m={m} s={s} src={src} onBack={() => setOpen(null)} nowAt={nowAt} lead={lead} />;
  return <div className="stack">
    <p className="small muted">A film session is a set of clips for your players, each with your note and a drawing on the frozen frame. Send it to the team and they watch it on their phones; you see who watched.</p>
    <div className="row"><button className="btn primary" onClick={() => { const n = addToSession(m, "new", [], `vs ${m.opp}: film`); setOpen(n.id); }}>New film session</button>
      <span className="small muted">or ask for clips in Find clips and add them.</span></div>
    {list.length > 0 && <ul className="fr-list">{list.map((x) => <li key={x.id}><button onClick={() => setOpen(x.id)}><b>{x.title}</b>
      <span className="small muted">{plural(x.items.length, "clip")} · {clock(sessionLength(x))}{x.code ? " · sent to the team" : ""}</span></button></li>)}</ul>}
  </div>;
}

function SessionEditor({ m, s, src, onBack, nowAt, lead }: { m: Match; s: FilmSession; src: string | null; onBack: () => void; nowAt: () => number; lead: number }) {
  const [draw, setDraw] = useState<FilmItem | null>(null), [send, setSend] = useState<{ text: string; f: number } | null>(null), stop = useRef<AbortController | null>(null);
  const [viewers, setViewers] = useState<{ name: string; watched: number; last: string }[] | null>(null);
  const set = (p: Partial<FilmSession>) => saveSession(m, { ...s, ...p });
  const setItem = (id: string, p: Partial<FilmItem>) => set({ items: s.items.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= s.items.length) return; const n = s.items.slice(); [n[i], n[j]] = [n[j], n[i]]; set({ items: n }); };
  const role = roleOn(m.teamId), canSend = cloudAvailable() && !!currentUser() && isLinked(m.teamId) && (role === "owner" || role === "coach");
  const link = s.code ? siteUrl("live", "film/" + s.code) : "";
  useEffect(() => { if (s.code && canSend) rpc("film_viewers", { c: s.code }).then(setViewers).catch(() => setViewers(null)); }, [s.code, s.sharedAt]);

  const sendIt = async () => {
    if (!src || !s.items.length) return;
    stop.current = new AbortController();
    const total = sessionLength(s); let done = 0; const out: { label: string; note?: string; url: string; secs: number }[] = [];
    try {
      for (let i = 0; i < s.items.length; i++) {
        const it = s.items[i];
        const blob = await recordItem(src, it, { signal: stop.current.signal, onTime: (sec) => setSend({ text: `Recording clip ${i + 1} of ${s.items.length}: ${it.label}`, f: Math.min(0.98, (done + sec) / total) }) });
        setSend({ text: `Uploading clip ${i + 1} of ${s.items.length}`, f: Math.min(0.98, (done + itemLength(it)) / total) });
        const path = `film/${m.teamId}/${s.id}/${i}-${it.id}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
        await uploadFile(path, blob);
        out.push({ label: it.label, note: it.note || undefined, url: publicFileUrl(path) + "?v=" + Date.now().toString(36), secs: Math.round(itemLength(it)) });
        done += itemLength(it);
      }
      const t = team()!;
      const code: string = await rpc("film_share", { t: m.teamId, sid: s.id, d: { title: s.title, note: s.note || "", team: t.name, logo: t.logo || null, opp: m.opp, date: m.date, items: out } });
      set({ code, sharedAt: Date.now() }); setSend(null); toast("Sent. Share the link with the team.");
    } catch (e: any) { setSend(null); if (e?.name !== "AbortError") toast(e?.message || "Couldn't send the session."); }
  };

  return <div className="stack fr-sess">
    <div className="row"><button className="btn sm" onClick={onBack}>‹ Sessions</button></div>
    <label className="field"><span className="label">Session title</span><input value={s.title} onChange={(e) => set({ title: e.target.value })} /></label>
    <label className="field"><span className="label">Note to the team (optional)</span><textarea rows={2} value={s.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Watch where our blockers' hands are before the hitter swings." /></label>
    <div className="row"><button className="btn sm" disabled={!src} onClick={() => { const t = nowAt(); set({ items: s.items.concat({ id: "i" + Date.now().toString(36), start: Math.max(0, +(t - lead).toFixed(1)), end: +(t + 2).toFixed(1), label: "Clip " + (s.items.length + 1) }) }); }}>Add this moment</button>
      <span className="small muted">{plural(s.items.length, "clip")} · {clock(sessionLength(s))}</span></div>
    <ol className="fr-items">{s.items.map((it, i) => <li key={it.id}>
      <div className="fr-item-hd">
        <input className="input fr-item-label" value={it.label} onChange={(e) => setItem(it.id, { label: e.target.value })} aria-label="Clip title" />
        <span className="num small muted">{clock(it.start)}–{clock(it.end)}</span>
        <span className="fr-item-btns">
          <button className="btn sm" aria-label="Start 1 s earlier" onClick={() => setItem(it.id, { start: Math.max(0, it.start - 1) })}>−1 s</button>
          <button className="btn sm" aria-label="End 1 s later" onClick={() => setItem(it.id, { end: it.end + 1 })}>+1 s</button>
          <button className="btn sm" aria-label="Move up" disabled={!i} onClick={() => move(i, -1)}>↑</button>
          <button className="btn sm" aria-label="Move down" disabled={i === s.items.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button className="btn sm" aria-label="Remove clip" onClick={() => set({ items: s.items.filter((x) => x.id !== it.id) })}>✕</button>
        </span>
      </div>
      <textarea className="input" rows={2} value={it.note || ""} onChange={(e) => setItem(it.id, { note: e.target.value })} placeholder="What to watch for in this clip" aria-label="Coach's note" />
      <div className="row small"><button className="btn sm" disabled={!src} onClick={() => setDraw(it)}>{it.freeze?.strokes.length ? `Edit drawing (${it.freeze.strokes.length})` : "Draw on it"}</button>
        {it.freeze && <span className="muted">Freezes at {clock(it.freeze.at)} for {FREEZE} s</span>}</div>
    </li>)}</ol>
    {!s.items.length && <p className="empty">No clips yet. Ask for clips in Find clips and tap “Add to a film session”, or pause the video and tap “Add this moment”.</p>}
    <Card title="Send to the team">
      {!cloudAvailable() || !currentUser() ? <p className="small muted">Sign in to send film to the team.</p>
        : !isLinked(m.teamId) ? <p className="small muted">Sync this team first (Account → Sync this team) to send film.</p>
        : !canSend ? <p className="small muted">Only the team's coaches can send film.</p>
        : send ? <div className="fr-scan"><div className="fr-bar"><i style={{ width: Math.round(send.f * 100) + "%" }} /></div><span className="small">{send.text}</span><button className="btn sm" onClick={() => stop.current?.abort()}>Stop</button></div>
        : <div className="stack">
          <p className="small muted">Each clip is recorded with your note and drawing, about {clock(sessionLength(s))} in all, then uploaded. Players and families open it on Jumpset Live with a free account.</p>
          <div className="row"><button className="btn primary" disabled={!src || !s.items.length} onClick={sendIt}>{s.code ? "Send the updated session" : "Send to team"}</button>
            {link && <><button className="btn sm" onClick={() => copyText(link).then((ok) => toast(ok ? "Link copied. Paste it in the team chat." : "Couldn't copy here"))}>Copy link</button><QrButton url={link} title={s.title} label="QR code" />
              <button className="btn sm ghost" onClick={async () => { try { await rpc("film_unshare", { c: s.code }); set({ code: undefined, sharedAt: undefined }); setViewers(null); toast("Taken down. The link no longer opens."); } catch (e: any) { toast(e?.message || "Couldn't take it down."); } }}>Take down</button></>}</div>
          {link && <p className="small">Link: <a href={link} target="_blank" rel="noopener">{link}</a></p>}
          {viewers && <div className="fr-viewers"><b className="small">{viewers.length ? `Watched by ${plural(viewers.length, "person", "people")}` : "Nobody has opened it yet"}</b>
            {viewers.length > 0 && <ul>{viewers.map((v) => <li key={v.name + v.last}><span>{v.name}</span><span className="small muted">{v.watched} of {s.items.length} clips</span></li>)}</ul>}</div>}
        </div>}
    </Card>
    {draw && src && <Telestrator src={src} item={draw} onClose={() => setDraw(null)} onSave={(freeze) => { setItem(draw.id, { freeze }); setDraw(null); }} />}
  </div>;
}

/* ---------- telestrator: draw on a frozen frame ---------- */
const TOOLS: [Tool, string][] = [["arrow", "Arrow"], ["circle", "Circle"], ["line", "Line"], ["pen", "Pen"]];
function Telestrator({ src, item, onClose, onSave }: { src: string; item: FilmItem; onClose: () => void; onSave: (f: { at: number; strokes: Stroke[] }) => void }) {
  const vid = useRef<HTMLVideoElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [at, setAt] = useState(item.freeze?.at ?? Math.max(item.start, item.end - 2)), [strokes, setStrokes] = useState<Stroke[]>(item.freeze?.strokes || []);
  const [tool, setTool] = useState<Tool>("arrow"), [color, setColor] = useState(PENS[0]), cur = useRef<Stroke | null>(null), [, tick] = useState(0);
  useEffect(() => { const v = vid.current; if (!v) return; const go = () => { v.currentTime = at; }; if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true }); }, [at]);
  useEffect(() => { const c = cv.current; if (!c) return; const g = c.getContext("2d")!; g.clearRect(0, 0, c.width, c.height); drawStrokes(g, cur.current ? strokes.concat(cur.current) : strokes, c.width, c.height); });
  const pt = (e: PointerEvent<HTMLCanvasElement>): [number, number] => { const r = cv.current!.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  const down = (e: PointerEvent<HTMLCanvasElement>) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = pt(e); cur.current = { tool, color, pts: [p, p] }; tick((x) => x + 1); };
  const moveP = (e: PointerEvent<HTMLCanvasElement>) => { if (!cur.current) return; const p = pt(e); if (tool === "pen") cur.current.pts.push(p); else cur.current.pts[1] = p; tick((x) => x + 1); };
  const up = () => { const s = cur.current; cur.current = null; if (s && (Math.abs(s.pts[0][0] - s.pts[s.pts.length - 1][0]) + Math.abs(s.pts[0][1] - s.pts[s.pts.length - 1][1]) > 0.01 || s.pts.length > 3)) setStrokes((x) => x.concat({ ...s, pts: s.tool === "pen" ? s.pts.filter((_, i) => i % 2 === 0 || i === s.pts.length - 1) : [s.pts[0], s.pts[s.pts.length - 1]] })); tick((x) => x + 1); };
  return <div className="fr-tele" role="dialog" aria-modal="true" aria-label="Draw on the frame">
    <div className="fr-tele-in">
      <div className="fr-tele-stage">
        <video ref={vid} src={src} muted playsInline preload="auto" />
        <canvas ref={cv} width={1280} height={720} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} aria-label="Drawing area" />
      </div>
      <div className="fr-tele-bar">
        <label className="row small" style={{ gap: 6 }}>Freeze at <input type="range" min={item.start} max={item.end} step={0.1} value={at} onChange={(e) => setAt(+e.target.value)} aria-label="Freeze frame time" /><span className="num">{clock(at)}</span></label>
        <div className="row" role="group" aria-label="Tool">{TOOLS.map(([k, l]) => <button key={k} className={"btn sm" + (tool === k ? " primary" : "")} aria-pressed={tool === k} onClick={() => setTool(k)}>{l}</button>)}</div>
        <div className="row" role="group" aria-label="Color">{PENS.map((c) => <button key={c} className={"fr-pen" + (color === c ? " on" : "")} style={{ background: c }} aria-label={"Color " + c} aria-pressed={color === c} onClick={() => setColor(c)} />)}</div>
        <div className="row"><button className="btn sm" disabled={!strokes.length} onClick={() => setStrokes((x) => x.slice(0, -1))}>Undo</button><button className="btn sm" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear</button>
          <span className="grow" /><button className="btn sm" onClick={onClose}>Cancel</button><button className="btn sm primary" onClick={() => onSave({ at, strokes })}>Save drawing</button></div>
      </div>
    </div>
  </div>;
}

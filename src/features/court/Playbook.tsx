/** Playbook: the 3D court as a board. Pick a defense, blocking scheme, serve-receive shape or hitting play, drag players, draw routes, run it, and save your own. */
import { useEffect, useRef, useState } from "react";
import { patch, team, toast, uid } from "../../data/store";
import { cloudAvailable, currentUser, rpc } from "../../cloud/client";
import { isLinked, roleOn } from "../../cloud/sync";
import { blankPlay, KIND_LABEL, LIBRARY, Play, PlayKind } from "../../sports/volleyball/playbook";
import { along, Court3D } from "../../ui/Court3D";
import { Card, download, Seg } from "../../ui/kit";
import { svgToPng } from "../../lib/svgPng";

const copy = (p: Play): Play => JSON.parse(JSON.stringify(p));

export function Playbook() {
  const t = team()!, mine = t.plays || [];
  const [play, setPlay] = useState<Play>(() => copy(LIBRARY[1]));
  const [src, setSrc] = useState(LIBRARY[1].id), [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<"move" | "route">("move");
  const [k, setK] = useState(0), raf = useRef(0); // 0 = start spots, 1 = everyone at the end of her route
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const open = (p: Play) => { cancelAnimationFrame(raf.current); setK(0); setPlay(copy(p)); setSrc(p.id); setDirty(false); };
  const edit = (f: (p: Play) => void) => { const n = copy(play); f(n); setPlay(n); setDirty(true); };
  const hasRoutes = play.spots.some((s) => s.to);
  const run = () => {
    cancelAnimationFrame(raf.current); const t0 = performance.now();
    const step = (now: number) => { const e = now - t0; setK(e < 1100 ? e / 1100 : e < 2300 ? 1 : 0); if (e < 2300) raf.current = requestAnimationFrame(step); };
    raf.current = requestAnimationFrame(step);
  };
  const ease = k * k * (3 - 2 * k), running = k > 0;
  const pegs = play.spots.map((s) => { const [x, y] = s.to ? along(s.x, s.y, s.to, s.via, ease) : [s.x, s.y]; return { num: s.r, name: s.name, lib: s.lib, x, y, to: running ? null : s.to, via: s.via }; });
  const saved = mine.some((m) => m.id === src);
  const save = () => {
    const name = play.name.trim() || "My play";
    if (saved) setMine(mine.map((m) => (m.id === src ? { ...copy(play), id: src, kind: "mine" as PlayKind, name, shared: m.shared } : m)));
    else { const id = uid("pl"); setMine([...mine, { ...copy(play), id, kind: "mine" as PlayKind, name: LIBRARY.some((l) => l.name === name) ? name + " (mine)" : name }]); setSrc(id); }
    setDirty(false);
  };
  // sharing: the plays marked shared are what players see on FloorCall Live (signed in, by the team page)
  const role = roleOn(t.id), canShare = cloudAvailable() && !!currentUser() && isLinked(t.id) && (role === "owner" || role === "coach");
  const publish = (list: Play[]) => { if (canShare) rpc("plays_publish", { t: t.id, d: list.filter((p) => p.shared).map((p) => ({ id: p.id, name: p.name, note: p.note, spots: p.spots, ball: p.ball || null })) }).catch((e) => toast(e?.message || "Couldn't update the team's plays. Check your connection.")); };
  const setMine = (list: Play[]) => { patch("teams", t.id, { plays: list }); if (list.some((p) => p.shared) || mine.some((p) => p.shared)) publish(list); };
  // a picture of the play as it's shown (camera angle included) to text the team or drop in a slide
  const picture = async () => {
    const svg = document.querySelector<SVGSVGElement>(".pb .c3d"); if (!svg) return;
    try { const b = await svgToPng(svg, 2, "#0B1117", { title: play.name, sub: `${t.name.toUpperCase()} · FLOORCALL PLAYBOOK` }), name = `${play.name} play.png`.replace(/[^\w\- .]+/g, ""), file = new File([b], name, { type: "image/png" }), nav: any = navigator;
      if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: play.name }); return; } catch { /* cancelled: save instead */ } }
      download(name, b, "image/png"); toast("Picture saved.");
    } catch { toast("Couldn't make the picture here."); }
  };
  const remove = () => { setMine(mine.filter((m) => m.id !== src)); open(LIBRARY[0]); };
  const cur = mine.find((m) => m.id === src);
  const share = (on: boolean) => { setMine(mine.map((m) => (m.id === src ? { ...m, shared: on } : m))); toast(on ? "Shared. Players see it under Plays on your team's Live page, signed in." : "No longer shared with the team."); };
  const groups: [PlayKind, Play[]][] = [["mine", mine], ...(["defense", "block", "receive", "attack"] as PlayKind[]).map((g): [PlayKind, Play[]] => [g, LIBRARY.filter((p) => p.kind === g)])];

  return <div className="pb">
    <Card title={play.name + (dirty ? " (edited)" : "")} actions={<Seg value={tool} onChange={setTool} options={[["move", "Move players"], ["route", "Draw routes"]]} label="Tool" />}>
      <Court3D pegs={pegs} ball={play.ball} tool={tool} label={`${play.name}: ${play.spots.map((s) => s.name).join(", ")}`}
        onMove={running ? undefined : (i, x, y) => edit((p) => { p.spots[i].x = x; p.spots[i].y = y; })}
        onRoute={running ? undefined : (i, to, via) => edit((p) => { p.spots[i].to = to; p.spots[i].via = to ? via || null : null; })} />
      <div className="pb-bar">
        <button className="btn primary" onClick={run} disabled={!hasRoutes || running}>Run it</button>
        <button className="btn" onClick={() => edit((p) => p.spots.forEach((s) => { s.to = null; s.via = null; }))} disabled={!hasRoutes}>Clear routes</button>
        <button className="btn" onClick={picture} disabled={running}>Save picture</button>
        <button className="btn" onClick={() => open([...mine, ...LIBRARY].find((p) => p.id === src) || blankPlay())} disabled={!dirty}>Reset</button>
        <span className="pb-gap" />
        <input className="input" value={play.name} onChange={(e) => edit((p) => { p.name = e.target.value; })} aria-label="Play name" maxLength={40} />
        <button className="btn" onClick={save} disabled={saved && !dirty}>{saved ? "Save changes" : "Save to my plays"}</button>
        {saved && <button className="btn danger" onClick={remove}>Delete</button>}
      </div>
      {saved && (canShare ? <label className="pb-share"><input type="checkbox" checked={!!cur?.shared} onChange={(e) => share(e.target.checked)} /> Share with the team on FloorCall Live <span className="muted">(players and families who are signed in)</span></label>
        : <p className="keys pb-share">To share plays with your players, sign in and sync this team (Team → Account).</p>)}
      <textarea className="input pb-note" rows={2} value={play.note} placeholder="Notes for this play: who has tips, what to call, when to use it." onChange={(e) => edit((p) => { p.note = e.target.value; })} aria-label="Notes" />
      <p className="keys">Dashed arrows show where a player goes; Run it plays the movement. These are the common textbook shapes. Move anyone to match how your team plays it, then save your version.</p>
    </Card>
    <Card title="Playbook">
      <div className="pb-lib">
        <button className={"pb-item new" + (src === "" ? " on" : "")} onClick={() => open(blankPlay())}>Start a new play</button>
        {groups.map(([g, list]) => (g !== "mine" || list.length > 0) && <div key={g} className="pb-group">
          <h3>{KIND_LABEL[g]}</h3>
          {list.map((p) => <button key={p.id} className={"pb-item" + (src === p.id ? " on" : "")} aria-pressed={src === p.id} onClick={() => open(p)}>{p.name}{p.shared && <span className="pb-shared"> · shared</span>}</button>)}
        </div>)}
      </div>
    </Card>
  </div>;
}

/** Tryouts: put in the candidates, rate them skill by skill (every evaluator on their own phone), merge the
 * evaluators' files, rank, decide, and turn the offers into a team. Kept on this device. */
import { useRef, useState } from "react";
import { createTeam, get, save, toast, todayISO, uid } from "../../data/store";
import { Player } from "../../data/model";
import { currentUser, userMeta } from "../../cloud/client";
import { go } from "../../app/router";
import { Card, ConfirmButton, download, fmtDate, Seg } from "../../ui/kit";
import { JoinTryout, StaffCard, useEvaluatorSync, useStaffPublish } from "./TryoutShare";
export { JoinTryout };
import { Candidate, Decision, mergeTryout, newTryout, parseCandidates, rank, ratingSheetHtml, staffNotes, Tryout, tryoutCsv } from "./tryouts";

const KEY = "tryouts";
const loadAll = (): Tryout[] => (get("kv", KEY)?.value as Tryout[]) || [];
const saveAll = (list: Tryout[]) => save("kv", { id: KEY, value: list });
const myName = () => { try { return localStorage.getItem("fc-evaluator") || (currentUser() ? userMeta().name : "") || ""; } catch { return ""; } };
const DEC: [Decision, string][] = [["offer", "Offer"], ["maybe", "Maybe"], ["cut", "Not this time"]];
type Tab = "players" | "rate" | "rank";

export function TryoutsPage({ id }: { id?: string }) {
  const list = loadAll(), t = list.find((x) => x.id === id);
  if (!t) return <TryoutList list={list} />;
  return <TryoutView t={t} onChange={(n) => saveAll(list.map((x) => (x.id === n.id ? n : x)))} onDelete={() => { saveAll(list.filter((x) => x.id !== t.id)); go("tryouts"); }} />;
}

function TryoutList({ list }: { list: Tryout[] }) {
  const [name, setName] = useState(""), [date, setDate] = useState(todayISO());
  return <div className="page">
    <div className="pagehead"><h1>Tryouts</h1></div>
    <div className="grid2">
      <Card title="Start a tryout">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); const t = newTryout(name || "Tryouts " + fmtDate(date), date, uid("tr")); saveAll([t, ...list]); go("tryouts", t.id); }}>
          <label className="field"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="16U tryouts" /></label>
          <label className="field"><span className="label">Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <button className="btn primary">Start</button>
        </form>
        <p className="keys">Add the players trying out, then every evaluator rates them 1 to 5 on each skill from their own phone. Floorcall ranks them and turns your offers into a roster. Kept on this device; share ratings as a file.</p>
      </Card>
      <Card title="Rating for another coach?"><form className="row" onSubmit={(e) => { e.preventDefault(); const v = ((e.target as HTMLFormElement).elements.namedItem("jc") as HTMLInputElement).value.trim().toUpperCase(); if (v) go("tryout-join", v); }}>
        <input name="jc" className="input" placeholder="Code" aria-label="Tryout code" maxLength={8} style={{ textTransform: "uppercase", maxWidth: 160 }} /><button className="btn">Join</button></form>
        <p className="keys">Enter the code the head coach gave you. Your ratings go to them only.</p></Card>
      <Card title="Your tryouts">{!list.length ? <p className="small muted">None yet.</p> : <ul className="ty-list">{list.map((t) => <li key={t.id}><a href={"#/tryouts/" + t.id}><b>{t.name}</b><span className="small muted">{fmtDate(t.date)} · {t.candidates.length} players · {Object.keys(t.ratings).length} {Object.keys(t.ratings).length === 1 ? "evaluator" : "evaluators"}</span></a></li>)}</ul>}</Card>
    </div>
  </div>;
}

function TryoutView({ t, onChange, onDelete }: { t: Tryout; onChange: (t: Tryout) => void; onDelete: () => void }) {
  const [tab, setTab] = useState<Tab>(t.candidates.length ? "rate" : "players"), [ev, setEv] = useState(myName);
  const setEvName = (n: string) => { setEv(n); try { localStorage.setItem("fc-evaluator", n); } catch { /* fine */ } };
  const sync = useEvaluatorSync(t, ev); useStaffPublish(t);
  if (t.role === "evaluator") return <div className="page">
    <div className="pagehead"><div><a className="small ty-back" href="#/tryouts">‹ All tryouts</a><h1 style={{ margin: 0 }}>{t.name}</h1><span className="muted">{t.candidates.length} players · rating for the head coach</span></div>
      <span className={"small ty-sync " + sync} role="status">{sync === "saving" ? "Saving…" : sync === "saved" ? "Sent to the head coach" : sync === "offline" ? "Not sent yet: no connection" : ""}</span></div>
    <Rate t={t} onChange={onChange} ev={ev} setEv={setEvName} lockName />
  </div>;
  return <div className="page">
    <div className="pagehead"><div><a className="small ty-back" href="#/tryouts">‹ All tryouts</a><h1 style={{ margin: 0 }}>{t.name}</h1><span className="muted">{fmtDate(t.date)} · {t.candidates.length} players</span></div>
      <ConfirmButton className="btn sm ghost" confirmText="Tap again to delete" onConfirm={onDelete}>Delete</ConfirmButton></div>
    <Seg value={tab} onChange={setTab} label="Tryout section" options={[["players", `Players (${t.candidates.length})`], ["rate", "Rate"], ["rank", "Rankings"]]} />
    <div style={{ marginTop: 14 }}>
      {tab === "players" && <Players t={t} onChange={onChange} />}
      {tab === "rate" && <Rate t={t} onChange={onChange} ev={ev} setEv={setEvName} />}
      {tab === "rank" && <><StaffCard t={t} onChange={onChange} ev={ev} /><div style={{ height: 14 }} /><Rankings t={t} onChange={onChange} ev={ev} /></>}
    </div>
  </div>;
}

function Players({ t, onChange }: { t: Tryout; onChange: (t: Tryout) => void }) {
  const [text, setText] = useState(""), set = (c: Candidate, p: Partial<Candidate>) => onChange({ ...t, candidates: t.candidates.map((x) => (x.id === c.id ? { ...x, ...p } : x)) });
  const dup = new Set(t.candidates.map((c) => c.bib).filter((b, i, a) => b && a.indexOf(b) !== i));
  const add = () => { const n = parseCandidates(text, t.candidates, () => uid("c")); if (!n.length) return; onChange({ ...t, candidates: t.candidates.concat(n) }); setText(""); toast(`Added ${n.length} ${n.length === 1 ? "player" : "players"}.`); };
  return <div className="grid2">
    <Card title="Add players">
      <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"One per line: bib, name, position, grade\n12 Maya Chen OH 10th\n13 Ava Ramirez S Jr"} aria-label="Players trying out, one per line" />
      <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={!text.trim()} onClick={add}>Add</button><span className="small muted">No bib? Floorcall numbers them.</span></div>
    </Card>
    <Card title="Skills">
      <p className="small muted" style={{ marginTop: 0 }}>Rated 1 to 5. Weight a skill to count it more in the ranking.</p>
      <ul className="ty-skills">{t.skills.map((k) => <li key={k}><span>{k}</span>
        <select className="input" aria-label={`Weight for ${k}`} value={t.weights[k] ?? 1} onChange={(e) => onChange({ ...t, weights: { ...t.weights, [k]: +e.target.value } })}>{[0, 1, 2, 3].map((w) => <option key={w} value={w}>{w === 0 ? "Not counted" : `×${w}`}</option>)}</select>
        <button className="btn sm ghost" aria-label={"Remove " + k} onClick={() => onChange({ ...t, skills: t.skills.filter((x) => x !== k) })}>✕</button></li>)}</ul>
      <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); const f = (e.target as HTMLFormElement).elements.namedItem("sk") as HTMLInputElement; const v = f.value.trim().slice(0, 30); if (v && !t.skills.includes(v)) onChange({ ...t, skills: t.skills.concat(v) }); f.value = ""; }}>
        <input name="sk" className="input" placeholder="Another skill" aria-label="Another skill" /><button className="btn sm">Add skill</button></form>
    </Card>
    {dup.size > 0 && <p className="banner span2" role="alert" style={{ borderLeft: "4px solid var(--bad)" }}>Two players share bib {[...dup].join(", ")}. Give each a different bib so ratings and staff files line up.</p>}
    {t.candidates.length > 0 && <Card title={`Trying out (${t.candidates.length})`} className="span2" actions={<button className="btn sm" onClick={() => printSheet(t)}>Print rating sheet</button>}>
      <div className="tbl"><table><thead><tr><th>Bib</th><th className="l">Name</th><th>Pos</th><th>Grade</th><th className="l">Note</th><th /></tr></thead>
        <tbody>{t.candidates.map((c) => <tr key={c.id}>
          <td><input className={"input ty-bib" + (dup.has(c.bib) ? " dup" : "")} title={dup.has(c.bib) ? "Two players have this bib" : undefined} aria-label={`Bib for ${c.name}`} value={c.bib} onChange={(e) => set(c, { bib: e.target.value.slice(0, 4) })} /></td>
          <td className="l">{c.name}</td><td>{c.pos || "–"}</td><td>{c.grade || "–"}</td>
          <td className="l"><input className="input" aria-label={`Note on ${c.name}`} value={c.note} onChange={(e) => set(c, { note: e.target.value.slice(0, 200) })} placeholder="Note" /></td>
          <td><ConfirmButton className="btn sm ghost" confirmText="Remove?" onConfirm={() => onChange({ ...t, candidates: t.candidates.filter((x) => x.id !== c.id) })}><span aria-label={"Remove " + c.name}>✕</span></ConfirmButton></td></tr>)}</tbody></table></div>
    </Card>}
  </div>;
}

/** Skill first, then down the list: how tryouts run (a serving station, a passing station). Big buttons for gym use. */
function Rate({ t, onChange, ev, setEv, lockName = false }: { t: Tryout; onChange: (t: Tryout) => void; ev: string; setEv: (n: string) => void; lockName?: boolean }) {
  const [skill, setSkill] = useState(t.skills[0] || ""), [q, setQ] = useState("");
  if (!t.candidates.length) return <p className="empty">Add the players trying out first (Players).</p>;
  if (!t.skills.length) return <p className="empty">Add at least one skill to rate (Players → Skills).</p>;
  if (!ev.trim()) return <Card title="Who's rating?"><form className="row" onSubmit={(e) => { e.preventDefault(); const v = ((e.target as HTMLFormElement).elements.namedItem("ev") as HTMLInputElement).value.trim(); if (v) setEv(v.slice(0, 40)); }}>
    <input name="ev" className="input" placeholder="Your name" aria-label="Your name as an evaluator" /><button className="btn primary">Start rating</button></form>
    <p className="keys">Each evaluator's ratings are kept separately and averaged in the rankings.</p></Card>;
  const mine = t.ratings[ev] || {}, rate = (c: Candidate, v: number) => {
    const cur = mine[c.id]?.[skill], next = { ...(mine[c.id] || {}) }; if (cur === v) delete next[skill]; else next[skill] = v;
    onChange({ ...t, ratings: { ...t.ratings, [ev]: { ...mine, [c.id]: next } } });
  };
  const done = t.candidates.filter((c) => typeof mine[c.id]?.[skill] === "number").length;
  const shown = t.candidates.filter((c) => !q || c.bib === q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return <div className="stack">
    <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
      <label className="field" style={{ minWidth: 200 }}><span className="label">Skill</span><select className="input" value={skill} onChange={(e) => setSkill(e.target.value)}>{t.skills.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      <label className="field" style={{ minWidth: 160 }}><span className="label">Find</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bib or name" /></label>
      <span className="small muted">Rating as <b>{ev}</b>{!lockName && <> · <button className="btn sm ghost" onClick={() => setEv("")}>Change</button></>} · {done}/{t.candidates.length} rated on {skill}</span>
    </div>
    <ul className="ty-rate">{shown.map((c) => { const v = mine[c.id]?.[skill]; return <li key={c.id} className={typeof v === "number" ? "done" : ""}>
      <span className="ty-who"><b className="num">{c.bib}</b> {c.name}{c.pos && <span className="muted small"> {c.pos}</span>}</span>
      <NoteButton note={t.evNotes?.[ev]?.[c.id] || ""} who={c.name} onSave={(n) => onChange({ ...t, evNotes: { ...(t.evNotes || {}), [ev]: { ...(t.evNotes?.[ev] || {}), [c.id]: n } } })} />
      <span className="ty-scale" role="group" aria-label={`${skill} for ${c.name}`}>{[1, 2, 3, 4, 5].map((n) => <button key={n} aria-pressed={v === n} aria-label={`${n} of 5`} className={v === n ? "on" : ""} onClick={() => rate(c, n)}>{n}</button>)}</span>
    </li>; })}</ul>
  </div>;
}

function Rankings({ t, onChange, ev }: { t: Tryout; onChange: (t: Tryout) => void; ev: string }) {
  const [pos, setPos] = useState(""), file = useRef<HTMLInputElement>(null), [teamName, setTeamName] = useState("");
  const rows = rank(t).filter((r) => !pos || r.c.pos === pos), positions = [...new Set(t.candidates.map((c) => c.pos).filter(Boolean))].sort();
  const setDec = (c: Candidate, d: Decision) => onChange({ ...t, candidates: t.candidates.map((x) => (x.id === c.id ? { ...x, decision: d } : x)) });
  const offers = t.candidates.filter((c) => c.decision === "offer"), evs = Object.keys(t.ratings);
  const fmt = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  const share = () => { const mine = { ...t, ratings: ev && t.ratings[ev] ? { [ev]: t.ratings[ev] } : t.ratings, evNotes: ev && t.evNotes?.[ev] ? { [ev]: t.evNotes[ev] } : t.evNotes }; download(`${t.name} ratings${ev ? " " + ev : ""}.json`.replace(/[^\w\- .]+/g, ""), JSON.stringify({ floorcallTryout: 1, tryout: mine }), "application/json"); toast("Ratings file saved. Send it to the head coach, who adds it here."); };
  const merge = async (f: File) => {
    try { const j = JSON.parse(await f.text()); if (j?.floorcallTryout !== 1 || !j.tryout?.candidates) throw 0;
      const r = mergeTryout(t, j.tryout as Tryout, () => uid("c")); onChange(r.t); toast(`Added ${r.ratings} ratings${r.added ? ` and ${r.added} new players` : ""}.`); }
    catch { toast("That isn't a Floorcall tryout ratings file."); }
  };
  const makeTeam = () => {
    const name = teamName.trim() || t.name; const team = createTeam({ name });
    for (const c of offers) { const [f, ...l] = c.name.split(/\s+/); save("players", { id: uid("p"), teamId: team.id, num: "", first: f || c.name, last: l.join(" "), pos: ({ MH: "MB", RS: "OPP", LIB: "L", DS: "L" } as Record<string, string>)[c.pos] || c.pos || "OH", grad: null, height: "", active: true, goals: [], notes: c.note } as Player); }
    toast(`${name} created with ${offers.length} players. Add jersey numbers on the Team page.`); go("team");
  };
  return <div className="stack">
    <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {positions.length > 1 && <select className="input" aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value)} style={{ width: "auto" }}><option value="">All positions</option>{positions.map((p) => <option key={p}>{p}</option>)}</select>}
        <span className="small muted">{evs.length ? `${evs.length} ${evs.length === 1 ? "evaluator" : "evaluators"}: ${evs.join(", ")}` : "No ratings yet"}</span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={share} disabled={!evs.length}>Share my ratings</button>
        <button className="btn sm" onClick={() => file.current?.click()}>Add ratings from a file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) merge(f); e.target.value = ""; }} aria-label="Ratings file" />
        <button className="btn sm" disabled={!t.candidates.length} onClick={() => download(`${t.name} rankings.csv`.replace(/[^\w\- .]+/g, ""), tryoutCsv(t), "text/csv")}>Spreadsheet</button>
      </div>
    </div>
    {!rows.length ? <p className="empty">No players yet.</p> : <div className="tbl"><table className="ty-rank"><thead><tr><th>#</th><th>Bib</th><th className="l">Name</th><th>Pos</th><th>Score</th>{t.skills.map((k) => <th key={k} title={k} className="sk">{k.slice(0, 4)}</th>)}<th className="l">Decision</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.c.id} className={r.c.decision}>
        <td>{i + 1}</td><td className="num">{r.c.bib}</td><td className="l"><b>{r.c.name}</b>{r.spread !== null && r.spread >= 1.5 && <span className="ty-split" title="Evaluators disagree by 1.5 or more"> · split</span>}{r.c.note && <div className="small muted">{r.c.note}</div>}{staffNotes(t, r.c.id).map((n) => <div key={n} className="small ty-snote">{n}</div>)}</td><td>{r.c.pos || "–"}</td>
        <td><b>{fmt(r.score)}</b></td>{t.skills.map((k) => <td key={k} className="sk">{fmt(r.bySkill[k])}</td>)}
        <td className="l"><select className="input ty-dec" aria-label={`Decision for ${r.c.name}`} value={r.c.decision} onChange={(e) => setDec(r.c, e.target.value as Decision)}><option value="">Undecided</option>{DEC.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      </tr>)}</tbody></table></div>}
    {offers.length > 0 && <Card title={`Make the team (${offers.length} offers)`}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}><input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={t.name} aria-label="New team name" style={{ flex: "1 1 200px" }} />
        <button className="btn primary" onClick={makeTeam}>Create team with {offers.length} {offers.length === 1 ? "player" : "players"}</button></div>
      <p className="keys">Creates a new team with everyone marked Offer, positions and notes included.</p>
    </Card>}
    <p className="keys">Score is the average of each evaluator's weighted rating. "Split" marks players the evaluators saw very differently: worth another look.</p>
  </div>;
}

/** Paper backup for evaluators who'd rather write: opens the sheet to print (or saves it if pop-ups are blocked). */
function printSheet(t: Tryout) {
  const html = ratingSheetHtml(t, myName()), w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch { /* they can print from the page */ } }, 300); return; }
  download(`${t.name} rating sheet.html`.replace(/[^\w\- .]+/g, ""), html, "text/html"); toast("Saved the sheet. Open it to print.");
}

/** A short note on a player from this evaluator ("strong arm, late on footwork"), opened from a small button. */
function NoteButton({ note, who, onSave }: { note: string; who: string; onSave: (n: string) => void }) {
  const [open, setOpen] = useState(false), [v, setV] = useState(note);
  if (!open) return <button className={"btn sm ghost ty-notebtn" + (note ? " has" : "")} aria-label={(note ? "Edit note on " : "Add a note on ") + who} title={note || "Add a note"} onClick={() => { setV(note); setOpen(true); }}>{note ? "Note ✓" : "Note"}</button>;
  return <form className="ty-note" onSubmit={(e) => { e.preventDefault(); onSave(v.trim().slice(0, 300)); setOpen(false); }}>
    <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="Strong arm, late on footwork" aria-label={"Note on " + who} maxLength={300} />
    <button className="btn sm primary">Save</button></form>;
}

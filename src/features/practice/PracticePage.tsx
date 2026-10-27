/** Practice: plan builder with drill library, stat-based focus, scrimmages and drill tracking. */
import { useEffect, useState } from "react";
import { activePlayers, currentMatch, drillsOf, get, matchesOf, newMatch, patch, plansOf, remove, replayOf, save, setTeamPatch, team, toast, todayISO, uid } from "../../data/store";
import { Drill, DRILL_CATEGORIES, PlanBlock, PracticePlan } from "../../data/model";
import { aggregate } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, fmtSigned, teamMetrics } from "../../sports/volleyball/metrics";
import { Card, ConfirmButton, copyText, download, fmtDate, Seg } from "../../ui/kit";
import { Tracker } from "../track/Tracker";
import { balancedSplit, SplitEditor, SplitState } from "./SplitEditor";
import { askJson, aiAvailable, AiError, AI_ERRORS } from "../../ai/client";
import { practiceSuggestPrompt } from "../../ai/prompts";
import { setUi } from "../../app/ui";
import { go } from "../../app/router";

const CAT_COLOR: Record<string, string> = {
  "Warm-up": "#C3C8CE", Serving: "#2B79B0", "Serve receive": "#5FA3D3", Setting: "#9BCBEB", Attacking: "#1D5A85", Blocking: "#7D838C",
  Defense: "#3A3F46", Transition: "#4E95C7", "Game play": "#0B0C0E", Conditioning: "#A4AAB2", "Team talk": "#D8DBE0",
};
const catColor = (c: string) => CAT_COLOR[c] || "#A4AAB2";

export function PracticePage() {
  const m = currentMatch();
  const [tab, setTab] = useState<"plan" | "scrim" | "history" | "drills">("plan");
  if (m && m.kind !== "match") return <div className="page">
    <div className="row between"><h1>{m.opp}</h1>
      <ConfirmButton className="btn" confirmText="Tap again to end practice" onConfirm={() => { patch("matches", m.id, { status: "done" }); setTeamPatch({ currentMatchId: null }); toast("Practice saved"); }}>End practice</ConfirmButton></div>
    <Tracker m={m} />
  </div>;
  return <div className="page">
    <div className="pagehead"><h1>Practice</h1>
      <Seg value={tab} onChange={setTab} options={[["plan", "Plans"], ["scrim", "Scrimmage"], ["drills", "Drill library"], ["history", "History"]]} label="Practice section" />
    </div>
    {m && <div className="banner"><p>A match is in progress. Starting practice tracking will finish it.</p></div>}
    {tab === "plan" && <Plans />}
    {tab === "scrim" && <ScrimSetup />}
    {tab === "drills" && <DrillLibrary />}
    {tab === "history" && <History />}
  </div>;
}

/* ---------- stat-based focus ---------- */
export function focusAreas(): { text: string; cat: string }[] {
  const t = team()!;
  const sets = matchesOf().filter((x) => x.kind === "match" && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).slice(0, 4).flatMap((x) => replayOf(x)?.sets || []);
  if (!sets.length) return [];
  const A = aggregate(sets), M = teamMetrics(A), out: { text: string; cat: string; w: number }[] = [];
  if (M.passAvg != null && M.passAvg < 2.1) out.push({ text: `Pass average is ${fmtAvg(M.passAvg)} (aim for 2.1+). Side-out after a 1-pass is ${fmtPct(M.soByPass.P1)} vs ${fmtPct(M.soByPass.P3)} after a 3.`, cat: "Serve receive", w: 2.1 - M.passAvg + 0.4 });
  if (M.serveIn != null && M.serveIn < 0.88) out.push({ text: `Serving ${fmtPct(M.serveIn)} in (aim for 88%+), ${A.T.SE + A.T.SEN + A.T.SEO} misses.`, cat: "Serving", w: (0.88 - M.serveIn) * 4 + 0.3 });
  if (M.hitting != null && M.hitting < 0.2) out.push({ text: `Hitting ${fmtHit(M.hitting)} with ${A.T.AE} errors.`, cat: "Attacking", w: (0.2 - M.hitting) * 3 + 0.3 });
  if (M.hitOutOfSystem != null && M.hitInSystem != null && M.hitInSystem - M.hitOutOfSystem > 0.15) out.push({ text: `Out-of-system hitting ${fmtHit(M.hitOutOfSystem)} vs ${fmtHit(M.hitInSystem)} in system. Rep high sets off bad passes.`, cat: "Attacking", w: 0.4 });
  if (M.digSuccess != null && M.digSuccess < 0.6) out.push({ text: `Dig success ${fmtPct(M.digSuccess)}; they're getting kills through the defense.`, cat: "Defense", w: (0.6 - M.digSuccess) * 3 + 0.3 });
  if (M.hitTransition != null && M.hitTransition < 0.1) out.push({ text: `Transition hitting is ${fmtHit(M.hitTransition)}. Work dig-to-attack.`, cat: "Transition", w: 0.35 });
  let worst = 0, wv = 0; for (let r = 1; r <= 6; r++) { const x = A.rot[r]; if (x && x.w - x.l < wv) { wv = x.w - x.l; worst = r; } }
  if (worst) out.push({ text: `Rotation ${worst} is ${fmtSigned(wv)} over the last four matches. Play it out in a rotation scrimmage.`, cat: "Game play", w: 0.5 + Math.abs(wv) / 20 });
  const misc = A.team.CE + A.team.EE + A.team.PE + A.T.CE + A.T.EE + A.T.PE;
  if (misc / (A.sets || 1) > 1.5) out.push({ text: `${misc} communication, effort and positioning errors (${(misc / A.sets).toFixed(1)} per set).`, cat: "Game play", w: 0.35 });
  return out.sort((a, b) => b.w - a.w).slice(0, 5);
}

/* ---------- plans ---------- */
const newPlan = (): PracticePlan => ({ id: uid("pl"), teamId: team()!.id, seasonId: team()!.activeSeasonId, date: todayISO(), title: "Practice", start: "15:30", blocks: [], notes: "", status: "planned", createdAt: Date.now() });
const addMin = (hhmm: string, min: number) => { const [h, m] = hhmm.split(":").map(Number); const t = (h || 0) * 60 + (m || 0) + min; const H = Math.floor(t / 60) % 24, M = t % 60; const h12 = ((H + 11) % 12) + 1; return `${h12}:${String(M).padStart(2, "0")}`; };

function Plans() {
  const plans = plansOf();
  const [id, setId] = useState<string | null>(plans.find((p) => p.status === "planned")?.id || plans[0]?.id || null);
  const plan = get("plans", id);
  return <div className="grid2" style={{ alignItems: "start" }}>
    <div className="stack">
      {plan ? <PlanEditor key={plan.id} plan={plan} onDelete={() => { remove("plans", plan.id); setId(null); }} /> : <Card><p className="empty">No plan selected. Start one below or let your stats suggest one.</p></Card>}
    </div>
    <div className="stack">
      <Card title="Your plans" actions={<button className="btn sm primary" onClick={() => { const p = newPlan(); save("plans", p); setId(p.id); }}>New plan</button>}>
        {plans.length ? <ul className="log">{plans.map((p) => <li key={p.id} className="click" style={{ gridTemplateColumns: "1fr auto", cursor: "pointer", fontWeight: p.id === id ? 700 : undefined }} onClick={() => setId(p.id)}>
          <span>{fmtDate(p.date)} · {p.title}</span><span className="small muted">{p.blocks.reduce((n, b) => n + b.minutes, 0)} min{p.status === "done" ? " · done" : ""}</span></li>)}</ul> : <p className="empty">No plans yet.</p>}
      </Card>
      <FocusCard onPlan={(p) => { save("plans", p); setId(p.id); }} />
    </div>
  </div>;
}

function FocusCard({ onPlan }: { onPlan: (p: PracticePlan) => void }) {
  const f = focusAreas(), drills = drillsOf();
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const quick = () => {
    const p = newPlan(); p.title = "Stat-based practice";
    const pick = (cat: string) => drills.find((d) => d.category === cat);
    const cats = ["Warm-up", ...new Set(f.map((x) => x.cat)), "Game play"];
    for (const c of cats) { const d = pick(c); if (d) p.blocks.push({ id: uid("b"), title: d.name, category: d.category, minutes: d.minutes, notes: d.description, drillId: d.id }); }
    onPlan(p); toast("Plan built from your stats");
  };
  const ai = async () => {
    if (!aiAvailable()) return setErr(AI_ERRORS.no_key);
    setBusy(true); setErr("");
    try {
      const r = await askJson<{ title: string; blocks: { title: string; category: string; minutes: number; notes: string }[] }>(practiceSuggestPrompt(f.map((x) => "- " + x.text).join("\n") || "- No match data yet; build a balanced fundamentals practice."));
      if (!Array.isArray(r.blocks) || !r.blocks.length) throw new AiError("bad", AI_ERRORS.invalid_json);
      const p = newPlan(); p.title = String(r.title || "AI practice plan");
      p.blocks = r.blocks.slice(0, 12).map((b) => ({ id: uid("b"), title: String(b.title || "Drill"), category: (DRILL_CATEGORIES as readonly string[]).includes(b.category) ? b.category : "Game play", minutes: Math.max(1, Math.min(60, Math.round(+b.minutes || 10))), notes: String(b.notes || ""), drillId: null }));
      onPlan(p); toast("AI plan added");
    } catch (e) { setErr(e instanceof AiError ? e.message : AI_ERRORS.upstream); }
    setBusy(false);
  };
  return <Card title="What to work on" actions={<div className="row"><button className="btn sm" disabled={!drills.length} onClick={quick}>Build plan</button><button className="btn sm" disabled={busy} onClick={ai}>{busy ? "Thinking…" : "AI plan"}</button></div>}>
    {f.length ? <ul className="recs">{f.map((x, i) => <li key={i}><span><b>{x.cat}:</b> {x.text}</span></li>)}</ul> : <p className="small muted">Once you've tracked a match, this lists what your stats say to practice.</p>}
    {err && <p className="hint warn">{err}</p>}
  </Card>;
}

function PlanEditor({ plan, onDelete }: { plan: PracticePlan; onDelete: () => void }) {
  const [running, setRunning] = useState(false);
  const drills = drillsOf();
  const [pick, setPick] = useState("");
  if (running) return <RunPractice plan={plan} onExit={() => setRunning(false)} />;
  const set = (p: Partial<PracticePlan>) => save("plans", { ...plan, ...p });
  const setB = (i: number, p: Partial<PlanBlock>) => set({ blocks: plan.blocks.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const move = (i: number, d: number) => { const b = plan.blocks.slice(); const j = i + d; if (j < 0 || j >= b.length) return; [b[i], b[j]] = [b[j], b[i]]; set({ blocks: b }); };
  const total = plan.blocks.reduce((n, b) => n + b.minutes, 0);
  let clock = 0;
  const addDrill = (d?: Drill) => set({ blocks: plan.blocks.concat(d ? { id: uid("b"), title: d.name, category: d.category, minutes: d.minutes, notes: d.description, drillId: d.id } : { id: uid("b"), title: "New block", category: "Game play", minutes: 10, notes: "", drillId: null }) });
  const text = () => [`${plan.title} — ${fmtDate(plan.date)}, starts ${addMin(plan.start, 0)} (${total} min)`, "", ...(() => { let c = 0; return plan.blocks.map((b) => { const s = addMin(plan.start, c); c += b.minutes; return `${s}  ${b.title} (${b.minutes} min, ${b.category})${b.notes ? "\n       " + b.notes : ""}`; }); })(), plan.notes ? "\nNotes: " + plan.notes : ""].join("\n");
  const startScrim = () => go("practice");
  return <Card title={<input className="input" style={{ fontWeight: 700, fontSize: 18, border: 0, padding: 0, background: "none" }} value={plan.title} onChange={(e) => set({ title: e.target.value })} aria-label="Plan title" />}
    actions={<div className="row"><button className="btn sm" onClick={() => copyText(text()).then((ok) => toast(ok ? "Plan copied" : "Couldn't copy"))}>Copy</button><button className="btn sm" onClick={() => download(`${plan.title} ${plan.date}.txt`, text(), "text/plain")}>Download</button><ConfirmButton onConfirm={onDelete}>Delete</ConfirmButton></div>}>
    <div className="stack">
      <div className="row">
        <label className="field"><span className="label">Date</span><input type="date" value={plan.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="field"><span className="label">Start</span><input type="time" value={plan.start} onChange={(e) => set({ start: e.target.value })} /></label>
        <div className="field"><span className="label">Total</span><b style={{ fontSize: 20, fontFamily: "var(--display)" }}>{total} min · ends {addMin(plan.start, total)}</b></div>
      </div>
      {total > 0 && <div className="timeline" aria-label="Time by category">{plan.blocks.map((b) => <span key={b.id} title={`${b.title} · ${b.minutes} min`} style={{ width: (100 * b.minutes) / total + "%", background: catColor(b.category) }} />)}</div>}
      {plan.blocks.map((b, i) => { const start = clock; clock += b.minutes; return <div key={b.id} className={"block " + (b.done ? "done" : "")}>
        <div className="time">{addMin(plan.start, start)}</div>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="blk-head"><span className="cat" style={{ color: catColor(b.category) }}>●</span>
            <select className="input" style={{ width: "auto", minWidth: 0, maxWidth: 150, padding: "4px 6px" }} value={b.category} onChange={(e) => setB(i, { category: e.target.value })}>{DRILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            <input className="input" style={{ width: 64, padding: "4px 6px" }} type="number" min={1} max={120} value={b.minutes} onChange={(e) => setB(i, { minutes: Math.max(1, +e.target.value || 1) })} aria-label="Minutes" /><span className="small muted">min</span>
            <span className="blk-ctl">
              <button className="btn sm ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn sm ghost" aria-label="Move down" disabled={i === plan.blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn sm" aria-pressed={!!b.done} aria-label="Mark done" onClick={() => setB(i, { done: !b.done })}>{b.done ? "✓ Done" : "Done"}</button>
              <button className="btn sm ghost" aria-label="Remove" onClick={() => set({ blocks: plan.blocks.filter((_, j) => j !== i) })}>✕</button>
            </span></div>
          <input className="input" value={b.title} onChange={(e) => setB(i, { title: e.target.value })} aria-label="Block title" />
          <textarea className="input" aria-label="Block notes" rows={b.notes ? 2 : 1} value={b.notes} placeholder="Notes, what to watch for" onChange={(e) => setB(i, { notes: e.target.value })} />
        </div>
      </div>; })}
      <div className="row">
        <select className="input" style={{ width: "auto", maxWidth: 300 }} value={pick} onChange={(e) => { const d = drills.find((x) => x.id === e.target.value); if (d) addDrill(d); setPick(""); }} aria-label="Add a drill">
          <option value="">+ Add a drill from your library</option>
          {DRILL_CATEGORIES.map((c) => { const ds = drills.filter((d) => d.category === c); return ds.length ? <optgroup key={c} label={c}>{ds.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.minutes} min)</option>)}</optgroup> : null; })}
        </select>
        <button className="btn sm" onClick={() => addDrill()}>+ Custom block</button>
      </div>
      <Attendance plan={plan} onChange={(attendance) => set({ attendance })} />
      <label className="field"><span className="label">Notes</span><textarea rows={2} value={plan.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      <div className="row">
        <button className="btn" onClick={() => set({ status: plan.status === "done" ? "planned" : "done" })}>{plan.status === "done" ? "Mark not done" : "Mark practice done"}</button>
        <button className="btn primary" disabled={!plan.blocks.length} onClick={() => setRunning(true)}>Run practice</button>
        <button className="btn" onClick={() => { newMatch({ kind: "drills", opp: plan.title, planId: plan.id }); setUi({ sel: null, panel: null, follow: null }); startScrim(); }}>Track drill stats</button>
      </div>
    </div>
  </Card>;
}

/* ---------- scrimmage ---------- */
function ScrimSetup() {
  const t = team()!, saved = t.scrimSplit;
  const ids = new Set(activePlayers().map((p) => p.id));
  const [s, setS] = useState<SplitState>(() => saved ? { aName: saved.aName, bName: saved.bName, a: saved.a.filter((x) => ids.has(x)), b: saved.b.filter((x) => ids.has(x)), out: saved.out.filter((x) => ids.has(x)).concat([...ids].filter((x) => !saved.a.includes(x) && !saved.b.includes(x) && !saved.out.includes(x))) } : { aName: "Blue", bName: "White", ...balancedSplit(false) });
  const [to, setTo] = useState(saved?.to || 25), [games, setGames] = useState(saved?.games || 3);
  const start = () => {
    if (!s.a.length || !s.b.length) return toast("Put players on both teams.");
    setTeamPatch({ scrimSplit: { ...s, to, games } });
    newMatch({ kind: "scrimmage", opp: `${s.aName} vs ${s.bName}`, bestOf: games, scrim: { a: { name: s.aName, ids: s.a }, b: { name: s.bName, ids: s.b }, to } });
    setUi({ sel: null, panel: null, follow: null });
  };
  return <div className="grid2" style={{ alignItems: "start" }}>
    <Card title="Split the roster">
      {ids.size ? <SplitEditor s={s} onChange={setS} /> : <p className="empty">Add players on the Team tab first.</p>}
    </Card>
    <Card title="Scrimmage format">
      <div className="stack">
        <div><div className="label">Games to</div><Seg value={to} onChange={setTo} options={[[25, "25"], [21, "21"], [15, "15"], [11, "11"]]} label="Points to win" /></div>
        <div><div className="label">Format</div><Seg value={games} onChange={setGames} options={[[1, "1 game"], [3, "Best of 3"], [5, "Best of 5"]]} label="Games" /></div>
        <p className="small muted">Every stat is credited to the player and their scrimmage team, so you get head-to-head numbers plus individual stats that count toward practice totals (not match stats).</p>
        <button className="btn primary" onClick={start}>Start scrimmage</button>
      </div>
    </Card>
  </div>;
}

/* ---------- drill library ---------- */
function DrillLibrary() {
  const drills = drillsOf();
  const [edit, setEdit] = useState<Drill | null>(null);
  const blank = (): Drill => ({ id: uid("dr"), teamId: team()!.id, name: "", category: "Game play", minutes: 10, description: "", focus: [] });
  return <div className="grid2" style={{ alignItems: "start" }}>
    <Card title={`Drills (${drills.length})`} actions={<button className="btn sm primary" onClick={() => setEdit(blank())}>New drill</button>}>
      {DRILL_CATEGORIES.map((c) => { const ds = drills.filter((d) => d.category === c); return ds.length ? <div key={c} style={{ marginBottom: 10 }}>
        <div className="label" style={{ color: catColor(c) }}>{c}</div>
        <ul className="log">{ds.map((d) => <li key={d.id} className="click" style={{ gridTemplateColumns: "1fr auto", cursor: "pointer" }} onClick={() => setEdit(d)}><span><b>{d.name}</b><br /><span className="small muted">{d.description}</span></span><span className="small muted">{d.minutes} min</span></li>)}</ul>
      </div> : null; })}
    </Card>
    {edit && <Card title={drills.some((d) => d.id === edit.id) ? "Edit drill" : "New drill"}>
      <div className="stack">
        <label className="field"><span className="label">Name</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <div className="two">
          <label className="field"><span className="label">Category</span><select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{DRILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span className="label">Minutes</span><input type="number" min={1} value={edit.minutes} onChange={(e) => setEdit({ ...edit, minutes: Math.max(1, +e.target.value || 1) })} /></label>
        </div>
        <label className="field"><span className="label">How to run it</span><textarea rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
        <div className="row"><button className="btn primary" disabled={!edit.name.trim()} onClick={() => { save("drills", { ...edit, name: edit.name.trim() }); setEdit(null); toast("Drill saved"); }}>Save</button>
          <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
          {drills.some((d) => d.id === edit.id) && <ConfirmButton onConfirm={() => { remove("drills", edit.id); setEdit(null); }}>Delete</ConfirmButton>}</div>
      </div>
    </Card>}
  </div>;
}

/* ---------- history ---------- */
function History() {
  const list = matchesOf().filter((m) => m.kind !== "match");
  return <Card title="Practice sessions">
    {list.length ? <ul className="log">{list.map((m) => { const R = replayOf(m); return <li key={m.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
      <span>{fmtDate(m.date)} · {m.opp} <span className="tag">{m.kind === "scrimmage" ? "Scrimmage" : "Drills"}</span></span>
      <span className="small muted">{m.kind === "scrimmage" && R ? R.sets.map((s) => `${s.us}-${s.them}`).join(", ") : R ? `${R.log.filter((l) => l.kind === "stat").length} entries` : ""}</span>
      <button className="btn sm" onClick={() => { setUi({ statsScope: "m:" + m.id }); go("stats"); }}>Stats</button>
    </li>; })}</ul> : <p className="empty">No practice sessions tracked yet. Start a scrimmage or track drill stats from a plan.</p>}
  </Card>;
}

/* ---------- attendance ---------- */
const ATT: Record<string, { next: "in" | "late" | "out" | undefined; label: string }> = { none: { next: "in", label: "—" }, in: { next: "late", label: "Here" }, late: { next: "out", label: "Late" }, out: { next: undefined, label: "Out" } };
function Attendance({ plan, onChange }: { plan: PracticePlan; onChange: (a: PracticePlan["attendance"]) => void }) {
  const ps = activePlayers(), a = plan.attendance || {};
  const counts = { in: 0, late: 0, out: 0 } as Record<string, number>; for (const p of ps) if (a[p.id]) counts[a[p.id]]++;
  const cycle = (id: string) => { const cur = a[id] || "none", nx = ATT[cur].next; const n = { ...a }; if (nx) n[id] = nx; else delete n[id]; onChange(n); };
  return <div className="att">
    <div className="row between"><span className="label">Attendance</span><span className="small muted">{counts.in} here · {counts.late} late · {counts.out} out{ps.length ? "" : ""} <button type="button" className="btn sm ghost" onClick={() => onChange(Object.fromEntries(ps.map((p) => [p.id, "in"])) as any)}>All here</button></span></div>
    <div className="att-grid">{ps.map((p) => { const st = a[p.id] || "none"; return <button type="button" key={p.id} className={"att-b " + st} onClick={() => cycle(p.id)} aria-label={`${p.first} ${p.last}: ${ATT[st].label}. Tap to change.`}><b>{p.num}</b><span>{p.first || p.last}</span><i>{ATT[st].label}</i></button>; })}</div>
  </div>;
}

/* ---------- run practice: a big timer that walks through the plan ---------- */
function RunPractice({ plan, onExit }: { plan: PracticePlan; onExit: () => void }) {
  const [i, setI] = useState(() => Math.max(0, plan.blocks.findIndex((b) => !b.done)));
  const [left, setLeft] = useState(() => (plan.blocks[Math.max(0, plan.blocks.findIndex((b) => !b.done))]?.minutes || 0) * 60);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const end = Date.now() + left * 1000;
    const tm = setInterval(() => { const l = Math.max(0, Math.round((end - Date.now()) / 1000)); setLeft(l); if (l === 0) { setOn(false); try { navigator.vibrate?.([300, 150, 300]); } catch { /* ignore */ } } }, 250);
    return () => clearInterval(tm);
  }, [on]);
  const b = plan.blocks[i], next = plan.blocks[i + 1];
  const go2 = (j: number, markDone = false) => {
    if (markDone && b) save("plans", { ...plan, blocks: plan.blocks.map((x, k) => (k === i ? { ...x, done: true } : x)) });
    if (j >= plan.blocks.length) { save("plans", { ...plan, blocks: plan.blocks.map((x) => ({ ...x, done: true })), status: "done" }); toast("Practice done"); onExit(); return; }
    setI(j); setLeft(plan.blocks[j].minutes * 60); setOn(false);
  };
  if (!b) return null;
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0"), frac = 1 - left / (b.minutes * 60 || 1);
  return <section className="card run">
    <div className="row between"><span className="small muted">{plan.title} · block {i + 1} of {plan.blocks.length}</span><button className="btn sm" onClick={onExit}>Exit</button></div>
    <div className="run-cat"><span className="sw" style={{ background: catColor(b.category) }} />{b.category}</div>
    <h2 className="run-title">{b.title}</h2>
    {b.notes && <p className="muted">{b.notes}</p>}
    <div className={"run-clock" + (left === 0 ? " up" : "")}>{mm}:{ss}</div>
    <div className="meter"><i style={{ width: frac * 100 + "%" }} /></div>
    <div className="row" style={{ justifyContent: "center" }}>
      <button className="btn" disabled={i === 0} onClick={() => go2(i - 1)}>Back</button>
      <button className="btn primary run-go" onClick={() => setOn(!on)}>{on ? "Pause" : left === b.minutes * 60 ? "Start" : left === 0 ? "Time's up" : "Resume"}</button>
      <button className="btn" onClick={() => setLeft((l) => l + 60)}>+1 min</button>
      <button className="btn" onClick={() => go2(i + 1, true)}>{next ? "Next" : "Finish"}</button>
    </div>
    {next && <p className="small muted" style={{ textAlign: "center" }}>Up next: <b>{next.title}</b> · {next.minutes} min</p>}
  </section>;
}

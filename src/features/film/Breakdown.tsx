/** Film Room → Breakdown: the film review a coach would build before practice, from the match's stats. Each finding
 * plays as clips; one tap turns the whole breakdown into a film session for the team, and the AI can write it up. */
import { AI_FEATURES } from "../../app/flags";
import { useState } from "react";
import { drillsOf, patch, plansOf, player, save, team, toast, todayISO, uid } from "../../data/store";
import { go } from "../../app/router";
import { Match, PracticePlan } from "../../data/model";
import { aggregate, Replay } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, teamMetrics } from "../../sports/volleyball/metrics";
import { plural } from "../../ui/kit";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { clipsFrom, clock, filmTiming, videoTime } from "../../film/clips";
import { matchQuery } from "../../film/query";
import { blocksFor, breakdown, breakdownPrompt, cleanReview, drillCategory, Finding, Tone } from "../../film/breakdown";
import { askPrompt, cleanAsk, filmDigest } from "../../film/askFilm";
import { ACTIONS } from "../../sports/volleyball/actions";
import { playName } from "../../film/clips";
import { itemFrom } from "../../film/session";
import { aiAvailable, AiError, askJson } from "../../ai/client";
import { addToSession, saveSession } from "./Sessions";
import { label, resolve } from "./words";

const TONE: Record<Tone, string> = { fix: "Fix", scout: "Scout", keep: "Keep doing" };
/** Clips per finding in a session: enough to see the pattern, short enough that players watch it. */
const PER = 6;
const dayName = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
/** Put film findings into the next practice that hasn't happened yet, or a new one tomorrow. Returns what happened, for the toast. */
export function toPractice(m: Match, fs: Finding[]): string {
  const today = todayISO(), next = plansOf().filter((p) => p.status === "planned" && p.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const t = team()!, tomorrow = (() => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const plan: PracticePlan = next ? { ...next, blocks: next.blocks.slice() } : { id: uid("pl"), teamId: t.id, seasonId: t.activeSeasonId, date: tomorrow, title: `After ${m.opp}`, start: "15:30", blocks: [], notes: "", status: "planned", createdAt: Date.now() };
  const add = blocksFor(fs, drillsOf(), m.opp, () => uid("b"), plan.blocks.map((b) => b.drillId || ""));
  if (!add.length) return fs.some((f) => drillCategory(f)) ? (next ? `${dayName(plan.date)}'s practice already has those drills.` : "Your drill library has no drill for that yet. Add one in Practice → Drills.") : "Nothing to drill: these are things to keep doing.";
  plan.blocks = plan.blocks.concat(add); save("plans", plan);
  return `Added ${add.map((b) => b.title).join(", ")} to ${next ? dayName(plan.date) + "'s practice" : "a new practice for " + dayName(plan.date)}.`;
}
export const playerTag = (id: string) => { const p = player(id); return p ? `#${p.num} ${p.first}` : "A player"; };

export function Breakdown({ m, R, T, onSeek, onAdded }: { m: Match; R: Replay; T: ReturnType<typeof filmTiming>; onSeek: (t: number) => void; onAdded: (sessionId: string) => void }) {
  const fs = breakdown(R.log, playerTag);
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [planned, setPlanned] = useState("");
  const plan = (x: Finding[]) => setPlanned(toPractice(m, x));
  const review = m.review, lead = m.film ? 5 : 8;
  const clipsOf = (f: Finding) => m.video ? clipsFrom(m, T, R.log.filter((l) => matchQuery(f.q, l)), () => true, label, lead, 2) : [];
  const noteOf = (f: Finding) => review?.notes[f.id] || f.note;

  const write = async () => {
    setBusy(true); setErr("");
    try {
      const M = teamMetrics(aggregate(R.sets));
      const numbers = `hitting ${fmtHit(M.hitting)}, pass average ${fmtAvg(M.passAvg)}, side-out ${fmtPct(M.sideOut)}, serve in ${fmtPct(M.serveIn)}`;
      const x = await askJson<any>(breakdownPrompt(m.opp, `${R.wonUs}–${R.wonThem} in sets, ${R.sets.map((s) => `${s.us}-${s.them}`).join(", ")}`, fs, numbers), { tier: "quick" });
      const c = cleanReview(x, fs);
      if (!c.summary && !Object.keys(c.notes).length) throw new Error("empty");
      patch("matches", m.id, { review: { at: Date.now(), ...c } });
    } catch (e) { setErr(e instanceof AiError ? e.message : "Couldn't write it up right now. The findings below still work."); }
    setBusy(false);
  };
  const makeSession = (only?: Finding) => {
    const items = (only ? [only] : fs).flatMap((f) => clipsOf(f).slice(0, only ? 50 : PER).map((c, i) => ({ ...itemFrom(c), note: i === 0 ? (only ? noteOf(f) : `${f.title}. ${noteOf(f)}`) : undefined })));
    if (!items.length) { toast("Add the game's video to make a film session."); return; }
    let s = addToSession(m, "new", items, only ? `vs ${m.opp}: ${only.title}` : `vs ${m.opp}: film review`);
    if (!only && review?.summary) { s = { ...s, note: review.summary }; saveSession(m, s); }
    toast(`Made “${s.title}” with ${plural(items.length, "clip")}`); onAdded(s.id);
  };

  const ask = AI_FEATURES.askFilm ? <AskFilm m={m} R={R} T={T} onAdded={onAdded} /> : null;
  if (!fs.length) return <div className="stack">{R.log.some((l) => l.kind === "stat") && ask}<p className="empty">{R.log.some((l) => l.kind === "stat" && l.w)
    ? "Nothing stood out in this match yet: no run of errors, no rotation stuck, no hitter who hurt us. Find clips has every play."
    : "Stat this game (or line the video up with your live stats) and the breakdown writes itself: where points went, the rotation that got stuck, their best hitter and what to keep doing. “Best rallies” in Rallies works without any stats."}</p></div>;
  return <div className="stack fr-bd">
    {ask}
    <div className="fr-bd-hd">
      <p className="small muted">What the film says about this match, from your stats. Each finding plays as clips.</p>
      <div className="row">
        <button className="btn primary" onClick={() => makeSession()} disabled={!m.video}>Make a film session from this</button>
        {fs.some((f) => drillCategory(f)) && <button className="btn" onClick={() => plan(fs)}>Plan practice from this</button>}
        {AI_FEATURES.filmSummary && aiAvailable() && <button className="btn" onClick={write} disabled={busy}>{busy ? "Writing…" : review ? "Write it up again" : "Write it up with AI"}</button>}
      </div>
      {!m.video && <p className="small muted">Add the game's video to watch these as clips.</p>}
      {err && <p className="small bad">{err}</p>}
      {planned && <div className="fr-planned" role="status"><span>{planned}</span><button className="btn sm" onClick={() => go("practice")}>Open practice</button></div>}
    </div>
    {review?.summary && <blockquote className="fr-bd-sum"><p>{review.summary}</p><span className="small muted">Written with AI from the findings below. Check it before you share it.</span></blockquote>}
    <ol className="fr-bd-list">{fs.map((f) => { const on = open === f.id, clips = on ? clipsOf(f) : [], playable = clips.filter((c) => resolve(c));
      return <li key={f.id} className={"fr-bd-item " + f.tone}>
        <div className="fr-bd-top"><span className={"fr-tone " + f.tone}>{TONE[f.tone]}</span><b>{f.title}</b></div>
        <p className="small">{f.why}</p>
        <p className="small fr-bd-note">{noteOf(f)}</p>
        <div className="row">
          <button className="btn sm" aria-expanded={on} onClick={() => setOpen(on ? null : f.id)}>{on ? "Hide" : m.video ? `Watch ${plural(f.n, "clip")}` : `Show ${plural(f.n, "play")}`}</button>
          {m.video && <button className="btn sm" onClick={() => makeSession(f)}>Film session of just this</button>}
          {drillCategory(f) && <button className="btn sm" onClick={() => plan([f])}>Drill it at practice</button>}
        </div>
        {on && <>
          {playable.length > 0 && <ClipPlayer key={f.id} clips={playable} resolve={resolve} allowSave title={`${f.title} · vs ${m.opp}`} fileName={(c) => `${f.title} vs ${m.opp}${c ? " " + c.label : ""}`.replace(/[^\w\- .#]+/g, "")} />}
          {!playable.length && <ul className="log film fr-rows">{R.log.filter((l) => matchQuery(f.q, l)).map((l) => { const s = l as any, at = videoTime(T, l.id); return <li key={l.id}>
            <button className="num fr-time" disabled={!m.video} onClick={() => onSeek(Math.max(0, at - lead))}>{m.video ? clock(Math.max(0, at - lead)) : "S" + l.set}</button><span>{label(l)}</span><span className={"small " + (s.w ? "pt-" + s.w : "muted")}>{s.w ? `${s.us}–${s.them}` : "S" + l.set}</span></li>; })}</ul>}
        </>}
      </li>; })}</ol>
  </div>;
}

/* ---------- ask about this match ---------- */
function AskFilm({ m, R, T, onAdded }: { m: Match; R: Replay; T: ReturnType<typeof filmTiming>; onAdded: (sessionId: string) => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [res, setRes] = useState<{ q: string; answer: string; plays: string[] } | null>(null), [err, setErr] = useState("");
  if (!aiAvailable()) return null;
  const lead = m.film ? 5 : 8;
  const run = async (q: string) => {
    setText(q); setBusy(true); setErr("");
    try {
      const digest = filmDigest(R.log, playerTag, (c) => playName(c, (ACTIONS as any)[c]?.long));
      const x = await askJson<any>(askPrompt(q, m.opp, `${R.wonUs}–${R.wonThem} in sets, ${R.sets.map((s) => `${s.us}-${s.them}`).join(", ")}`, digest), { tier: "default" });
      const c = cleanAsk(x, R.log); if (!c.answer) throw new Error("empty");
      setRes({ q, ...c });
    } catch (e) { setErr(e instanceof AiError ? e.message : "Couldn't answer that right now. Try asking another way."); }
    setBusy(false);
  };
  const rows = res ? R.log.filter((l) => res.plays.includes(l.id)) : [];
  const clips = res && m.video ? clipsFrom(m, T, rows, () => true, label, lead, 2) : [], playable = clips.filter((c) => resolve(c));
  return <div className="fr-askfilm">
    <form className="fr-ask" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(text.trim()); }}>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this match: “why did we lose set 2?”" aria-label="Ask about this match" />
      <button className="btn primary" disabled={busy || !text.trim()}>{busy ? "Watching…" : "Ask"}</button>
    </form>
    {!res && !busy && <div className="fr-examples">{["Why did we lose the close set?", "How did serve receive go?", "Who hurt us most?", "What went right late in sets?"].map((x) => <button key={x} className="fr-ex" onClick={() => run(x)}>{x}</button>)}</div>}
    {err && <p className="small bad">{err}</p>}
    {res && <div className="fr-answer">
      <p>{res.answer}</p>
      <span className="small muted">Answered with AI from this match's stats. {rows.length ? `It points to ${plural(rows.length, "play")}.` : ""}</span>
      {rows.length > 0 && m.video && <div className="row"><button className="btn sm" onClick={() => { const s = addToSession(m, "new", clips.map((c, i) => ({ ...itemFrom(c), note: i === 0 ? res.answer : undefined })), `vs ${m.opp}: ${res.q.replace(/\?$/, "")}`); toast(`Made “${s.title}”`); onAdded(s.id); }}>Make a film session of these</button></div>}
      {playable.length > 0 && <ClipPlayer key={res.q + res.plays.join()} clips={playable} resolve={resolve} allowSave title={res.q} fileName={(c) => `${res.q} vs ${m.opp}${c ? " " + c.label : ""}`.replace(/[^\w\- .#]+/g, "")} />}
      {!playable.length && rows.length > 0 && <ul className="log film fr-rows">{rows.map((l) => { const s = l as any; return <li key={l.id}><span className="num fr-time">S{l.set}</span><span>{label(l)}</span><span className={"small " + (s.w ? "pt-" + s.w : "muted")}>{s.w ? `${s.us}–${s.them}` : ""}</span></li>; })}</ul>}
    </div>}
  </div>;
}

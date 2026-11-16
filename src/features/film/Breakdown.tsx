/** Film Room → Breakdown: the film review a coach would build before practice, from the match's stats. Each finding
 * plays as clips; one tap turns the whole breakdown into a film session for the team, and the AI can write it up. */
import { useState } from "react";
import { patch, player, toast } from "../../data/store";
import { Match } from "../../data/model";
import { aggregate, Replay } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, teamMetrics } from "../../sports/volleyball/metrics";
import { plural } from "../../ui/kit";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { clipsFrom, clock, filmTiming, videoTime } from "../../film/clips";
import { matchQuery } from "../../film/query";
import { breakdown, breakdownPrompt, cleanReview, Finding, Tone } from "../../film/breakdown";
import { itemFrom } from "../../film/session";
import { aiAvailable, AiError, askJson } from "../../ai/client";
import { addToSession, saveSession } from "./Sessions";
import { label, resolve } from "./words";

const TONE: Record<Tone, string> = { fix: "Fix", scout: "Scout", keep: "Keep doing" };
/** Clips per finding in a session: enough to see the pattern, short enough that players watch it. */
const PER = 6;
export const playerTag = (id: string) => { const p = player(id); return p ? `#${p.num} ${p.first}` : "A player"; };

export function Breakdown({ m, R, T, onSeek, onAdded }: { m: Match; R: Replay; T: ReturnType<typeof filmTiming>; onSeek: (t: number) => void; onAdded: (sessionId: string) => void }) {
  const fs = breakdown(R.log, playerTag);
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
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

  if (!fs.length) return <div className="stack"><p className="empty">{R.log.some((l) => l.kind === "stat" && l.w)
    ? "Nothing stood out in this match yet: no run of errors, no rotation stuck, no hitter who hurt us. Find clips has every play."
    : "Stat this game (or line the video up with your live stats) and the breakdown writes itself: where points went, the rotation that got stuck, their best hitter and what to keep doing. “Best rallies” in Rallies works without any stats."}</p></div>;
  return <div className="stack fr-bd">
    <div className="fr-bd-hd">
      <p className="small muted">What the film says about this match, from your stats. Each finding plays as clips.</p>
      <div className="row">
        <button className="btn primary" onClick={() => makeSession()} disabled={!m.video}>Make a film session from this</button>
        {aiAvailable() && <button className="btn" onClick={write} disabled={busy}>{busy ? "Writing…" : review ? "Write it up again" : "Write it up with AI"}</button>}
      </div>
      {!m.video && <p className="small muted">Add the game's video to watch these as clips.</p>}
      {err && <p className="small bad">{err}</p>}
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
        </div>
        {on && <>
          {playable.length > 0 && <ClipPlayer key={f.id} clips={playable} resolve={resolve} allowSave title={`${f.title} · vs ${m.opp}`} fileName={(c) => `${f.title} vs ${m.opp}${c ? " " + c.label : ""}`.replace(/[^\w\- .#]+/g, "")} />}
          {!playable.length && <ul className="log film fr-rows">{R.log.filter((l) => matchQuery(f.q, l)).map((l) => { const s = l as any, at = videoTime(T, l.id); return <li key={l.id}>
            <button className="num fr-time" disabled={!m.video} onClick={() => onSeek(Math.max(0, at - lead))}>{m.video ? clock(Math.max(0, at - lead)) : "S" + l.set}</button><span>{label(l)}</span><span className={"small " + (s.w ? "pt-" + s.w : "muted")}>{s.w ? `${s.us}–${s.them}` : "S" + l.set}</span></li>; })}</ul>}
        </>}
      </li>; })}</ol>
  </div>;
}

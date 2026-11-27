/** Paste the pool schedule instead of typing it: pick which team is you, check the games, add them. */
import { useMemo, useState } from "react";
import { team, uid } from "../../data/store";
import { TGame, Tournament } from "../../tournament/model";
import { gamesFrom, guessUs, norm, parsePaste } from "../../tournament/paste";

const EXAMPLE = `Pool 3 - Court 12
8:00 AM  Your Team  vs  Mavericks 16-1   W: Coast 16 Navy
9:00 AM  Coast 16 Navy  vs  Legacy 16 Red   W: Your Team`;

export function PasteSchedule({ t, set, clock, done }: { t: Tournament; set: (p: Partial<Tournament>) => void; clock: (x?: string) => string; done: () => void }) {
  const [text, setText] = useState(""), [us, setUs] = useState<string | null>(null), [skip, setSkip] = useState<Set<number>>(new Set());
  const p = useMemo(() => parsePaste(text), [text]);
  const guess = useMemo(() => guessUs(p.teams, team()?.name || ""), [p.teams.join("|")]);
  const me = us ?? guess;
  const out = useMemo(() => { let n = 0; return gamesFrom(p, me, { bestOf: 2, scoring: team()?.settings.scoring || "25" }, () => "p" + n++); }, [p, me]);
  const have = (g: TGame) => t.games.some((x) => x.time === g.time && norm(x.opp) === norm(g.opp) && x.stage === g.stage);
  const picked = out.games.filter((g, i) => !skip.has(i) && !have(g));
  const add = () => {
    const others = out.others.filter((o) => !t.others.some((x) => norm(x.a + " " + x.b) === norm(o.a + " " + o.b) || norm(x.b + " " + x.a) === norm(o.a + " " + o.b))).map((o) => ({ ...o, id: uid("to") }));
    const pool = t.poolTeams.slice(); for (const x of out.poolTeams) if (!pool.some((y) => norm(y) === norm(x))) pool.push(x);
    set({ games: t.games.concat(picked.map((g) => ({ ...g, id: uid("tg"), day: t.start }))), others: t.others.concat(others), poolTeams: pool, poolName: p.pool && (!t.poolName || (t.poolName === "Pool A" && !t.others.length)) ? p.pool : t.poolName });
    done();
  };
  return <div className="stack tn-paste">
    <label className="field"><span className="label">Paste the schedule</span>
      <textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setSkip(new Set()); }} placeholder={EXAMPLE} spellCheck={false} /></label>
    <p className="small muted" style={{ margin: 0 }}>Copy it from the tournament's website or app, or type it your way: "8am ct 4 vs Rivals", "9 work". FloorCall only reads what you paste.</p>
    {text.trim() && !p.lines.length && <p className="hint warn">No games found. Each game needs a time or "vs" on its line.</p>}
    {p.teams.length > 1 && <label className="field"><span className="label">Which team is you?</span>
      <select className="input" value={me || ""} onChange={(e) => setUs(e.target.value || null)}>
        <option value="">Not listed (my games say "vs …")</option>{p.teams.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>}
    {out.games.length > 0 && <>
      <ul className="tn-paste-list" aria-label="Games found">{out.games.map((g, i) => { const dup = have(g); return <li key={i}>
        <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" disabled={dup} checked={!dup && !skip.has(i)} onChange={(e) => { const s = new Set(skip); e.target.checked ? s.delete(i) : s.add(i); setSkip(s); }} />
          <span><b>{clock(g.time) || "No time"}{g.court ? ` · Ct ${g.court}` : ""}</b> {g.stage === "work" ? `Work${g.opp ? ": " + g.opp : ""}` : `${g.stage === "bracket" ? (g.round || "Bracket") + " " : ""}vs ${g.opp}`}{dup && <small className="muted"> (already added)</small>}</span>
        </label></li>; })}</ul>
      {out.others.length > 0 && <p className="small muted" style={{ margin: 0 }}>Also {out.others.length} other {out.others.length === 1 ? "match" : "matches"} in your pool, for the standings.</p>}
    </>}
    {p.lines.length > 0 && !out.games.length && <p className="hint warn">Found {p.lines.length} {p.lines.length === 1 ? "match" : "matches"}, but none for your team. Pick your team above.</p>}
    <div className="row"><button className="btn primary" disabled={!picked.length} onClick={add}>{picked.length ? `Add ${picked.length} ${picked.length === 1 ? "game" : "games"}` : "Add games"}</button><button className="btn" onClick={done}>Cancel</button></div>
  </div>;
}

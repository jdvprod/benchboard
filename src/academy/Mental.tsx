/** Academy → The mental game: topics (reading the game, reading the block, blocking reads, faster decisions,
 * pressure, bouncing back, focus, leadership, teammates), each with ideas, drills and a "Test yourself" quiz of real
 * situations. A mixed Game IQ test draws from every topic. Best scores are kept on this device. */
import { useEffect, useMemo, useState } from "react";
import { Level, LEVELS, Who } from "./content";
import { MENTAL, MentalId, MentalTopic, quizFor, quizVerdict, shuffled, TIME_FOR } from "./mentalData";
import { DrillRow, OwnSection, usePicks } from "./Library";
import { rpc } from "../cloud/client";

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const KINDS: MentalTopic["kind"][] = ["Game IQ", "Mindset", "Team", "Work team"];
const KIND_NOTE: Partial<Record<MentalTopic["kind"], string>> = { "Work team": "At tournaments, teams referee each other. Learn each job before your team works a match." };

export function MentalPage({ who, coach, topic }: { who: Who; coach: boolean; topic?: string }) {
  const base = "#/" + (who === "player" ? "players" : "coaches") + "/mental";
  const [best, setBest] = useState<Record<string, number>>(() => read("fc-academy-iq", {}));
  const saveBest = (k: string, pct: number) => { if ((best[k] ?? -1) < pct) { const n = { ...best, [k]: pct }; setBest(n); write("fc-academy-iq", n); } };
  const t = MENTAL.find((x) => x.id === topic);
  if (topic === "test") return <article className="ac-lib ac-mind"><a className="ac-back" href={base}>The mental game</a>
    <header className="ac-lib-hd"><h1>Game IQ test</h1><p>Ten situations from every part of the mental game. Pick what you'd do; each answer explains the best choice.</p></header>
    <Quiz key="all" topic="all" onDone={(p) => saveBest("all", p)} best={best.all} /></article>;
  if (t) return <TopicPage t={t} who={who} coach={coach} base={base} best={best[t.id]} onScore={(p) => saveBest(t.id, p)} />;
  return <article className="ac-lib ac-mind">
    <header className="ac-lib-hd">
      <a className="ac-back" href={"#/" + (who === "player" ? "players" : "coaches")}>Academy</a>
      <h1>The mental game</h1>
      <p>Reading the game, making faster decisions, handling pressure and bad days, being a great teammate and leader, and working a match as line judge, scorekeeper or ref. Each topic has the ideas, drills that train them, and real situations to test yourself on.</p>
    </header>
    <a className="ac-mind-test" href={base + "/test"}><span><b>Take the Game IQ test</b><span>10 situations from every topic. {best.all != null ? `Your best: ${best.all}%` : "See where you stand."}</span></span><svg className="ac-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg></a>
    {KINDS.map((k) => <section key={k} className="ac-sec" aria-labelledby={"mk-" + k}><h2 id={"mk-" + k}>{k}</h2>{KIND_NOTE[k] && <p className="ac-kind-note">{KIND_NOTE[k]}</p>}
      <ul className="ac-mind-topics">{MENTAL.filter((x) => x.kind === k).map((x) => <li key={x.id}><a href={base + "/" + x.id}>
        <b>{x.name}</b><span>{x.tagline}</span>
        <small>{x.drills.length} drills · {x.questions.length} situations{best[x.id] != null ? ` · best ${best[x.id]}%` : ""}</small></a></li>)}</ul></section>)}
    <section className="ac-sec"><OwnSection area="mental" who={who} category="Team talk" title="Your own mental drills" /></section>
  </article>;
}

function TopicPage({ t, who, coach, base, best, onScore }: { t: MentalTopic; who: Who; coach: boolean; base: string; best?: number; onScore: (pct: number) => void }) {
  const { teams, teamPicks, loadTeam } = usePicks(coach);
  const sendFor = (id: string) => coach && teams.length ? { teams, picked: (x: string) => (teamPicks[x] || []).includes(id), toggle: async (x: string, on: boolean) => { await rpc("team_pick_drill", { t: x, drill: id, pick: on, note: null }); await loadTeam(x); } } : undefined;
  const i = MENTAL.indexOf(t), next = MENTAL[i + 1];
  const drills = who === "player" ? t.drills.filter((x) => x.who === "player").concat(t.drills.filter((x) => x.who === "coach")) : t.drills;
  return <article className="ac-lib ac-mind">
    <a className="ac-back" href={base}>The mental game</a>
    <header className="ac-lib-hd"><span className="ac-mind-kind">{t.kind}</span><h1>{t.name}</h1><p>{t.intro}</p></header>
    <section className="ac-sec" aria-labelledby="mi"><h2 id="mi">The ideas</h2>
      <ol className="ac-str-pr">{t.ideas.map((x) => <li key={x.title}><b>{x.title}</b><span>{x.text}</span></li>)}</ol></section>
    <section className="ac-sec" aria-labelledby="md"><h2 id="md">Drills</h2>
      <ul className="ac-drills">{drills.map((x) => <DrillRow key={x.id} d={{ ...x, areaName: x.who === "coach" ? "Team drill" : "On your own" } as any} category="Team talk" who={who} send={sendFor(x.id)} />)}</ul></section>
    <section className="ac-sec" aria-labelledby="mq"><h2 id="mq">Test yourself</h2>
      <Quiz key={t.id} topic={t.id} onDone={onScore} best={best} /></section>
    {next && <a className="ac-mind-next" href={base + "/" + next.id}>Next: {next.name}</a>}
  </article>;
}

function Quiz({ topic, onDone, best }: { topic: MentalId | "all"; onDone: (pct: number) => void; best?: number }) {
  const [level, setLevel] = useState<Level | "">(() => read<Level | "">("fc-academy-iq-level", "")), [timed, setTimed] = useState(() => read("fc-academy-iq-timed", false));
  const setL = (l: Level | "") => { setLevel(l); write("fc-academy-iq-level", l); if (l === "Advanced" && !timed) { setTimed(true); write("fc-academy-iq-timed", true); } };
  return <div className="ac-quizwrap">
    <div className="ac-quiz-set">
      <div className="ac-seg" role="group" aria-label="Difficulty"><button aria-pressed={!level} onClick={() => setL("")}>Mixed</button>{LEVELS.map((l) => <button key={l} aria-pressed={level === l} onClick={() => setL(l)}>{l === "Advanced" ? "Advanced (hard)" : l}</button>)}</div>
      <label className="ac-timed"><input type="checkbox" checked={timed} onChange={(e) => { setTimed(e.target.checked); write("fc-academy-iq-timed", e.target.checked); }} /> Timed{level ? ` (${TIME_FOR[level]} seconds)` : ""}</label>
    </div>
    <QuizRun key={topic + level + timed} topic={topic} level={level} timed={timed} onDone={(p) => onDone(p)} best={best} />
  </div>;
}

function QuizRun({ topic, level, timed, onDone, best }: { topic: MentalId | "all"; level: Level | ""; timed: boolean; onDone: (pct: number) => void; best?: number }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const qs = useMemo(() => quizFor(topic, 10, seed, level), [topic, seed, level]);
  const [at, setAt] = useState(0), [pick, setPick] = useState<number | null>(null), [right, setRight] = useState(0), [left, setLeft] = useState<number | null>(null), [late, setLate] = useState(false);
  const done = at >= qs.length, Q0 = qs[at], S = Q0 ? shuffled(Q0, seed + at) : null, Q = Q0 && S ? { ...Q0, ...S } : Q0;
  const secs = Q0 ? TIME_FOR[Q0.level] : 0;
  useEffect(() => { if (!timed || done || pick != null) { setLeft(null); return; } setLeft(secs); setLate(false);
    const t0 = Date.now(), iv = setInterval(() => { const l = Math.max(0, secs - Math.floor((Date.now() - t0) / 1000)); setLeft(l); if (l <= 0) { clearInterval(iv); setLate(true); setPick(-1); } }, 250);
    return () => clearInterval(iv); }, [at, timed, done, pick == null]);
  const choose = (k: number) => { if (pick != null) return; setPick(k); if (k === Q.answer) setRight((r) => r + 1); };
  const next = () => { const n = at + 1; setAt(n); setPick(null); setLate(false); if (n >= qs.length) onDone(Math.round((100 * right) / qs.length)); };
  const restart = () => { setAt(0); setPick(null); setRight(0); setLate(false); setSeed(Math.floor(Math.random() * 1e9)); };
  if (done) { const pct = Math.round((100 * right) / qs.length); return <div className="ac-quiz ac-quiz-done" aria-live="polite">
    <b className="ac-quiz-score">{right} of {qs.length}</b><span>{quizVerdict(right, qs.length)}{level ? ` · ${level}` : ""}{timed ? " · timed" : ""}</span>
    {best != null && <small>{pct > best ? "New best!" : `Your best: ${Math.max(best, pct)}%`}</small>}
    <button className="btn primary" onClick={restart}>Try again</button></div>; }
  return <div className="ac-quiz">
    <div className="ac-quiz-hd"><span>Situation {at + 1} of {qs.length}</span>{left != null && <span className={"ac-quiz-time" + (left <= 5 ? " low" : "")} aria-label={`${left} seconds left`}>{left}s</span>}<span className={"ac-lvl " + Q.level.toLowerCase()}>{Q.level}</span></div>
    <p className="ac-quiz-q">{Q.q}</p>
    <div className="ac-quiz-opts" role="group" aria-label="Your answer">{Q.options.map((o, k) => <button key={k} disabled={pick != null && k !== pick && k !== Q.answer}
      className={pick == null ? "" : k === Q.answer ? "right" : k === pick ? "wrong" : ""} aria-pressed={pick === k} onClick={() => choose(k)}>{o}</button>)}</div>
    {pick != null && <div className={"ac-quiz-why " + (pick === Q.answer ? "right" : "wrong")} role="status"><b>{pick === Q.answer ? "Right." : late ? "Time's up." : "Not quite."}</b> {Q.why}
      <div><button className="btn primary sm" onClick={next} autoFocus>{at + 1 < qs.length ? "Next situation" : "See your score"}</button></div></div>}
  </div>;
}

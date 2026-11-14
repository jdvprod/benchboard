/** Floorcall Live demo (#/demo): a whole sample match that plays itself, point by point, on the real gamecast.
 * No account, no cloud: the events are generated here and revealed on a timer, so anyone can see Live working. */
import { useEffect, useMemo, useRef, useState } from "react";
import { replay } from "../sports/volleyball/engine";
import { SAMPLE_OPP_ROSTER, SAMPLE_ROSTER, sampleMatch } from "../sports/volleyball/sample";
import { tr } from "../lib/i18n";
import { placeUrl } from "../cloud/links";
import { Game, LMatch, LPlayer } from "./data";
import { GameView } from "./GameView";

const SPEEDS = [1, 3, 10];
const STEP = 2400; // ms between plays at 1×

export function DemoGame({ Shell }: { Shell: any }) {
  const events = useMemo(() => sampleMatch(23, Date.now() - 60 * 60000, { sets: 4, finished: true }), []);
  const setStarts = useMemo(() => events.map((e, i) => (e.t === "NS" ? i : -1)).filter((i) => i >= 0), [events]);
  const [n, setN] = useState(() => Math.min(events.length, (setStarts[0] || 0) + 34)); // open mid-set so there's a game on
  const [speed, setSpeed] = useState(1), [paused, setPaused] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const done = n >= events.length;
  useEffect(() => {
    if (paused || done) return;
    const next = events[n];
    // touches inside a rally come quicker; a longer breath between sets
    const wait = (next?.t === "NS" ? STEP * 2.5 : /^(P[0-3]|D|AST|SATT|TA|SI|BT|FB)$/.test(next?.t || "") ? STEP * 0.55 : STEP) / speed;
    timer.current = window.setTimeout(() => setN((x) => Math.min(events.length, x + 1)), wait);
    return () => window.clearTimeout(timer.current);
  }, [n, paused, speed, done, events]);
  useEffect(() => { document.title = tr("Demo game") + " · Floorcall Live"; }, []);

  const players: LPlayer[] = SAMPLE_ROSTER.map((p) => ({ id: p.id, num: p.num, first: p.first, last: p.last[0], pos: p.pos, photo: null }));
  const m: LMatch = { id: "demo", opp: "Ridgeview", date: new Date().toISOString().slice(0, 10), bestOf: 5, status: done ? "done" : "live", event: tr("Demo game"), site: "home", kind: "match", oppLogo: null, oppRoster: SAMPLE_OPP_ROSTER };
  const g: Game = { m, R: replay(events.slice(0, n) as any, { id: "demo", bestOf: 5 }) };
  const curSet = setStarts.filter((i) => i < n).length;
  const jumpSet = (k: number) => { const i = setStarts[k]; if (i != null) setN(i + 1); };

  return <Shell team="Westbrook">
    <section className="lv-demo" aria-label={tr("Demo controls")}>
      <div className="lv-demo-t"><b>{tr("Demo game")}</b><span>{tr("A sample match playing itself, just as families see a real one. Made-up teams and players.")}</span></div>
      <div className="lv-demo-c">
        <button className="btn sm" onClick={() => (done ? setN(setStarts[0] + 1) : setPaused(!paused))}>{done ? tr("Replay") : paused ? tr("Play") : tr("Pause")}</button>
        <div className="lv-gc-seg" role="group" aria-label={tr("Speed")}>{SPEEDS.map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
        <div className="lv-gc-seg" role="group" aria-label={tr("Jump to set")}>{setStarts.map((_, k) => <button key={k} aria-pressed={curSet === k + 1} onClick={() => jumpSet(k)}>{tr("Set {n}", { n: k + 1 })}</button>)}</div>
        <a className="btn sm primary" href={placeUrl("app", "#/account/signup")}>{tr("Get Floorcall for your team")}</a>
      </div>
    </section>
    <GameView g={g} team="Westbrook" players={players} fresh={done ? tr("Final") : paused ? tr("Paused") : tr("Live demo · {s}×", { s: String(speed) })} logo={null} />
  </Shell>;
}

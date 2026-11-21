/** Academy → Strength and jumping: a short guide to training safely, sample weeks by level, and every lift, jump and
 * prevention routine, grouped by what it's for. Coaches can add any of them to a practice or send them to players. */
import { useState } from "react";
import { Level, LEVELS, Who } from "./content";
import { STRENGTH, STRENGTH_GROUPS, STRENGTH_GUIDE, StrengthGroup } from "./strengthData";
import { DrillRow, OwnSection, usePicks } from "./Library";
import { rpc } from "../cloud/client";

export function StrengthPage({ who, coach }: { who: Who; coach: boolean }) {
  const { teams, teamPicks, loadTeam } = usePicks(coach);
  const [level, setLevel] = useState<Level | "">(""), [week, setWeek] = useState(0), [group, setGroup] = useState<StrengthGroup | "">("");
  const sendFor = (id: string) => coach && teams.length ? {
    teams, picked: (t: string) => (teamPicks[t] || []).includes(id),
    toggle: async (t: string, on: boolean) => { await rpc("team_pick_drill", { t, drill: id, pick: on, note: null }); await loadTeam(t); },
  } : undefined;
  const list = STRENGTH.filter((x) => (!level || x.level === level) && (!group || x.group === group));
  const W = STRENGTH_GUIDE.weeks[week];
  return <article className="ac-lib ac-str">
    <header className="ac-lib-hd">
      <a className="ac-back" href={"#/" + (who === "player" ? "players" : "coaches")}>Academy</a>
      <h1>Strength and jumping</h1>
      <p>{STRENGTH_GUIDE.intro}</p>
    </header>

    <section className="ac-str-safe" aria-labelledby="str-safe"><h2 id="str-safe">Train safely</h2>
      <ul>{STRENGTH_GUIDE.safety.map((x) => <li key={x}>{x}</li>)}</ul></section>

    <section className="ac-sec" aria-labelledby="str-pr"><h2 id="str-pr">How it works</h2>
      <ol className="ac-str-pr">{STRENGTH_GUIDE.principles.map((p) => <li key={p.title}><b>{p.title}</b><span>{p.text}</span></li>)}</ol></section>

    <section className="ac-sec" aria-labelledby="str-wk"><h2 id="str-wk">A week of training</h2>
      <div className="ac-seg" role="group" aria-label="Plan">{STRENGTH_GUIDE.weeks.map((w, i) => <button key={w.title} aria-pressed={week === i} onClick={() => setWeek(i)}>{w.title.split(" (")[0]}</button>)}</div>
      <div className="ac-str-week"><h3><span className={"ac-lvl " + W.level.toLowerCase()}>{W.level}</span> {W.title}</h3>
        <ul>{W.days.map((d) => { const [h, ...rest] = d.split(": "); return <li key={d}>{rest.length ? <><b>{h}</b>{": " + rest.join(": ")}</> : d}</li>; })}</ul></div>
    </section>

    <section className="ac-sec" aria-labelledby="str-ex"><h2 id="str-ex">Exercises <small className="ac-count">{list.length}</small></h2>
      <div className="ac-filters">
        <div className="ac-chips" role="group" aria-label="What it's for"><button aria-pressed={!group} onClick={() => setGroup("")}>Everything</button>{STRENGTH_GROUPS.map(([g, name]) => <button key={g} aria-pressed={group === g} onClick={() => setGroup(group === g ? "" : g)}>{name}</button>)}</div>
        <div className="ac-seg" role="group" aria-label="Level"><button aria-pressed={!level} onClick={() => setLevel("")}>All levels</button>{LEVELS.map((l) => <button key={l} aria-pressed={level === l} onClick={() => setLevel(level === l ? "" : l)}>{l}</button>)}</div>
      </div>
      {STRENGTH_GROUPS.filter(([g]) => list.some((x) => x.group === g)).map(([g, name, sub]) => <div key={g} className="ac-str-group">
        <h3>{name}</h3><p className="ac-str-sub">{sub}</p>
        <ul className="ac-drills">{list.filter((x) => x.group === g).map((x) => <DrillRow key={x.id} d={{ ...x, areaName: "" } as any} category="Conditioning" who={who} send={sendFor(x.id)} />)}</ul>
      </div>)}
    </section>
    <section className="ac-sec"><OwnSection area="strength" who={who} category="Conditioning" title="Your own exercises" /></section>
    <p className="ac-str-foot">These exercises are general guidance for healthy athletes, not medical advice or a personal program. See the <a href="../legal/terms.html#training">training and safety terms</a>.</p>
  </article>;
}

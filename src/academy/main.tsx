/** Floorcall Academy: each volleyball skill, for players learning it and coaches teaching it. Its own site.
 *   #/                     the skills (in the last view chosen)
 *   #/players, #/coaches   the skills, for players or for coaches
 *   #/players/serving      one skill; links can be sent to a team
 * Players can check off what they can do; that's kept on this device. Coaches can add any drill to their practice plans. */
import "../styles/app.css";
import "./academy.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { watchErrors } from "../app/errors";
import { SiteSwitch } from "../ui/SiteSwitch";
import { placeUrl } from "../cloud/links";
import { cloudAvailable, userMeta } from "../cloud/client";
import { SiteGate } from "../cloud/SiteGate";
import { checks, Drill, Level, Skill, skill, SKILLS, Who } from "./content";
import { Diagram } from "./Diagram";

const LEVELS: Level[] = ["Beginner", "Intermediate", "Advanced"];
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: kept for this visit */ } };
const parse = () => location.hash.replace(/^#\/?/, "").split(/[/?]/).filter(Boolean);
const roleOf = (seg?: string): Who | null => (seg === "players" ? "player" : seg === "coaches" ? "coach" : null);
/** "I can dig a down ball" → "Can dig a down ball", for the coach's progression list. */
const coachLine = (t: string) => { const x = t.replace(/^I can /, "can ").replace(/^I'm /, "is ").replace(/^I /, "").replace(/^My /, "their "); return x[0].toUpperCase() + x.slice(1); };
const seg = (w: Who) => (w === "player" ? "players" : "coaches");
/** A drill, packed into a link that adds it to the coach's drill library in the Floorcall app. */
export const drillLink = (d: Drill, s: Skill) => {
  const json = JSON.stringify({ n: d.name, c: s.category, m: d.minutes, d: [d.needs + ".", ...d.how, "Coaching points: " + d.points.join(" ")].join(" "), src: "academy", ...(d.for ? { f: d.for } : {}) });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return placeUrl("app", "practice/drill:" + b64);
};

function App() {
  const [route, setRoute] = useState(parse);
  const [done, setDone] = useState<string[]>(() => read("fc-academy-done", []));
  // coaches see both versions; players, parents and fans see the player's version
  const coach = !cloudAvailable() || userMeta().kind === "coach";
  const remembered = read<Who>("fc-academy-role", coach ? "coach" : "player");
  const who: Who = coach ? roleOf(route[0]) || remembered : "player";
  const id = roleOf(route[0]) ? route[1] : route[0];
  const sk = id ? skill(id) : undefined;
  useEffect(() => { const f = () => { setRoute(parse()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  useEffect(() => { write("fc-academy-role", who); document.title = (sk ? sk.name + " · " : "") + "Floorcall Academy"; }, [who, sk]);
  const toggle = (k: string) => { const next = done.includes(k) ? done.filter((x) => x !== k) : [...done, k]; setDone(next); write("fc-academy-done", next); };
  const switchTo = (w: Who) => { location.hash = "#/" + seg(w) + (sk ? "/" + sk.id : ""); };
  return <div className="ac">
    <header className="ac-top">
      <a className="ac-brand" href={"#/" + seg(who)}><b>Floorcall</b><span>Academy</span></a>
      {coach && <div className="ac-role" role="group" aria-label="Show this for">
        <button aria-pressed={who === "player"} onClick={() => switchTo("player")}>For players</button>
        <button aria-pressed={who === "coach"} onClick={() => switchTo("coach")}>For coaches</button>
      </div>}
      <SiteSwitch here="academy" />
    </header>
    <main className="ac-main"><SiteGate name="Floorcall Academy" kind="athlete" what="How to serve, pass, set, hit and play defense: what good looks like, the mistakes that cost points and how to fix them, and drills for every level."
      points={["Court diagrams for every skill", "Players: step-by-step guides, drills you can do on your own, and a checklist", "Coaches: what to watch for, team concepts, and drills that go straight into your practice plans"]}>
      {sk ? <SkillPage s={sk} who={who} done={done} toggle={toggle} /> : id ? <Missing who={who} /> : <Home who={who} done={done} coach={coach} />}</SiteGate></main>
    <footer className="ac-foot">Your checklist is saved on this device. <a href="../legal/privacy.html">Privacy</a> · <a href="../legal/terms.html">Terms</a></footer>
  </div>;
}

function Missing({ who }: { who: Who }) {
  return <div className="ac-empty"><h1>That page isn't here</h1><p><a href={"#/" + seg(who)}>See every skill</a></p></div>;
}

function Home({ who, done, coach }: { who: Who; done: string[]; coach: boolean }) {
  return <>
    <section className="ac-hero">
      <h1>{who === "player" ? "Get better at volleyball, one skill at a time." : "Teach every skill the same way, every season."}</h1>
      <p>{who === "player"
        ? "What good looks like for each skill, the mistakes that cost points and how to fix them, drills you can do on your own, and a checklist to see how far you've come."
        : "The key points to teach, what to watch for, the mistakes and their fixes, team concepts, and drills you can drop straight into a practice plan in Floorcall."}</p>
    </section>
    <ol className="ac-skills">{SKILLS.map((s) => {
      const all = checks(s), n = all.filter((k) => done.includes(k)).length, teamDrills = s.drills.filter((d) => d.who === "coach").length, own = s.drills.filter((d) => d.who === "player").length;
      return <li key={s.id}><a href={"#/" + seg(who) + "/" + s.id}>
        <span className="ac-thumb"><Diagram id={s.id} small /></span>
        <span className="ac-sk-text"><b>{s.name}</b><span>{s.tagline}</span></span>
        <span className="ac-sk-meta">{who === "player"
          ? <><span className="ac-meter" aria-hidden="true"><i style={{ width: Math.round((n / all.length) * 100) + "%" }} /></span><small>{n ? `${n} of ${all.length} checked off` : `${own} drills on your own`}</small></>
          : <small>{teamDrills} team drills · measured by {s.stat.name.split(" (")[0].toLowerCase()}</small>}</span>
        <svg className="ac-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </a></li>; })}</ol>
    {coach && <p className="ac-other">{who === "player" ? <>Coaching a team? <a href="#/coaches">See the coach's version</a>, with team drills you can add to practice.</> : <>Send players the <a href="#/players">player's version</a>: the same skills, with drills they can do on their own and a checklist.</>}</p>}
  </>;
}

function SkillPage({ s, who, done, toggle }: { s: Skill; who: Who; done: string[]; toggle: (k: string) => void }) {
  const i = SKILLS.indexOf(s), prev = SKILLS[i - 1], next = SKILLS[i + 1];
  const [forWho, setFor] = useState<"" | "girls" | "boys">(() => read("fc-academy-for", ""));
  const tagged = SKILLS.some((x) => x.drills.some((d) => d.for));
  const drills = s.drills.filter((d) => d.who === who && (!forWho || !d.for || d.for === forWho));
  const all = checks(s), n = all.filter((k) => done.includes(k)).length;
  const sections: [string, string][] = who === "player"
    ? [["cues", "Key points"], ["steps", "Step by step"], ["mistakes", "Mistakes and fixes"], ["drills", "Drills on your own"], ["check", "Check yourself"]]
    : [["cues", "Key points"], ["watch", "What to watch for"], ["mistakes", "Mistakes and fixes"], ["concepts", "Team concepts"], ["drills", "Drills for practice"], ["levels", "Progression"]];
  return <article className="ac-skill">
    <header className="ac-band">
      <div className="ac-band-text">
        <a className="ac-back" href={"#/" + seg(who)}>All skills</a>
        <h1>{s.name}</h1>
        <p className="ac-tag">{s.tagline}</p>
        <p className="ac-intro">{s.intro}</p>
        <p className="ac-stat"><b>Measured by</b> {s.stat.name}. <span>{s.stat.good}.</span></p>
      </div>
      <div className="ac-band-fig"><Diagram id={s.id} /></div>
    </header>
    <div className="ac-body">
      <nav className="ac-toc" aria-label="On this page"><ul>{sections.map(([k, l]) => <li key={k}><a href={"#" + "/" + seg(who) + "/" + s.id} onClick={(e) => { e.preventDefault(); document.getElementById("ac-" + k)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{l}</a></li>)}</ul></nav>
      <div className="ac-content">
        <section id="ac-cues" className="ac-sec"><h2>Key points</h2>
          <ul className="ac-cues">{s.cues.map((c) => <li key={c.title}><b>{c.title}</b><p>{c.text}</p></li>)}</ul></section>
        {who === "player" && <section id="ac-steps" className="ac-sec"><h2>Step by step</h2>
          <ol className="ac-steps">{s.steps.map((x) => <li key={x.title}><b>{x.title}</b><p>{x.text}</p></li>)}</ol></section>}
        {who === "coach" && <section id="ac-watch" className="ac-sec"><h2>What to watch for</h2>
          <ul className="ac-cues">{s.watch.map((c) => <li key={c.what}><b>{c.what}</b><p>{c.text}</p></li>)}</ul></section>}
        <section id="ac-mistakes" className="ac-sec"><h2>Mistakes and fixes</h2>
          <ul className="ac-mistakes">{s.mistakes.map((m) => <li key={m.what}><div><b>{m.what}</b>{who === "coach" && <p className="ac-why">{m.why}</p>}</div><p><span className="ac-fix">Fix</span> {m.fix}</p></li>)}</ul></section>
        {who === "coach" && <section id="ac-concepts" className="ac-sec"><h2>Team concepts</h2>
          {s.concepts.map((c) => <div key={c.title} className="ac-concept"><h3>{c.title}</h3><p>{c.text}</p>{c.points && <ul>{c.points.map((p) => <li key={p}>{p}</li>)}</ul>}</div>)}</section>}
        <section id="ac-drills" className="ac-sec"><h2>{who === "player" ? "Drills on your own" : "Drills for practice"}</h2>
          {tagged && <div className="ac-for" role="group" aria-label="Drills for">{([["", "All drills"], ["girls", "Girls"], ["boys", "Boys"]] as const).map(([k, l]) => <button key={k} aria-pressed={forWho === k} onClick={() => { setFor(k); write("fc-academy-for", k); }}>{l}</button>)}</div>}
          {who === "coach" && <p className="ac-note">"Add to my practice" opens Floorcall and puts the drill in your drill library, ready for any practice plan.</p>}
          <ul className="ac-drills">{drills.map((d) => <DrillRow key={d.id} d={d} s={s} who={who} />)}</ul></section>
        {who === "player" && <section id="ac-check" className="ac-sec"><h2>Check yourself</h2>
          <p className="ac-note">Check off what you can do. It's saved on this device. {n ? `${n} of ${all.length} so far.` : ""}</p>
          {LEVELS.map((l) => <fieldset key={l} className="ac-level"><legend>{l}</legend>
            {s.levels[l].map((t, k) => { const key = `${s.id}:${l}:${k}`; return <label key={key} className="ac-check"><input type="checkbox" checked={done.includes(key)} onChange={() => toggle(key)} /><span>{t}</span></label>; })}
          </fieldset>)}</section>}
        {who === "coach" && <section id="ac-levels" className="ac-sec"><h2>Progression</h2>
          <p className="ac-note">What players should be able to do at each level. Players see these as a checklist on their version of this page.</p>
          <div className="ac-prog">{LEVELS.map((l) => <div key={l}><h3>{l}</h3><ul>{s.levels[l].map((t) => <li key={t}>{coachLine(t)}</li>)}</ul></div>)}</div></section>}
        <nav className="ac-pager" aria-label="More skills">
          {prev ? <a href={"#/" + seg(who) + "/" + prev.id}><small>Previous</small><b>{prev.name}</b></a> : <span />}
          {next ? <a className="next" href={"#/" + seg(who) + "/" + next.id}><small>Next</small><b>{next.name}</b></a> : <a className="next" href={"#/" + seg(who)}><small>Back to</small><b>All skills</b></a>}
        </nav>
      </div>
    </div>
  </article>;
}

function DrillRow({ d, s, who }: { d: Drill; s: Skill; who: Who }) {
  const [open, setOpen] = useState(false);
  return <li className={"ac-drill" + (open ? " open" : "")}>
    <button className="ac-drill-hd" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="ac-drill-name"><b>{d.name}{d.for && <span className="ac-forchip">{d.for === "girls" ? "Girls" : "Boys"}</span>}</b><small>{d.needs}</small></span>
      <span className="ac-drill-meta"><span className={"ac-lvl " + d.level.toLowerCase()}>{d.level}</span><span className="num">{d.minutes} min</span></span>
      <svg className="ac-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="ac-drill-body">
      <div><h3>How</h3><ol>{d.how.map((h) => <li key={h}>{h}</li>)}</ol></div>
      <div><h3>{who === "player" ? "Focus on" : "Coach"}</h3><ul>{d.points.map((p) => <li key={p}>{p}</li>)}</ul></div>
      {who === "coach" && <a className="btn primary sm ac-add" href={drillLink(d, s)} target="_blank" rel="noopener">Add to my practice</a>}
    </div>}
  </li>;
}

watchErrors();
// works without a signal once visited (see public/academy/sw.js)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) addEventListener("load", () => {
  navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((r) => {
    const files = [location.href.split("#")[0], ...performance.getEntriesByType("resource").map((x) => x.name).filter((u) => u.startsWith(location.origin) || /fonts\.(googleapis|gstatic)\.com/.test(u))];
    r.active?.postMessage({ cache: [...new Set(files)] });
  }).catch(() => {});
});
createRoot(document.getElementById("root")!).render(<App />);

/** Jumpset Recruit for athletes (free account): how to get recruited, what to have ready, emails to coaches,
 * and Reel Studio, which turns your clips or a whole game into a batch of highlight videos. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Athlete, EmailKind, EMAIL_KINDS, emailGaps, Target, writeEmail } from "./emails";
import { Clip, clock } from "../film/clips";
import { canMakeReel, reelLength, renderReel } from "../film/reel";
import { cloudAvailable, currentUser, updateMeta, userMeta } from "../cloud/client";
import { MiniAuth, SignedIn } from "../cloud/MiniAuth";

const KEY = "bbr-athlete";
const BLANK: Athlete = { first: "", last: "", grad: "", pos: "", height: "" };
const fromName = (): Partial<Athlete> => { const n = (currentUser() && userMeta().name || "").trim().split(/\s+/); return n[0] ? { first: n[0], last: n.slice(1).join(" ") } : {}; };
const loadA = (): Athlete => { const cloud = (currentUser() && userMeta().athlete) as Partial<Athlete> | undefined; if (cloud) return { ...BLANK, ...fromName(), ...cloud }; if (currentUser()) { try { const local = JSON.parse(localStorage.getItem(KEY) || "{}"); return { ...BLANK, ...fromName(), ...local }; } catch { return { ...BLANK, ...fromName() }; } } try { return { ...BLANK, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...BLANK }; } };
let syncTimer: any = 0;
const saveA = (a: Athlete) => {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private window */ }
  // kept with the account so the details are there on every device
  if (currentUser()) { clearTimeout(syncTimer); syncTimer = setTimeout(() => updateMeta({ athlete: { ...(userMeta().athlete || {}), ...a } as any }).catch(() => {}), 1200); }
};
function useAthlete(): [Athlete, (p: Partial<Athlete>) => void] {
  const [a, setA] = useState<Athlete>(loadA);
  return [a, (p) => setA((x) => { const n = { ...x, ...p }; saveA(n); return n; })];
}

/** The athlete tools need a free account. */
function Gate({ Shell, crumb, on, children }: { Shell: any; crumb: string; on: string; children: () => any }) {
  const [, bump] = useState(0);
  if (cloudAvailable() && !currentUser()) return <Shell crumb={crumb}><GuideNav on={on} />
    <section className="rg-head"><h1>{crumb}</h1><p>Free for athletes and families. Your details and checklist are saved to your account, so they're there on every device.</p></section>
    <MiniAuth kind="athlete" title="Create your free account" sub="One account for the recruiting guide, emails to coaches and Reel Studio." onIn={() => bump((x) => x + 1)} />
  </Shell>;
  return children();
}
const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); return true; } catch { return false; } };

export function GuideNav({ on }: { on: string }) {
  return <nav className="rg-nav" aria-label="For athletes">{[["guide", "Recruiting guide"], ["emails", "Emails to coaches"], ["studio", "Reel Studio"]].map(([k, l]) => <a key={k} href={"#/" + k} aria-current={on === k ? "page" : undefined}>{l}</a>)}</nav>;
}

/* ---------- the guide ---------- */
const READY: [string, string][] = [
  ["Highlight video", "Two to four minutes, best plays first. Mark yourself before each play (your number on screen, or a freeze with an arrow). Reel Studio makes this for you."],
  ["Full match film", "One whole, unedited set or match. Coaches who like your highlights ask for it next, to see how you move between plays."],
  ["Verified stats", "A Jumpset Recruit profile from your coach: numbers recorded live, match by match, with clips behind them. Ask your coach to share yours."],
  ["Measurables", "Height, standing reach, approach jump and block jump, measured in the last few months. Round honestly; coaches re-measure at camps."],
  ["Grades", "Unofficial transcript and GPA, plus test scores if you have them. Academics open doors to more schools and to academic aid."],
  ["Schedule", "Your club and high school schedule with your jersey number, updated before every tournament."],
  ["References", "Your club coach and high school coach, with their emails. Ask them first so they expect the call."],
  ["Eligibility", "Register with the NCAA Eligibility Center (Division I and II) and the NAIA Eligibility Center if those levels interest you. Your counselor can check your core courses."],
  ["An email you check", "A simple address with your name in it. Check spam every week: coaches' replies land there."],
];
const YEARS: [string, string[]][] = [
  ["9th grade", ["Get better: that's the whole job this year.", "Take the core courses colleges expect and keep your grades up.", "Start filming your matches, even from the bleachers.", "Start a list of schools by fit: academics, level, location, size, cost."]],
  ["10th grade", ["Make your first highlight video and send your first emails to schools on your list.", "Go to camps at schools you're interested in; camps are how coaches see you up close.", "Many coaches can't reply personally yet because of NCAA contact rules, but they read emails and track players. Check the current NCAA recruiting calendar for volleyball."]],
  ["11th grade", ["The big year: club season is where most college coaches watch.", "Send your schedule a week or two before each tournament and new film after it.", "Visit campuses, register with the eligibility centers, take the SAT or ACT if your schools want it.", "Narrow your list to schools that answer you."]],
  ["12th grade", ["Official visits, offers and signing. Division III and NAIA schools often recruit later, so keep emailing.", "Keep your grades up: offers depend on finishing strong.", "Thank every coach who recruited you, including the ones you say no to."]],
];
const VIDEO_TIPS = ["Best five plays in the first 30 seconds. Many coaches decide there.", "Show every skill for your position: hitters hit and pass, setters set from bad passes too, liberos dig and serve-receive.", "Landscape, steady, filmed from behind the end line and up high if you can.", "Skip slow motion, long intros and loud music. Coaches watch on mute.", "Upload to YouTube (unlisted is fine) and send the link. Never attach a video file to an email."];
const SAY_TIPS = ["You write it, not a parent. Coaches want to hear from you.", "Short: five or six sentences a coach can read between practices.", "One real reason you like their school. Generic emails get skipped.", "Grad year, position and club team in the subject line.", "Links, not attachments: highlight video, full film, stats profile.", "Follow up every four to six weeks with something new: a schedule, new film, a better GPA."];

export function GuidePage({ Shell }: { Shell: any }) { return <Gate Shell={Shell} crumb="Recruiting guide" on="guide">{() => <Guide Shell={Shell} />}</Gate>; }
function Guide({ Shell }: { Shell: any }) {
  // the newest checklist wins: this device's copy or the account's (saved from another device, or still on its way up)
  const [done, setDone] = useState<Record<string, boolean>>(() => { const c = (userMeta().athlete as any)?.ready, cAt = +((userMeta().athlete as any)?.readyAt || 0); let l: any = null, lAt = 0; try { l = JSON.parse(localStorage.getItem("bbr-ready") || "null"); lAt = +(localStorage.getItem("bbr-ready-at") || 0); } catch { /* private window */ } return (c && cAt >= lAt ? c : l || c) || {}; });
  const tick = (k: string) => setDone((d) => { const n = { ...d, [k]: !d[k] }, at = Date.now(); try { localStorage.setItem("bbr-ready", JSON.stringify(n)); localStorage.setItem("bbr-ready-at", String(at)); } catch { /* ignore */ } if (currentUser()) updateMeta({ athlete: { ...(userMeta().athlete || {}), ready: n, readyAt: at } }).catch(() => {}); return n; });
  const count = READY.filter(([k]) => done[k]).length;
  return <Shell crumb="Recruiting guide"><GuideNav on="guide" />
    <SignedIn onOut={() => location.reload()} />
    <section className="rg-head"><h1>Getting recruited for college volleyball</h1>
      <p>What college coaches want to see, what to have ready before you email them, and what to do each year of high school.</p></section>
    <section className="rc-card"><div className="rg-row"><h2>What to have ready</h2><span className="rg-count">{count} of {READY.length} ready</span></div>
      <div className="rg-meter" aria-hidden="true"><i style={{ width: (count / READY.length) * 100 + "%" }} /></div>
      <ul className="rg-check">{READY.map(([k, d]) => <li key={k} className={done[k] ? "on" : ""}><label><input type="checkbox" checked={!!done[k]} onChange={() => tick(k)} /><span><b>{k}</b><small>{d}</small></span></label></li>)}</ul>
      <p className="rc-note">Your checklist is saved to your account.</p>
    </section>
    <section className="rc-card"><h2>Year by year</h2>
      <ol className="rg-years">{YEARS.map(([y, items]) => <li key={y}><b>{y}</b><ul>{items.map((x) => <li key={x}>{x}</li>)}</ul></li>)}</ol>
      <p className="rc-note">Contact rules and calendars differ by division and change from year to year. Check the NCAA and NAIA sites for the current rules before you plan around a date.</p>
    </section>
    <div className="rc-two">
      <section className="rc-card"><h2>A highlight video that works</h2><ul className="rg-list">{VIDEO_TIPS.map((x) => <li key={x}>{x}</li>)}</ul><a className="btn primary" href="#/studio">Make your videos in Reel Studio</a></section>
      <section className="rc-card"><h2>What to say to coaches</h2><ul className="rg-list">{SAY_TIPS.map((x) => <li key={x}>{x}</li>)}</ul><a className="btn primary" href="#/emails">Write an email to a coach</a></section>
    </div>
  </Shell>;
}

/* ---------- email writer ---------- */
export function EmailsPage({ Shell }: { Shell: any }) { return <Gate Shell={Shell} crumb="Emails to coaches" on="emails">{() => <Emails Shell={Shell} />}</Gate>; }
function Emails({ Shell }: { Shell: any }) {
  const [a, setA] = useAthlete();
  const [kind, setKind] = useState<EmailKind>("intro"), [t, setTt] = useState<Target>({}), [copied, setCopied] = useState("");
  const setT = (p: Partial<Target>) => setTt((x) => ({ ...x, ...p }));
  const e = writeEmail(kind, a, t), gaps = emailGaps(kind, a, t);
  const f = (k: keyof Athlete, label: string, ph = "", wide = false) => <label className={"rg-f" + (wide ? " wide" : "")}><span>{label}</span><input value={(a[k] as string) || ""} placeholder={ph} onChange={(x) => setA({ [k]: x.target.value } as any)} /></label>;
  const g = (k: keyof Target, label: string, ph = "", area = false) => <label className="rg-f wide"><span>{label}</span>{area ? <textarea rows={3} value={t[k] || ""} placeholder={ph} onChange={(x) => setT({ [k]: x.target.value })} /> : <input value={t[k] || ""} placeholder={ph} onChange={(x) => setT({ [k]: x.target.value })} />}</label>;
  const done = async (what: string, s: string) => { setCopied((await copy(s)) ? what : "Couldn't copy here: select the text and copy it"); setTimeout(() => setCopied(""), 2500); };
  const mailto = "mailto:?subject=" + encodeURIComponent(e.subject) + "&body=" + encodeURIComponent(e.body);
  return <Shell crumb="Emails to coaches"><GuideNav on="emails" />
    <section className="rg-head"><h1>Emails to college coaches</h1><p>Fill in your details once. Pick the email, add the coach and school, and copy it into your own email. Nothing is sent from here.</p></section>
    <div className="rg-kinds" role="tablist">{EMAIL_KINDS.map(([k, l, d]) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}><b>{l}</b><small>{d}</small></button>)}</div>
    <div className="rg-mail">
      <div className="stack">
        <section className="rc-card rg-this"><h2>This email</h2><div className="rg-form">
          {g("coach", "Coach's name", "Coach Rivera")}{g("school", "School", "University of …")}
          {(kind === "intro" || kind === "camp" || kind === "thanks") && g("why", kind === "intro" ? "Why this school (one real reason)" : "One thing that stood out", kind === "intro" ? "your fast offense and the nursing program" : "the serve-receive session with your libero", true)}
          {(kind === "camp" || kind === "thanks") && g("camp", kind === "camp" ? "Which camp" : "Thank them for", kind === "camp" ? "your elite camp on June 14" : "the call on Tuesday")}
          {(kind === "intro" || kind === "schedule" || kind === "video") && g("events", kind === "video" ? "Where the new film is from" : "Tournaments (one per line)", "Las Vegas Classic · Apr 11–13 · Las Vegas Convention Center", true)}
        </div></section>
        <section className="rc-card rg-you"><h2>About you <small className="muted">saved to your account</small></h2><div className="rg-form">
          {f("first", "First name")}{f("last", "Last name")}{f("grad", "Grad year", "2028")}{f("pos", "Position", "Outside hitter")}{f("height", "Height", "5'11\"")}
          {f("approach", "Approach jump", "9'10\"")}{f("block", "Block jump", "9'4\"")}{f("club", "Club team", "Club name 17 Elite")}{f("clubNum", "Jersey #", "7")}{f("school", "High school")}{f("city", "City, state")}{f("gpa", "GPA", "3.8")}{f("major", "What you want to study")}
          {f("stats", "Your numbers (one line)", "3.2 kills/set, .260 hitting, 2.4 digs/set", true)}
          {f("video", "Highlight video link", "https://youtu.be/…", true)}{f("profile", "Jumpset profile link", "", true)}
          {f("email", "Your email")}{f("phone", "Your phone")}{f("clubCoach", "Club coach")}{f("clubCoachEmail", "Club coach email")}
        </div></section>
      </div>
      <section className="rc-card rg-preview" aria-label="Your email">
        <div className="rg-row"><h2>Your email</h2>{copied && <span className="rg-copied" role="status">{copied}</span>}</div>
        <div className="rg-subj"><span>Subject</span><b>{e.subject}</b></div>
        <pre className="rg-body">{e.body}</pre>
        {gaps.length > 0 && <p className="rg-gaps">Still to add: {gaps.join(", ")}.</p>}
        <div className="row"><button className="btn primary" onClick={() => done("Email copied", e.body)}>Copy email</button><button className="btn" onClick={() => done("Subject copied", e.subject)}>Copy subject</button><a className="btn" href={mailto}>Open in my email app</a></div>
        <p className="rc-note">Find coaches' emails on each school's athletics site, under the volleyball staff page. Send to the head coach and the recruiting coordinator.</p>
      </section>
    </div>
  </Shell>;
}

/* ---------- Reel Studio ---------- */
type Cat = "K" | "BS" | "SA" | "D" | "AST" | "P3" | "SI" | "TAG";
const CATS: [Cat, string, string][] = [["K", "Kill", "k"], ["BS", "Block", "b"], ["SA", "Ace", "a"], ["D", "Dig", "d"], ["AST", "Set", "s"], ["P3", "Pass", "p"], ["SI", "Serve", "v"], ["TAG", "Other", "o"]];
const CAT_NAME = Object.fromEntries(CATS.map(([c, l]) => [c, l])) as Record<Cat, string>;
const RANK: Record<Cat, number> = { K: 5, BS: 5, SA: 4, D: 3, AST: 3, P3: 2, SI: 1, TAG: 2 };
const REELS: [string, string, Cat[] | null][] = [["best", "Best of", null], ["hitting", "Hitting", ["K"]], ["blocking", "Blocking", ["BS"]], ["defense", "Defense and passing", ["D", "P3"]], ["serving", "Serving", ["SA", "SI"]], ["setting", "Setting", ["AST"]]];
interface Film { id: string; name: string; url: string; dur: number; game: boolean }
interface Mark { id: string; film: string; at: number; start: number; end: number; cat: Cat; star?: boolean }
let seq = 0; const nid = () => "s" + Date.now().toString(36) + (seq++).toString(36);

/** Clips for a reel: the category's plays, starred and strongest first for "Best of", capped at `max` seconds. Pure: unit tested. */
export function pickReel(marks: Mark[], cats: Cat[] | null, max = 180): Mark[] {
  const pool = marks.filter((m) => !cats || cats.includes(m.cat)).map((m, i) => ({ m, i, w: (m.star ? 10 : 0) + (cats ? 0 : RANK[m.cat]) }));
  pool.sort((a, b) => b.w - a.w || a.i - b.i);
  const out: Mark[] = []; let total = 0;
  for (const { m } of pool) { const d = m.end - m.start; if (total + d > max && out.length) continue; out.push(m); total += d; }
  return out;
}

export function StudioPage({ Shell }: { Shell: any }) { return <Gate Shell={Shell} crumb="Reel Studio" on="studio">{() => <Studio Shell={Shell} />}</Gate>; }
function Studio({ Shell }: { Shell: any }) {
  const [a, setA] = useAthlete();
  const [films, setFilms] = useState<Film[]>([]), [marks, setMarks] = useState<Mark[]>([]), [cur, setCur] = useState<string | null>(null);
  const [before, setBefore] = useState(6), [after, setAfter] = useState(2), [maxLen, setMaxLen] = useState(180);
  const [want, setWant] = useState<Record<string, boolean>>({ best: true }), [jobs, setJobs] = useState<{ key: string; name: string; status: string; f: number; url?: string; blob?: Blob }[]>([]);
  const vid = useRef<HTMLVideoElement>(null), stop = useRef<AbortController | null>(null);
  const film = films.find((f) => f.id === cur) || null;
  useEffect(() => () => { films.forEach((f) => URL.revokeObjectURL(f.url)); }, []);

  const add = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const url = URL.createObjectURL(file);
      const dur = await new Promise<number>((r) => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => r(v.duration || 0); v.onerror = () => r(0); v.src = url; });
      if (!dur) { URL.revokeObjectURL(url); continue; }
      const f: Film = { id: nid(), name: file.name, url, dur, game: dur > 90 };
      setFilms((x) => x.concat(f));
      if (!f.game) setMarks((x) => x.concat({ id: nid(), film: f.id, at: dur, start: 0, end: dur, cat: "K" })); // a short clip is one play
      else setCur((c) => c || f.id);
    }
  };
  const mark = (cat: Cat) => { const v = vid.current; if (!v || !film) return; const t = v.currentTime; setMarks((x) => x.concat({ id: nid(), film: film.id, at: t, start: Math.max(0, +(t - before).toFixed(1)), end: Math.min(film.dur, +(t + after).toFixed(1)), cat })); };
  const patch = (id: string, p: Partial<Mark>) => setMarks((x) => x.map((m) => (m.id === id ? { ...m, ...p } : m)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; if (e.metaKey || e.ctrlKey || e.altKey || !vid.current) return;
      const c = CATS.find(([, , k]) => k === e.key); if (c) { e.preventDefault(); mark(c[0]); return; }
      if (e.key === " " && el?.tagName !== "VIDEO") { e.preventDefault(); vid.current.paused ? vid.current.play().catch(() => {}) : vid.current.pause(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); vid.current.currentTime += e.key === "ArrowLeft" ? -5 : 5; }
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  });

  const asClip = (m: Mark): Clip => { const f = films.find((x) => x.id === m.film)!; return { id: m.id, matchId: m.film, url: f.url, start: m.start, end: m.end, label: CAT_NAME[m.cat] === "Other" ? "Highlight" : CAT_NAME[m.cat], t: m.cat, date: "", opp: "" }; };
  const plan = useMemo(() => REELS.map(([key, name, cats]) => { const ms = pickReel(marks, cats, maxLen); return { key, name, ms, secs: Math.round(reelLength(ms.map(asClip))) }; }), [marks, films, maxLen]);
  const name = `${a.first} ${a.last}`.trim();
  const make = async () => {
    const todo = plan.filter((p) => want[p.key] && p.ms.length >= (p.key === "best" ? 1 : 2));
    if (!todo.length) return;
    stop.current = new AbortController();
    setJobs(todo.map((p) => ({ key: p.key, name: p.name, status: "Waiting", f: 0 })));
    for (const p of todo) {
      const upd = (x: any) => setJobs((js) => js.map((j) => (j.key === p.key ? { ...j, ...x } : j)));
      try {
        const blob = await renderReel(p.ms.map(asClip), (c) => c.url, {
          player: { first: a.first || "Your", last: a.last || "Name", num: a.clubNum || "", pos: a.pos, grad: a.grad ? +a.grad : null, height: a.height },
          team: { name: a.club || a.school || "", level: p.key === "best" ? "" : p.name }, stats: [], verified: false, link: a.video ? "" : a.email || "",
          lines: [[a.grad && `Class of ${a.grad}`, a.pos, a.height].filter(Boolean).join("  ·  "), [a.club, a.school].filter(Boolean).join("  ·  "), a.gpa ? `GPA ${a.gpa}` : "", a.email || ""],
        }, { signal: stop.current.signal, onProgress: (text, f) => upd({ status: text, f }) });
        upd({ status: "Ready", f: 1, blob, url: URL.createObjectURL(blob) });
      } catch (e: any) { upd({ status: e?.name === "AbortError" ? "Stopped" : "Couldn't make this one in this browser", f: 0 }); if (e?.name === "AbortError") break; }
    }
  };
  const fileName = (j: { name: string; blob?: Blob }) => `${name || "Highlights"} ${j.name === "Best of" ? "highlights" : j.name.toLowerCase()}.${j.blob?.type.includes("mp4") ? "mp4" : "webm"}`.replace(/[^\w\- .]+/g, "");
  const busy = jobs.some((j) => j.status !== "Ready" && j.status !== "Stopped" && !j.status.startsWith("Couldn't"));
  const supported = canMakeReel();

  return <Shell crumb="Reel Studio"><GuideNav on="studio" />
    <section className="rg-head"><h1>Reel Studio</h1><p>Drop in your clips or a whole game, mark your plays, and get a batch of finished highlight videos at once: a best-of plus one for each skill. Your film never leaves this device.</p></section>
    {!supported && <p className="rg-gaps">This browser can't make videos. Use Chrome or Edge on a computer.</p>}
    <section className="rc-card"><h2>1. Your film</h2>
      <label className="rg-drop"><input type="file" accept="video/*" multiple onChange={(e) => { add(e.target.files); e.target.value = ""; }} aria-label="Add video files" />
        <b>Add videos</b><span>Short clips become one play each. Anything longer than 90 seconds opens as a game you mark plays in.</span></label>
      {films.length > 0 && <ul className="rg-films">{films.map((f) => <li key={f.id} className={cur === f.id ? "on" : ""}>
        <span><b>{f.name}</b><small>{clock(f.dur)} · {f.game ? `game · ${plural(marks.filter((m) => m.film === f.id).length, "play")} marked` : "clip"}</small></span>
        {f.game && <button className="btn sm" onClick={() => setCur(f.id)}>{cur === f.id ? "Marking" : "Mark plays"}</button>}
        <button className="btn sm" aria-label={"Remove " + f.name} onClick={() => { setFilms((x) => x.filter((y) => y.id !== f.id)); setMarks((x) => x.filter((m) => m.film !== f.id)); if (cur === f.id) setCur(null); }}>Remove</button></li>)}</ul>}
    </section>
    {film && <section className="rc-card"><h2>2. Mark your plays in {film.name}</h2>
      <div className="rg-mark">
        <video ref={vid} src={film.url} controls playsInline preload="auto" />
        <div className="stack">
          <p className="small muted">Play the game. The moment the ball hits the floor (or you touch it), tap what you did. Each tap saves the {before} seconds before through {after} after.</p>
          <div className="rg-cats">{CATS.map(([c, l, k]) => <button key={c} className="btn" onClick={() => mark(c)}>{l}<kbd>{k.toUpperCase()}</kbd></button>)}</div>
          <div className="row small" style={{ gap: 8 }}><label className="row" style={{ gap: 4 }}>Before <input className="input" type="number" min={2} max={20} value={before} onChange={(e) => setBefore(Math.max(2, Math.min(20, +e.target.value || 6)))} style={{ width: 56 }} />s</label><label className="row" style={{ gap: 4 }}>After <input className="input" type="number" min={0} max={8} value={after} onChange={(e) => setAfter(Math.max(0, Math.min(8, +e.target.value || 0)))} style={{ width: 52 }} />s</label></div>
          <p className="small muted">Keys: Space play/pause · ← → 5 s · letters mark plays</p>
        </div>
      </div>
    </section>}
    {marks.length > 0 && <section className="rc-card"><h2>{film ? "3" : "2"}. Your plays <small className="muted">{marks.length}</small></h2>
      <ul className="rg-marks">{marks.map((m) => { const f = films.find((x) => x.id === m.film); return <li key={m.id}>
        <button className={"rg-star" + (m.star ? " on" : "")} aria-pressed={!!m.star} aria-label="Must include in Best of" onClick={() => patch(m.id, { star: !m.star })}>★</button>
        <select value={m.cat} onChange={(e) => patch(m.id, { cat: e.target.value as Cat })} aria-label="Play type">{CATS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
        <button className="rg-at" onClick={() => { if (f?.game) { setCur(f.id); setTimeout(() => { if (vid.current) { vid.current.currentTime = m.start; vid.current.play().catch(() => {}); } }, 50); } }} disabled={!f?.game}>{f?.game ? `${clock(m.start)}–${clock(m.end)}` : f?.name}</button>
        {f?.game && <span className="rg-trim"><button className="btn sm" aria-label="Start earlier" onClick={() => patch(m.id, { start: Math.max(0, m.start - 1) })}>−1 s</button><button className="btn sm" aria-label="End later" onClick={() => patch(m.id, { end: Math.min(f.dur, m.end + 1) })}>+1 s</button></span>}
        <button className="btn sm" aria-label="Remove play" onClick={() => setMarks((x) => x.filter((y) => y.id !== m.id))}>✕</button></li>; })}</ul>
      <p className="rc-note">★ puts a play in your Best of first.</p>
    </section>}
    {marks.length > 0 && <section className="rc-card"><h2>Make your videos</h2>
      <div className="rg-form">
        <label className="rg-f"><span>First name</span><input value={a.first} onChange={(e) => setA({ first: e.target.value })} /></label><label className="rg-f"><span>Last name</span><input value={a.last} onChange={(e) => setA({ last: e.target.value })} /></label>
        <label className="rg-f"><span>Jersey #</span><input value={a.clubNum || ""} onChange={(e) => setA({ clubNum: e.target.value })} /></label><label className="rg-f"><span>Position</span><input value={a.pos} onChange={(e) => setA({ pos: e.target.value })} /></label>
        <label className="rg-f"><span>Grad year</span><input value={a.grad} onChange={(e) => setA({ grad: e.target.value })} /></label><label className="rg-f"><span>Height</span><input value={a.height} onChange={(e) => setA({ height: e.target.value })} /></label>
        <label className="rg-f"><span>Club team</span><input value={a.club || ""} onChange={(e) => setA({ club: e.target.value })} /></label><label className="rg-f"><span>Email for coaches</span><input value={a.email || ""} onChange={(e) => setA({ email: e.target.value })} /></label>
      </div>
      <ul className="rg-reels">{plan.map((p) => { const ok = p.ms.length >= (p.key === "best" ? 1 : 2); return <li key={p.key} className={ok ? "" : "off"}><label>
        <input type="checkbox" checked={!!want[p.key] && ok} disabled={!ok} onChange={(e) => setWant((w) => ({ ...w, [p.key]: e.target.checked }))} />
        <span><b>{p.name}</b><small>{ok ? `${plural(p.ms.length, "play")} · ${clock(p.secs)}` : "Mark at least 2 plays"}</small></span></label></li>; })}</ul>
      <div className="row"><label className="row small" style={{ gap: 6 }}>Longest video <select className="input" style={{ width: "auto" }} value={maxLen} onChange={(e) => setMaxLen(+e.target.value)}><option value={120}>2 min</option><option value={180}>3 min</option><option value={240}>4 min</option></select></label>
        <button className="btn primary" disabled={!supported || busy || !plan.some((p) => want[p.key] && p.ms.length >= (p.key === "best" ? 1 : 2))} onClick={make}>Make {plural(plan.filter((p) => want[p.key] && p.ms.length >= (p.key === "best" ? 1 : 2)).length, "video")}</button>
        {busy && <button className="btn" onClick={() => stop.current?.abort()}>Stop</button>}</div>
      <p className="rc-note">Videos are made in real time while this page is open: a 3-minute video takes about 3 minutes. Keep this tab in front.</p>
      {jobs.length > 0 && <ul className="rg-jobs">{jobs.map((j) => <li key={j.key}>
        <div className="rg-row"><b>{j.name}</b><span className="small muted">{j.status}</span></div>
        {j.url ? <><video src={j.url} controls playsInline className="rg-out" /><div className="row"><a className="btn primary" href={j.url} download={fileName(j)}>Save video</a></div></>
          : <div className="rg-meter"><i style={{ width: Math.round(j.f * 100) + "%" }} /></div>}</li>)}</ul>}
      {jobs.some((j) => j.url) && <p className="rc-note">Upload them to YouTube (unlisted is fine), then send the links with <a href="#/emails">an email to a coach</a>.</p>}
    </section>}
  </Shell>;
}
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

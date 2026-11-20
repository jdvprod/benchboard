/** FloorCall Lessons: private lessons, small-group training and clinics. Its own site, lessons.getfloorcall.com.
 * Trainers (verified coaches) keep athletes from anywhere, schedule sessions, count reps and track who has paid.
 * Athletes and parents join with a personal code and see only their own sessions, shared notes and numbers.
 *   #/                 trainer: the schedule. athlete or parent: my lessons
 *   #/athletes[/ID]    trainer: athletes, one athlete (invite code, sessions, progress)
 *   #/new, #/s/ID[/edit|/stat]   a session: new, details, edit, count reps
 *   #/signups          clinic sign-ups waiting for the trainer
 *   #/mine             my lessons (for a coach who is also a parent)
 *   #/join[/CODE]      join with a code from a trainer
 *   #/c/CODE           a clinic's public sign-up page (no account needed) */
import "../styles/app.css";
import "./lessons.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { watchErrors } from "../app/errors";
import { SiteSwitch } from "../ui/SiteSwitch";
import { QrButton } from "../ui/QrButton";
import { copyText, download, plural } from "../ui/kit";
import { contactUrl, placeUrl } from "../cloud/links";
import { cloudAvailable, CloudError, rpc, userMeta } from "../cloud/client";
import { SiteGate } from "../cloud/SiteGate";
import { AccessNote } from "../cloud/AccessNote";
import { CoachVerify, useCoachStatus } from "../cloud/CoachVerify";
import { Calendar, CalItem, ymd } from "../ui/Calendar";
import { Badge } from "../cloud/Badge";
import { allReps, detail, fmtMeasure, ics, measure, message, REP_KINDS, Reps, sessionName, SKILL_IDS, SkillId, sum, tap, total, trend, weekly, when } from "./reps";

type Kind = "private" | "group" | "clinic";
interface Athlete { id: string; name: string; grad?: string | null; position?: string | null; club?: string | null; contact?: string | null; notes?: string | null; code?: string | null; joined?: { role: string; email: string }[] }
interface Sess { id: string; starts: string; minutes: number; kind: Kind; title?: string | null; place?: string | null; capacity?: number | null; focus: string[]; athletes: string[]; open: boolean; public: boolean; code?: string | null; price?: string | null; notes?: string | null; shared_note?: string | null; status: "scheduled" | "done" | "canceled" }
interface Row { session_id: string; athlete_id: string; reps: Reps; attended: boolean | null; paid: boolean }
interface Req { id: string; session_id: string; name: string; contact?: string; note?: string | null; created_at: string }
interface Book { athletes: Athlete[]; sessions: Sess[]; roster: Row[]; requests: Req[]; verified: boolean }
interface Mine { athletes: { id: string; name: string; role: string; trainer: string }[]; sessions: (Omit<Sess, "athletes" | "notes" | "capacity" | "public" | "code"> & { mine: string[]; spots: number | null })[]; roster: Row[] }

const KINDS: [Kind, string][] = [["private", "Private"], ["group", "Small group"], ["clinic", "Clinic"]];
const parse = () => location.hash.replace(/^#\/?/, "").split(/[/?]/).filter(Boolean).map(decodeURIComponent);
const go = (h: string) => { location.hash = "#/" + h; };
const newId = (p: string) => p + "_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 14));
const errText = (e: unknown) => (e instanceof CloudError ? e.message : "Couldn't reach FloorCall. Check your connection and try again.");
const upcoming = (s: { starts: string; minutes: number; status: string }) => s.status !== "canceled" && new Date(s.starts).getTime() + s.minutes * 60000 > Date.now();
/** "Nov 12", with the year only when it isn't this year. */
const shortDate = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); };
const dayKey = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const academy = (s: string) => placeUrl("academy", "players/" + s);
const skillName = (s: string) => REP_KINDS[s as SkillId]?.name || s;
const joinLink = (code: string) => placeUrl("lessons", "join/" + code);
const clinicLink = (code: string) => placeUrl("lessons", "c/" + code);

/* ---------- a small toast ---------- */
let showToast: (m: string) => void = () => {};
const toast = (m: string) => showToast(m);
function Toaster() {
  const [m, setM] = useState<{ t: string; at: number } | null>(null);
  useEffect(() => { showToast = (t) => setM({ t, at: Date.now() }); }, []);
  useEffect(() => { if (!m) return; const h = setTimeout(() => setM(null), 2200); return () => clearTimeout(h); }, [m]);
  return m ? <div className="toast" role="status">{m.t}</div> : null;
}
const copy = async (text: string, what = "Copied") => toast((await copyText(text)) ? what : "Couldn't copy. Select the text and copy it instead.");

function App() {
  const [route, setRoute] = useState(parse);
  useEffect(() => { const f = () => { setRoute(parse()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const coach = !cloudAvailable() || userMeta().kind === "coach";
  const open = route[0] === "c" && route[1]; // a clinic's public page needs no account
  const athleteSide = !coach || route[0] === "mine" || route[0] === "join";
  return <div className="ls">
    <header className="ls-top">
      <a className="ls-brand" href="#/"><img className="brandmark" src="../brand/mark-white.png" alt="" width="26" height="26" /><b>FloorCall</b><span>Lessons</span></a>
      <SiteSwitch here="lessons" />
    </header>
    {open ? <main className="ls-main"><ClinicPage code={route[1]} /></main>
      : <main className="ls-main"><SiteGate name="FloorCall Lessons" kind={route[0] === "join" ? "athlete" : "coach"}
          art={<div className="ls-gate-art">{SKILL_IDS.slice(0, 3).map((x) => <img key={x} src={`../brand/skill-${x}.png`} alt="" width="84" height="84" />)}</div>}
          what="Private lessons, small-group training and clinics. Trainers schedule sessions, count reps and see each athlete improve. Athletes and parents see their own sessions and numbers."
          points={["Trainers: schedule one-off or weekly sessions, open times athletes can book, and clinics with a sign-up page", "Count reps in a session: serves, passes, sets, swings and digs", "Athletes and parents join with a code from their trainer and see only their own lessons"]}>
        {athleteSide ? <AthleteSide route={route} coach={coach} /> : <Trainer route={route} />}
      </SiteGate></main>}
    <footer className="ls-foot">Each athlete and parent sees only their own sessions, notes their trainer shares, and their own numbers. <a href="../legal/privacy.html">Privacy</a> · <a href="../legal/terms.html">Terms</a> · <a href={contactUrl("lessons")}>Help</a></footer>
    <Toaster />
  </div>;
}

/* ====================================================================== trainer */
function Trainer({ route }: { route: string[] }) {
  const [book, setBook] = useState<Book | null>(null), [err, setErr] = useState("");
  const load = useCallback(async () => { try { setBook(await rpc("lesson_trainer_data", {})); setErr(""); } catch (e) { setErr(errText(e)); } }, []);
  // fresh on each tab and whenever the page comes back into view (a parent may have booked, a clinic may have filled)
  useEffect(() => { load(); }, [load, route[0]]);
  useEffect(() => { const f = () => { if (document.visibilityState === "visible") load(); }; document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, [load]);
  useEffect(() => { document.title = "FloorCall Lessons"; }, []);
  if (err && !book) return <div className="ls-page"><p className="ls-err">{err}</p><button className="btn" onClick={load}>Try again</button></div>;
  if (!book) return <div className="ls-page"><p className="muted">Loading your lessons…</p></div>;
  const tab = route[0] === "athletes" ? "athletes" : route[0] === "signups" ? "signups" : route[0] === "calendar" ? "calendar" : "schedule";
  const act = async (f: () => Promise<unknown>, done?: string) => { try { await f(); await load(); if (done) toast(done); return true; } catch (e) { toast(errText(e)); return false; } };
  const s = route[0] === "s" ? book.sessions.find((x) => x.id === route[1]) : undefined;
  const a = route[0] === "athletes" && route[1] ? book.athletes.find((x) => x.id === route[1]) : undefined;
  let page: ReactNode;
  if (route[0] === "new") page = <SessionForm book={book} act={act} pre={route[1]} />;
  else if (route[0] === "s") page = !s ? <Missing /> : route[2] === "edit" ? <SessionForm book={book} act={act} s={s} /> : route[2] === "stat" ? <StatMode book={book} s={s} reload={load} /> : <SessionPage book={book} s={s} act={act} />;
  else if (route[0] === "athletes") page = route[1] ? (a ? <AthletePage book={book} a={a} act={act} /> : <Missing />) : <Athletes book={book} act={act} />;
  else if (route[0] === "signups") page = <Signups book={book} act={act} />;
  else if (route[0] === "calendar") page = <TrainerCalendar book={book} />;
  else page = <Schedule book={book} />;
  if (route[0] === "s" && route[2] === "stat") return <>{page}</>; // counting reps fills the screen
  return <>
    <nav className="ls-tabs" aria-label="Lessons">
      <a href="#/" aria-current={tab === "schedule" ? "page" : undefined}>Schedule</a>
      <a href="#/calendar" aria-current={tab === "calendar" ? "page" : undefined}>Calendar</a>
      <a href="#/athletes" aria-current={tab === "athletes" ? "page" : undefined}>Athletes <small>{book.athletes.length}</small></a>
      <a href="#/signups" aria-current={tab === "signups" ? "page" : undefined}>Clinic sign-ups {book.requests.length > 0 && <small className="ls-badge">{book.requests.length}</small>}</a>
    </nav>
    {!book.verified && <Verify />}
    {page}
  </>;
}

function Verify() {
  const [s, setS] = useCoachStatus();
  if (!s || s.status === "approved") return null;
  return <div className="ls-page ls-verify"><p className="ls-lead">FloorCall checks every trainer before they add athletes, because most athletes are minors. Look around now; you can add athletes and schedule as soon as you're verified.</p><CoachVerify s={s} onChange={setS} /></div>;
}

function Missing() { return <div className="ls-page"><h1>That isn't here</h1><p><a href="#/">Back to your schedule</a></p></div>; }

function Schedule({ book }: { book: Book }) {
  const [past, setPast] = useState(false);
  const up = book.sessions.filter(upcoming), done = book.sessions.filter((x) => !upcoming(x)).reverse().slice(0, past ? 200 : 12);
  const days = new Map<string, Sess[]>();
  for (const x of up) days.set(dayKey(x.starts), [...(days.get(dayKey(x.starts)) || []), x]);
  const unpaid = book.roster.filter((r) => !r.paid && (r.attended || book.sessions.find((x) => x.id === r.session_id && x.status === "done"))).length;
  return <div className="ls-page">
    <div className="ls-head">
      <div><h1>Schedule</h1><p className="muted">{up.length ? `${plural(up.length, "session")} coming up${unpaid ? ` · ${unpaid} unpaid` : ""}` : "Nothing scheduled yet."}</p></div>
      <a className="btn primary" href="#/new">New session</a>
    </div>
    {!book.athletes.length && !up.length && <div className="ls-start">
      <h2>Start with your athletes</h2>
      <p>Add the athletes you train, then schedule a lesson. Each athlete gets a code so they (or a parent) can see their sessions and numbers. You can also post open times they book themselves, or a clinic with a public sign-up page.</p>
      <div className="row"><a className="btn primary" href="#/athletes">Add athletes</a><a className="btn" href="#/new/clinic">Schedule a clinic</a></div>
    </div>}
    {[...days].map(([d, list]) => <section key={d} className="ls-day"><h2>{d}</h2><ul className="ls-list">{list.map((x) => <SessionRow key={x.id} s={x} book={book} />)}</ul></section>)}
    {done.length > 0 && <section className="ls-day ls-past"><h2>Past sessions</h2><ul className="ls-list">{done.map((x) => <SessionRow key={x.id} s={x} book={book} showDate />)}</ul>
      {!past && book.sessions.length - up.length > done.length && <button className="btn sm" onClick={() => setPast(true)}>Show all past sessions</button>}</section>}
  </div>;
}

/** A session as a calendar item, in the viewer's own time zone. */
const hhmm = (iso: string) => { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
function sessionItem(s: { id: string; starts: string; minutes: number; kind: string; title?: string | null; place?: string | null; status: string; open: boolean }, who: string, href?: string, open = false): CalItem {
  return { id: s.id, date: ymd(new Date(s.starts)), time: hhmm(s.starts), title: sessionName(s) + (who ? " · " + who : ""), sub: [`${s.minutes} min`, s.place].filter(Boolean).join(" · "),
    kind: s.status === "canceled" ? "canceled" : open ? "open" : s.kind, href, done: s.status === "done" };
}
function TrainerCalendar({ book }: { book: Book }) {
  const items = book.sessions.map((s) => { const who = names(s.athletes, book); return sessionItem(s, s.kind === "private" ? who[0] || (s.open ? "open" : "") : who.length ? `${who.length}${s.capacity ? "/" + s.capacity : ""}` : s.open ? "open" : "", "#/s/" + s.id, s.open && !s.athletes.length); });
  return <div className="ls-page">
    <div className="ls-head"><div><h1>Calendar</h1><p className="muted">Every session, by month or by week. Tap one to open it.</p></div><a className="btn primary" href="#/new">New session</a></div>
    <Calendar items={items} storeKey="fc-ls-cal" legend={[["private", "Private and small group"], ["clinic", "Clinics"], ["open", "Open, nobody booked"], ["canceled", "Canceled"]]}
      empty={<>Nothing scheduled in these dates. <a href="#/new">Schedule a session</a>.</>} />
  </div>;
}

function names(ids: string[], book: Book) { return ids.map((i) => book.athletes.find((a) => a.id === i)?.name).filter(Boolean) as string[]; }
function SessionRow({ s, book, showDate }: { s: Sess; book: Book; showDate?: boolean }) {
  const who = names(s.athletes, book), rows = book.roster.filter((r) => r.session_id === s.id);
  const unpaid = s.athletes.filter((i) => !rows.find((r) => r.athlete_id === i)?.paid).length, counted = rows.some((r) => allReps(r.reps) > 0);
  const tags: string[] = [];
  if (s.status === "canceled") tags.push("Canceled");
  if (s.open && upcoming(s)) tags.push("Open to book");
  if (s.public) tags.push("Public sign-up");
  if (!upcoming(s) && s.status !== "canceled" && s.athletes.length) { if (unpaid) tags.push(unpaid + " unpaid"); if (!counted) tags.push("No reps counted"); }
  return <li className={s.status === "canceled" ? "ls-row off" : "ls-row"}><a href={"#/s/" + s.id}>
    <span className="ls-when"><b>{showDate ? new Date(s.starts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : time(s.starts)}</b><small>{showDate ? time(s.starts) : s.minutes + " min"}</small></span>
    <span className="ls-what"><b>{sessionName(s)}</b>
      <span>{who.length ? (s.kind === "private" ? who.join(", ") : `${who.slice(0, 3).join(", ")}${who.length > 3 ? ` and ${who.length - 3} more` : ""}`) : s.open ? "Nobody booked yet" : "No athletes yet"}{s.capacity ? ` · ${s.athletes.length} of ${s.capacity}` : ""}{s.place ? ` · ${s.place}` : ""}</span>
      {(s.focus.length > 0 || tags.length > 0) && <span className="ls-tags">{s.focus.map((f) => <i key={f} className="ls-focus">{skillName(f)}</i>)}{tags.map((t) => <i key={t}>{t}</i>)}</span>}
    </span>
    <svg className="ls-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
  </a></li>;
}

type Act = (f: () => Promise<unknown>, done?: string) => Promise<boolean>;

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function SessionForm({ book, act, s, pre }: { book: Book; act: Act; s?: Sess; pre?: string }) {
  const start = s ? new Date(s.starts) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); return d; })();
  const [f, setF] = useState({ kind: (s?.kind || (pre === "clinic" ? "clinic" : "private")) as Kind, title: s?.title || "", date: localDate(start), time: localTime(start), minutes: String(s?.minutes || 60), place: s?.place || "",
    capacity: s?.capacity ? String(s.capacity) : "", focus: s?.focus || [] as string[], athletes: s?.athletes || (pre && book.athletes.some((a) => a.id === pre) ? [pre] : []) as string[], open: s?.open || false, public: s?.public || false,
    price: s?.price || "", shared_note: s?.shared_note || "", notes: s?.notes || "", weeks: "1" });
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const tog = (k: "focus" | "athletes", v: string) => set({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] } as any);
  const cap = f.capacity ? +f.capacity : f.kind === "private" ? 1 : null;
  const over = cap != null && f.athletes.length > cap;
  const valid = f.date && f.time && +f.minutes >= 5 && !over;
  const save = async () => {
    setBusy(true);
    const first = new Date(`${f.date}T${f.time}`).toISOString();
    const dates = s ? [first] : weekly(first, +f.weeks || 1);
    let firstId = s?.id || "";
    const ok = await act(async () => {
      for (const d of dates) {
        const id = s?.id || newId("ls"); if (!firstId) firstId = id;
        await rpc("lesson_save_session", { x: { id, starts: d, minutes: +f.minutes, kind: f.kind, title: f.title.trim() || null, place: f.place.trim() || null, capacity: cap, focus: f.focus, athletes: f.athletes,
          open: f.open, public: f.kind !== "private" && f.public, price: f.price.trim() || null, shared_note: f.shared_note.trim() || null, notes: f.notes.trim() || null, status: s?.status || "scheduled" } });
      }
    }, s ? "Saved" : dates.length > 1 ? `${dates.length} sessions scheduled` : "Scheduled");
    setBusy(false);
    if (ok) go("s/" + firstId);
  };
  const list = book.athletes.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  return <div className="ls-page ls-form">
    <a className="ls-back" href={s ? "#/s/" + s.id : "#/"}>{s ? sessionName(s) : "Schedule"}</a>
    <h1>{s ? "Edit session" : "New session"}</h1>
    <fieldset className="ls-kinds"><legend className="label">What kind</legend>
      {KINDS.map(([k, label]) => <label key={k} className={f.kind === k ? "on" : ""}><input type="radio" name="kind" checked={f.kind === k} onChange={() => set({ kind: k, capacity: k === "private" ? "" : f.capacity })} />
        <b>{label}</b><small>{k === "private" ? "One athlete" : k === "group" ? "A few athletes together" : "A bigger session, with a sign-up page if you want one"}</small></label>)}
    </fieldset>
    <div className="two">
      <label className="field"><span className="label">Name (optional)</span><input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.kind === "clinic" ? "e.g. Serve receive clinic" : "e.g. Setter footwork"} /></label>
      <label className="field"><span className="label">Where</span><input value={f.place} onChange={(e) => set({ place: e.target.value })} placeholder="e.g. Northside gym, court 2" /></label>
    </div>
    <div className="ls-when-row">
      <label className="field"><span className="label">Date</span><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
      <label className="field"><span className="label">Start</span><input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} /></label>
      <label className="field"><span className="label">Minutes</span><input type="number" min={5} max={600} step={5} value={f.minutes} onChange={(e) => set({ minutes: e.target.value })} /></label>
      {f.kind !== "private" && <label className="field"><span className="label">Spots</span><input type="number" min={1} max={500} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} placeholder="No limit" /></label>}
      {!s && <label className="field"><span className="label">Repeat</span><select value={f.weeks} onChange={(e) => set({ weeks: e.target.value })}>
        <option value="1">Just once</option>{[2, 3, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>Weekly, {n} weeks</option>)}</select></label>}
    </div>
    <fieldset className="ls-chips"><legend className="label">Focus skills</legend>
      {SKILL_IDS.map((k) => <button type="button" key={k} aria-pressed={f.focus.includes(k)} onClick={() => tog("focus", k)}>{REP_KINDS[k].name}</button>)}
    </fieldset>
    <fieldset className="ls-pick"><legend className="label">Athletes {cap != null && <span className={over ? "ls-over" : ""}>({f.athletes.length} of {cap})</span>}</legend>
      {book.athletes.length > 8 && <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an athlete" aria-label="Find an athlete" />}
      {book.athletes.length ? <div className="ls-pick-list">{list.map((a) => <label key={a.id}><input type="checkbox" checked={f.athletes.includes(a.id)} onChange={() => tog("athletes", a.id)} />{a.name}{a.grad && <small>{a.grad}</small>}</label>)}</div>
        : <p className="muted small">No athletes yet. <a href="#/athletes">Add athletes</a>, or leave this open for athletes to book.</p>}
    </fieldset>
    <div className="ls-switches">
      <label><input type="checkbox" checked={f.open} onChange={(e) => set({ open: e.target.checked })} /><span><b>Athletes can book this</b><small>Your athletes and their parents see it as an open time and book a spot themselves.</small></span></label>
      {f.kind !== "private" && <label><input type="checkbox" checked={f.public} onChange={(e) => set({ public: e.target.checked })} /><span><b>Public sign-up page</b><small>Anyone with the link can sign up, even if they aren't your athlete yet. You accept each sign-up. Leave this off to keep the clinic private.</small></span></label>}
    </div>
    <div className="two">
      <label className="field"><span className="label">Price (optional)</span><input value={f.price} onChange={(e) => set({ price: e.target.value })} placeholder="e.g. $40" /></label>
      <span />
    </div>
    <label className="field"><span className="label">Note for athletes and parents</span><textarea rows={2} value={f.shared_note} onChange={(e) => set({ shared_note: e.target.value })} placeholder="e.g. Bring kneepads and water" /></label>
    <label className="field"><span className="label">Private notes (only you see these)</span><textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Plan, what to watch for, how it went" /></label>
    <div className="row"><button className="btn primary" disabled={busy || !valid} onClick={save}>{busy ? "Saving…" : s ? "Save" : +f.weeks > 1 ? `Schedule ${f.weeks} sessions` : "Schedule"}</button>
      <a className="btn ghost" href={s ? "#/s/" + s.id : "#/"}>Cancel</a>{over && <span className="ls-over small">More athletes than spots.</span>}</div>
  </div>;
}

function SessionPage({ book, s, act }: { book: Book; s: Sess; act: Act }) {
  // ticks show at once; the server's copy replaces them when it comes back
  const [local, setLocal] = useState<Record<string, Partial<Row>>>({});
  const rows = (id: string): Row => ({ ...(book.roster.find((r) => r.session_id === s.id && r.athlete_id === id) || { session_id: s.id, athlete_id: id, reps: {}, attended: null, paid: false }), ...local[id] });
  const save = async (r: Row, p: Partial<Row>) => {
    setLocal((l) => ({ ...l, [r.athlete_id]: { ...l[r.athlete_id], ...p } }));
    const ok = await act(() => rpc("lesson_save_roster", { sid: s.id, aid: r.athlete_id, reps: p.reps ?? r.reps, attended: p.attended !== undefined ? p.attended : r.attended, paid: p.paid ?? r.paid }));
    setLocal((l) => { const n = { ...l }; delete n[r.athlete_id]; return n; });
    return ok;
  };
  const status = (st: Sess["status"], done: string) => act(() => rpc("lesson_save_session", { x: { ...s, status: st } }), done);
  const [add, setAdd] = useState("");
  const others = book.athletes.filter((a) => !s.athletes.includes(a.id));
  const full = s.capacity != null && s.athletes.length >= s.capacity;
  const reqs = book.requests.filter((r) => r.session_id === s.id);
  const sendText = (a?: Athlete) => message(s, a?.name.split(" ")[0]) + (a && !a.joined?.length && a.code ? `\n\nSee your lessons and numbers in FloorCall: ${joinLink(a.code)}` : "");
  return <div className="ls-page">
    <a className="ls-back" href="#/">Schedule</a>
    <div className="ls-head">
      <div><h1>{sessionName(s)}</h1>
        <p className="ls-sub">{when(s.starts, { year: new Date(s.starts).getFullYear() !== new Date().getFullYear() })} · {s.minutes} min{s.place ? " · " + s.place : ""}{s.price ? " · " + s.price : ""}</p>
        {s.status !== "scheduled" && <p className={"ls-status " + s.status}>{s.status === "done" ? "Done" : "Canceled"}</p>}</div>
      <div className="row">
        {s.status !== "canceled" && <a className="btn primary" href={`#/s/${s.id}/stat`}>Count reps</a>}
        <a className="btn" href={`#/s/${s.id}/edit`}>Edit</a>
      </div>
    </div>
    {s.focus.length > 0 && <p className="ls-focusline">Focus: {s.focus.map((f, i) => <span key={f}>{i ? ", " : ""}<a href={academy(f)} target="_blank" rel="noopener">{skillName(f)}</a></span>)} <small className="muted">(Academy guides open in a new tab)</small></p>}
    {(s.open || s.public) && <div className="ls-callout">
      {s.open && <p><b>Open to book.</b> Your athletes and their parents can book {s.capacity ? `the ${plural(Math.max(s.capacity - s.athletes.length, 0), "spot")} left` : "a spot"} from their FloorCall Lessons page.</p>}
      {s.public && s.code && <div><p><b>Public sign-up page.</b> Share this link anywhere: {reqs.length ? plural(reqs.length, "sign-up") + " waiting for you." : "sign-ups come to you to accept."}</p>
        <div className="ls-link"><code>{clinicLink(s.code)}</code><button className="btn sm" onClick={() => copy(clinicLink(s.code!), "Link copied")}>Copy link</button><QrButton url={clinicLink(s.code)} title={sessionName(s)} /></div></div>}
    </div>}
    <section className="ls-sec">
      <div className="ls-sec-hd"><h2>Athletes</h2>{s.athletes.length > 0 && <small className="muted">{s.capacity ? `${s.athletes.length} of ${s.capacity} spots` : plural(s.athletes.length, "athlete")}</small>}</div>
      {s.athletes.length ? <table className="ls-roster"><thead><tr><th>Athlete</th><th>Came</th><th>Paid</th><th>Reps</th><th /></tr></thead><tbody>
        {s.athletes.map((id) => { const a = book.athletes.find((x) => x.id === id); const r = rows(id); if (!a) return null;
          return <tr key={id}>
            <td><a href={"#/athletes/" + a.id}>{a.name}</a></td>
            <td><input type="checkbox" aria-label={`${a.name} came`} checked={!!r.attended} onChange={(e) => save(r, { attended: e.target.checked })} /></td>
            <td><input type="checkbox" aria-label={`${a.name} paid`} checked={r.paid} onChange={(e) => save(r, { paid: e.target.checked })} /></td>
            <td className="ls-reps">{SKILL_IDS.filter((k) => total(r.reps, k)).map((k) => <span key={k}>{REP_KINDS[k].name} <b>{fmtMeasure(k, measure(r.reps, k))}</b> <small>({total(r.reps, k)})</small></span>)}{!allReps(r.reps) && <span className="muted">None yet</span>}</td>
            <td><button className="btn sm ghost" onClick={() => act(() => rpc("lesson_save_session", { x: { ...s, athletes: s.athletes.filter((x) => x !== id) } }), "Taken off this session")}>Remove</button></td>
          </tr>; })}
      </tbody></table> : <p className="muted">{s.open ? "Nobody has booked yet." : "No athletes on this session yet."}</p>}
      {others.length > 0 && !full && <div className="row ls-add"><select className="input" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Add an athlete"><option value="">Add an athlete…</option>{others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="btn sm" disabled={!add} onClick={() => { act(() => rpc("lesson_save_session", { x: { ...s, athletes: [...s.athletes, add] } }), "Added"); setAdd(""); }}>Add</button></div>}
    </section>
    <section className="ls-sec">
      <h2>Send it</h2>
      <p className="muted small">Athletes who joined with their code already see this session. To text or email it too, copy the message; the calendar file adds it to any calendar.</p>
      <pre className="ls-msg">{sendText(s.kind === "private" ? book.athletes.find((a) => a.id === s.athletes[0]) : undefined)}</pre>
      <div className="row"><button className="btn sm" onClick={() => copy(sendText(s.kind === "private" ? book.athletes.find((a) => a.id === s.athletes[0]) : undefined), "Message copied")}>Copy message</button>
        <button className="btn sm" onClick={() => download(sessionName(s).replace(/[^\w -]/g, "") + ".ics", ics([s]), "text/calendar")}>Calendar file</button></div>
    </section>
    {(s.shared_note || s.notes) && <section className="ls-sec ls-notes">
      {s.shared_note && <div><h3>Shared with athletes</h3><p>{s.shared_note}</p></div>}
      {s.notes && <div><h3>Private notes</h3><p>{s.notes}</p></div>}
    </section>}
    <div className="row ls-end">
      {s.status === "scheduled" && <button className="btn sm" onClick={() => status("done", "Marked done")}>Mark done</button>}
      {s.status === "scheduled" && <button className="btn sm" onClick={() => status("canceled", "Canceled")}>Cancel session</button>}
      {s.status !== "scheduled" && <button className="btn sm" onClick={() => status("scheduled", "Back on the schedule")}>Put back on the schedule</button>}
      <ConfirmDelete label="Delete session" onConfirm={async () => { if (await act(() => rpc("lesson_delete_session", { sid: s.id }), "Deleted")) go(""); }} />
    </div>
  </div>;
}

function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button className={"btn sm ghost" + (armed ? " danger" : "")} onClick={() => { if (armed) onConfirm(); else setArmed(true); }}>{armed ? "Tap again to delete" : label}</button>;
}

/* ---------- counting reps: phone first, big buttons ---------- */
const PASS_WORD: Record<string, string> = { "3": "Perfect", "2": "Good", "1": "Poor", "0": "Error" };
function StatMode({ book, s, reload }: { book: Book; s: Sess; reload: () => Promise<void> }) {
  const ids = s.athletes.filter((i) => book.athletes.some((a) => a.id === i));
  const [who, setWho] = useState(ids[0] || "");
  const init = () => Object.fromEntries(ids.map((i) => [i, book.roster.find((r) => r.session_id === s.id && r.athlete_id === i) || { session_id: s.id, athlete_id: i, reps: {}, attended: null, paid: false }]));
  const [rows, setRows] = useState<Record<string, Row>>(init);
  const [hist, setHist] = useState<{ who: string; reps: Reps }[]>([]), [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [more, setMore] = useState(false);
  const timers = useRef<Record<string, any>>({}), latest = useRef(rows); latest.current = rows;
  const flush = async (id: string) => {
    const r = latest.current[id]; if (!r) return;
    setState("saving");
    try { await rpc("lesson_save_roster", { sid: s.id, aid: id, reps: r.reps, attended: r.attended ?? (allReps(r.reps) > 0 ? true : null), paid: r.paid }); setState("saved"); }
    catch { setState("error"); }
  };
  const queue = (id: string) => { clearTimeout(timers.current[id]); timers.current[id] = setTimeout(() => flush(id), 500); };
  useEffect(() => () => { for (const [id, t] of Object.entries(timers.current)) { clearTimeout(t); flush(id); } }, []); // eslint-disable-line
  const press = (k: SkillId, kind: string) => {
    const r = rows[who]; if (!r) return;
    setHist([...hist, { who, reps: r.reps }].slice(-50));
    setRows({ ...rows, [who]: { ...r, reps: tap(r.reps, k, kind) } }); queue(who);
    navigator.vibrate?.(8);
  };
  const undo = () => { const h = hist[hist.length - 1]; if (!h) return; setHist(hist.slice(0, -1)); setRows({ ...rows, [h.who]: { ...rows[h.who], reps: h.reps } }); setWho(h.who); queue(h.who); };
  const finish = async () => { for (const [id, t] of Object.entries(timers.current)) { clearTimeout(t); await flush(id); } timers.current = {}; await reload(); go("s/" + s.id); };
  if (!ids.length) return <div className="ls-page"><a className="ls-back" href={"#/s/" + s.id}>{sessionName(s)}</a><h1>Count reps</h1><p className="muted">Add athletes to this session first.</p></div>;
  const r = rows[who]?.reps || {};
  const focus = (s.focus.length ? s.focus : SKILL_IDS) as SkillId[], rest = SKILL_IDS.filter((k) => !focus.includes(k));
  const shown = more ? [...focus, ...rest] : focus;
  return <div className="ls-stat">
    <div className="ls-stat-top">
      <button className="ls-stat-done" onClick={finish}>Done</button>
      <span className="ls-stat-title"><b>{sessionName(s)}</b><small aria-live="polite">{state === "saving" ? "Saving…" : state === "error" ? "Not saved: check your connection" : "Saved"}</small></span>
      <button className="ls-stat-undo" onClick={undo} disabled={!hist.length}>Undo</button>
    </div>
    {ids.length > 1 && <div className="ls-who" role="tablist" aria-label="Athlete">{ids.map((i) => { const a = book.athletes.find((x) => x.id === i)!; return <button key={i} role="tab" aria-selected={who === i} onClick={() => setWho(i)}>{a.name.split(" ")[0]}<small>{allReps(rows[i].reps)}</small></button>; })}</div>}
    {ids.length === 1 && <p className="ls-who-one">{book.athletes.find((x) => x.id === who)?.name}</p>}
    <div className="ls-skills">{shown.map((k) => <section key={k} className="ls-skill">
      <div className="ls-skill-hd"><h2>{REP_KINDS[k].name}</h2><span><small>{REP_KINDS[k].measure}</small> <b>{fmtMeasure(k, measure(r, k))}</b></span></div>
      <div className={"ls-pads n" + REP_KINDS[k].kinds.length}>{REP_KINDS[k].kinds.map(([kind, label], i) => <button key={kind} className={"ls-pad p" + i} onClick={() => press(k, kind)} aria-label={`${REP_KINDS[k].name}: ${label}`}>
        <span>{k === "passing" ? `${PASS_WORD[kind]} (${label})` : label}</span><b>{r[k]?.[kind] || 0}</b></button>)}</div>
    </section>)}</div>
    {rest.length > 0 && <button className="btn ls-more" onClick={() => setMore(!more)}>{more ? "Only the focus skills" : "Count other skills too"}</button>}
  </div>;
}

/* ---------- athletes ---------- */
function Athletes({ book, act }: { book: Book; act: Act }) {
  const [f, setF] = useState({ name: "", grad: "", position: "", club: "", contact: "" }), [open, setOpen] = useState(!book.athletes.length);
  const add = async () => { if (await act(() => rpc("lesson_save_athlete", { a: { id: newId("la"), ...f } }), f.name.trim() + " added")) setF({ name: "", grad: "", position: "", club: "", contact: "" }); };
  const last = (id: string) => book.sessions.filter((x) => x.athletes.includes(id) && !upcoming(x) && x.status !== "canceled").pop();
  const next = (id: string) => book.sessions.find((x) => x.athletes.includes(id) && upcoming(x));
  const unpaid = (id: string) => book.sessions.filter((x) => x.athletes.includes(id) && !upcoming(x) && x.status !== "canceled" && !book.roster.find((r) => r.session_id === x.id && r.athlete_id === id)?.paid).length;
  return <div className="ls-page">
    <div className="ls-head"><div><h1>Athletes</h1><p className="muted">The players you train, from any team or club. Each one gets a code to see their own lessons.</p></div>
      {!open && <button className="btn primary" onClick={() => setOpen(true)}>Add an athlete</button>}</div>
    {open && <div className="ls-addform">
      <div className="ls-addgrid">
        <label className="field"><span className="label">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label className="field"><span className="label">Grad year</span><input value={f.grad} inputMode="numeric" onChange={(e) => setF({ ...f, grad: e.target.value })} placeholder="2028" /></label>
        <label className="field"><span className="label">Position</span><input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="OH, S, L…" /></label>
        <label className="field"><span className="label">Club or school</span><input value={f.club} onChange={(e) => setF({ ...f, club: e.target.value })} /></label>
        <label className="field"><span className="label">Parent's email or phone</span><input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={!f.name.trim() || !book.verified} onClick={add}>Add athlete</button>{book.athletes.length > 0 && <button className="btn ghost" onClick={() => setOpen(false)}>Close</button>}
        {!book.verified && <span className="small muted">You can add athletes once your coach account is verified.</span>}</div>
      <p className="small muted">Coaching a team in FloorCall? Open a player in the coaching app and choose "Add to FloorCall Lessons".</p>
    </div>}
    {book.athletes.length > 0 && <ul className="ls-list ls-athletes">{book.athletes.map((a) => { const l = last(a.id), n = next(a.id), u = unpaid(a.id);
      return <li key={a.id} className="ls-row"><a href={"#/athletes/" + a.id}>
        <span className="ls-avatar" aria-hidden="true">{a.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span>
        <span className="ls-what"><b>{a.name}</b><span>{[a.position, a.grad && "Class of " + a.grad, a.club].filter(Boolean).join(" · ") || "No details yet"}</span>
          <span className="ls-tags">{a.joined?.length ? <i className="ls-joined">Joined</i> : <i>Not joined yet</i>}{n && <i>Next: {new Date(n.starts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</i>}{!n && l && <i>Last: {new Date(l.starts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</i>}{u > 0 && <i>{u} unpaid</i>}</span></span>
        <svg className="ls-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </a></li>; })}</ul>}
  </div>;
}

function AthletePage({ book, a, act }: { book: Book; a: Athlete; act: Act }) {
  const [f, setF] = useState({ name: a.name, grad: a.grad || "", position: a.position || "", club: a.club || "", contact: a.contact || "", notes: a.notes || "" }), [edit, setEdit] = useState(false);
  const [code, setCode] = useState(a.code || "");
  const mine = book.sessions.filter((x) => x.athletes.includes(a.id) && x.status !== "canceled");
  const rows = mine.map((x) => ({ s: x, r: book.roster.find((r) => r.session_id === x.id && r.athlete_id === a.id) }));
  const invite = async (fresh = false) => { try { const c = await rpc("lesson_invite", { aid: a.id, fresh }); setCode(c); if (fresh) toast("New code made. The old one no longer works."); } catch (e) { toast(errText(e)); } };
  const inviteText = (c: string) => `${a.name.split(" ")[0]}'s lessons are on FloorCall: sessions, what we're working on, and progress. Make a free account and join with code ${c}: ${joinLink(c)}`;
  return <div className="ls-page">
    <a className="ls-back" href="#/athletes">Athletes</a>
    <div className="ls-head"><div><h1>{a.name}</h1><p className="ls-sub">{[a.position, a.grad && "Class of " + a.grad, a.club].filter(Boolean).join(" · ") || "No details yet"}{a.contact ? " · " + a.contact : ""}</p></div>
      <div className="row"><a className="btn primary" href={"#/new/" + a.id}>Schedule</a><button className="btn" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit"}</button></div></div>
    {edit && <div className="ls-addform">
      <div className="ls-addgrid">
        <label className="field"><span className="label">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span className="label">Grad year</span><input value={f.grad} onChange={(e) => setF({ ...f, grad: e.target.value })} /></label>
        <label className="field"><span className="label">Position</span><input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></label>
        <label className="field"><span className="label">Club or school</span><input value={f.club} onChange={(e) => setF({ ...f, club: e.target.value })} /></label>
        <label className="field"><span className="label">Parent's email or phone</span><input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
      </div>
      <label className="field"><span className="label">Private notes (only you see these)</span><textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <div className="row"><button className="btn primary" disabled={!f.name.trim()} onClick={async () => { if (await act(() => rpc("lesson_save_athlete", { a: { id: a.id, ...f } }), "Saved")) setEdit(false); }}>Save</button>
        <ConfirmDelete label={"Delete " + a.name.split(" ")[0]} onConfirm={async () => { if (await act(() => rpc("lesson_delete_athlete", { aid: a.id }), "Deleted")) go("athletes"); }} /></div>
    </div>}
    {!edit && a.notes && <p className="ls-privnote"><b>Private notes:</b> {a.notes}</p>}
    <section className="ls-sec">
      <h2>Their FloorCall Lessons page</h2>
      {a.joined?.length ? <p>{a.joined.map((j) => `${j.role === "parent" ? "A parent" : a.name.split(" ")[0]} (${j.email})`).join(" and ")} {a.joined.length > 1 ? "have" : "has"} joined and see{a.joined.length > 1 ? "" : "s"} {a.name.split(" ")[0]}'s sessions and numbers.</p>
        : <p className="muted">Nobody has joined yet. Send the code to the athlete or a parent: they make a free FloorCall account and see only {a.name.split(" ")[0]}'s sessions, the notes you share, and their numbers.</p>}
      {code ? <div className="ls-code"><span className="ls-code-big">{code}</span>
        <div className="row"><button className="btn sm primary" onClick={() => copy(inviteText(code), "Invite copied")}>Copy invite</button><button className="btn sm" onClick={() => copy(joinLink(code), "Link copied")}>Copy link</button><QrButton url={joinLink(code)} title={"Join " + a.name + "'s lessons"} /><ConfirmButtonLite onConfirm={() => invite(true)}>New code</ConfirmButtonLite></div></div>
        : <button className="btn" onClick={() => invite()}>Make an invite code</button>}
    </section>
    <Progress rows={rows.filter((x) => x.r && allReps(x.r.reps)).map((x) => ({ starts: x.s.starts, reps: x.r!.reps }))} />
    <section className="ls-sec">
      <h2>Sessions</h2>
      {mine.length ? <ul className="ls-hist">{rows.slice().reverse().map(({ s, r }) => <li key={s.id}><a href={"#/s/" + s.id}><span className="ls-hist-d">{shortDate(s.starts)}</span>
        <span><b>{sessionName(s)}</b>{r && allReps(r.reps) > 0 && <small>{SKILL_IDS.filter((k) => total(r.reps, k)).map((k) => `${REP_KINDS[k].name} ${fmtMeasure(k, measure(r.reps, k))}`).join(" · ")}</small>}</span>
        <span className="ls-hist-flags">{upcoming(s) ? <i>Upcoming</i> : r?.paid ? <i className="ok">Paid</i> : <i className="due">Not paid</i>}</span></a></li>)}</ul>
        : <p className="muted">No sessions yet.</p>}
    </section>
  </div>;
}
function ConfirmButtonLite({ children, onConfirm }: { children: ReactNode; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button className="btn sm ghost" onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? "Tap again: the old code stops working" : children}</button>;
}

/** Each skill's number over time, one small chart per skill with reps, plus totals. */
function Progress({ rows, title = "Progress" }: { rows: { starts: string; reps: Reps }[]; title?: string }) {
  if (!rows.length) return null;
  const all = sum(rows.map((x) => x.reps));
  const skills = SKILL_IDS.filter((k) => total(all, k));
  return <section className="ls-sec">
    <h2>{title}</h2>
    <div className="ls-prog">{skills.map((k) => { const t = trend(rows, k); return <div key={k} className="ls-prog-card">
      <div className="ls-prog-hd"><span>{REP_KINDS[k].measure}</span><b>{fmtMeasure(k, measure(all, k))}</b></div>
      {t.length > 1 && <Spark k={k} pts={t} />}
      <p className="small muted">{plural(total(all, k), "rep")} over {plural(t.length, "session")}: {detail(all, k)}. <a href={academy(k)} target="_blank" rel="noopener">{REP_KINDS[k].name} drills</a></p>
    </div>; })}</div>
  </section>;
}
function Spark({ k, pts }: { k: SkillId; pts: { at: string; v: number }[] }) {
  const W = 260, H = 70, P = 6;
  const lo = k === "passing" ? 0 : k === "hitting" ? Math.min(-0.2, ...pts.map((p) => p.v)) : 0, hi = k === "passing" ? 3 : 1;
  const x = (i: number) => P + (pts.length < 2 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pts.length - 1));
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const label = `${REP_KINDS[k].measure} by session: ${pts.map((p) => `${new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${fmtMeasure(k, p.v)}`).join(", ")}`;
  return <svg className="ls-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
    <line x1={P} x2={W - P} y1={y(lo)} y2={y(lo)} className="base" />
    {pts.length > 1 && <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} />}
    {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={i === pts.length - 1 ? 4 : 2.5}><title>{`${new Date(p.at).toLocaleDateString()}: ${fmtMeasure(k, p.v)}`}</title></circle>)}
  </svg>;
}

function Signups({ book, act }: { book: Book; act: Act }) {
  const by = new Map<string, Req[]>();
  for (const r of book.requests) by.set(r.session_id, [...(by.get(r.session_id) || []), r]);
  const clinics = book.sessions.filter((s) => s.public && upcoming(s));
  return <div className="ls-page">
    <div className="ls-head"><div><h1>Clinic sign-ups</h1><p className="muted">People who signed up from a clinic's public page. Accepting adds them to your athletes and books them in.</p></div></div>
    {!book.requests.length && <p className="ls-empty">{clinics.length ? "No new sign-ups. Share a clinic's link to fill it." : "No sign-ups. To get some, schedule a clinic and turn on its public sign-up page."}</p>}
    {[...by].map(([sid, list]) => { const s = book.sessions.find((x) => x.id === sid); if (!s) return null;
      return <section key={sid} className="ls-sec"><div className="ls-sec-hd"><h2><a href={"#/s/" + s.id}>{sessionName(s)}</a></h2><small className="muted">{when(s.starts)}{s.capacity ? ` · ${s.athletes.length} of ${s.capacity} spots taken` : ""}</small></div>
        <ul className="ls-reqs">{list.map((r) => <li key={r.id}><span><b>{r.name}</b><small>{r.contact}{r.note ? " · " + r.note : ""}</small></span>
          <span className="row"><button className="btn sm primary" onClick={() => act(() => rpc("lesson_request_decide", { rid: r.id, accept: true }), r.name + " is in")}>Accept</button>
            <button className="btn sm ghost" onClick={() => act(() => rpc("lesson_request_decide", { rid: r.id, accept: false }), "Declined")}>Decline</button></span></li>)}</ul></section>; })}
  </div>;
}

/* ====================================================================== athletes and parents */
/** Signed in, but no trainer has this account: say so once, then the code form. */
function NoLessons({ coach, onJoined }: { coach: boolean; onJoined: () => void }) {
  const [note, setNote] = useState(!coach);
  return <div className="ls-page">
    {coach && <a className="ls-back" href="#/">Your schedule</a>}
    <Join code="" onJoined={onJoined} first />
    {note && <AccessNote site="FloorCall Lessons" from="lessons" reason="trainer" onCode={() => { setNote(false); setTimeout(() => (document.querySelector(".ls-page input") as HTMLInputElement | null)?.focus(), 0); }} onClose={() => setNote(false)} />}
  </div>;
}
function AthleteSide({ route, coach }: { route: string[]; coach: boolean }) {
  const [d, setD] = useState<Mine | null>(null), [err, setErr] = useState(""), [pick, setPick] = useState("");
  const load = useCallback(async () => { try { setD(await rpc("my_lessons", {})); setErr(""); } catch (e) { setErr(errText(e)); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const f = () => { if (document.visibilityState === "visible") load(); }; document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, [load]);
  useEffect(() => { document.title = "My lessons · FloorCall Lessons"; }, []);
  if (route[0] === "join") return <Join code={route[1] || ""} onJoined={async () => { await load(); go(coach ? "mine" : ""); }} />;
  if (err && !d) return <div className="ls-page"><p className="ls-err">{err}</p><button className="btn" onClick={load}>Try again</button></div>;
  if (!d) return <div className="ls-page"><p className="muted">Loading your lessons…</p></div>;
  if (!d.athletes.length) return <NoLessons coach={coach} onJoined={load} />;
  const a = d.athletes.find((x) => x.id === pick) || d.athletes[0];
  const mine = d.sessions.filter((s) => s.mine.includes(a.id));
  const next = mine.filter(upcoming), past = mine.filter((s) => !upcoming(s)).reverse();
  const openTimes = d.sessions.filter((s) => s.open && upcoming(s) && !s.mine.includes(a.id) && s.spots !== 0);
  const row = (sid: string) => d.roster.find((r) => r.session_id === sid && r.athlete_id === a.id);
  const book = async (sid: string, join: boolean) => { try { await rpc("lesson_book", { sid, aid: a.id, join_it: join }); await load(); toast(join ? "Booked" : "Booking canceled"); } catch (e) { toast(errText(e)); } };
  const first = a.name.split(" ")[0], parent = a.role === "parent";
  return <div className="ls-page ls-mine">
    {coach && <a className="ls-back" href="#/">Your schedule</a>}
    <div className="ls-head"><div><h1>{parent ? first + "'s lessons" : "My lessons"}</h1><p className="muted">With {a.trainer} <Badge kind="verified" /></p></div>
      {d.athletes.length > 1 && <div className="ls-kids" role="group" aria-label="Athlete">{d.athletes.map((x) => <button key={x.id} aria-pressed={x.id === a.id} onClick={() => setPick(x.id)}>{x.name.split(" ")[0]}</button>)}</div>}</div>
    <section className="ls-sec">
      <div className="ls-sec-hd"><h2>Coming up</h2>{next.length > 1 && <button className="btn sm" onClick={() => download("FloorCall lessons.ics", ics(next as any), "text/calendar")}>Add all to calendar</button>}</div>
      {next.length ? <ul className="ls-cards">{next.map((s) => { const r = row(s.id); return <li key={s.id} className="ls-card">
        <div className="ls-card-when"><b>{new Date(s.starts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b><span>{time(s.starts)} · {s.minutes} min</span></div>
        <div className="ls-card-body"><h3>{sessionName(s)}</h3>
          {s.place && <p>{s.place}</p>}
          {s.focus.length > 0 && <p className="ls-focusline">Working on {s.focus.map((f, i) => <span key={f}>{i ? ", " : ""}<a href={academy(f)}>{skillName(f).toLowerCase()}</a></span>)}</p>}
          {s.shared_note && <p className="ls-shared">{s.shared_note}</p>}
          <div className="row">
            <button className="btn sm" onClick={() => download(sessionName(s) + ".ics", ics([s as any]), "text/calendar")}>Add to calendar</button>
            {s.price && <span className="small muted">{s.price}{r?.paid ? " · paid" : ""}</span>}
            {s.open && <CancelBooking onConfirm={() => book(s.id, false)} />}
          </div>
        </div></li>; })}</ul>
        : <p className="ls-empty">Nothing scheduled right now.{openTimes.length ? " Book one of the open times below." : ""}</p>}
    </section>
    <section className="ls-sec">
      <h2>Calendar</h2>
      <Calendar items={[...mine.map((s) => sessionItem(s as any, "", undefined)), ...openTimes.map((s) => sessionItem(s as any, "open", undefined, true))]} storeKey="fc-ls-mycal"
        legend={[["private", parent ? first + "'s sessions" : "Your sessions"], ["open", "Open times you can book"]]} empty="Nothing in these dates." />
    </section>
    {openTimes.length > 0 && <section className="ls-sec">
      <h2>Open times</h2>
      <p className="muted small">Times {a.trainer.split(" ")[0]} has open. Booking saves {parent ? first + "'s" : "your"} spot.</p>
      <ul className="ls-list">{openTimes.map((s) => <li key={s.id} className="ls-row ls-open"><div>
        <span className="ls-when"><b>{new Date(s.starts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</b><small>{time(s.starts)}</small></span>
        <span className="ls-what"><b>{sessionName(s)}</b><span>{s.minutes} min{s.place ? " · " + s.place : ""}{s.spots != null ? ` · ${plural(s.spots, "spot")} left` : ""}{s.price ? " · " + s.price : ""}</span>
          {s.focus.length > 0 && <span className="ls-tags">{s.focus.map((f) => <i key={f} className="ls-focus">{skillName(f)}</i>)}</span>}</span>
        <button className="btn sm primary" onClick={() => book(s.id, true)}>Book{d.athletes.length > 1 ? " for " + first : ""}</button>
      </div></li>)}</ul>
    </section>}
    <Progress title={parent ? first + "'s numbers" : "Your numbers"} rows={past.map((s) => ({ starts: s.starts, reps: row(s.id)?.reps || {} })).filter((x) => allReps(x.reps))} />
    {past.length > 0 && <section className="ls-sec">
      <h2>Past sessions</h2>
      <ul className="ls-hist">{past.map((s) => { const r = row(s.id); return <li key={s.id}><div>
        <span className="ls-hist-d">{shortDate(s.starts)}</span>
        <span><b>{sessionName(s)}</b>{r && allReps(r.reps) > 0 ? <small>{SKILL_IDS.filter((k) => total(r.reps, k)).map((k) => `${REP_KINDS[k].name}: ${detail(r.reps, k)}`).join(" · ")}</small> : s.focus.length > 0 && <small>Worked on {s.focus.map((f) => skillName(f).toLowerCase()).join(", ")}</small>}
          {s.shared_note && <small>{s.shared_note}</small>}</span>
        <span className="ls-hist-flags">{s.price || r ? (r?.paid ? <i className="ok">Paid</i> : <i className="due">Not paid yet</i>) : null}</span></div></li>; })}</ul>
    </section>}
    <details className="ls-joinmore"><summary>Join with another code</summary><Join code="" onJoined={load} /></details>
  </div>;
}
function CancelBooking({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return <button className={"btn sm ghost" + (armed ? " danger" : "")} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? "Tap again to cancel" : "Cancel booking"}</button>;
}

function Join({ code, onJoined, first }: { code: string; onJoined: () => void; first?: boolean }) {
  const [c, setC] = useState(code.toUpperCase()), [role, setRole] = useState<"athlete" | "parent">(userMeta().kind === "parent" ? "parent" : "athlete"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const join = async () => {
    setBusy(true); setErr("");
    try { const name = await rpc("lesson_join", { invite: c.trim(), as_role: role }); toast(`You're in: ${name}'s lessons`); onJoined(); }
    catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  return <div className={first || code ? "ls-join ls-join-first" : "ls-join"}>
    {(first || code) && <><h1>Join your trainer's lessons</h1><p className="muted">Your trainer sends each athlete a six-letter code. Enter it to see your sessions, what you're working on, and your numbers.</p></>}
    <div className="ls-join-row">
      <input className="input" value={c} onChange={(e) => setC(e.target.value.toUpperCase())} placeholder="CODE" aria-label="Code from your trainer" maxLength={8} autoCapitalize="characters" />
      <button className="btn primary" disabled={busy || c.trim().length < 6} onClick={join}>{busy ? "Joining…" : "Join"}</button>
    </div>
    <div className="ls-join-role" role="radiogroup" aria-label="I'm">
      <label><input type="radio" name="jr" checked={role === "athlete"} onChange={() => setRole("athlete")} /> I'm the athlete</label>
      <label><input type="radio" name="jr" checked={role === "parent"} onChange={() => setRole("parent")} /> I'm a parent</label>
    </div>
    {err && <p className="ls-err">{err}</p>}
  </div>;
}

/* ====================================================================== public clinic page */
function ClinicPage({ code }: { code: string }) {
  const [c, setC] = useState<any>(undefined), [f, setF] = useState({ who: "", contact: "", note: "" }), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [sent, setSent] = useState(false);
  useEffect(() => { rpc("lesson_public", { c: code }, true).then((x) => { setC(x); if (x) document.title = (x.title || "Clinic") + " · FloorCall Lessons"; }).catch(() => setC(null)); }, [code]);
  const closed = useMemo(() => !c || c.status !== "scheduled" || new Date(c.starts).getTime() < Date.now(), [c]);
  if (c === undefined) return <div className="ls-page"><p className="muted">Loading…</p></div>;
  if (!c) return <div className="ls-page"><h1>This sign-up page isn't open</h1><p className="muted">Check the link with the trainer who sent it.</p></div>;
  const send = async () => { setBusy(true); setErr(""); try { await rpc("lesson_signup", { c: code, who: f.who.trim(), contact: f.contact.trim(), note: f.note.trim() || null }, true); setSent(true); } catch (e) { setErr(errText(e)); } setBusy(false); };
  return <div className="ls-clinic">
    <div className="ls-clinic-band">
      <p className="ls-clinic-by">{c.trainer} <Badge kind="verified" /> · FloorCall Lessons</p>
      <h1>{c.title || "Volleyball clinic"}</h1>
      <p className="ls-clinic-when">{new Date(c.starts).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, {time(c.starts)} · {c.minutes} min</p>
      {c.place && <p>{c.place}</p>}
      <dl className="ls-clinic-facts">
        {c.focus?.length > 0 && <div><dt>Skills</dt><dd>{c.focus.map(skillName).join(", ")}</dd></div>}
        {c.price && <div><dt>Price</dt><dd>{c.price}</dd></div>}
        {c.spots != null && <div><dt>Spots left</dt><dd>{c.spots}</dd></div>}
      </dl>
      {c.shared_note && <p className="ls-clinic-note">{c.shared_note}</p>}
      <button className="btn sm" onClick={() => download((c.title || "Clinic") + ".ics", ics([{ id: "clinic-" + code, ...c, kind: "clinic" }]), "text/calendar")}>Add to calendar</button>
    </div>
    <div className="ls-clinic-form">
      {sent ? <div><h2>You're signed up</h2><p>{c.trainer.split(" ")[0]} will confirm your spot{c.price ? " and how to pay" : ""}. If you have a FloorCall account, you'll also be able to see the session there once you're in.</p></div>
        : closed ? <div><h2>Sign-ups are closed</h2><p className="muted">This clinic has started or was canceled.</p></div>
        : c.spots === 0 ? <div><h2>This clinic is full</h2><p className="muted">Ask the trainer about the next one.</p></div>
        : <>
          <h2>Sign up</h2>
          <label className="field"><span className="label">Player's name</span><input value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} autoComplete="off" /></label>
          <label className="field"><span className="label">Parent's email or phone</span><input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} autoComplete="email" /></label>
          <label className="field"><span className="label">Anything the trainer should know (optional)</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Age, position, club" /></label>
          {err && <p className="ls-err">{err}</p>}
          <button className="btn primary" disabled={busy || f.who.trim().length < 2 || f.contact.trim().length < 5} onClick={send}>{busy ? "Sending…" : "Sign up"}</button>
          <p className="small muted">Only the trainer sees what you send. <a href="../legal/privacy.html">Privacy</a></p>
        </>}
    </div>
  </div>;
}

watchErrors();
// the schedule opens without a signal once visited (see public/lessons/sw.js); changes need a connection
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) addEventListener("load", () => {
  navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((r) => {
    const files = [location.href.split("#")[0], ...performance.getEntriesByType("resource").map((x) => x.name).filter((u) => u.startsWith(location.origin) || /fonts\.(googleapis|gstatic)\.com/.test(u))];
    r.active?.postMessage({ cache: [...new Set(files)] });
  }).catch(() => {});
});
createRoot(document.getElementById("root")!).render(<App />);

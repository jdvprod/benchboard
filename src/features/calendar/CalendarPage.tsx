/** Calendar: the team's season on one page, by month or by week. Matches on the schedule, matches already played,
 * practices, tournament days, and the team's own events (team dinner, photo day, film session), which are added here.
 * Players and families see it too (read-only), without practice notes. */
import { useState } from "react";
import { matchesOf, plansOf, replayOf, setTeamPatch, team, toast, uid } from "../../data/store";
import { Calendar, CalItem, fmtTime } from "../../ui/Calendar";
import { Card, download } from "../../ui/kit";
import { setUi } from "../../app/ui";
import { go } from "../../app/router";
import { isViewer } from "../../app/viewAs";
import type { TeamEvent } from "../../data/model";

const siteWord = (s: string) => (s === "away" ? "@ " : s === "neutral" ? "vs " : "vs ");

/** Everything on the team's calendar, as calendar items. Pure apart from reading the store. */
export function teamCalendarItems(viewer: boolean): CalItem[] {
  const t = team()!, items: CalItem[] = [];
  const played = matchesOf(t.id);
  for (const s of t.schedule || []) {
    // a scheduled match that's been played shows once, as played
    if (played.some((m) => m.date === s.date && m.opp.trim().toLowerCase() === s.opp.trim().toLowerCase())) continue;
    items.push({ id: "s" + s.id, date: s.date, time: s.time || undefined, title: siteWord(s.site) + s.opp, sub: [s.site === "home" ? "Home" : s.site === "away" ? "Away" : s.site === "neutral" ? "Neutral" : "", s.event].filter(Boolean).join(" · "), kind: "match", href: viewer ? undefined : "#/matchup" });
  }
  for (const m of played) {
    if (m.kind !== "match") continue;
    const R = m.status === "done" ? replayOf(m) : null, won = R?.wonUs || 0, lost = R?.wonThem || 0;
    items.push({ id: "m" + m.id, date: m.date, title: `${siteWord(m.site)}${m.opp}${R && won + lost ? ` · ${won > lost ? "W" : "L"} ${won}–${lost}` : m.status === "live" ? " · live" : ""}`, sub: m.event || undefined, kind: "match", done: m.status === "done",
      onClick: () => { setUi({ statsScope: "m:" + m.id }); go("stats"); } });
  }
  if (!viewer) for (const p of plansOf(t.id)) items.push({ id: "p" + p.id, date: p.date, time: p.start || undefined, title: p.title || "Practice", sub: p.blocks?.length ? `${p.blocks.reduce((a, b) => a + (b.minutes || 0), 0)} min · ${p.blocks.length} blocks` : undefined, kind: "practice", done: p.status === "done", href: "#/practice/" + p.id });
  else for (const p of plansOf(t.id)) items.push({ id: "p" + p.id, date: p.date, time: p.start || undefined, title: "Practice", kind: "practice" });
  for (const tr of t.tournaments || []) {
    const start = new Date(tr.start + "T12:00"), end = new Date((tr.end || tr.start) + "T12:00");
    for (let d = new Date(start), i = 0; d <= end && i < 7; d.setDate(d.getDate() + 1), i++) {
      const k = d.toISOString().slice(0, 10);
      items.push({ id: "t" + tr.id + k, date: k, title: tr.name, sub: tr.site || undefined, kind: "tournament", href: viewer ? undefined : "#/tournament/" + tr.id });
    }
  }
  for (const e of t.events || []) items.push({ id: "e" + e.id, date: e.date, time: e.time || undefined, title: e.title, sub: [e.place, e.note].filter(Boolean).join(" · ") || undefined, kind: "event" });
  return items;
}

const ics = (items: CalItem[], name: string) => {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FloorCall//Calendar//EN", "X-WR-CALNAME:" + esc(name)];
  for (const it of items) {
    const d = it.date.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${it.id}@getfloorcall.com`, `DTSTAMP:${stamp}`);
    if (it.time) { const [h, m] = it.time.split(":"); lines.push(`DTSTART:${d}T${h.padStart(2, "0")}${(m || "00").padStart(2, "0")}00`); }
    else { const n = new Date(it.date + "T12:00"); n.setDate(n.getDate() + 1); lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n.toISOString().slice(0, 10).replace(/-/g, "")}`); }
    lines.push("SUMMARY:" + esc(it.title)); if (it.sub) lines.push("DESCRIPTION:" + esc(it.sub)); lines.push("END:VEVENT");
  }
  return lines.concat("END:VCALENDAR").join("\r\n") + "\r\n";
};

export function CalendarPage() {
  const t = team()!, viewer = isViewer(t.id);
  const [adding, setAdding] = useState(false), [f, setF] = useState<Omit<TeamEvent, "id">>({ date: new Date().toISOString().slice(0, 10), time: "", title: "", place: "", note: "" });
  const items = teamCalendarItems(viewer);
  const add = () => {
    if (!f.title.trim()) { toast("Name the event."); return; }
    setTeamPatch({ events: [...(t.events || []), { ...f, title: f.title.trim(), id: uid("ev") }] });
    toast("Added to the calendar"); setAdding(false); setF({ ...f, title: "", place: "", note: "", time: "" });
  };
  const events = (t.events || []).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return <div className="page">
    <div className="pagehead"><h1>Calendar</h1></div>
    <Card>
      <Calendar items={items} storeKey="fc-cal-view" legend={[["match", "Matches"], ["practice", "Practices"], ["tournament", "Tournaments"], ["event", "Team events"]]}
        empty={viewer ? "Nothing on the calendar here yet." : <>Nothing here yet. Add matches in <a href="#/matchup">Matchup → Schedule</a>, plan practices in <a href="#/practice">Practice</a>, or add a team event.</>}
        actions={<>{!viewer && <button className="btn sm primary" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add event"}</button>}
          <button className="btn sm" onClick={() => download(`${t.name} calendar.ics`.replace(/[^\w\- .]+/g, ""), ics(items, t.name), "text/calendar")} title="Every item, for Google, Apple or Outlook calendar">Calendar file</button></>} />
    </Card>
    {adding && <Card title="Add a team event">
      <div className="grid2" style={{ gap: 12 }}>
        <label className="field"><span className="label">What</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Team dinner, picture day, film session" autoFocus /></label>
        <label className="field"><span className="label">Where (optional)</span><input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></label>
        <label className="field"><span className="label">Date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field"><span className="label">Time (optional)</span><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}><span className="label">Note (optional)</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={add}>Add event</button><button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button></div>
    </Card>}
    {!viewer && events.length > 0 && <Card title="Team events">
      <ul className="log">{events.map((e) => <li key={e.id} style={{ gridTemplateColumns: "1fr auto" }}><span><b>{e.title}</b> <span className="small muted">{new Date(e.date + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}{e.time ? " · " + fmtTime(e.time) : ""}{e.place ? " · " + e.place : ""}</span></span>
        <button className="btn sm ghost" onClick={() => setTeamPatch({ events: (t.events || []).filter((x) => x.id !== e.id) })}>Remove</button></li>)}</ul>
    </Card>}
  </div>;
}

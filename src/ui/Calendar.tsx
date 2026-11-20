/** A month or week calendar, shared by the coaching app (Calendar tab) and FloorCall Lessons.
 * Items are plain: a date (YYYY-MM-DD, the viewer's own day), an optional start time (HH:MM), a title, a kind for
 * its colour, and where it goes when tapped. Keyboard: ←/→ move a month or week; T jumps to today. */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import "./calendar.css";

export interface CalItem { id: string; date: string; time?: string; end?: string; title: string; sub?: string; kind: string; href?: string; onClick?: () => void; done?: boolean }
export type CalView = "month" | "week";

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Weeks start on Sunday (US school and club calendars). */
const weekStart = (d: Date) => addDays(d, -d.getDay());
export const fmtTime = (t?: string) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); if (!Number.isFinite(h)) return t; const ap = h >= 12 ? "pm" : "am", hh = h % 12 || 12; return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`; };

/** The days a month grid shows: whole weeks from the Sunday on or before the 1st to the Saturday on or after the last day. */
export function monthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
  const out: Date[] = [];
  for (let d = weekStart(first); d <= last || d.getDay() !== 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export function Calendar({ items, legend, initial, empty, actions, storeKey }: {
  items: CalItem[]; legend?: [string, string][]; initial?: CalView; empty?: ReactNode; actions?: ReactNode; storeKey?: string;
}) {
  const today = ymd(new Date());
  const [view, setView] = useState<CalView>(() => { try { return (storeKey && (localStorage.getItem(storeKey) as CalView)) || initial || "month"; } catch { return initial || "month"; } });
  const [anchor, setAnchor] = useState(() => new Date());
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { try { if (storeKey) localStorage.setItem(storeKey, view); } catch { /* private window */ } }, [view, storeKey]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const it of items) m.set(it.date, [...(m.get(it.date) || []), it]);
    for (const list of m.values()) list.sort((a, b) => (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));
    return m;
  }, [items]);
  const move = (n: number) => setAnchor((a) => (view === "month" ? new Date(a.getFullYear(), a.getMonth() + n, 1) : addDays(a, 7 * n)));
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (el && /input|textarea|select/i.test(el.tagName)) return;
      if (e.key === "ArrowLeft") move(-1); else if (e.key === "ArrowRight") move(1); else if (e.key === "t" || e.key === "T") setAnchor(new Date());
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  }, [view]);
  const days = view === "month" ? monthDays(anchor.getFullYear(), anchor.getMonth()) : Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
  const title = view === "month" ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : (() => { const a = days[0], b = days[6]; return a.getMonth() === b.getMonth() ? `${a.toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${b.getDate()}, ${b.getFullYear()}` : `${a.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${b.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`; })();
  const inRange = days.some((d) => byDay.has(ymd(d)));
  const Item = ({ it, wide }: { it: CalItem; wide?: boolean }) => {
    const body = <><span className="cal-dot" aria-hidden="true" />{it.time && <span className="cal-time">{fmtTime(it.time)}</span>}<span className="cal-t">{it.title}</span>{wide && it.sub && <span className="cal-sub">{it.sub}</span>}</>;
    const cls = `cal-item k-${it.kind}${it.done ? " done" : ""}`;
    return it.href ? <a className={cls} href={it.href} title={[fmtTime(it.time), it.title, it.sub].filter(Boolean).join(" · ")}>{body}</a>
      : it.onClick ? <button className={cls} onClick={it.onClick} title={[fmtTime(it.time), it.title, it.sub].filter(Boolean).join(" · ")}>{body}</button>
      : <span className={cls}>{body}</span>;
  };
  return <div className={"cal cal-" + view}>
    <div className="cal-bar">
      <div className="cal-nav">
        <button className="cal-arrow" onClick={() => move(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg></button>
        <button className="cal-arrow" onClick={() => move(1)} aria-label={view === "month" ? "Next month" : "Next week"}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg></button>
        <h2 className="cal-title" aria-live="polite">{title}</h2>
        <button className="cal-today" onClick={() => setAnchor(new Date())}>Today</button>
      </div>
      <div className="cal-right">
        {actions}
        <div className="cal-views" role="group" aria-label="Calendar view">
          <button aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
          <button aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
        </div>
      </div>
    </div>
    {legend && <ul className="cal-legend">{legend.map(([k, l]) => <li key={k} className={"k-" + k}><span className="cal-dot" aria-hidden="true" />{l}</li>)}</ul>}
    <div className="cal-head" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => <span key={d}>{view === "week" ? <>{d} <b>{days[i].getDate()}</b></> : d}</span>)}</div>
    <div className="cal-grid">
      {days.map((d) => {
        const k = ymd(d), list = byDay.get(k) || [], out = view === "month" && d.getMonth() !== anchor.getMonth();
        const shown = view === "month" ? list.slice(0, 3) : list;
        return <div key={k} className={"cal-day" + (k === today ? " today" : "") + (out ? " out" : "") + (k < today ? " past" : "")} aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (list.length ? `, ${list.length} ${list.length === 1 ? "item" : "items"}` : "")}>
          {view === "month" ? <button className={"cal-num" + (picked === k ? " picked" : "")} onClick={() => setPicked(picked === k ? null : k)} aria-label={"Show " + d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>{d.getDate()}</button>
            : <span className="cal-num">{d.toLocaleDateString(undefined, { weekday: "short" })} <b>{d.getDate()}</b></span>}
          <div className="cal-items">{shown.map((it) => <Item key={it.id} it={it} wide={view === "week"} />)}
            {view === "month" && list.length > 3 && <button className="cal-more" onClick={() => { setAnchor(d); setView("week"); }}>+{list.length - 3} more</button>}</div>
        </div>;
      })}
    </div>
    {view === "month" && picked && <div className="cal-pick" aria-live="polite">
      <div className="cal-pick-hd"><b>{parse(picked).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</b><button className="cal-x" onClick={() => setPicked(null)} aria-label="Close">×</button></div>
      {(byDay.get(picked) || []).length ? <div className="cal-pick-list">{(byDay.get(picked) || []).map((it) => <Item key={it.id} it={it} wide />)}</div> : <p className="cal-empty">Nothing on this day.</p>}
    </div>}
    {!inRange && empty && <div className="cal-empty">{empty}</div>}
  </div>;
}

/** Next items from today on, for a short list beside or under the calendar. */
export const upcomingItems = (items: CalItem[], n = 6) => { const t = ymd(new Date()); return items.filter((x) => x.date >= t).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))).slice(0, n); };
export { parse as parseYmd };

/** A calendar file (.ics) of the team's upcoming matches, for families' phone calendars. Pure: unit tested.
 * Times are "floating" local times (no time zone), which every calendar app shows as the time on the schedule. */
export interface CalItem { uid: string; date: string; time?: string; title: string; where?: string; note?: string; minutes?: number }
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => { const out: string[] = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const ymd = (iso: string) => iso.replace(/-/g, "");
const addMin = (date: string, time: string, min: number) => { const d = new Date(`${date}T${time}:00`); d.setMinutes(d.getMinutes() + min); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`; };
const nextDay = (iso: string) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };

export function icsFile(calName: string, items: CalItem[], now = new Date()): string {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jumpset//Live//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc(calName)];
  for (const it of items) {
    L.push("BEGIN:VEVENT", "UID:" + it.uid + "@jumpset", "DTSTAMP:" + stamp(now));
    if (it.time && /^\d{1,2}:\d{2}$/.test(it.time)) { const t = it.time.padStart(5, "0"); L.push("DTSTART:" + ymd(it.date) + "T" + t.replace(":", "") + "00", "DTEND:" + addMin(it.date, t, it.minutes || 90)); }
    else L.push("DTSTART;VALUE=DATE:" + ymd(it.date), "DTEND;VALUE=DATE:" + nextDay(it.date));
    L.push("SUMMARY:" + esc(it.title));
    if (it.where) L.push("LOCATION:" + esc(it.where));
    if (it.note) L.push("DESCRIPTION:" + esc(it.note));
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

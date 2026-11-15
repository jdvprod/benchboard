/** Turns a pasted schedule (from a league site, email or PDF) into schedule entries. One match per line. */
export interface ParsedGame { date: string; time: string; opp: string; site: "home" | "away" | "neutral" | ""; event: string; line: string }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function inferYear(m: number, d: number, today: Date): number {
  // Schedules are for the coming season: a date more than ~2 months in the past belongs to next year.
  const y = today.getFullYear(), cand = new Date(y, m - 1, d);
  return cand.getTime() < today.getTime() - 60 * 86400000 ? y + 1 : y;
}

export function parseSchedule(text: string, today = new Date()): ParsedGame[] {
  const out: ParsedGame[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\t+/g, "  ").trim(); if (!line) continue;
    let y = 0, mo = 0, d = 0, m: RegExpMatchArray | null;
    if ((m = line.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = line.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/))) { mo = +m[1]; d = +m[2]; if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
    else if ((m = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/i))) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = +m[2]; if (m[3]) y = +m[3]; }
    if (!mo || !d || mo > 12 || d > 31) continue;
    line = line.replace(m![0], " ");
    if (!y) y = inferYear(mo, d, today);
    if (new Date(y, mo - 1, d).getDate() !== d) continue; // e.g. 2/31
    // time
    let time = "";
    const tm = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)\b/i) || line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (tm) {
      let h = +tm[1]; const min = tm[2] ? +tm[2] : 0, ap = (tm[3] || "").toLowerCase();
      if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0;
      if (!ap && h < 8) h += 12; // "6:00" on a schedule means evening
      time = pad(h) + ":" + pad(min); line = line.replace(tm[0], " ");
    }
    // site
    let site: ParsedGame["site"] = "";
    if (/(^|\s)(@|at)\s/i.test(" " + line + " ") || /\baway\b/i.test(line)) site = "away";
    else if (/\b(vs\.?|v\.|home)\b/i.test(line)) site = "home";
    if (/\b(neutral|tournament|tourney|invitational|classic|showcase|qualifier)\b/i.test(line) && site !== "away") site = site || "neutral";
    // event: text in parentheses, or after " - " / " | "
    line = line.replace(/\s+/g, " ").trim().replace(/^[-–|:]\s*/, "").replace(/\s*[-–|:]$/, "");
    let event = "";
    const pe = line.match(/\(([^)]+)\)/); if (pe) { event = pe[1].trim(); line = line.replace(pe[0], " "); }
    else { const de = line.split(/\s[-–|]\s/); if (de.length > 1) { event = de.slice(1).join(" ").trim(); line = de[0]; } }
    const opp = line
      .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|sday|urday)?\b\.?,?/gi, " ")
      .replace(/(^|\s)(@|at|vs\.?|v\.|versus|home|away|neutral)(?=\s|$)/gi, " ")
      .replace(/\b(varsity|jv|frosh|freshman|game|match)\b:?/gi, " ")
      .replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[-–:]\s*|\s*[-–:]$/g, "");
    if (!opp || /^(tbd|tba|bye)$/i.test(opp)) continue;
    out.push({ date: `${y}-${pad(mo)}-${pad(d)}`, time, opp, site, event: event.replace(/\s+/g, " "), line: raw.trim() });
  }
  return out;
}

/** A calendar file (.ics from Google Calendar, TeamSnap, a league site) as schedule lines parseSchedule understands:
 * "2026-12-05 18:00 vs Central - Fresno Convention Center". Practices and past events are left out. */
export function icsToLines(ics: string, today = new Date()): string[] {
  const text = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, ""), out: { key: string; line: string }[] = [];
  const pad = (n: number) => String(n).padStart(2, "0"), un = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
  const from = new Date(today.getTime() - 86400000), fromKey = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
  for (const block of text.split(/BEGIN:VEVENT/i).slice(1)) {
    const body = block.split(/END:VEVENT/i)[0], get = (k: string) => { const m = body.match(new RegExp(`^${k}((?:;[^:\\r\\n]*)?):(.*)$`, "im")); return m ? { params: m[1], value: m[2].trim() } : null; };
    const st = get("DTSTART"), sum = get("SUMMARY"); if (!st || !sum) continue;
    const summary = un(sum.value); if (!summary || /\bpractice\b|\bcancel(l)?ed\b/i.test(summary)) continue;
    const m = st.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/); if (!m) continue;
    let date: string, time = "";
    if (m[4] && m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; time = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    else { date = `${m[1]}-${m[2]}-${m[3]}`; if (m[4]) time = `${m[4]}:${m[5]}`; }
    if (date < fromKey) continue;
    const loc = get("LOCATION"), where = loc ? un(loc.value).split(/,/)[0].trim() : "";
    out.push({ key: date + (time || "99"), line: `${date}${time ? " " + time : ""} ${summary}${where ? " - " + where : ""}` });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.line);
}

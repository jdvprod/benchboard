/** A practice plan as a printable sheet: times, blocks, minutes and notes, with room to write. */
import type { PracticePlan } from "../../data/model";
import { esc, PRINT_CSS } from "../../ui/print";

const clock = (hhmm: string, add: number) => { const [h, m] = (hhmm || "0:0").split(":").map(Number); const t = (h || 0) * 60 + (m || 0) + add, H = Math.floor(t / 60) % 24, M = t % 60; return `${((H + 11) % 12) + 1}:${String(M).padStart(2, "0")} ${H < 12 ? "am" : "pm"}`; };

export function planSheetHtml(plan: PracticePlan, team: { name: string; gym?: string }): string {
  const total = plan.blocks.reduce((a, b) => a + (b.minutes || 0), 0);
  let at = 0;
  const rows = plan.blocks.map((b) => { const s = clock(plan.start, at); at += b.minutes || 0; return `<tr><td style="white-space:nowrap"><b>${s}</b></td><td><b>${esc(b.title)}</b><div class="mut">${esc(b.category)}</div>${b.notes ? `<div>${esc(b.notes)}</div>` : ""}</td><td style="text-align:right;white-space:nowrap">${b.minutes} min</td><td style="width:22%"></td></tr>`; }).join("");
  const day = new Date(plan.date + "T12:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(plan.title)} · ${esc(team.name)}</title><style>${PRINT_CSS}</style></head><body><main>
<h1>${esc(plan.title || "Practice")}</h1>
<p class="mut">${esc(team.name)} · ${esc(day)} · ${clock(plan.start, 0)}–${clock(plan.start, total)} (${total} min)${plan.place || team.gym ? " · " + esc(plan.place || team.gym) : ""}</p>
<table><thead><tr><th>Time</th><th>Block</th><th style="text-align:right">Length</th><th>Notes</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="mut">No blocks yet.</td></tr>`}</tbody></table>
${plan.notes ? `<h2>Notes</h2><div class="box">${esc(plan.notes).replace(/\n/g, "<br>")}</div>` : ""}
<footer>Made with FloorCall</footer></main></body></html>`;
}

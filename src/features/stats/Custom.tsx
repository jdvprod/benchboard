/** Stats → Pick stats: a dropdown to look up any one stat, and a table of only the stats a coach chooses,
 * for the whole team or one player, ready to print. */
import { useState } from "react";
import { aggregate, Agg } from "../../sports/volleyball/engine";
import { player, playerName, team, teamPlayers, toast } from "../../data/store";
import { Card, fmtDate } from "../../ui/kit";
import { LineChart } from "../../ui/charts";
import { go } from "../../app/router";
import { Scope } from "./scope";
import { fmtStat, GROUPS, playerSubject, PRESETS, STAT, StatDef, STATS, Subject, teamSubject } from "./catalog";

const PICK_KEY = () => "fc-statpicks-" + (team()?.id || "");
function loadPicks(): string[] { try { const v = JSON.parse(localStorage.getItem(PICK_KEY()) || "null"); if (Array.isArray(v) && v.length) return v.filter((k) => STAT[k]); } catch { /* ignore */ } return PRESETS[0][2]; }
function savePicks(v: string[]) { try { localStorage.setItem(PICK_KEY(), JSON.stringify(v)); } catch { /* ignore */ } }

function StatSelect({ value, onChange, label }: { value: string; onChange: (k: string) => void; label: string }) {
  return <select className="input" style={{ width: "auto", maxWidth: 280 }} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
    {GROUPS.map((g) => <optgroup key={g} label={g}>{STATS.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>)}
  </select>;
}

/** Rows over time for one subject: sets of one match, or the matches in the selection. */
function overTime(S: Scope, who: string | "team"): { label: string; sub?: string; x: Subject }[] {
  const subj = (a: Agg) => (who === "team" ? teamSubject(a) : playerSubject(a, who));
  if (S.single) return S.single.R.sets.map((s) => ({ label: "Set " + s.n, x: subj(aggregate([s])) }));
  return S.items.slice().sort((a, b) => a.m.date.localeCompare(b.m.date)).map(({ m, R }) => ({ label: fmtDate(m.date), sub: (m.kind === "match" ? "vs " : "") + m.opp, x: subj(aggregate(R.sets)) }));
}

export function CustomView({ S, A }: { S: Scope; A: Agg }) {
  return <><StatLookup S={S} A={A} /><StatPicker S={S} A={A} /></>;
}

/** One stat from a dropdown: the team number, every player ranked, and the trend. */
function StatLookup({ S, A }: { S: Scope; A: Agg }) {
  const [k, setK] = useState("K"), d = STAT[k];
  const ids = teamPlayers().map((p) => p.id).filter((id) => A.ps[id] || A.setsPlayed[id]);
  const rows = ids.map((id) => ({ id, v: d.get(playerSubject(A, id)) })).filter((r) => r.v != null && (r.v !== 0 || d.lowIsGood))
    .sort((a, b) => (d.lowIsGood ? (a.v as number) - (b.v as number) : (b.v as number) - (a.v as number)));
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.v as number)));
  const trend = overTime(S, "team").map((r) => ({ label: r.label, sub: r.sub, v: d.get(r.x) }));
  return <Card title="Look up a stat" actions={<StatSelect value={k} onChange={setK} label="Stat" />}>
    <div className="lookup">
      <div className="lookup-team"><span className="label">Team</span><b>{fmtStat(d, d.get(teamSubject(A)))}</b><span className="muted small">{d.label}{d.desc ? `. ${d.desc}.` : ""}</span></div>
      <div className="lookup-rank">{rows.length ? rows.map((r, i) => <button key={r.id} className="lookup-row" onClick={() => go("player", r.id)}>
        <span className="lookup-n">{i + 1}</span><span className="lookup-nm">{playerName(r.id)}</span>
        <span className="lookup-bar"><i style={{ width: (100 * Math.abs(r.v as number)) / max + "%" }} /></span><b>{fmtStat(d, r.v)}</b>
      </button>) : <p className="empty">No one has this stat yet.</p>}</div>
    </div>
    {trend.length > 1 && <><div className="label" style={{ marginTop: 12 }}>{S.single ? "By set" : "By match"}</div><LineChart points={trend} format={(v) => fmtStat(d, v)} height={170} /></>}
  </Card>;
}

/** Only the stats the coach ticks, for the team or one player, with print. */
function StatPicker({ S, A }: { S: Scope; A: Agg }) {
  const [picks, setPicksState] = useState<string[]>(loadPicks), [who, setWho] = useState<string>("team"), [open, setOpen] = useState(false);
  const setPicks = (v: string[]) => { setPicksState(v); savePicks(v); };
  const cols = picks.map((k) => STAT[k]).filter(Boolean) as StatDef[];
  const ids = teamPlayers().map((p) => p.id).filter((id) => A.ps[id] || A.setsPlayed[id]);
  const rows: { key: string; label: string; sub?: string; x: Subject; total?: boolean; id?: string }[] = who === "team"
    ? [...ids.map((id) => ({ key: id, id, label: playerName(id), x: playerSubject(A, id) })), { key: "_t", label: "Team", x: teamSubject(A), total: true }]
    : [...overTime(S, who).map((r, i) => ({ key: "r" + i, label: r.label, sub: r.sub, x: r.x })), { key: "_t", label: S.single ? "Match" : "Total", x: playerSubject(A, who), total: true }];
  const title = who === "team" ? `${team()!.name}: ${S.label}` : `${playerName(who)}: ${S.label}`;
  const toggle = (k: string) => setPicks(picks.includes(k) ? picks.filter((x) => x !== k) : [...picks, k]);

  return <Card title="Choose your stats" actions={<div className="row">
    <select className="input" style={{ width: "auto", maxWidth: 220 }} aria-label="Stats for" value={who} onChange={(e) => setWho(e.target.value)}>
      <option value="team">Whole team</option>{ids.map((id) => <option key={id} value={id}>{playerName(id)}</option>)}
    </select>
    <select className="input" style={{ width: "auto" }} aria-label="Start from" value="" onChange={(e) => { const p = PRESETS.find((x) => x[0] === e.target.value); if (p) setPicks(p[2]); }}>
      <option value="">Start from…</option>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
    <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Done choosing" : `Stats (${cols.length})`}</button>
    <button className="btn sm primary" disabled={!cols.length} onClick={() => printTable(title, cols, rows)}>Print</button>
  </div>}>
    {open && <div className="picker">{GROUPS.map((g) => <fieldset key={g} className="picker-g"><legend>{g}</legend>
      {STATS.filter((d) => d.group === g).map((d) => <label key={d.key} className="picker-o"><input type="checkbox" checked={picks.includes(d.key)} onChange={() => toggle(d.key)} />{d.label}</label>)}
    </fieldset>)}
      <div className="row"><button className="btn sm" onClick={() => setPicks([])}>Clear all</button><span className="small muted">Columns show in the order you tick them. Your picks are remembered on this device.</span></div>
    </div>}
    {!cols.length ? <p className="empty">Tick at least one stat to build your table.</p> : <div className="tbl"><table>
      <thead><tr><th className="l">{who === "team" ? "Player" : S.single ? "Set" : "Match"}</th>{cols.map((d) => <th key={d.key} title={d.label}>{d.short}</th>)}</tr></thead>
      <tbody>{rows.filter((r) => !r.total).map((r) => <tr key={r.key} className={r.id ? "click" : ""} onClick={r.id ? () => go("player", r.id!) : undefined}>
        <td className="l">{r.label}{r.sub && <span className="muted small"> {r.sub}</span>}</td>{cols.map((d) => <td key={d.key}>{fmtStat(d, d.get(r.x))}</td>)}</tr>)}</tbody>
      <tfoot>{rows.filter((r) => r.total).map((r) => <tr key={r.key}><td className="l">{r.label}</td>{cols.map((d) => <td key={d.key}>{fmtStat(d, d.get(r.x))}</td>)}</tr>)}</tfoot>
    </table></div>}
    {cols.length > 0 && <p className="keys" style={{ marginTop: 8 }}>{cols.map((d) => `${d.short} = ${d.label}`).join(". ")}.</p>}
  </Card>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function printTable(title: string, cols: StatDef[], rows: { label: string; sub?: string; x: Subject; total?: boolean }[]) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#000;margin:24px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 14px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:right;font-variant-numeric:tabular-nums}th{font-size:11px;text-transform:none;border-bottom:2px solid #000}
th:first-child,td:first-child{text-align:left}tfoot td{font-weight:700;border-top:2px solid #000}small{color:#666}.k{margin-top:12px;font-size:11px;color:#555}@page{margin:12mm}</style></head><body>
<h1>${esc(title)}</h1><p>Floorcall, printed ${new Date().toLocaleDateString()}</p><table><thead><tr><th></th>${cols.map((d) => `<th>${esc(d.short)}</th>`).join("")}</tr></thead>
<tbody>${rows.filter((r) => !r.total).map((r) => `<tr><td>${esc(r.label)}${r.sub ? ` <small>${esc(r.sub)}</small>` : ""}</td>${cols.map((d) => `<td>${esc(fmtStat(d, d.get(r.x)))}</td>`).join("")}</tr>`).join("")}</tbody>
<tfoot>${rows.filter((r) => r.total).map((r) => `<tr><td>${esc(r.label)}</td>${cols.map((d) => `<td>${esc(fmtStat(d, d.get(r.x)))}</td>`).join("")}</tr>`).join("")}</tfoot></table>
<p class="k">${cols.map((d) => `${esc(d.short)} = ${esc(d.label)}`).join(". ")}.</p></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch { /* the page is open; they can print from it */ } }, 300); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = title.replace(/[^\w\- .]+/g, "") + ".html"; a.click();
  toast("Saved the table. Open it to print.");
}

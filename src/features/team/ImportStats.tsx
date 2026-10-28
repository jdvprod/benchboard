/** Team tab: bring in stats from Hudl, SoloStats, MaxPreps or a spreadsheet. */
import { useState } from "react";
import { importMatch, matchesOf, save, team, teamPlayers, toast, todayISO, uid } from "../../data/store";
import { Player } from "../../data/model";
import { Card, Seg } from "../../ui/kit";
import { readXlsx } from "../../lib/xlsx";
import { localISO } from "../../lib/dates";
import { Field, FIELD_LABEL, FIELDS, formatFrom, guessFields, Line, linesOf, matchEvents, oppFromFileName, plansFrom, readText, Table, toTable } from "../../import/statsImport";
import { positionCell } from "./parseRoster";

type Mode = "match" | "season" | "rows";
interface Pending { id: string; name: string; table: Table; fields: Field[]; mode: Mode; opp: string; date: string; scores: string; sheet?: string }
const KIND: Record<Table["kind"], string> = { maxpreps: "MaxPreps file (from Hudl, SoloStats and others)", csv: "Spreadsheet (CSV)", tsv: "Spreadsheet (tab-separated)", xlsx: "Excel spreadsheet" };
const statCount = (f: Field[]) => f.filter((x) => /^[A-Z]/.test(x)).length;
const sameNum = (a: string, b: string) => !!a && !!b && (a === b || (/^\d+$/.test(a) && /^\d+$/.test(b) && +a === +b && a.replace(/^0+/, "") === b.replace(/^0+/, "")));

export function ImportStats() {
  const t = team()!, [files, setFiles] = useState<Pending[]>([]), [addNew, setAddNew] = useState(true), [busy, setBusy] = useState(false);
  const roster = teamPlayers();
  const find = (l: Line): Player | undefined => roster.find((p) => sameNum(p.num, l.num)) || (l.first || l.last ? roster.find((p) => p.first.toLowerCase() === l.first.toLowerCase() && (!l.last || p.last.toLowerCase().startsWith(l.last.toLowerCase().slice(0, 3)))) : undefined);

  const read = async (list: FileList | null) => {
    if (!list?.length) return; setBusy(true);
    const out: Pending[] = [];
    for (const f of Array.from(list)) {
      try {
        let table: Table, sheet: string | undefined;
        if (/\.xlsx$/i.test(f.name)) {
          // the sheet that looks most like player stats
          const sheets = await readXlsx(await f.arrayBuffer());
          const best = sheets.map((s) => ({ s, t: toTable(s.rows, "xlsx") })).sort((a, b) => statCount(guessFields(b.t.header)) - statCount(guessFields(a.t.header)))[0];
          if (!best) throw new Error("empty"); table = best.t; sheet = sheets.length > 1 ? best.s.name : undefined;
        } else table = readText(await f.text());
        if (!table.header.length || !table.rows.length) { toast(`${f.name}: couldn't find a table of player stats in it.`); continue; }
        const fields = guessFields(table.header), byRows = fields.includes("date") && fields.includes("opp");
        out.push({ id: uid("f"), name: f.name, table, fields, sheet, mode: byRows ? "rows" : /season|total/i.test(f.name) ? "season" : "match", opp: oppFromFileName(f.name), date: f.lastModified ? localISO(new Date(f.lastModified)) : todayISO(), scores: "" });
      } catch { toast(`${f.name}: couldn't read this file. Save it as .csv, .xlsx or the MaxPreps .txt export.`); }
    }
    setFiles((x) => x.concat(out)); setBusy(false);
  };
  const upd = (id: string, p: Partial<Pending>) => setFiles((x) => x.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const preview = files.map((f) => {
    const lines = linesOf(f.table, f.fields), plans = plansFrom(lines, f), notes = new Set<string>();
    plans.forEach((pl) => matchEvents(pl, () => "x", notes as any));
    const matched = lines.filter((l) => find(l)), fresh = lines.filter((l) => !find(l));
    const dupes = plans.filter((pl) => matchesOf().some((m) => m.imported && m.date === pl.date && m.opp.toLowerCase() === pl.opp.toLowerCase()));
    return { f, lines, plans, notes, matched, fresh, dupes };
  });
  const total = preview.reduce((n, p) => n + p.plans.length - p.dupes.length, 0);

  const run = () => {
    let made = 0, added = 0;
    const created = new Map<string, string>(); // new players by number/name key, so several files share them
    for (const { f, plans, dupes } of preview) {
      for (const pl of plans) {
        if (dupes.includes(pl)) continue;
        const pid = (l: Line): string | null => {
          const p = find(l); if (p) return p.id;
          const key = l.num || (l.first + " " + l.last).toLowerCase();
          if (created.has(key)) return created.get(key)!;
          if (!addNew) return null;
          const np: Player = { id: uid("p"), teamId: t.id, num: l.num, first: l.first, last: l.last, pos: positionCell(l.pos) || "OH", grad: null, height: "", active: true, goals: [], notes: "" };
          save("players", np); roster.push(np); created.set(key, np.id); added++; return np.id;
        };
        const { bestOf, setTo } = formatFrom(pl.scores);
        importMatch({ opp: pl.opp, date: pl.date, bestOf, setTo, imported: { source: KIND[f.table.kind], file: f.name, at: Date.now(), season: pl.season || undefined }, events: matchEvents(pl, pid, new Set()) as any });
        made++;
      }
    }
    setFiles([]);
    toast(`Imported ${made} ${made === 1 ? "match" : "matches"}${added ? ` and added ${added} ${added === 1 ? "player" : "players"}` : ""}. Find them in Stats and on the Team tab.`);
  };

  return <Card title="Import stats from another app">
    <p className="small" style={{ marginTop: 0 }}>Bring last season (or this one) over from <b>Hudl</b> or <b>SoloStats</b> (export each match's MaxPreps file, a .txt), from <b>MaxPreps</b>, or from any spreadsheet (.xlsx or .csv, one row per player). GameChanger doesn't export volleyball stats yet.</p>
    <label className="btn sm primary" style={{ cursor: "pointer" }}>{busy ? "Reading…" : files.length ? "Add more files" : "Choose files"}<input type="file" multiple accept=".txt,.csv,.tsv,.xlsx,text/plain,text/csv" hidden onChange={(e) => { read(e.target.files); e.target.value = ""; }} /></label>
    {preview.map(({ f, lines, plans, notes, matched, fresh, dupes }) => <div key={f.id} className="imp-file">
      <div className="row between"><div><b>{f.name}</b><div className="small muted">{KIND[f.table.kind]}{f.sheet ? ` · sheet "${f.sheet}"` : ""} · {lines.length} {lines.length === 1 ? "player" : "players"}{f.table.skipped ? ` · ${f.table.skipped} total lines left out` : ""}</div></div>
        <button className="btn sm ghost" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={"Remove " + f.name}>Remove</button></div>
      <div className="row" style={{ marginTop: 8 }}><span className="small">This file is</span>
        <Seg value={f.mode} onChange={(v) => upd(f.id, { mode: v })} label="What the file holds" options={[["match", "One match"], ["season", "Season totals"], ...(f.fields.includes("date") && f.fields.includes("opp") ? [["rows", "Several matches"] as [Mode, string]] : [])]} /></div>
      {f.mode === "match" && <div className="imp-grid">
        <label className="field"><span className="label">Opponent</span><input value={f.opp} onChange={(e) => upd(f.id, { opp: e.target.value })} placeholder="e.g. Buchanan" /></label>
        <label className="field"><span className="label">Date</span><input type="date" value={f.date} onChange={(e) => upd(f.id, { date: e.target.value })} /></label>
        <label className="field"><span className="label">Set scores (optional)</span><input value={f.scores} onChange={(e) => upd(f.id, { scores: e.target.value })} placeholder="25-20, 22-25, 15-12" /></label>
      </div>}
      {f.mode === "season" && <p className="small muted">Season totals count toward season stats and player pages, but don't show as a match result.</p>}
      {f.mode === "rows" && <p className="small muted">{plans.length} {plans.length === 1 ? "match" : "matches"} by date and opponent{plans.some((p) => !p.scores.length) ? "; matches without set scores in the file come in without a result" : ""}.</p>}
      <details className="imp-cols"><summary>Columns: {statCount(f.fields)} stats matched{f.fields.some((x) => x === "ignore") ? `, ${f.fields.filter((x) => x === "ignore").length} left out` : ""}. Check them</summary>
        <div className="imp-colgrid">{f.table.header.map((h, i) => <div key={i} className="field"><span className="label" aria-hidden="true">{h || `Column ${i + 1}`}</span>
          <select className="input" aria-label={`Column "${h || i + 1}" imports as`} value={f.fields[i]} onChange={(e) => upd(f.id, { fields: f.fields.map((x, j) => (j === i ? (e.target.value as Field) : x)) })}>{FIELDS.map((k) => <option key={k} value={k}>{FIELD_LABEL[k]}</option>)}</select></div>)}</div>
      </details>
      <p className="small" style={{ margin: "8px 0 0" }}>{matched.length} on your roster{fresh.length ? ` · ${fresh.length} not yet: ${fresh.slice(0, 4).map((l) => `${l.num ? "#" + l.num + " " : ""}${l.first} ${l.last}`.trim()).join(", ")}${fresh.length > 4 ? "…" : ""}` : ""}</p>
      {notes.has("passes-unrated") && <p className="small muted" style={{ margin: "4px 0 0" }}>Receptions in this file have no pass ratings, so they're left out: a pass average can't be made up.</p>}
      {notes.has("passes-4scale") && <p className="small muted" style={{ margin: "4px 0 0" }}>Pass averages look like a 0–4 scale; they're converted to 0–3.</p>}
      {dupes.length > 0 && <p className="small" style={{ margin: "4px 0 0", color: "var(--warn)" }}>{dupes.map((d) => `${d.opp} on ${d.date}`).join(", ")} {dupes.length === 1 ? "was" : "were"} already imported and will be skipped.</p>}
    </div>)}
    {files.length > 0 && <div className="stack" style={{ marginTop: 10 }}>
      {preview.some((p) => p.fresh.length) && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} /> Add players who aren't on the roster yet</label>}
      <div className="row"><button className="btn primary" disabled={!total} onClick={run}>Import {total} {total === 1 ? "match" : "matches"}</button><button className="btn" onClick={() => setFiles([])}>Cancel</button></div>
      <p className="keys">Imported matches count for players' stats, reports, Benchboard Live and Recruit. They don't have rally-by-rally detail, so side-out, rotation and situation numbers only come from matches you track. Delete one from Matches & practices if it went wrong.</p>
    </div>}
  </Card>;
}

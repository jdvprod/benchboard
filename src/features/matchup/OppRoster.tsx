/** Their roster: jersey numbers, and names and positions if the coach wants them. Used when tracking their plays
 * and on Floorcall Live; with no names, Live just says the team name. */
import { useState } from "react";
import { OppRoster } from "../../data/model";
import { POSITIONS } from "../../sports/volleyball/actions";

const clean = (n: string) => n.replace(/[^0-9A-Za-z]/g, "").slice(0, 3);
const byNum = (a: string, b: string) => (parseInt(a) || 999) - (parseInt(b) || 999) || a.localeCompare(b);

/** "11 Kayla Smith OH, 7, 3 Jo" → roster entries. */
export function parseRoster(text: string): OppRoster {
  const out: OppRoster = {};
  for (const part of text.split(/[\n,;]+/)) {
    const w = part.trim().replace(/^#/, "").split(/\s+/).filter(Boolean); if (!w.length) continue;
    const n = clean(w[0]); if (!n || !/\d/.test(n)) continue;
    const rest = w.slice(1), last = rest[rest.length - 1]?.toUpperCase();
    const pos = last && (POSITIONS as readonly string[]).includes(last) ? last : "";
    const name = (pos ? rest.slice(0, -1) : rest).join(" ").slice(0, 40);
    out[n] = { ...(name ? { name } : {}), ...(pos ? { pos } : {}) };
  }
  return out;
}

export function OppRosterEditor({ roster, onChange, team }: { roster: OppRoster; onChange: (r: OppRoster) => void; team: string }) {
  const [n, setN] = useState(""), [name, setName] = useState(""), [pos, setPos] = useState(""), [paste, setPaste] = useState(""), [bulk, setBulk] = useState(false);
  const nums = Object.keys(roster).sort(byNum);
  const set = (k: string, v: { name?: string; pos?: string }) => onChange({ ...roster, [k]: { ...roster[k], ...v } });
  const add = () => { const k = clean(n); if (!k) return; onChange({ ...roster, [k]: { ...(name.trim() ? { name: name.trim() } : {}), ...(pos ? { pos } : {}) } }); setN(""); setName(""); setPos(""); };
  const drop = (k: string) => { const r = { ...roster }; delete r[k]; onChange(r); };
  return <div className="opr">
    {nums.length > 0 && <div className="tbl"><table className="opr-t">
      <thead><tr><th className="l">#</th><th className="l">Name (optional)</th><th className="l">Pos</th><th /></tr></thead>
      <tbody>{nums.map((k) => <tr key={k}>
        <td className="l"><b>{k}</b></td>
        <td className="l"><input className="input" defaultValue={roster[k]?.name || ""} placeholder="Name" aria-label={`Name for their #${k}`} onBlur={(e) => { if ((roster[k]?.name || "") !== e.target.value.trim()) set(k, { name: e.target.value.trim() }); }} /></td>
        <td className="l"><select className="input" value={roster[k]?.pos || ""} aria-label={`Position for their #${k}`} onChange={(e) => set(k, { pos: e.target.value })}><option value="">–</option>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select></td>
        <td><button className="btn sm ghost" aria-label={`Remove their #${k}`} onClick={() => drop(k)}>Remove</button></td>
      </tr>)}</tbody></table></div>}
    <div className="opr-add">
      <input className="input" style={{ width: 70 }} inputMode="numeric" placeholder="#" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Their jersey number" />
      <input className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Their player's name" />
      <select className="input" style={{ width: 84 }} value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Their player's position"><option value="">Pos</option>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select>
      <button className="btn sm" disabled={!clean(n)} onClick={add}>Add player</button>
      <button className="btn sm ghost" aria-expanded={bulk} onClick={() => setBulk(!bulk)}>Paste a list</button>
    </div>
    {bulk && <div className="opr-bulk">
      <textarea className="input" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"One per line or separated by commas:\n11 Kayla Smith OH\n7\n3 Jordan L"} aria-label="Their roster as a list" />
      <button className="btn sm primary" disabled={!Object.keys(parseRoster(paste)).length} onClick={() => { onChange({ ...roster, ...parseRoster(paste) }); setPaste(""); setBulk(false); }}>Add {Object.keys(parseRoster(paste)).length || ""} players</button>
    </div>}
    <p className="small muted">Numbers let you tap who scored on you. Names are optional; if you add them they show on Floorcall Live next to {team}'s plays. Without names, Live just says {team}.</p>
  </div>;
}

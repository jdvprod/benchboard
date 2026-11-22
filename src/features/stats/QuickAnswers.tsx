/** Quick answers on the Stats overview: the most-asked questions, answered from the numbers (no AI). */
import { useMemo, useState } from "react";
import { playerName } from "../../data/store";
import { QUICK, QuickId, quickAnswer } from "../../sports/volleyball/quick";
import { Scope } from "./scope";

export function QuickAnswers({ S }: { S: Scope }) {
  const [open, setOpen] = useState<QuickId | null>(null);
  const ans = useMemo(() => (open ? quickAnswer(open, S.sets, (id) => playerName(id)) : null), [open, S.key, S.sets.length]);
  return <section className="card qa-card" aria-labelledby="quick-h">
    <div className="hd"><h3 id="quick-h">Quick answers</h3></div>
    <div className="pick" role="group" aria-label="Questions">
      {QUICK.map((x) => <button key={x.id} aria-pressed={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>{x.q}</button>)}
    </div>
    {ans && <div className="quick-a" aria-live="polite">
      <p className="quick-lead">{ans.a}</p>
      {ans.thin && <p className="hint">Small sample: worth a look, but give it a few more matches before you change things.</p>}
      {ans.rows.length > 0 && <table className="quick-t"><tbody>{ans.rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th><td>{r.value}{r.note && <span className="small muted">{r.note}</span>}</td></tr>)}</tbody></table>}
      <p className="keys">Based on {S.single ? (S.single.setN ? "this set" : "this match") : S.event ? S.event : "this season's tracked matches"}. Worked out from your stats, no AI.</p>
    </div>}
  </section>;
}

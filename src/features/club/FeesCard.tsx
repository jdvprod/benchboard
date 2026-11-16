/** Team → Player fees: the season fee, each family's payments, and who still owes. A ledger, not a payment processor. */
import { useState } from "react";
import { setTeamPatch, team, teamPlayers, toast, todayISO, uid } from "../../data/store";
import { Card, ConfirmButton, download, plural } from "../../ui/kit";
import { addPayment, balance, feePlayers, stillOwe, Fees, feesCsv, FeeStatus, fmtMoney, owed, paid, parseMoney, reminder, removePayment, setLine, status, summary } from "./fees";

const LABEL: Record<FeeStatus, string> = { paid: "Paid", partial: "Partly paid", owes: "Owes", over: "Overpaid", waived: "Waived" };

export function FeesCard() {
  const t = team()!, f = t.fees || null, players = feePlayers(f, teamPlayers());
  const [amt, setAmt] = useState(""), [due, setDue] = useState(""), [label, setLabel] = useState("");
  const [open, setOpen] = useState<string | null>(null), [only, setOnly] = useState(false), [edit, setEdit] = useState(false), [amounts, setAmounts] = useState(false);
  const save = (x: Fees | null) => setTeamPatch({ fees: x });

  if (!f || edit) {
    const start = () => { const a = parseMoney(amt || String(f?.amt ?? "")); if (a === null) { toast("Enter the fee in dollars, like 450"); return; } save({ ...(f || { lines: {} }), amt: a, due: due || f?.due || undefined, label: (label || f?.label || "").trim() || undefined }); setEdit(false); toast(f ? "Fee updated" : "Tracking fees"); };
    return <Card title="Player fees">
      <p className="small muted">Track the season fee for each family: what they've paid and who still owes. Coaches on this team see it; families never do. Floorcall doesn't take payments.</p>
      <div className="fee-setup">
        <label className="field"><span className="label">Fee per player</span><input className="input" inputMode="decimal" value={amt} placeholder={f ? String(f.amt) : "450"} onChange={(e) => setAmt(e.target.value)} /></label>
        <label className="field"><span className="label">Due date (optional)</span><input className="input" type="date" value={due || f?.due || ""} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="field"><span className="label">What it's for (optional)</span><input className="input" value={label} placeholder={f?.label || "Club season fee"} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></label>
      </div>
      <div className="row"><button className="btn primary" onClick={start}>{f ? "Save" : "Start tracking fees"}</button>{edit && <button className="btn" onClick={() => setEdit(false)}>Cancel</button>}</div>
    </Card>;
  }
  const S = summary(f, players), rows = players.filter((p) => !only || balance(f, p.id) > 0);
  const msg = reminder(f, players, t.name, amounts);
  return <Card title="Player fees" actions={<button className="btn sm ghost" onClick={() => { setEdit(true); setAmt(""); setDue(""); setLabel(""); }}>Edit fee</button>}>
    <div className="fee-sum">
      <div><b className="num">{fmtMoney(S.got)}</b><span className="small muted"> of {fmtMoney(S.due)} collected</span></div>
      <div className="fee-bar" role="img" aria-label={`${Math.round(S.pct * 100)} percent collected`}><i style={{ width: Math.min(100, Math.round(S.pct * 100)) + "%" }} /></div>
      <span className="small">{S.owing ? stillOwe(S.owing, S.left) : "Everyone has paid."}{f.due ? ` · due ${new Date(f.due + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}{f.label ? ` · ${f.label}` : ""}</span>
    </div>
    <div className="row" style={{ margin: "10px 0" }}>
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Only who owes</label>
      {msg && <span className="row" style={{ gap: 8 }}><button className="btn sm" onClick={() => navigator.clipboard?.writeText(msg).then(() => toast("Reminder copied. Paste it in your team chat or email."), () => toast("Couldn't copy"))}>Copy reminder</button>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} />with amounts</label></span>}
      <button className="btn sm" onClick={() => download(`${t.name} fees.csv`, feesCsv(f, players), "text/csv")}>Download spreadsheet</button>
    </div>
    <ul className="fee-list">{rows.map((p) => { const st = status(f, p.id), on = open === p.id, l = f.lines[p.id];
      return <li key={p.id} className={on ? "on" : ""}>
        <button className="fee-row" aria-expanded={on} onClick={() => setOpen(on ? null : p.id)}>
          <span className="num fee-n">{p.num}</span><span className="fee-name">{p.first} {p.last}</span>
          <span className={"fee-st " + st}>{LABEL[st]}</span><span className="num fee-bal">{st === "waived" ? "" : st === "paid" ? fmtMoney(paid(f, p.id)) : st === "over" ? "+" + fmtMoney(-balance(f, p.id)) : fmtMoney(balance(f, p.id)) + " left"}</span>
        </button>
        {on && <PlayerFees f={f} id={p.id} name={p.first} onSave={save} />}
        {!on && l?.note && <p className="small muted fee-note">{l.note}</p>}
      </li>; })}</ul>
    {!rows.length && <p className="empty">{only ? "Nobody owes anything." : "Add players to the roster to track their fees."}</p>}
    <div className="row" style={{ marginTop: 10 }}><ConfirmButton className="btn sm ghost" confirmText="Tap again: delete every payment recorded" onConfirm={() => { save(null); toast("Stopped tracking fees"); }}>Stop tracking fees</ConfirmButton></div>
  </Card>;
}

function PlayerFees({ f, id, name, onSave }: { f: Fees; id: string; name: string; onSave: (f: Fees) => void }) {
  const l = f.lines[id] || { paid: [] }, [amt, setAmt] = useState(""), [at, setAt] = useState(todayISO()), [note, setNote] = useState("");
  const [own, setOwn] = useState(l.amt != null ? String(l.amt) : ""), [waive, setWaive] = useState(l.waived ? String(l.waived) : ""), [memo, setMemo] = useState(l.note || "");
  const add = () => { const a = parseMoney(amt); if (!a) { toast("Enter the amount paid, like 150"); return; } onSave(addPayment(f, id, { id: uid("pay"), at: at || todayISO(), amt: a, note: note.trim().slice(0, 60) || undefined })); setAmt(""); setNote(""); toast(`Recorded ${fmtMoney(a)} for ${name}`); };
  const saveLine = () => { const o = own.trim() ? parseMoney(own) : null, w = waive.trim() ? parseMoney(waive) : 0; if ((own.trim() && o === null) || w === null) { toast("Amounts are in dollars, like 450"); return; } onSave(setLine(f, id, { amt: o ?? undefined, waived: w || undefined, note: memo.trim().slice(0, 200) || undefined })); toast("Saved"); };
  return <div className="fee-detail">
    <p className="small">Owes {fmtMoney(owed(f, id))}{l.waived ? ` (${fmtMoney(l.waived)} waived)` : ""} · paid {fmtMoney(paid(f, id))}</p>
    {l.paid.length > 0 && <ul className="fee-pays">{l.paid.map((p) => <li key={p.id}><span className="num">{new Date(p.at + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><b className="num">{fmtMoney(p.amt)}</b><span className="small muted">{p.note}</span>
      <button className="btn sm ghost" aria-label={`Remove the ${fmtMoney(p.amt)} payment`} onClick={() => onSave(removePayment(f, id, p.id))}>×</button></li>)}</ul>}
    <div className="fee-add">
      <input className="input" inputMode="decimal" aria-label={`Amount ${name} paid`} placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <input className="input" type="date" aria-label="Date paid" value={at} onChange={(e) => setAt(e.target.value)} />
      <input className="input" aria-label="How they paid (optional)" placeholder="Cash, check #, Venmo…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} />
      <button className="btn sm primary" onClick={add}>Record payment</button>
    </div>
    <details className="fee-more"><summary className="small">Different amount, waiver or note</summary>
      <div className="fee-add">
        <input className="input" inputMode="decimal" aria-label={`${name}'s fee, if different`} placeholder={`Fee (default ${fmtMoney(f.amt)})`} value={own} onChange={(e) => setOwn(e.target.value)} />
        <input className="input" inputMode="decimal" aria-label="Amount waived" placeholder="Waived or scholarship" value={waive} onChange={(e) => setWaive(e.target.value)} />
        <input className="input" aria-label="Note (coaches only)" placeholder="Note, e.g. payment plan" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
        <button className="btn sm" onClick={saveLine}>Save</button>
      </div>
    </details>
  </div>;
}

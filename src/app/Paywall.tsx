/** Shown once a team's free trial is over (only when BILLING is on). Stats stay safe; tracking and the coaching tools wait for a plan. */
import { PLANS, Plan } from "./flags";
import { team } from "../data/store";
import { go } from "./router";

export function Paywall() {
  const t = team()!;
  return <div className="page pw">
    <div className="pagehead"><h1>Your free trial is over</h1></div>
    <p className="pw-lead">Everything you tracked for {t.name} is saved. Pick a plan to keep tracking, scouting and planning. Your players and families are included, and FloorCall Live stays free for fans.</p>
    <div className="pw-plans">{(["team", "club"] as Plan[]).map((k) => <div key={k} className="pw-plan">
      <b>{PLANS[k].name}</b><div className="pw-price">{PLANS[k].price}<small> {PLANS[k].per}</small></div>
      <button className="btn primary" disabled title="Payments open soon">Choose {PLANS[k].name}</button>
    </div>)}</div>
    <p className="small muted">Questions about plans or a school purchase order? <button className="linkbtn" onClick={() => go("settings")}>Settings → Help</button></p>
  </div>;
}

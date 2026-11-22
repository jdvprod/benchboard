/** The free tier's edges (only when billing is on): a paid feature shows what it is and what stays free, never an error. */
import { FREE_LIST, Feature, PAID, PLANS } from "./flags";
import { team } from "../data/store";
import { placeUrl } from "../cloud/links";

const pricing = () => placeUrl("home").replace(/[^/]*$/, "") + "pricing.html";

/** A card in place of a paid feature. */
export function Locked({ f, compact }: { f: Feature; compact?: boolean }) {
  return <section className={"card locked" + (compact ? " compact" : "")} aria-label="Team plan">
    <b>{PAID[f]} {compact ? "is" : "are"} part of the Team plan.</b>
    {!compact && <p className="small muted">{team()?.name || "Your team"} keeps the free plan: {FREE_LIST.join(", ").toLowerCase()}. Everything you've tracked stays saved.</p>}
    <p className="small"><a href={pricing()} target="_blank" rel="noopener">See plans</a> · Team {PLANS.team.price} {PLANS.team.per}</p>
  </section>;
}

/** A whole page that's paid (Scouting, Film Room, Practice, Club). */
export function Paywall({ f }: { f: Feature }) {
  return <div className="page pw">
    <div className="pagehead"><h1>{PAID[f]}</h1></div>
    <p className="pw-lead">This is part of the Team plan. Your players and families are included, and FloorCall Live stays free for fans.</p>
    <div className="pw-plans">{(["team", "club"] as const).map((k) => <div key={k} className="pw-plan">
      <b>{PLANS[k].name}</b><div className="pw-price">{PLANS[k].price}<small> {PLANS[k].per}</small></div>
      <a className="btn primary" href={pricing()} target="_blank" rel="noopener">See the {PLANS[k].name} plan</a>
    </div>)}</div>
    <p className="small muted">Free forever: {FREE_LIST.join(" · ")}.</p>
  </div>;
}

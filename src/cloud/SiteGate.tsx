/** Academy, Beach and Recruit need a FloorCall account before anything shows (only FloorCall Live is open to everyone).
 * Links someone shares to watch (a beach match, a player's profile) stay open, like Live. Each site has its own sign-in. */
import "./miniauth.css";
import type { ReactNode } from "react";
import { AccountKind, cloudAvailable, currentUser } from "./client";
import { MiniAuth } from "./MiniAuth";

export function SiteGate({ name, what, kind, children, points, art }: { name: string; what: string; kind: AccountKind; points: string[]; children: ReactNode; art?: ReactNode }) {
  if (!cloudAvailable() || currentUser()) return <>{children}</>;
  return <div className="sg">
    <div className="sg-text">
      {art}
      <h1>{name}</h1>
      <p className="sg-what">{what}</p>
      <ul>{points.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="sg-small">Use the same FloorCall account on every site. Each site asks you to sign in once. Try everything free first.</p>
    </div>
    <MiniAuth kind={kind} title="Create your account to start" sub="Already have one? Choose Sign in." onIn={() => location.reload()} />
  </div>;
}

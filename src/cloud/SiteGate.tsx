/** Academy, Beach and Recruit need a Floorcall account before anything shows (only Floorcall Live is open to everyone).
 * Links someone shares to watch (a beach match, a player's profile) stay open, like Live. One account works on every site. */
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
      <p className="sg-small">One Floorcall account works for the coaching app, Live, Recruit, Beach, Academy and Lessons. Try everything free first.</p>
    </div>
    <MiniAuth kind={kind} title="Create your account to start" sub="Already have one? Choose Sign in." onIn={() => location.reload()} />
  </div>;
}

/** Who checked this coach: a FloorCall admin (verified), their own verified head coach (an assistant they approved),
 * or nobody yet. Shown on the account, the team's staff list, and wherever families see a coach or trainer. */
import "./badge.css";

export type BadgeKind = "verified" | "admin" | "assistant" | "pending" | "not";
const TEXT: Record<BadgeKind, [string, string]> = {
  verified: ["Verified coach", "FloorCall confirmed this coach works at the school or club they named."],
  admin: ["FloorCall admin", "Runs FloorCall."],
  assistant: ["Approved by head coach", "An assistant the team's verified head coach let in."],
  pending: ["Verification pending", "FloorCall is checking this coach's school or club, usually within a day."],
  not: ["Not verified", "This coach hasn't been checked by FloorCall yet."],
};
export function Badge({ kind, short }: { kind: BadgeKind; short?: boolean }) {
  const [label, title] = TEXT[kind];
  const check = kind === "verified" || kind === "admin" || kind === "assistant";
  return <span className={"vbadge vb-" + kind} title={title}>
    {check ? <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.2" /><path d="m4.9 8.2 2.1 2.1 4.2-4.4" /></svg>
      : <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.6" /><path d="M8 4.8v3.6M8 10.7v.3" /></svg>}
    {short && check ? <span className="sr-only">{label}</span> : <span>{label}</span>}
  </span>;
}
/** The badge for a coach status from coach_status(). */
export const badgeFor = (s: { status: string; admin?: boolean } | null | undefined): BadgeKind | null =>
  !s ? null : s.admin ? "admin" : s.status === "approved" ? "verified" : s.status === "pending" ? "pending" : "not";

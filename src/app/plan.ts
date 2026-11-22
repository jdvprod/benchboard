/** What the current team may use: everything while billing is off (until 2027), in the trial and on a plan; afterwards the free tier. */
import { access, billingOn, Feature, featureOk } from "./flags";
import { matchesOf, team } from "../data/store";

export function can(f: Feature): boolean {
  if (!billingOn()) return true;
  const t = team(); if (!t || t.sample) return true;
  if ((globalThis as any).__FC_TEST_BILLING === "free") return featureOk(f, { ok: false, why: "trial over" }); // tests: a team past its trial
  return featureOk(f, access(t, matchesOf().filter((m) => m.status === "done" && m.kind === "match").length));
}

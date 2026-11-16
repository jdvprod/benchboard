/** Ask about a match in plain words ("why did we lose set 2?", "how did we do against their #7?") and get an answer
 * with the clips that show it. The AI reads a compact list of the match's plays and answers only from them, naming
 * the plays it relied on; those become the clips. Pure, so the prompt and the clean-up are unit tested. */
import type { LogEntry } from "../sports/volleyball/engine";

type Stat = Extract<LogEntry, { kind: "stat" }>;
/** Longest list the AI is given. Big matches keep the plays that ended rallies. */
export const DIGEST_MAX = 450;

/** One line per play: id, set, score after it, who, what, where, rotation and who served. */
export function filmDigest(log: LogEntry[], name: (id: string) => string, what: (code: string) => string): string[] {
  let st = log.filter((l): l is Stat => l.kind === "stat");
  if (st.length > DIGEST_MAX) st = st.filter((l) => l.w);
  if (st.length > DIGEST_MAX) st = st.slice(-DIGEST_MAX);
  return st.map((l) => [l.id, "S" + l.set, l.w ? `${l.us}-${l.them} (${l.w === "us" ? "our" : "their"} point)` : `${l.us}-${l.them}`,
    l.p ? name(l.p) : l.op ? "their #" + l.op : "", what(l.t), typeof l.z === "number" ? "to area " + l.z : "", l.rot ? "rot " + l.rot : "", l.sv ? (l.sv === "us" ? "we served" : "they served") : ""].filter(Boolean).join(" | "));
}

export function askPrompt(question: string, opp: string, score: string, digest: string[]): string {
  return `You are helping a volleyball coach review film of a match against ${opp} (${score}). Each line below is one play: id | set | score after the play | player | play | where the ball went | our rotation | who served.
${digest.join("\n")}

Coach's question: ${JSON.stringify(question.slice(0, 400))}

Answer only from these plays. If they can't answer it, say what the stats can and can't show.
Return JSON: {"answer": "2-4 plain sentences, specific numbers, no markdown", "plays": ["ids of up to 12 plays that best show the answer, in match order"]}.`;
}

export function cleanAsk(x: any, log: LogEntry[]): { answer: string; plays: string[] } {
  const ids = new Set(log.filter((l) => l.kind === "stat" || l.kind === "tag").map((l) => l.id));
  const plays = (Array.isArray(x?.plays) ? x.plays : []).map(String).filter((id: string, i: number, a: string[]) => ids.has(id) && a.indexOf(id) === i).slice(0, 20);
  return { answer: typeof x?.answer === "string" ? x.answer.trim().slice(0, 1200) : "", plays };
}

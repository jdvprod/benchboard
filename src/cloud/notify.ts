/** After each sync, a coach's device announces matches that started or finished to families following the team
 * (Benchboard Live notifications). The server sends each announcement once, however many coaches' devices ask. */
import { all, localISO, patch, replayOf, todayISO } from "../data/store";
import { fn, CloudError } from "./client";
import { siteUrl } from "./links";
import { startMessage, finalMessage } from "../notify/messages";

let off = false; // the notify function isn't deployed or has no keys: don't keep asking this session
const H3 = 3 * 3600_000;

export async function announce(roleOn: (teamId: string) => string | null, linked: (teamId: string) => boolean) {
  if (off) return;
  const today = todayISO(), yesterday = localISO(new Date(Date.now() - 86400_000));
  for (const m of all("matches")) {
    if (m.kind !== "match" || m.scrim || m.sample || m.imported || !linked(m.teamId)) continue;
    const role = roleOn(m.teamId); if (role !== "owner" && role !== "coach") continue;
    const t = all("teams").find((x) => x.id === m.teamId); if (!t) continue;
    const R = replayOf(m); if (!R) continue;
    const sent = m.notified || {};
    const game = (t.tournaments || []).flatMap((x) => x.games.map((g) => ({ x, g }))).find((y) => y.g.matchId === m.id);
    let kind: "start" | "final" | null = null, msg: { title: string; body: string } | null = null;
    if (!sent.final && (R.matchOver || (m.status === "done" && R.wonUs + R.wonThem > 0)) && m.date >= yesterday) {
      kind = "final"; msg = finalMessage(t.name, m.opp, R.wonUs, R.wonThem, R.sets.filter((s) => s.us + s.them).map((s) => [s.us, s.them]), m.event || undefined);
    } else if (!sent.start && !sent.final && m.status === "live" && !R.matchOver && m.date === today && Date.now() - m.createdAt < H3) {
      kind = "start"; msg = startMessage(t.name, m.opp, { event: m.event || undefined, court: game?.g.court });
    }
    if (!kind || !msg) continue;
    try {
      await fn("notify", { action: "send", team_id: m.teamId, match_id: m.id, kind, title: msg.title, body: msg.body, base: siteUrl("live") });
      patch("matches", m.id, { notified: { ...sent, [kind]: true, ...(kind === "final" ? { start: true } : {}) } });
    } catch (e) {
      if (e instanceof CloudError && (e.status === 404 || e.status === 503)) { off = true; return; }
    }
  }
}

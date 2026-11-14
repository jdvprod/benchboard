/** Game leaders, broadcast style: for each category, the top player on each side with their photo, their stat line
 * and the big number. Their side needs jersey numbers from the coach; without them it shows the team's total. */
import { Agg, Stat } from "../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, hitting, passAvg, serveErrors } from "../sports/volleyball/metrics";
import { Avatar, TeamLogo } from "../ui/Logo";
import { tr } from "../lib/i18n";
import { LPlayer } from "./data";
import type { Roster } from "./GameView";

type Logos = { us?: string | null; them?: string | null };
interface Cat { key: string; title: string; ours: (s: Stat) => number; line: (s: Stat) => string; theirs?: (o: Opp) => number; theirLine?: (o: Opp) => string; theirTeam?: (A: Agg) => number }
interface Opp { K: number; A: number; E: number; P: number }
const pts = (s: Stat) => s.K + s.SA + s.BS + s.BA / 2;
const n1 = (v: number) => String(+v.toFixed(1));

const CATS: Cat[] = [
  { key: "K", title: "Kills", ours: (s) => s.K, line: (s) => `${s.K} K, ${s.AE} E, ${s.TA} TA, ${s.TA ? fmtHit(hitting(s)) : "–"}`, theirs: (o) => o.K, theirLine: (o) => `${o.K} K`, theirTeam: (A) => A.team.OK },
  { key: "PTS", title: "Points", ours: pts, line: (s) => `${n1(pts(s))} PTS: ${s.K} K, ${s.SA} SA, ${n1(blocks(s))} BLK`, theirs: (o) => o.K + o.A + o.P, theirLine: (o) => `${o.K + o.A + o.P} PTS: ${o.K} K, ${o.A} SA`, theirTeam: (A) => A.team.OK + A.team.OA + A.team.TP },
  { key: "AST", title: "Assists", ours: (s) => s.AST, line: (s) => `${s.AST} AST, ${s.SA} SA, ${s.D} DIG` },
  { key: "SA", title: "Aces", ours: (s) => s.SA, line: (s) => `${s.SA} SA, ${serveErrors(s)} SE`, theirs: (o) => o.A, theirLine: (o) => `${o.A} SA`, theirTeam: (A) => A.team.OA },
  { key: "D", title: "Digs", ours: (s) => s.D, line: (s) => `${s.D} DIG, ${s.R} REC${s.R ? ", " + fmtAvg(passAvg(s)) + " PASS" : ""}` },
  { key: "BLK", title: "Blocks", ours: blocks, line: (s) => `${n1(blocks(s))} BLK: ${s.BS} BS, ${s.BA} BA${s.BT ? ", " + s.BT + " BT" : ""}` },
];

export function GameLeaders({ A, P, team, them, logos, ro, compact }: { A: Agg; P: Map<string, LPlayer>; team: string; them: string; logos: Logos; ro?: Roster; compact?: boolean }) {
  const ours = Object.entries(A.ps).filter(([id]) => P.has(id));
  const opp = (A as any).opp as Record<string, Opp> | undefined;
  const cats = CATS.filter((c) => ours.some(([, s]) => c.ours(s) > 0) || (c.theirTeam && c.theirTeam(A) > 0)).slice(0, compact ? 4 : 6);
  if (!cats.length) return compact ? null : <section className="lv-card lv-ldr"><div className="lv-h"><h2>{tr("Game leaders")}</h2></div><p className="lv-note">{tr("Leaders show once players have kills, aces, digs, blocks or assists.")}</p></section>;
  return <section className="lv-card lv-ldr">
    <div className="lv-h"><h2>{tr("Game leaders")}</h2></div>
    <div className="lv-ldr-teams"><span><TeamLogo src={logos.us} name={team} size={22} />{team}</span><span><TeamLogo src={logos.them} name={them} size={22} />{them}</span></div>
    {cats.map((c) => {
      const top = ours.map(([id, s]) => ({ id, s, v: c.ours(s) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0];
      const p = top ? P.get(top.id) : undefined;
      const tops = c.theirs && opp ? Object.entries(opp).map(([n, o]) => ({ n, o, v: c.theirs!(o) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0] : undefined;
      const tteam = c.theirTeam ? c.theirTeam(A) : null;
      return <div key={c.key} className="lv-ldr-cat">
        <h3>{tr(c.title)}</h3>
        <div className="lv-ldr-row">
          {top && p ? <div className="lv-ldr-p us">
            <Avatar photo={p.photo} num={p.num} size={52} />
            <div className="lv-ldr-t"><b>{p.first ? `${p.first}${p.last ? " " + p.last + "." : ""}` : tr("Player #{n}", { n: p.num })}</b><small>#{p.num}{p.pos ? " · " + p.pos : ""}</small><span>{c.line(top.s)}</span></div>
            <strong>{n1(top.v)}</strong>
          </div> : <div className="lv-ldr-p us none"><span>—</span></div>}
          {tops ? <div className="lv-ldr-p them">
            <span className="lv-ldr-num">{tops.n}</span>
            <div className="lv-ldr-t"><b>{ro?.[tops.n]?.name || `#${tops.n}`}</b><small>#{tops.n}{ro?.[tops.n]?.pos ? " · " + ro[tops.n].pos : ""}</small><span>{c.theirLine!(tops.o)}</span></div>
            <strong>{tops.v}</strong>
          </div> : <div className="lv-ldr-p them none">
            <TeamLogo src={logos.them} name={them} size={40} />
            <div className="lv-ldr-t">{tteam != null ? <><b>{them}</b><span>{tr("{n} as a team", { n: String(tteam) })}</span></> : <><b>{them}</b><span>{tr("Not tracked")}</span></>}</div>
            {tteam != null && <strong>{tteam}</strong>}
          </div>}
        </div>
      </div>;
    })}
  </section>;
}

/** Their box score, when the coach marked their jersey numbers: kills, aces, errors and points for each, then the team. */
export function TheirBox({ A, them, logo, ro }: { A: Agg; them: string; logo?: string | null; ro?: Roster }) {
  const opp = ((A as any).opp || {}) as Record<string, Opp>;
  const nums = [...new Set([...Object.keys(opp), ...Object.keys(ro || {})])].sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));
  if (!nums.length) return null;
  const sum = (f: (o: Opp) => number) => Object.values(opp).reduce((t, o) => t + f(o), 0);
  const un = { K: A.team.OK - sum((o) => o.K), A: A.team.OA - sum((o) => o.A), E: A.team.OE - sum((o) => o.E), P: A.team.TP - sum((o) => o.P) };
  const line = (o: Opp) => [o.K, o.A, o.E, o.P, o.K + o.A + o.P];
  return <section className="lv-card lv-ebox">
    <header className="lv-ebox-h them"><TeamLogo src={logo} name={them} size={30} /><h2>{them}</h2></header>
    <div className="lv-ebox-scroll"><table>
      <thead><tr className="lv-ebox-sec"><th className="nm" scope="col">{tr("Players")}</th><th scope="col" title={tr("Kills")}>K</th><th scope="col" title={tr("Service aces")}>SA</th><th scope="col" title={tr("Errors")}>E</th><th scope="col" title={tr("Other points")}>OTH</th><th scope="col" title={tr("Points")}>PTS</th></tr></thead>
      <tbody>{nums.map((n) => { const o = opp[n], r = ro?.[n];
        return <tr key={n}><th className="nm" scope="row"><span className="lv-ebox-nm"><b>{r?.name || "#" + n}</b><small>#{n}{r?.pos ? " " + r.pos : ""}</small></span></th>
          {o ? line(o).map((v, i) => <td key={i}>{v}</td>) : <td className="dnp" colSpan={5}>{tr("No stats")}</td>}</tr>; })}
        {(un.K || un.A || un.E || un.P) > 0 && <tr><th className="nm" scope="row"><span className="lv-ebox-nm"><b>{tr("No number marked")}</b></span></th>{line(un).map((v, i) => <td key={i}>{v}</td>)}</tr>}
      </tbody>
      <tfoot><tr className="tot"><th className="nm" scope="row">{tr("Team")}</th>{[A.team.OK, A.team.OA, A.team.OE, A.team.TP, A.team.OK + A.team.OA + A.team.TP].map((v, i) => <td key={i}>{v}</td>)}</tr></tfoot>
    </table></div>
    <p className="lv-note">{tr("From what the home staff marked: their kills, aces and errors, and points with no play named (OTH).")}</p>
  </section>;
}

/** Season leaders for one team: the leader of each category with their line, and the next two. */
export function TeamLeaders({ A, P, href, title }: { A: Agg; P: Map<string, LPlayer>; href: (id: string) => string; title: string }) {
  const ours = Object.entries(A.ps).filter(([id]) => P.has(id));
  const cats = CATS.filter((c) => ours.some(([, s]) => c.ours(s) > 0));
  if (!cats.length) return null;
  const nm = (p: LPlayer) => (p.first ? `${p.first}${p.last ? " " + p.last + "." : ""}` : tr("Player #{n}", { n: p.num }));
  return <section className="lv-card lv-ldr">
    <div className="lv-h"><h2>{title}</h2></div>
    <div className="lv-ldr-grid">{cats.map((c) => {
      const top = ours.map(([id, s]) => ({ id, s, v: c.ours(s) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
      const p = P.get(top[0].id)!;
      return <div key={c.key} className="lv-ldr-cat">
        <h3>{tr(c.title)}</h3>
        <a className="lv-ldr-p us" href={href(top[0].id)}>
          <Avatar photo={p.photo} num={p.num} size={52} />
          <div className="lv-ldr-t"><b>{nm(p)}</b><small>#{p.num}{p.pos ? " · " + p.pos : ""}</small><span>{c.line(top[0].s)}</span></div>
          <strong>{n1(top[0].v)}</strong>
        </a>
        {top.slice(1).map((x, i) => { const q = P.get(x.id)!; return <a key={x.id} className="lv-ldr-next" href={href(x.id)}><span>{i + 2}</span><b>{nm(q)}</b><small>#{q.num}</small><strong>{n1(x.v)}</strong></a>; })}
      </div>;
    })}</div>
  </section>;
}

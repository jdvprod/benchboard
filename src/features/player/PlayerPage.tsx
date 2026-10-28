/** Player portal: season numbers, trends, match log, goals, AI report card and a shareable report. */
import { useState } from "react";
import { matchesOf, patch, plansOf, player, replayOf, teamPlayers, team, toast, uid } from "../../data/store";
import { Goal, GoalMetric, Match, RecruitProfile } from "../../data/model";
import { aggregate, Agg, SetState, Stat } from "../../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, fmtNum, fmtPct, fmtSigned, hitting, passAvg, playerMetrics, PlayerMetrics, serveAttempts, serveErrors } from "../../sports/volleyball/metrics";
import { Card, ConfirmButton, download, fmtDate, Kpi, plural, Seg, SetRow, Switch } from "../../ui/kit";
import { LineChart } from "../../ui/charts";
import { AiCard } from "../../ui/ai";
import { reportCardPrompt } from "../../ai/prompts";
import { go } from "../../app/router";
import { cloudAvailable, currentUser } from "../../cloud/client";
import { isLinked, shareRecruit, unshareRecruit } from "../../cloud/sync";
import { LEGAL } from "../../app/legal";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { highlightPick } from "../../film/clips";
import { playerClips, recruitData } from "./recruitData";
import { copyText } from "../../ui/kit";
import { QrButton } from "../../ui/QrButton";
import { CourtSvg } from "../../ui/court";
import { tendencies } from "../../sports/volleyball/tendencies";

export const GOALS: Record<GoalMetric, { label: string; key: keyof PlayerMetrics; fmt: (v: number | null) => string; step: number; lowerBetter?: boolean }> = {
  hitting: { label: "Hitting %", key: "hitting", fmt: fmtHit, step: 0.01 },
  passAvg: { label: "Pass average", key: "passAvg", fmt: (v) => fmtAvg(v), step: 0.05 },
  perfectPass: { label: "Perfect pass %", key: "perfectPass", fmt: fmtPct, step: 0.01 },
  serveIn: { label: "Serve in %", key: "serveIn", fmt: fmtPct, step: 0.01 },
  serveEff: { label: "Serve efficiency", key: "serveEff", fmt: fmtHit, step: 0.01 },
  killsPerSet: { label: "Kills per set", key: "kps", fmt: (v) => fmtNum(v, 2), step: 0.1 },
  digsPerSet: { label: "Digs per set", key: "dps", fmt: (v) => fmtNum(v, 2), step: 0.1 },
  acesPerSet: { label: "Aces per set", key: "acesPs", fmt: (v) => fmtNum(v, 2), step: 0.05 },
  blocksPerSet: { label: "Blocks per set", key: "bps", fmt: (v) => fmtNum(v, 2), step: 0.05 },
  assistsPerSet: { label: "Assists per set", key: "aps", fmt: (v) => fmtNum(v, 2), step: 0.5 },
};
const TREND: [GoalMetric | "net", string][] = [["hitting", "Hitting %"], ["passAvg", "Passing"], ["serveIn", "Serve in %"], ["killsPerSet", "Kills/set"], ["digsPerSet", "Digs/set"], ["net", "Net pts/set"]];

interface Row { m: Match; sets: SetState[]; A: Agg; s: Stat; pm: PlayerMetrics }

function rowsFor(id: string, src: "games" | "practice" | "all" = "games"): Row[] {
  const t = team()!;
  const out: Row[] = [];
  for (const m of matchesOf().filter((x) => (src === "all" || (src === "games" ? x.kind === "match" : x.kind !== "match")) && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).reverse()) {
    const R = replayOf(m); if (!R) continue; const A = aggregate(R.sets); if (!A.ps[id] && !A.pm[id]) continue;
    out.push({ m, sets: R.sets, A, s: A.ps[id], pm: playerMetrics(A, id) });
  }
  return out;
}

export function PlayerPage({ id }: { id: string }) {
  const p = player(id), t = team()!;
  const [pickMetric, setMetric] = useState<GoalMetric | "net" | null>(null), [src, setSrc] = useState<"games" | "practice" | "all">("games");
  if (!p) return <div className="page"><Card><p className="empty">Player not found.</p><button className="btn" onClick={() => go("team")}>Back to roster</button></Card></div>;
  const rows = rowsFor(id, src);
  const taken = plansOf().filter((pl) => pl.attendance && Object.keys(pl.attendance).length);
  const att = taken.length ? (() => { const here = taken.filter((pl) => pl.attendance![id] === "in" || pl.attendance![id] === "late").length; return `${here} of ${taken.length} (${Math.round((100 * here) / taken.length)}%)`; })() : "";
  const A = aggregate(rows.flatMap((r) => r.sets)), s = A.ps[id], pm = playerMetrics(A, id);
  // last 3 matches vs the season, shown under each number
  const L3 = rows.length >= 4 ? aggregate(rows.slice(-3).flatMap((r) => r.sets)) : null, l3 = L3?.ps[id], lm = L3 ? playerMetrics(L3, id) : null;
  const fd = (a: number | null | undefined, b: number | null | undefined, f: (v: number) => string) => (a == null || b == null ? null : f(a) === f(b) ? { text: "Last 3: same", better: null } : { text: `${a > b ? "▲" : "▼"} last 3: ${f(a)}`, better: a > b });
  const has = (k: keyof Stat) => !!s && s[k] > 0;
  const valOf = (r: Row, k: GoalMetric | "net") => (k === "net" ? r.pm.netPerSet : (r.pm[GOALS[k].key] as number | null));
  // default to the first stat this player actually has a trend for (a setter has no hitting trend)
  const metric = pickMetric || (TREND.map((x) => x[0]).find((k) => k !== "net" && rows.filter((r) => valOf(r, k) != null && (k !== "hitting" || (r.s?.TA || 0) > 0)).length >= 2 && rows.some((r) => (valOf(r, k) || 0) !== 0)) ?? "net");
  const trend = rows.map((r) => ({ label: r.m.date.slice(5).replace("-", "/"), sub: r.m.opp, v: metric === "net" ? r.pm.netPerSet : (r.pm[GOALS[metric].key] as number | null) }));
  const fmt = metric === "net" ? (v: number) => fmtNum(v, 1) : (v: number) => GOALS[metric].fmt(v);

  return <div className="page">
    <div className="row"><button className="btn sm" onClick={() => history.length > 1 ? history.back() : go("stats")}>← Back</button></div>
    <section className="card"><div className="hero">
      <div className="jersey">{p.num}</div>
      <div className="grow"><h1 style={{ margin: 0 }}>{p.first} {p.last}</h1>
        <p className="muted">{[p.pos, p.height, p.grad ? "Class of " + p.grad : "", t.name].filter(Boolean).join(" · ")}</p>
        <p className="small muted">{src === "practice" ? plural(rows.length, "practice") : src === "all" ? plural(rows.length, "match or practice", "matches and practices") : plural(rows.length, "match", "matches")} · {plural(pm.sets, "set")} this season{pm.plusMinus != null ? ` · ${fmtSigned(pm.plusMinus)} on court` : ""}{att ? ` · practice ${att}` : ""}</p></div>
      <div className="stack" style={{ alignItems: "flex-end" }}><Seg value={src} onChange={setSrc} options={[["games", "Matches"], ["practice", "Practice"], ["all", "All"]]} label="Which stats" />
        <button className="btn" onClick={() => shareReport(id, rowsFor(id, "games"), aggregate(rowsFor(id, "games").flatMap((r) => r.sets)))}>Download player report</button></div>
    </div></section>
    {!s ? <Card><p className="empty">No stats yet this season.</p></Card> : <>
      <div className="kpis">
        {has("TA") && <Kpi label="Hitting" value={fmtHit(hitting(s))} delta={l3 && l3.TA >= 5 ? fd(hitting(l3), hitting(s), (v) => fmtHit(v)) : null} sub={`${s.K} K · ${s.AE} E · ${s.TA} TA · ${fmtNum(pm.kps, 2)} K/set`} />}
        {has("R") && <Kpi label="Passing" value={fmtAvg(passAvg(s))} delta={l3 && l3.R >= 5 ? fd(passAvg(l3), passAvg(s), (v) => fmtAvg(v)) : null} sub={`${s.R} rec · ${fmtPct(pm.perfectPass)} perfect · ${s.P0} aced`} />}
        {serveAttempts(s) > 0 && <Kpi label="Serving" value={fmtPct(pm.serveIn)} delta={lm && l3 && serveAttempts(l3) >= 5 ? fd(lm.serveIn, pm.serveIn, (v) => fmtPct(v)) : null} sub={`${s.SA} aces · ${serveErrors(s)} err · eff ${fmtHit(pm.serveEff)}`} />}
        {has("D") && <Kpi label="Digs" value={s.D} delta={lm ? fd(lm.dps, pm.dps, (v) => fmtNum(v, 2) + "/set") : null} sub={`${fmtNum(pm.dps, 2)} per set · ${s.DE} errors`} />}
        {(s.BS + s.BA) > 0 && <Kpi label="Blocks" value={fmtNum(blocks(s))} sub={`${s.BS} solo · ${s.BA} assist · ${fmtNum(pm.bps, 2)}/set`} />}
        {has("AST") && <Kpi label="Assists" value={s.AST} sub={`${fmtNum(pm.aps, 2)} per set · ${s.BHE} errors`} />}
        <Kpi label="Net points" value={fmtSigned(pm.netPoints)} delta={lm ? fd(lm.netPerSet, pm.netPerSet, (v) => fmtNum(v, 2) + "/set") : null} sub={`${fmtNum(pm.netPerSet, 2)} per set`} />
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <Card title="Trend" actions={<Seg value={metric} onChange={setMetric} options={TREND} />}>
          {trend.filter((x) => x.v != null).length >= 2 ? <LineChart points={trend} format={fmt} /> : <p className="empty">Needs two or more matches with this stat.</p>}
        </Card>
        <Goals id={id} A={A} />
      </div>
      <PlayerCourt id={id} A={A} />
      <Card title="Match by match"><div className="tbl"><table>
        <thead><tr><th className="l">Date</th><th className="l">Opponent</th><th>Sets</th><th>K</th><th>E</th><th>TA</th><th>Hit %</th><th>Ace</th><th>SE</th><th>Pass</th><th>Dig</th><th>Blk</th><th>Ast</th><th>+/−</th></tr></thead>
        <tbody>{rows.slice().reverse().map((r) => { const x = r.s || ({} as Stat); return <tr key={r.m.id}><td className="l">{fmtDate(r.m.date)}</td><td className="l">{r.m.opp}</td><td>{r.pm.sets}</td><td>{x.K ?? 0}</td><td>{x.AE ?? 0}</td><td>{x.TA ?? 0}</td><td>{r.s ? fmtHit(hitting(x)) : "—"}</td><td>{x.SA ?? 0}</td><td>{r.s ? serveErrors(x) : 0}</td><td>{r.s ? fmtAvg(passAvg(x)) : "—"}</td><td>{x.D ?? 0}</td><td>{r.s ? fmtNum(blocks(x)) : 0}</td><td>{x.AST ?? 0}</td><td>{fmtSigned(r.pm.plusMinus)}</td></tr>; })}</tbody>
      </table></div></Card>
      <AiCard key={id} title="Report card" desc="Strengths, growth areas and one measurable goal, written for the player from their numbers." button="Write report card" prompt={() => reportCardPrompt(id)} filename={`${p.first} ${p.last} report card`} />
    </>}
    <Recruiting id={id} rows={rows} A={A} />
    <Card title="Coach notes"><textarea className="input" aria-label="Coach notes" rows={3} value={p.notes} onChange={(e) => patch("players", id, { notes: e.target.value })} placeholder="Private notes: what they're working on, role, recruiting contacts (keep health details out)" /></Card>
    <PlayerData id={id} />
  </div>;
}

function Goals({ id, A }: { id: string; A: Agg }) {
  const p = player(id)!, pm = playerMetrics(A, id);
  const [metric, setMetric] = useState<GoalMetric>("hitting"), [target, setTarget] = useState("");
  const add = () => { const v = parseFloat(target); if (!isFinite(v)) return toast("Enter a target number."); const pctLike = ["serveIn", "perfectPass"].includes(metric) && v > 1 ? v / 100 : v; patch("players", id, { goals: p.goals.concat({ id: uid("g"), metric, target: pctLike }) }); setTarget(""); };
  return <Card title="Goals">
    <div className="stack">
      {p.goals.length ? p.goals.map((g: Goal) => { const G = GOALS[g.metric], v = pm[G.key] as number | null, prog = v == null ? 0 : Math.max(0, Math.min(1, g.target > 0 ? v / g.target : v >= g.target ? 1 : 0)), hit = v != null && v >= g.target;
        return <div key={g.id} className="goal">
          <div className="row between"><span><b>{G.label}</b> · goal {G.fmt(g.target)}</span><span className={hit ? "hi" : ""}>{G.fmt(v)}{hit ? " ✓" : ""} <button className="btn sm" aria-label="Remove goal" onClick={() => patch("players", id, { goals: p.goals.filter((x) => x.id !== g.id) })}>✕</button></span></div>
          <div className="meter"><i style={{ width: prog * 100 + "%", background: hit ? "var(--good)" : undefined }} /></div>
        </div>; }) : <p className="small muted">Set a measurable target, like a .250 hitting % or a 2.2 pass average. Progress updates after every match.</p>}
      <div className="row">
        <select className="input" style={{ width: "auto" }} value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)} aria-label="Goal stat">{(Object.keys(GOALS) as GoalMetric[]).map((k) => <option key={k} value={k}>{GOALS[k].label}</option>)}</select>
        <input className="input" style={{ width: 100 }} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={metric === "hitting" ? ".250" : metric === "passAvg" ? "2.2" : ["serveIn", "perfectPass"].includes(metric) ? "90" : "3"} aria-label="Target" />
        <button className="btn sm primary" onClick={add}>Add goal</button>
      </div>
    </div>
  </Card>;
}

/** A self-contained HTML page the player or parents can open on any phone. */
function shareReport(id: string, rows: Row[], A: Agg) {
  const p = player(id)!, t = team()!, s = A.ps[id], pm = playerMetrics(A, id);
  const esc = (x: any) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const kpi = (l: string, v: string, sub: string) => `<div class="k"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`;
  const ks = s ? [kpi("Hitting", fmtHit(hitting(s)), `${s.K} kills · ${s.TA} attempts`), kpi("Kills / set", fmtNum(pm.kps, 2), `${pm.sets} sets`), kpi("Passing", fmtAvg(passAvg(s)), `${s.R} receptions`), kpi("Serve in", fmtPct(pm.serveIn), `${s.SA} aces`), kpi("Digs", String(s.D), `${fmtNum(pm.dps, 2)} per set`), kpi("Blocks", fmtNum(blocks(s)), `${s.BS} solo`), kpi("Assists", String(s.AST), `${fmtNum(pm.aps, 2)} per set`)].join("") : "<p>No stats yet.</p>";
  const goals = p.goals.map((g) => { const G = GOALS[g.metric], v = pm[G.key] as number | null; return `<li>${esc(G.label)}: ${esc(G.fmt(v))} of ${esc(G.fmt(g.target))} goal${v != null && v >= g.target ? " ✓" : ""}</li>`; }).join("");
  const log = rows.slice().reverse().map((r) => { const x = r.s; return `<tr><td>${esc(r.m.date)}</td><td>${esc(r.m.opp)}</td><td>${x ? x.K : 0}</td><td>${x ? fmtHit(hitting(x)) : "—"}</td><td>${x ? x.SA : 0}</td><td>${x ? fmtAvg(passAvg(x)) : "—"}</td><td>${x ? x.D : 0}</td><td>${x ? fmtNum(blocks(x)) : 0}</td><td>${x ? x.AST : 0}</td></tr>`; }).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.first + " " + p.last)} · ${esc(t.name)}</title>
<style>:root{--c:#2B79B0;--ink:#141a21;--mut:#5d6873;--bg:#f4f6f8;--card:#fff;--line:#e2e6ea}@media(prefers-color-scheme:dark){:root{--ink:#e9edf1;--mut:#9aa6b2;--bg:#0f141a;--card:#18202a;--line:#2a3440}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:760px;margin:0 auto;padding:20px 16px}
.hero{display:flex;gap:16px;align-items:center;background:#141a21;color:#fff;border-radius:14px;padding:18px;border-bottom:5px solid var(--c)}.n{font-size:54px;font-weight:800;color:var(--c);min-width:80px;text-align:center}
h1{margin:0;font-size:26px}.sub{color:#aeb8c2}.ks{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:16px 0}.k{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.l{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:700}.v{font-size:28px;font-weight:800}.s{font-size:12px;color:var(--mut)}section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:12px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{padding:6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}th:nth-child(-n+2),td:nth-child(-n+2){text-align:left}th{font-size:11px;color:var(--mut);text-transform:uppercase}footer{color:var(--mut);font-size:12px;text-align:center;margin-top:18px}</style></head>
<body><main><div class="hero"><div class="n">${esc(p.num)}</div><div><h1>${esc(p.first + " " + p.last)}</h1><div class="sub">${esc([p.pos, p.height, p.grad ? "Class of " + p.grad : ""].filter(Boolean).join(" · "))}</div><div class="sub">${esc(t.name)}${t.level ? " · " + esc(t.level) : ""}</div></div></div>
<div class="ks">${ks}</div>${goals ? `<section><h3 style="margin:0 0 6px">Goals</h3><ul>${goals}</ul></section>` : ""}
<section><h3 style="margin:0 0 6px">Match by match</h3><table><thead><tr><th>Date</th><th>Opponent</th><th>K</th><th>Hit %</th><th>Ace</th><th>Pass</th><th>Dig</th><th>Blk</th><th>Ast</th></tr></thead><tbody>${log}</tbody></table></section>
<footer>Made with Benchboard · ${new Date().toLocaleDateString()}</footer></main></body></html>`;
  download(`${p.first} ${p.last} - ${t.name}.html`, html, "text/html");
  toast("Report saved. Text or email the file to share it.");
}

/* ---------- recruiting profile (preview of the recruiting add-on) ---------- */
const PF: [keyof RecruitProfile, string, string][] = [
  ["club", "Club team", "e.g. Central Valley 16 Elite"], ["gpa", "GPA", "3.8"], ["hand", "Dominant hand", "Right"],
  ["reach", "Standing reach", `7'6"`], ["approach", "Approach jump", `9'8"`], ["block", "Block jump", `9'2"`],
  ["email", "Player email", "name@email.com"], ["phone", "Player phone", ""], ["video", "Highlight video link", "https://…"], ["coachContact", "Coach contact", "Your name and email"],
];
function Recruiting({ id, rows, A }: { id: string; rows: Row[]; A: Agg }) {
  const p = player(id)!, pr = p.profile || {}, t = team()!;
  const [open, setOpen] = useState(!!Object.values(pr).some(Boolean));
  const [busy, setBusy] = useState(false), url = pr.sharedUrl || "";
  const consented = !!pr.consentAt;
  const setUrl = (u: string) => patch("players", id, { profile: { ...(player(id)!.profile || {}), sharedUrl: u || undefined } });
  const canShare = cloudAvailable() && !!currentUser() && isLinked(t.id) && !t.sample;
  const [preview, setPreview] = useState(false);
  const allClips = playerClips(id), picked = highlightPick(allClips);
  const set = (k: keyof RecruitProfile, v: string) => patch("players", id, { profile: { ...(player(id)!.profile || {}), [k]: v } });
  return <Card title={<>Recruiting profile <span className="tag" style={{ verticalAlign: 2 }}>Preview</span></>} actions={<div className="row">
    {!open && <button className="btn sm" onClick={() => setOpen(true)}>Fill in</button>}
    {canShare && <button className="btn sm" disabled={busy || !consented} title={consented ? undefined : "Confirm family consent below first"} onClick={async () => { setBusy(true); try { const r = await shareRecruit(t.id, id, recruitHtml(id, rows, A), recruitData(id, { clips: pr.clipsOff ? [] : picked })); setUrl(r.url); const ok = await copyText(r.url); toast(ok ? "Profile link copied. It's a snapshot; tap again after new matches." : "Profile link: " + r.url); } catch (e: any) { toast(e?.message || "Couldn't share the profile."); } setBusy(false); }}>{busy ? "Publishing…" : url ? "Update profile link" : "Share profile link"}</button>}
    <button className="btn sm primary" onClick={() => { download(`${p.first} ${p.last} recruiting profile.html`, recruitHtml(id, rows, A), "text/html"); toast("Recruiting sheet saved. Send it to college coaches or attach it to emails."); }}>Download recruiting sheet</button></div>}>
    {open ? <div className="stack">
      <div className="pf-grid">{PF.map(([k, label, ph]) => <label key={k} className="field"><span className="label">{label}</span><input key={id + k} defaultValue={String(pr[k] ?? "")} placeholder={ph} onBlur={(e) => set(k, e.target.value.trim())} /></label>)}</div>
      <label className="field"><span className="label">About</span><textarea key={id + "about"} rows={3} defaultValue={pr.about || ""} placeholder="Strengths, leadership, what they're looking for in a program" onBlur={(e) => set("about", e.target.value.trim())} /></label>
      <p className="keys">Stays private on your account until you share it. The download and the profile link show the player's full name, these details and verified stats; the link is a snapshot you can update anytime.</p>
    </div> : <p className="small muted">Measurables, contact info and a highlight link, combined with verified season stats into a one-page sheet for college coaches.</p>}
    <div className="rc-clips">
      <div className="row between"><b>Highlight clips</b>{picked.length > 0 && <button className="btn sm" onClick={() => setPreview(!preview)}>{preview ? "Hide" : "Preview"}</button>}</div>
      {picked.length ? <>
        <p className="small muted" style={{ margin: "4px 0 6px" }}>{picked.length} of {p.first || "this player"}'s best plays (kills, aces and blocks first) from {allClips.length} tracked plays with linked video. College coaches can watch them on the profile.</p>
        <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={!pr.clipsOff} onChange={(e) => patch("players", id, { profile: { ...(player(id)!.profile || {}), clipsOff: e.target.checked ? undefined : true } })} /> Include clips on the shared profile</label>
        {preview && <div style={{ marginTop: 8 }}><ClipPlayer clips={picked} title={`${p.first} ${p.last} · highlights`} /></div>}
      </> : <p className="small muted" style={{ margin: "4px 0 0" }}>Link match videos on Stats → One match → Film (YouTube, Vimeo or a video file link), and {p.first || "this player"}'s best plays become highlight clips here.</p>}
    </div>
    {canShare && <label className="consent-check"><input type="checkbox" checked={consented} onChange={(e) => patch("players", id, { profile: { ...(player(id)!.profile || {}), consentAt: e.target.checked ? Date.now() : undefined, consentBy: e.target.checked ? currentUser()?.email : undefined } })} />
      <span>{p.first || "The player"} and a parent or guardian (if under 18) agreed to share this profile publicly with their full name. <a href={LEGAL.consent + "#team=" + encodeURIComponent(t.name)} target="_blank" rel="noopener">Parent form</a></span></label>}
    {url && <div className="row" style={{ marginTop: 6 }}><span className="small">Profile link: <a href={url} target="_blank" rel="noopener">{url}</a></span><QrButton url={url} title={`${p.first} ${p.last}: recruiting profile`} label="QR code" />
      <ConfirmButton className="btn sm ghost" confirmText="Take it down?" onConfirm={async () => { try { await unshareRecruit(t.id, id); setUrl(""); toast("Profile link taken down. It no longer opens."); } catch (e: any) { toast(e?.message || "Couldn't take it down. Check your connection."); } }}>Stop sharing</ConfirmButton></div>}
  </Card>;
}

/** Only web links go into shared pages, never javascript: or data: URLs. */
export function safeUrl(u?: string): string {
  const v = (u || "").trim(); if (!v) return "";
  try { const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : "https://" + v); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; }
}

/** Everything Benchboard holds about one player, as a file a family can keep (access requests). */
export function playerExport(id: string) {
  const p = player(id)!, t = team()!;
  const matches = matchesOf().filter((m) => m.teamId === t.id).map((m) => {
    const R = replayOf(m); if (!R) return null; const A = aggregate(R.sets); const s = A.ps[id];
    if (!s && !A.pm[id]) return null;
    const stats = s ? Object.fromEntries(Object.entries(s).filter(([, v]) => v)) : {};
    return { date: m.date, kind: m.kind, opponent: m.opp, setsPlayed: A.setsPlayed[id] || 0, stats };
  }).filter(Boolean);
  const practices = plansOf().filter((pl) => pl.attendance?.[id]).map((pl) => ({ date: pl.date, title: pl.title, attendance: pl.attendance![id] }));
  const { teamId: _t, ...rest } = p;
  return { exported: new Date().toISOString(), team: t.name, player: rest, matches, practices,
    note: "Stat codes: K kills, KT tool kills, AE attack errors, AB attacks blocked, TA attempts, SA aces, SE serve errors, R passes (R3/R2/R1 by grade, RS shanked), D digs, BS solo blocks, BA block assists, AST assists. Generated by Benchboard." };
}

function PlayerData({ id }: { id: string }) {
  const p = player(id)!, t = team()!;
  const [typed, setTyped] = useState(""), [ask, setAsk] = useState(false);
  const name = `${p.first} ${p.last}`.trim();
  const erase = async () => {
    if (p.profile?.sharedUrl) { try { await unshareRecruit(t.id, id); } catch { toast("Couldn't take down the profile link. Check your connection and try again."); return; } }
    const n = teamPlayers(t.id).filter((x) => x.first === "Former" && x.last.startsWith("player")).length + 1;
    patch("players", id, { first: "Former", last: "player " + n, num: "", grad: null, height: "", notes: "", goals: [], profile: undefined, active: false });
    setAsk(false); setTyped("");
    toast("Personal information erased. Team totals still count their plays, without a name.");
  };
  return <Card title="Privacy and family requests">
    <SetRow title="Keep off public pages" sub={`Live gamecasts and the season page show only #${p.num || "?"}, without a name, and share graphics leave ${p.first || "them"} out. Use this when a family agrees to stats but not to team pages.`}>
      <Switch checked={!!p.hidePublic} onChange={(v) => { patch("players", id, { hidePublic: v || undefined }); toast(v ? `${p.first || "Player"} will show only as #${p.num || "?"} on public pages.` : `${p.first || "Player"} shows by first name and last initial on public pages again.`); }} label="Keep off public pages" />
    </SetRow>
    <p className="small muted">For family requests: give them a copy of everything stored about {p.first || "this player"}, or erase their personal information when they ask.</p>
    <div className="row">
      <button className="btn sm" onClick={() => { download(`${name || "player"} - ${t.name} data.json`, JSON.stringify(playerExport(id), null, 2), "application/json"); toast("Saved. Send the file to the family."); }}>Download their information</button>
      {!ask ? <button className="btn sm ghost" onClick={() => setAsk(true)}>Erase personal information</button> : null}
    </div>
    {ask && <div className="stack" style={{ marginTop: 10 }}>
      <p className="small" style={{ margin: 0 }}>This replaces their name and number with "Former player", deletes notes, goals, measurables and the recruiting profile{p.profile?.sharedUrl ? " (and takes down its link)" : ""}, and removes them from the roster. Match scores and team totals stay the same. This can't be undone{isLinked(t.id) ? " and applies for everyone on the team" : ""}.</p>
      <label className="field"><span className="label">Type ERASE to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" /></label>
      <div className="row"><button className="btn sm danger" disabled={typed.trim().toUpperCase() !== "ERASE"} onClick={erase}>Erase {name || "player"}</button><button className="btn sm ghost" onClick={() => { setAsk(false); setTyped(""); }}>Cancel</button></div>
    </div>}
  </Card>;
}

function recruitHtml(id: string, rows: Row[], A: Agg): string {
  const p = player(id)!, t = team()!, pr = p.profile || {}, s = A.ps[id], pm = playerMetrics(A, id);
  const esc = (x: any) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const item = (l: string, v?: string) => (v ? `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>` : "");
  const stats = s ? [["Kills/set", fmtNum(pm.kps, 2)], ["Hitting %", s.TA ? fmtHit(hitting(s)) : ""], ["Aces/set", fmtNum(pm.acesPs, 2)], ["Serve in", serveAttempts(s) ? fmtPct(pm.serveIn) : ""], ["Pass avg", s.R ? fmtAvg(passAvg(s)) : ""], ["Digs/set", fmtNum(pm.dps, 2)], ["Blocks/set", fmtNum(pm.bps, 2)], ["Assists/set", s.AST ? fmtNum(pm.aps, 2) : ""]].filter((x) => x[1] && x[1] !== "—" && x[1] !== "0") : [];
  const best = rows.map((r) => ({ r, k: r.s?.K || 0, d: r.s?.D || 0, a: r.s?.AST || 0 })).sort((a, b) => b.k + b.d + b.a / 3 - (a.k + a.d + a.a / 3)).slice(0, 3);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.first + " " + p.last)} · Recruiting profile</title>
<style>:root{--c:#2B79B0;--ink:#0B0C0E;--mut:#686E77;--line:#E2E4E8}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:#fff;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:820px;margin:0 auto;padding:24px 18px}
.hero{display:flex;gap:18px;align-items:center;border-bottom:4px solid var(--c);padding-bottom:16px}.n{width:86px;height:86px;border-radius:14px;background:#000;color:#9BD3F2;display:grid;place-items:center;font-size:44px;font-weight:800;flex:none}
h1{margin:0;font-size:30px}.sub{color:var(--mut)}h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:20px 0 8px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.g div{border:1px solid var(--line);border-radius:10px;padding:8px 10px}.g span{display:block;font-size:12px;color:var(--mut)}.g b{font-size:18px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left}th{font-size:12px;color:var(--mut)}a{color:var(--c)}footer{margin-top:22px;color:var(--mut);font-size:12px}</style></head><body><main>
<div class="hero"><div class="n">${esc(p.num)}</div><div><h1>${esc(p.first + " " + p.last)}</h1><div class="sub">${esc([p.pos, p.height, p.grad ? "Class of " + p.grad : ""].filter(Boolean).join(" · "))}</div><div class="sub">${esc([t.name, t.level, pr.club].filter(Boolean).join(" · "))}</div></div></div>
${pr.about ? `<p style="margin-top:14px">${esc(pr.about)}</p>` : ""}
${p.height || pr.reach || pr.approach || pr.block || pr.hand || pr.gpa ? `<h2>Measurables</h2><div class="g">${item("Height", p.height)}${item("Standing reach", pr.reach)}${item("Approach jump", pr.approach)}${item("Block jump", pr.block)}${item("Dominant hand", pr.hand)}${item("GPA", pr.gpa)}</div>` : ""}
<h2>Season stats (${pm.sets} ${pm.sets === 1 ? "set" : "sets"}, tracked live)</h2><div class="g">${stats.map(([l, v]) => item(l, v)).join("")}</div>
${best.length ? `<h2>Best matches</h2><table><thead><tr><th>Date</th><th>Opponent</th><th>Kills</th><th>Digs</th><th>Assists</th><th>Aces</th></tr></thead><tbody>${best.map(({ r }) => `<tr><td>${esc(r.m.date)}</td><td>${esc(r.m.opp)}</td><td>${r.s?.K ?? 0}</td><td>${r.s?.D ?? 0}</td><td>${r.s?.AST ?? 0}</td><td>${r.s?.SA ?? 0}</td></tr>`).join("")}</tbody></table>` : ""}
${safeUrl(pr.video) ? `<h2>Highlights</h2><p><a href="${esc(safeUrl(pr.video))}">${esc(pr.video)}</a></p>` : ""}
${pr.email || pr.phone || pr.coachContact ? `<h2>Contact</h2><div class="g">${item("Player email", pr.email)}${item("Player phone", pr.phone)}${item("Coach", pr.coachContact)}</div>` : ""}
<footer>Stats recorded with Benchboard · ${new Date().toLocaleDateString()} · Shared with the family's permission · <a href="${esc(new URL(LEGAL.privacy, location.href).href)}">Privacy</a></footer></main></body></html>`;
}

/** Where this player's attacks land, plus hitting and passing by rotation. */
function PlayerCourt({ id, A }: { id: string; A: Agg }) {
  const T = tendencies(A.locs, "ourAttack", { p: id });
  const rots = [1, 2, 3, 4, 5, 6].map((r) => ({ r, a: A.atkRot[r]?.[id], p: A.rcvRot[r]?.[id] })).filter((x) => (x.a && x.a.TA) || (x.p && x.p.R));
  if (!T.total && !rots.length) return null;
  const byZone: Record<string, number> = {}; for (const [z, c] of Object.entries(T.zones)) byZone[z] = c.total;
  const top = Object.entries(T.zones).sort((a, b) => b[1].total - a[1].total)[0];
  return <div className="grid2" style={{ alignItems: "start" }}>
    {T.total > 0 && <Card title="Where attacks land">
      <CourtSvg half="them" counts={{ half: "them", byZone, total: T.total, heat: true }} label="Attack chart"
        dots={T.points.filter((l) => l.x != null).map((l) => ({ x: l.x, y: l.y, color: l.t === "K" || l.t === "KT" ? "var(--us)" : "var(--muted)", r: 0.24, opacity: 0.85 }))} labels={{ top: "Opponent" }} />
      <div className="keys"><span><span className="sw" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: "var(--us)", marginRight: 4 }} />Kill</span><span><span className="sw" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: "var(--muted)", marginRight: 4 }} />Kept in play</span>{top && <span>· Most often zone {top[0]} ({Math.round((100 * top[1].total) / T.total)}%)</span>}</div>
    </Card>}
    {rots.length > 0 && <Card title="By rotation">
      <div className="tbl"><table>
        <thead><tr><th className="l">Rotation</th><th>Swings</th><th>Kills</th><th>Hit %</th><th>Passes</th><th>Pass avg</th></tr></thead>
        <tbody>{rots.map(({ r, a, p }) => <tr key={r}><td className="l"><b>R{r}</b></td><td>{a?.TA || 0}</td><td>{a?.K || 0}</td><td>{a && a.TA ? fmtHit((a.K - a.E) / a.TA) : "—"}</td><td>{p?.R || 0}</td><td>{p && p.R ? fmtAvg(p.RS / p.R) : "—"}</td></tr>)}</tbody>
      </table></div>
      <p className="keys" style={{ marginTop: 8 }}>Use this to see which rotations produce the best swings, and where serve receive leans on this player most.</p>
    </Card>}
  </div>;
}

/** Lineup builder: six starters, libero, all six rotations, rotation results, AI suggestion. */
import { autoLineup } from "../../sports/volleyball/autoLineup";
import { useState } from "react";
import { activePlayers, appendEvents, currentMatch, matchesOf, patch, player, playerName, replayOf, setTeamPatch, team, toast, todayISO, uid } from "../../data/store";
import { Lineup } from "../../data/model";
import { aggregate, rotateLineup } from "../../sports/volleyball/engine";
import { fmtPct, fmtSigned, ratio } from "../../sports/volleyball/metrics";
import { Card, Seg } from "../../ui/kit";
import { useDragDrop } from "../../ui/drag";
import { askJson, aiAvailable, AiError, AI_ERRORS } from "../../ai/client";
import { lineupPrompt } from "../../ai/prompts";
import { lineupCardsHtml } from "./lineupCards";
import { download } from "../../ui/kit";

/** Court order for display: front row P4 P3 P2, back row P5 P6 P1. */
const FRONT = [3, 2, 1], BACK = [4, 5, 0];
const POS_NAME = ["P1 · right back · serves", "P2 · right front", "P3 · middle front", "P4 · left front", "P5 · left back", "P6 · middle back"];

/** Which back-row player the libero replaces in this rotation (the back-row middle, else nobody). */
export function liberoFor(lu: string[], lib: string | null, libSrv: string | null): number | null {
  if (!lib) return null;
  for (const i of [4, 5, 0]) { const p = player(lu[i]); if (p?.pos === "MB") { if (i === 0 && libSrv !== lu[0]) return null; return i; } }
  if (libSrv && lu[0] === libSrv) return 0;
  return null;
}

export function LineupPage() {
  const t = team()!, ps = activePlayers(), m = currentMatch();
  const live = m && m.kind === "match" ? replayOf(m)?.cur : null;
  const seed: Lineup = t.defLineup || { ...autoLineup(ps), libSrv: null };
  const [lu, setLu] = useState<string[]>([0, 1, 2, 3, 4, 5].map((i) => seed.lu[i] || ""));
  const [lib, setLib] = useState<string | null>(seed.lib);
  const [libSrv, setLibSrv] = useState<string | null>(seed.libSrv);
  const [sel, setSel] = useState<number | "lib" | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [statsFrom, setStatsFrom] = useState<"season" | "lineup">("season");

  const place = (slot: number | "lib", id: string) => {
    const n = lu.slice(); let L = lib;
    const from = n.indexOf(id);
    if (slot === "lib") { if (from >= 0) n[from] = ""; L = id; }
    else { const prev = n[slot]; if (from >= 0) n[from] = prev; else if (L === id) L = prev && player(prev)?.pos === "L" ? prev : null; n[slot] = id; }
    setLu(n); setLib(L); if (libSrv && !n.includes(libSrv)) setLibSrv(null); setSel(null);
  };
  useDragDrop((d) => { if (d.target === "slot") place(d.targetId === "lib" ? "lib" : +d.targetId, d.id); });

  const valid = lu.every(Boolean) && new Set(lu).size === 6 && !(lib && lu.includes(lib));
  const current: Lineup = { lu, lib, libSrv: libSrv && lu.includes(libSrv) ? libSrv : null };
  const saveDefault = () => { if (!valid) return toast("Fill all six spots with different players."); setTeamPatch({ defLineup: current }); toast("Saved as your starting lineup"); };
  const useNow = () => { if (!m || !valid) return; appendEvents(m.id, [{ t: "LU", ...current } as any]); toast("Lineup is on court now"); };
  const useNext = () => { if (!m || !valid) return; patch("matches", m.id, { nextLu: current }); toast("Queued for the next set"); };

  // Rotation results from this season, optionally only sets that started with this exact lineup
  const sets = matchesOf().filter((x) => x.kind === "match" && (!t.activeSeasonId || x.seasonId === t.activeSeasonId)).flatMap((x) => replayOf(x)?.sets || []);
  const same = sets.filter((s) => s.startLu && s.startLu.join() === lu.join());
  const A = aggregate(statsFrom === "lineup" ? same : sets);
  // Rotation results keyed by who is in position 1 (the server), so they follow the players when the lineup is rotated or reordered.
  const byP1 = new Map<string, { w: number; l: number; rw: number; rn: number; sw: number; sn: number }>();
  for (const r of A.rallies) { const p1 = r.onCourt[0]; if (!p1 || r.onCourt.length < 6) continue; const x = byP1.get(p1) || { w: 0, l: 0, rw: 0, rn: 0, sw: 0, sn: 0 }; byP1.set(p1, x); const won = r.w === "us"; if (won) x.w++; else x.l++; if (r.server === "them") { x.rn++; if (won) x.rw++; } else { x.sn++; if (won) x.sw++; } }
  const rotStat = (r: number) => byP1.get(rotateLineup(lu, r - 1)[0]) || null;

  const suggest = async () => {
    if (!aiAvailable()) return setErr(AI_ERRORS.no_key);
    setBusy(true); setErr("");
    try {
      const r = await askJson<{ lineup: string[]; libero: string | null; summary: string; reasons: string[]; serveReceive: string[] }>(lineupPrompt(), { tier: "complex" });
      const ids = new Set(ps.map((p) => p.id));
      if (!Array.isArray(r.lineup) || r.lineup.length !== 6 || new Set(r.lineup).size !== 6 || !r.lineup.every((id) => ids.has(id))) throw new AiError("bad", "The suggestion didn't use your roster correctly. Try again.");
      const libero = r.libero && ids.has(r.libero) && !r.lineup.includes(r.libero) ? r.libero : null;
      setTeamPatch({ luAdvice: { lineup: r.lineup, libero, summary: String(r.summary || ""), reasons: (r.reasons || []).map(String), serveReceive: (r.serveReceive || []).map(String), at: Date.now() } });
    } catch (e) { setErr(e instanceof AiError ? e.message : AI_ERRORS.upstream); }
    setBusy(false);
  };
  const adv = t.luAdvice;

  const slot = (i: number | "lib") => {
    const id = i === "lib" ? lib : lu[i];
    const p = player(id);
    return <button key={i} className={"lslot " + (p ? "filled " : "") + (sel === i ? "sel" : "")} data-drop="slot" data-drop-id={String(i)} onClick={() => setSel(sel === i ? null : i)} aria-label={i === "lib" ? "Libero" : POS_NAME[i]}>
      <span className="pos">{i === "lib" ? "LIBERO" : "P" + (i + 1)}</span>
      {p ? <><span className="n">{p.num}</span><span className="nm">{p.first || p.last}</span><span className="ps">{p.pos}</span></> : <span className="small muted">{sel === i ? "Pick a player" : "Empty"}</span>}
    </button>;
  };

  return <div className="page">
    <div className="pagehead"><h1>Lineup & rotations</h1>
      <div className="row">
        <button className="btn primary" disabled={!valid} onClick={saveDefault}>Save as starting lineup</button>
        <button className="btn" disabled={!valid} onClick={() => {
          const today = todayISO(), next = (team()!.schedule || []).filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
          const opp = m && m.kind === "match" && m.status === "live" ? m.opp : next?.opp, date = m && m.kind === "match" && m.status === "live" ? m.date : next?.date;
          download(`${team()!.name} lineup cards.html`.replace(/[^\w\- .]+/g, ""), lineupCardsHtml(lu, lib, { opp, date, sets: 5 }), "text/html"); toast("Lineup cards saved. Open the file to print.");
        }}>Lineup cards</button>
        {m && m.kind === "match" && <><button className="btn" disabled={!valid} onClick={useNow}>Put on court now</button><button className="btn" disabled={!valid} onClick={useNext}>Use next set{m.nextLu ? " ✓" : ""}</button></>}
      </div>
    </div>
    {live?.lu && <p className="small muted">On court now in set {live.n}: {live.lu.map((id) => playerName(id)).join(", ")}. <button className="btn sm" onClick={() => { setLu(live.lu!.slice()); setLib(live.lib); setLibSrv(live.libSrv); }}>Load it here</button></p>}
    <div className="grid2" style={{ alignItems: "start" }}>
      <Card title="Starting six" actions={<span className="small muted">Tap a spot, then a player. Or drag.</span>}>
        <div className="stack">
          <div className="netbar" style={{ textAlign: "center" }}><span className="label">NET</span></div>
          <div className="mini3" style={{ gap: 8 }}>{FRONT.map(slot)}</div>
          <div className="mini3" style={{ gap: 8 }}>{BACK.map(slot)}</div>
          <div className="row" style={{ alignItems: "stretch" }}>
            <div style={{ width: 120 }}>{slot("lib")}</div>
            <label className="field grow"><span className="label">Libero serves for</span>
              <select value={libSrv || ""} onChange={(e) => setLibSrv(e.target.value || null)} disabled={!lib}><option value="">Nobody</option>{lu.filter(Boolean).map((id) => <option key={id} value={id}>{playerName(id)}</option>)}</select></label>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Roster {sel !== null && <span className="tag">placing into {sel === "lib" ? "libero" : "P" + ((sel as number) + 1)}</span>}</div>
            <div className="players">{ps.map((p) => {
              const where = lu.indexOf(p.id), isLib = lib === p.id;
              return <button key={p.id} className={"pl " + (where >= 0 || isLib ? "" : "bench")} data-drag="lp" data-drag-id={p.id} onClick={() => { if (sel !== null) place(sel, p.id); else { const empty = lu.findIndex((x) => !x); if (empty >= 0) place(empty, p.id); else toast("Tap a spot first, then the player."); } }}>
                {isLib && <span className="lb">L</span>}<span className="n">{p.num}</span><span className="nm">{p.first || p.last}</span><span className="ps">{where >= 0 ? "P" + (where + 1) : p.pos}</span>
              </button>; })}</div>
          </div>
          {!valid && <p className="hint warn">Fill all six spots with different players{lib && lu.includes(lib) ? ", and keep the libero out of the six" : ""}.</p>}
          <LineupChecks lu={lu} />
        </div>
      </Card>
      <div className="stack">
        <Card title="Best lineup from your stats" actions={<button className="btn sm primary" disabled={busy} onClick={suggest}>{busy ? "Thinking…" : adv ? "Ask again" : "Suggest a lineup"}</button>}>
          {err && <p className="hint warn">{err}</p>}
          {adv ? <div className="stack">
            <p><b>{adv.summary}</b></p>
            <div className="mini3">{[3, 2, 1, 4, 5, 0].map((i) => <div key={i}><b>{player(adv.lineup[i])?.num ?? "?"}</b>{playerName(adv.lineup[i], "first")}</div>)}</div>
            {adv.libero && <p className="small">Libero: {playerName(adv.libero, "full")}</p>}
            <ul className="recs">{adv.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            {adv.serveReceive.length > 0 && <><div className="label">Serve receive</div><ul className="recs">{adv.serveReceive.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
            <div className="row"><button className="btn sm" onClick={() => { setLu(adv.lineup.slice()); setLib(adv.libero); setLibSrv(null); toast("Loaded. Save it to keep it."); }}>Load into builder</button><span className="small muted">Suggested {new Date(adv.at).toLocaleDateString()}</span></div>
          </div> : <p className="small muted">Uses every player's hitting, passing, serving and your rotation results to suggest a starting six. You can load it, tweak it, and save.</p>}
        </Card>
        <StartRotation rotStat={rotStat} lu={lu} valid={valid} onUse={(n) => { setLu(rotateLineup(lu, n - 1)); toast(`Rotated: what was rotation ${n} is now your starting rotation. Save it to keep it.`); }} />
      </div>
    </div>
    <SubPlan />
    <Card title="All six rotations" actions={<Seg value={statsFrom} onChange={setStatsFrom} options={[["season", "Season results"], ["lineup", `This lineup (${same.length} sets)`]]} />}>
      <div className="rots">{[1, 2, 3, 4, 5, 6].map((r) => {
        const L = rotateLineup(lu, r - 1), li = liberoFor(L, lib, libSrv), x = rotStat(r), net = x ? x.w - x.l : 0;
        const cell = (i: number) => { const isL = li === i, id = isL ? lib : L[i]; return <div key={i} className={(i === 0 ? "srvp " : "") + (isL ? "libx" : "")} title={isL ? `${playerName(lib)} in for ${playerName(L[i])}` : undefined}><b>{player(id)?.num ?? "–"}</b>{id ? playerName(id, "first") : "—"}</div>; };
        return <div key={r} className="rotcard">
          <div className="hd"><span>Rotation {r}</span>{x && x.w + x.l > 0 && <span style={{ color: net > 0 ? "var(--good)" : net < 0 ? "var(--muted)" : undefined }}>{fmtSigned(net)}</span>}</div>
          <div className="mini3"><span className="net" />{FRONT.map(cell)}{BACK.map(cell)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>Serving: {playerName(li === 0 ? lib : L[0]) || "—"}{x && x.rn ? ` · SO ${fmtPct(ratio(x.rw, x.rn))}` : ""}{x && x.sn ? ` · PS ${fmtPct(ratio(x.sw, x.sn))}` : ""}</div>
        </div>; })}</div>
      <p className="keys" style={{ marginTop: 8 }}>Highlighted box = server. Dashed = libero in for that player. Results follow the player in the serving spot, so they stay right if you rotate or reorder the lineup. SO = side-out %, PS = point-scoring %.</p>
    </Card>
  </div>;
}

/** Quick sanity checks on a 5-1 / 6-2 style lineup. */
function LineupChecks({ lu }: { lu: string[] }) {
  if (lu.some((x) => !x)) return null;
  const pos = lu.map((id) => player(id)?.pos || "");
  const opp = (a: number) => (a + 3) % 6;
  const notes: string[] = [];
  const s = pos.indexOf("S"), o = pos.indexOf("OPP");
  if (s >= 0 && o >= 0 && opp(s) !== o) notes.push("The setter and opposite usually line up across from each other (3 spots apart).");
  const mbs = pos.map((p, i) => (p === "MB" ? i : -1)).filter((i) => i >= 0);
  if (mbs.length === 2 && opp(mbs[0]) !== mbs[1]) notes.push("The two middles usually line up across from each other so one is always front row.");
  const ohs = pos.map((p, i) => (p === "OH" ? i : -1)).filter((i) => i >= 0);
  if (ohs.length === 2 && opp(ohs[0]) !== ohs[1]) notes.push("The two outsides usually line up across from each other.");
  if (s < 0) notes.push("No setter in the six.");
  if (!notes.length) return <p className="hint">Balanced: setter, middles and outsides are across from each other.</p>;
  return <div className="hint warn">{notes.map((n, i) => <div key={i}>{n}</div>)}</div>;
}

/** Planned substitutions by rotation. The Track screen reminds you when that rotation comes up. */
function SubPlan() {
  const t = team()!, ps = activePlayers(), plan = t.subPlan || [];
  const [rot, setRot] = useState(4), [out, setOut] = useState(""), [inn, setIn] = useState("");
  const save2 = (p: typeof plan) => setTeamPatch({ subPlan: p });
  return <Card title="Planned subs">
    <div className="stack">
      {plan.length ? <ul className="log">{plan.slice().sort((a, b) => a.rot - b.rot).map((x) => <li key={x.id} style={{ gridTemplateColumns: "60px 1fr 28px" }}><b>R{x.rot}</b><span>{playerName(x.in)} in for {playerName(x.out)}</span><button className="x" aria-label="Remove" onClick={() => save2(plan.filter((y) => y.id !== x.id))}>✕</button></li>)}</ul>
        : <p className="small muted">Plan your regular subs, like a defensive specialist in for the opposite when that player rotates to the back row. Track reminds you when that rotation comes up.</p>}
      <div className="row">
        <select className="input" style={{ width: "auto" }} value={rot} onChange={(e) => setRot(+e.target.value)} aria-label="Rotation">{[1, 2, 3, 4, 5, 6].map((r) => <option key={r} value={r}>Rotation {r}</option>)}</select>
        <select className="input" style={{ width: "auto" }} value={inn} onChange={(e) => setIn(e.target.value)} aria-label="Sub in"><option value="">Sub in…</option>{ps.map((p) => <option key={p.id} value={p.id}>#{p.num} {p.first}</option>)}</select>
        <span className="small muted">for</span>
        <select className="input" style={{ width: "auto" }} value={out} onChange={(e) => setOut(e.target.value)} aria-label="Sub out"><option value="">Player out…</option>{ps.map((p) => <option key={p.id} value={p.id}>#{p.num} {p.first}</option>)}</select>
        <button className="btn sm primary" disabled={!out || !inn || out === inn} onClick={() => { save2(plan.concat({ id: uid("sp"), rot, out, in: inn })); setIn(""); setOut(""); toast("Planned sub added"); }}>Add</button>
      </div>
    </div>
  </Card>;
}

/** Which rotation to start sets in: early rotations come up more often, so lead with the strongest. */
function StartRotation({ rotStat, lu, valid, onUse }: { rotStat: (r: number) => { w: number; l: number } | null; lu: string[]; valid: boolean; onUse: (n: number) => void }) {
  const rate = (r: number) => { const x = rotStat(r); const n = x ? x.w + x.l : 0; return x && n >= 8 ? (x.w - x.l) / n : null; };
  const known = [1, 2, 3, 4, 5, 6].filter((r) => rate(r) != null).length;
  if (known < 4) return null;
  const W = [1.3, 1.2, 1.1, 1, 0.9, 0.8];
  const score = (s: number) => W.reduce((sum, w, k) => sum + w * (rate(((s - 1 + k) % 6) + 1) ?? 0), 0);
  const opts = [1, 2, 3, 4, 5, 6].map((s) => ({ s, v: score(s) })).sort((a, b) => b.v - a.v), best = opts[0], cur = opts.find((o) => o.s === 1)!;
  const order = (s: number) => [0, 1, 2].map((k) => ((s - 1 + k) % 6) + 1);
  const gain = (best.v - cur.v) / W.reduce((a, b) => a + b, 0);
  return <Card title="Which rotation to start in">
    {best.s === 1 ? <p className="small">Rotation 1 is already the best place to start. Your first three rotations are {order(1).map((r) => fmtSigned(Math.round((rate(r) ?? 0) * 100))).join(", ")} per 100 rallies.</p>
      : <><p className="small">Start in <b>rotation {best.s}</b>. Sets spend the most time in the first few rotations, so lead with {order(best.s).map((r) => "R" + r).join(", ")} ({order(best.s).map((r) => fmtSigned(Math.round((rate(r) ?? 0) * 100))).join(", ")} per 100 rallies) instead of {order(1).map((r) => "R" + r).join(", ")} ({order(1).map((r) => fmtSigned(Math.round((rate(r) ?? 0) * 100))).join(", ")}).
          {gain < 0.02 ? " The difference is small, about one point every few sets." : ` Worth about ${Math.max(1, Math.round(gain * 45))} point${Math.round(gain * 45) > 1 ? "s" : ""} a set.`}</p>
        <div className="row"><button className="btn sm primary" disabled={!valid || !lu.every(Boolean)} onClick={() => onUse(best.s)}>Start in rotation {best.s}</button><span className="small muted">Rotates the lineup in the builder; same six, same order.</span></div></>}
    <p className="keys" style={{ marginTop: 6 }}>Based on points won minus lost with each player in the serving spot, for the stats shown below, so it holds up when you rotate the lineup. Needs at least 8 rallies to count a rotation.</p>
  </Card>;
}

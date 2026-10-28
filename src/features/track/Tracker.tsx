/** Live stat tracking for a match, drill session or scrimmage. */
import { useWakeLock } from "../../ui/wakeLock";
import { autoLineup } from "../../sports/volleyball/autoLineup";
import { useCallback, useEffect, useRef, useState } from "react";
import { roleOn } from "../../cloud/sync";
import { setTeamPatch, setPrefs, state, stampLog, logsOf, DEVICE, activePlayers, appendEvents, deleteEvent, eventsOf, isMine, patch, patchEvent, player, playerName, replayOf, save, team, toast, undoLast } from "../../data/store";
import { Match } from "../../data/model";
import { ACTIONS, ActionCode, GROUPS, LOCATION_HALF, OPP_NUMBER } from "../../sports/volleyball/actions";
import { aggregate, LogEntry, Replay, serverOf, SetState, zoneOf } from "../../sports/volleyball/engine";
import { fmtAvg, fmtHit, fmtPct, hitting, passAvg, ratio, serveAttempts, serveErrors, serves, blocks } from "../../sports/volleyball/metrics";
import { flags } from "../../sports/volleyball/flags";
import { setUi, ui } from "../../app/ui";
import { sideNames } from "../../app/Scoreboard";
import { CourtSvg } from "../../ui/court";
import { Ball } from "../../ui/icons";
import { Card, ConfirmButton } from "../../ui/kit";
import { useDragDrop } from "../../ui/drag";
import { AiCard } from "../../ui/ai";
import { timeoutPrompt } from "../../ai/prompts";
import { go } from "../../app/router";
import { SplitEditor, SplitState } from "../practice/SplitEditor";
import { parseQuick, QUICK_HELP } from "../../sports/volleyball/quickcodes";
import { PlanPanel } from "../matchup/MatchupPage";
import { KEYMAP, useStatKeys } from "./keys";

/** This device's job for a real match (scrimmages and drills always track everything). */
export const jobOf = (m: Match): "all" | "score" | "stats" => (m.kind === "match" && !m.scrim ? state.prefs.job || "all" : "all");
const SCORE_GROUPS: [string, ActionCode[]][] = [["Score", ["UP", "TP"]], ["How they scored or erred", ["OK", "OA", "OE"]]];
const STAT_GROUP_NAMES = GROUPS.map((g) => g[0]).filter((g) => g !== "Opponent");
const jobGroups = (m: Match): [string, ActionCode[]][] => {
  const j = jobOf(m);
  if (j === "score") return SCORE_GROUPS;
  if (j === "stats") { const pick = state.prefs.jobGroups?.length ? state.prefs.jobGroups : STAT_GROUP_NAMES; return GROUPS.filter((g) => pick.includes(g[0])); }
  return GROUPS;
};

const TAGS = ["Great play", "Review this", "Serve receive", "Rotation breakdown", "Defense", "Coachable moment"];

export function Tracker({ m }: { m: Match }) {
  const t = team()!, R = replayOf(m)!, c = R.cur;
  useWakeLock(m.status === "live" && !R.matchOver); // a phone on the bench shouldn't dim and lock mid-rally
  const names = sideNames(m, t.name);
  const scr = m.scrim;

  const onDrop = useCallback((d: { kind: string; id: string; target: string; targetId: string }) => {
    const cur = replayOf(m)?.cur; if (!cur || !cur.lu) return;
    if (d.kind === "bench" && d.target === "court" && cur.lu.includes(d.targetId)) {
      const lim = team()!.settings.subLimit;
      if (lim && cur.subs >= lim) { toast(`Sub limit reached (${lim}).`); return; }
      if (ui.sel === d.targetId) setUi({ sel: null });
      appendEvents(m.id, [{ t: "SUB", out: d.targetId, in: d.id } as any]);
      toast(`${playerName(d.id)} in for ${playerName(d.targetId)}`);
    }
  }, [m]);
  useDragDrop(onDrop, !!(c && c.lu && !scr));
  const recRef = { current: null as null | ((k: ActionCode) => boolean) };
  const [keyHelp, setKeyHelp] = useState(false);
  useStatKeys(!!c, {
    record: (k) => { recRef.current?.(k); },
    selectNum: (num) => {
      const pool = scr ? activePlayers().filter((p) => scr.a.ids.includes(p.id) || scr.b.ids.includes(p.id)) : activePlayers();
      const p = pool.find((x) => String(x.num) === num); if (!p) return false;
      setUi({ sel: p.id }); return true;
    },
    clear: () => setUi({ sel: null, follow: null }),
    undo: () => { const u = undoLast(m.id); setUi({ follow: null }); toast(u ? "Undid " + describe(u as any) : "Nothing of yours to undo."); },
    help: () => setKeyHelp((x) => !x),
  });

  if (!c) return <p className="empty">This match has no sets yet.</p>;
  const setA = aggregate([c]), mA = aggregate(R.sets);
  const srv = serverOf(c);

  const record = (code: ActionCode, o: { p?: string | null; op?: string; quiet?: boolean } = {}) => {
    const a: any = ACTIONS[code];
    let p: string | null = null;
    if (!a.team) {
      if (o.p) p = o.p;
      else if (ui.sel && !o.quiet) p = ui.sel;
      else if (!scr && a.serve && srv) p = srv;
      else if (scr || !a.optionalPlayer) { toast("Pick a player first."); return false; }
    }
    // a finished set (or match) takes no more plays until the next set starts; stats-only entries never touch the score
    if (c.over && jobOf(m) !== "stats") {
      toast(R.matchOver ? "The match is over. Fix the score if a point was missed, or finish the match." : `${m.scrim ? "Game" : "Set"} ${c.n} is over. Pick who serves first in ${m.scrim ? "game" : "set"} ${c.n + 1} to keep going.`);
      return false;
    }
    const ev: any = { t: code };
    if (p) ev.p = p;
    if (o.op) ev.op = o.op;
    if (scr && p) ev.s = scr.b.ids.includes(p) ? "b" : "a";
    if (jobOf(m) === "stats") {
      ev.ns = true;
      if (ui.prevRally) {
        // place it just before the point that ended the last rally, so it counts in that rally
        const lastPt = R.log.slice().reverse().find((l) => l.kind === "stat" && l.w);
        const t0 = lastPt ? eventsOf(m.id).find((x) => x.id === lastPt.id)?.ts : undefined;
        if (t0) ev.ts = t0 - 1;
        setUi({ prevRally: false });
      }
    }
    const e = appendEvents(m.id, [ev]); if (!e) return false;
    if (o.op && !m.oppPlayers.includes(o.op)) patch("matches", m.id, { oppPlayers: m.oppPlayers.concat(o.op) });
    if (o.quiet) return true;
    let half = t.settings.askLoc ? LOCATION_HALF[code] || null : null;
    if (code === "D" && !t.settings.askLocDigs) half = null;
    if (scr && half && ev.s === "b") half = half === "them" ? "us" : "them";
    const askOpp = !scr && t.settings.askOpp && !!OPP_NUMBER[code];
    if (half || askOpp) setUi({ follow: { id: e.id, half, askOpp, label: (p ? playerName(p) + " · " : "") + a.long } });
    else { setUi({ follow: null }); toast((p ? playerName(p) + " · " : "") + a.long, { label: "Undo", fn: () => { const u = undoLast(m.id); if (u) toast("Undid " + describe(u as any)); } }); }
    // Clear the selected player after their play so the next tap can't land on the wrong person.
    if (p && ui.sel === p) setUi({ sel: null });
    return true;
  };
  recRef.current = (k) => { const ok = record(k); if (ok && ui.sel && !(ACTIONS[k] as any).team) setUi({ sel: null }); return ok; };
  const focus = !!(state.prefs.labsFocus && state.prefs.focus);

  return (
    <div className={"stack" + (focus ? " focus" : "")}>
      <Banners m={m} R={R} />
      <ControlBar m={m} c={c} names={names} />
      <CrewWarning m={m} />
      {roleOn(t.id) === "viewer" && <div className="banner warn"><p><b>View-only.</b> You can follow along, but what you record on this device isn't shared with the team. Ask a coach for a coach invite to track.</p></div>}
      <QuickEntry m={m} record={record} />
      <div className={focus ? "stack" : "split"}>
        <div className="stack">
          <Panels m={m} R={R} c={c} />
          {scr ? <ScrimPlayers m={m} /> : <CourtPlayers c={c} />}
          <PlannedSub c={c} m={m} />
          <Hint c={c} m={m} />
          <Pad m={m} c={c} setA={setA} mA={mA} record={record} />
          <div className="legend"><span><span className="sw" style={{ background: "var(--us)" }} />Point to {names.us}</span><span><span className="sw" style={{ background: "var(--them)" }} />Point to {names.them}</span><span><span className="sw" style={{ background: "var(--line)" }} />No point, rally continues</span></div>
        </div>
        {!focus && <div className="stack">
          {scr ? <ScrimSummary m={m} c={c} /> : <SetSummary c={c} setA={setA} />}
          {!scr && <FlagsCard R={R} m={m} />}
          <RecentCard m={m} R={R} />
        </div>}
      </div>
      <FollowSheet m={m} />
      {!ui.follow && <ActionSheet m={m} c={c} record={record} />}
      {keyHelp && <KeyHelp onClose={() => setKeyHelp(false)} />}
    </div>
  );
}

/* ---------- banners ---------- */
function Banners({ m, R }: { m: Match; R: Replay }) {
  const t = team()!, c = R.cur!, names = sideNames(m, t.name), unit = m.scrim ? "Game" : "Set";
  // on a phone the coach is usually scrolled down to the buttons: bring the end-of-set question and timeout card into view
  const endRef = useRef<HTMLDivElement>(null), toRef = useRef<HTMLDivElement>(null);
  const ended = R.matchOver ? "match" : c.over ? "set" + c.n : "";
  useEffect(() => { if (ended) endRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [ended]);
  useEffect(() => { if (ui.panel === "timeout") toRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [ui.panel]);
  const startNext = (serve: "us" | "them") => {
    const ev: any = { t: "NS", serve };
    if (m.nextLu && m.nextLu.lu.length === 6) { Object.assign(ev, { lu: m.nextLu.lu, lib: m.nextLu.lib, libSrv: m.nextLu.libSrv }); patch("matches", m.id, { nextLu: null }); }
    appendEvents(m.id, [ev]);
  };
  return <>
    {m.sample && <div className="banner"><p><b>Sample team.</b> Everything here is example data so you can explore. Create your own team from the Team tab.</p><button className="btn sm" onClick={() => go("team")}>Go to Team</button></div>}
    {ui.panel === "timeout" && !m.scrim && <div ref={toRef}><AiCard title="Timeout card" desc="Three talking points from the live stats." button="Get talking points" tier="quick" prompt={() => timeoutPrompt(m)} /></div>}
    {R.matchOver ? <div className="banner accent" ref={endRef}><p><b>{m.scrim ? "Scrimmage" : "Match"} over.</b> {R.wonUs === R.wonThem ? `Split ${R.wonUs}–${R.wonThem}.` : `${R.wonUs > R.wonThem ? names.us : names.them} win ${Math.max(R.wonUs, R.wonThem)}–${Math.min(R.wonUs, R.wonThem)}.`}</p>
      <div className="row"><button className="btn" onClick={() => { setUi({ statsScope: "match" }); go("stats"); }}>See stats and report</button><button className="btn primary" onClick={() => { patch("matches", m.id, { status: "done" }); save("teams", { ...t, currentMatchId: null }); }}>Finish</button></div></div>
      : c.over && <div className="banner accent" ref={endRef}><p><b>{unit} {c.n} to {c.winner === "us" ? names.us : names.them}, {c.us}–{c.them}.</b> Who serves first in {unit.toLowerCase()} {c.n + 1}?{!m.scrim && (m.nextLu ? " Your queued lineup starts it." : c.startLu ? " The starting lineup carries over." : "")}</p>
        <div className="row"><button className="btn primary" onClick={() => startNext("us")}>{names.us} serve</button><button className="btn" onClick={() => startNext("them")}>{names.them} serve</button></div></div>}
  </>;
}

/* ---------- control bar ---------- */
function ControlBar({ m, c, names }: { m: Match; c: SetState; names: { us: string; them: string } }) {
  const t = team()!, lim = t.settings.subLimit;
  const undo = () => { const e = undoLast(m.id); toast(e ? "Undid " + describe(e as any) : "Nothing of yours to undo."); setUi({ follow: null }); };
  const timeout = (side: "us" | "them") => { appendEvents(m.id, [{ t: "TO", v: side } as any]); toast(`Timeout ${side === "us" ? names.us : names.them}`); if (side === "us") setUi({ panel: "timeout" }); };
  const panel = (p: typeof ui.panel) => setUi({ panel: ui.panel === p ? null : p });
  if (m.kind !== "match") return (
    <div className="ctrlbar">
      {m.scrim && <button className="ctrl" onClick={() => panel("teams")}>Edit teams<small>move players</small></button>}
      <button className="ctrl" onClick={() => panel("fix")}>Fix score<small>{c.us}–{c.them}</small></button>
      <button className="ctrl" onClick={() => panel("tag")}>Film tag<small>bookmark a moment</small></button>
      <button className="ctrl" onClick={undo}>Undo<small>your last entry</small></button>
      <FocusToggle />
    </div>);
  return (
    <div className="ctrlbar">
      <button className="ctrl us grow" disabled={c.to.us >= 2} onClick={() => timeout("us")}>Timeout · {names.us}<small>{2 - c.to.us} left · shows talking points</small></button>
      <button className="ctrl them grow" disabled={c.to.them >= 2} onClick={() => timeout("them")}>Timeout · {names.them}<small>{2 - c.to.them} left</small></button>
      <button className="ctrl" onClick={() => panel("fix")}>Fix score<small>{c.us}–{c.them}</small></button>
      {c.lu && <button className="ctrl" onClick={() => panel("sub")}>Sub<small>{c.subs}{lim ? " of " + lim : ""} used</small></button>}
      <button className="ctrl" onClick={() => panel("lineup")}>{c.lu ? "Fix positions" : "Set lineup"}<small>{c.lu ? "who's where now" : "rotation tracking"}</small></button>
      <button className="ctrl" onClick={() => panel("plan")}>Game plan<small>keys & threats</small></button>
      <button className={"ctrl" + (jobOf(m) !== "all" ? " on" : "")} onClick={() => panel("job")}>My job<small>{({ all: "everything", score: "score only", stats: "stats only" } as const)[jobOf(m)]}</small></button>
      <button className="ctrl" onClick={() => panel("tag")}>Film tag<small>bookmark</small></button>
      <button className="ctrl" onClick={undo}>Undo<small>your last entry</small></button>
      <FocusToggle />
      <EndMatch m={m} />
    </div>);
}

function EndMatch({ m }: { m: Match }) {
  const [arm, setArm] = useState(false);
  return <button className="ctrl" onClick={() => { if (!arm) { setArm(true); setTimeout(() => setArm(false), 3000); return; } patch("matches", m.id, { status: "done" }); setTeamPatch({ currentMatchId: null }); toast("Match saved"); }}>{arm ? "Tap again" : "End match"}<small>{arm ? "to save and close" : "save & close"}</small></button>;
}

function FocusToggle() {
  const on = !!state.prefs.focus;
  if (!state.prefs.labsFocus) return null;
  return <button className="ctrl" aria-pressed={on} onClick={() => setPrefs({ focus: !on })}>{on ? "Exit focus" : "Focus mode"}<small>{on ? "show side panels" : "big buttons only"}</small></button>;
}

/* ---------- type-in codes ---------- */
function QuickEntry({ m, record }: { m: Match; record: (k: ActionCode, o?: { p?: string | null; op?: string; quiet?: boolean }) => boolean }) {
  const [v, setV] = useState(""), [help, setHelp] = useState(false), [msg, setMsg] = useState("");
  if (!state.prefs.quick) return null;
  const submit = () => {
    const r = parseQuick(v); if (!v.trim()) return;
    const done: string[] = [], bad = r.errors.slice();
    for (let i = 0; i < r.undo; i++) { const e = undoLast(m.id); if (e) done.push("undo"); }
    for (const it of r.items) {
      let pid: string | null = null;
      if (it.num) { const p = activePlayers().find((x) => x.num === it.num); if (!p) { bad.push(it.raw + " (no #" + it.num + ")"); continue; } pid = p.id; }
      if (record(it.code, { p: pid, op: it.op, quiet: true })) done.push(it.raw); else bad.push(it.raw);
    }
    setMsg((done.length ? "Recorded: " + done.join(" ") : "") + (bad.length ? (done.length ? " · " : "") + "Didn't understand: " + bad.join(", ") : ""));
    if (!bad.length) setV(""); else setV(bad.map((b) => b.split(" ")[0]).join(" "));
    setUi({ follow: null });
  };
  return <div className="quick">
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="Type codes: 7k  12ace  4p3  ok11  oe   (Enter to record)" aria-label="Type stat codes" autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button className="btn sm" onClick={submit}>Record</button>
      <button className="btn sm ghost" aria-expanded={help} onClick={() => setHelp(!help)}>Codes</button>
    </div>
    {msg && <p className="small muted" style={{ margin: "4px 2px 0" }}>{msg}</p>}
    {help && <div className="tbl" style={{ marginTop: 6 }}><table><tbody>{QUICK_HELP.map(([c, d]) => <tr key={c}><td className="l"><code>{c}</code></td><td className="l small">{d}</td></tr>)}</tbody></table>
      <p className="keys" style={{ marginTop: 6 }}>Number first for your players (7k), after the code for theirs (ok11). Several on one line work. Type-in entries skip the court-location prompt.</p></div>}
  </div>;
}

export function describe(e: { t: string; p?: string }): string {
  const a: any = (ACTIONS as any)[e.t];
  if (a) return (e.p ? playerName(e.p) + " · " : "") + a.long;
  return ({ NS: "new set", TO: "timeout", SUB: "substitution", LU: "lineup change", TAG: "film tag", ADJ: "score fix", ROT: "rotation change", SRV: "serve change" } as any)[e.t] || "entry";
}

/* ---------- editors ---------- */
function Panels({ m, R, c }: { m: Match; R: Replay; c: SetState }) {
  const p = ui.panel;
  if (p === "fix") return <FixScore m={m} c={c} />;
  if (p === "lineup" && !m.scrim) return <LineupFix m={m} c={c} />;
  if (p === "sub" && c.lu) return <SubPanel m={m} c={c} />;
  if (p === "tag") return <TagPanel m={m} R={R} />;
  if (p === "teams" && m.scrim) return <TeamsPanel m={m} />;
  if (p === "plan" && !m.scrim) return <PlanPanel m={m} onClose={() => setUi({ panel: null })} />;
  if (p === "job" && m.kind === "match" && !m.scrim) return <JobPanel m={m} />;
  return null;
}

function FixScore({ m, c }: { m: Match; c: SetState }) {
  const t = team()!, names = sideNames(m, t.name);
  const [v, setV] = useState({ us: c.us, them: c.them });
  const step = (k: "us" | "them", d: number) => setV({ ...v, [k]: Math.max(0, v[k] + d) });
  return <div className="editor">
    <b>Fix the score · {m.scrim ? "game" : "set"} {c.n}</b>
    <div className="two">{(["us", "them"] as const).map((k) => <div key={k}><div className="label">{names[k]}</div><div className="stepper"><button onClick={() => step(k, -1)} aria-label="Minus one">−</button><span className="val">{v[k]}</span><button onClick={() => step(k, 1)} aria-label="Plus one">+</button></div></div>)}</div>
    <div className="row"><button className="btn primary" onClick={() => { if (v.us !== c.us || v.them !== c.them) { appendEvents(m.id, [{ t: "ADJ", us: v.us, them: v.them } as any]); toast(`Score set to ${v.us}–${v.them}`); } setUi({ panel: null }); }}>Save score</button><button className="btn" onClick={() => setUi({ panel: null })}>Cancel</button></div>
    <p className="small muted">This only changes the score. Missed a whole rally? Add it so serve and rotation move too:</p>
    <div className="row"><button className="btn sm" onClick={() => { appendEvents(m.id, [{ t: "UP" } as any]); setV({ ...v, us: v.us + 1 }); }}>+1 rally to {names.us}</button><button className="btn sm" onClick={() => { appendEvents(m.id, [{ t: "TP" } as any]); setV({ ...v, them: v.them + 1 }); }}>+1 rally to {names.them}</button></div>
    {!c.over && c.us !== c.them && <><p className="small muted">Set ended early (time limit, different scoring)? End it at {c.us}–{c.them} and start the next one:</p>
      <div className="row"><ConfirmButton className="btn sm" confirmText={`End at ${c.us}–${c.them}?`} onConfirm={() => { appendEvents(m.id, [{ t: "NS", serve: "us" } as any]); setUi({ panel: null }); toast(`${m.scrim ? "Game" : "Set"} ${c.n} ended ${c.us}–${c.them}`); }}>{`End ${m.scrim ? "game" : "set"} · ${names.us} serve next`}</ConfirmButton>
        <ConfirmButton className="btn sm" confirmText={`End at ${c.us}–${c.them}?`} onConfirm={() => { appendEvents(m.id, [{ t: "NS", serve: "them" } as any]); setUi({ panel: null }); toast(`${m.scrim ? "Game" : "Set"} ${c.n} ended ${c.us}–${c.them}`); }}>{`End ${m.scrim ? "game" : "set"} · ${names.them} serve next`}</ConfirmButton></div></>}
  </div>;
}

function LineupFix({ m, c }: { m: Match; c: SetState }) {
  const t = team()!, ps = activePlayers();
  const base = c.lu || c.startLu || t.defLineup?.lu || autoLineup(ps).lu;
  const [lu, setLu] = useState<string[]>([0, 1, 2, 3, 4, 5].map((i) => base[i] || ""));
  const [lib, setLib] = useState<string>(c.lib || t.defLineup?.lib || ps.find((p) => p.pos === "L")?.id || "");
  const [ls, setLs] = useState<string>(c.libSrv || "");
  const opts = (sel: string) => <><option value="">—</option>{ps.map((p) => <option key={p.id} value={p.id}>#{p.num} {p.first} {p.last}</option>)}</>;
  const slot = (i: number) => <label className="field" key={i}><span className="label">Pos {i + 1}{i === 0 ? " · server" : ""}</span><select value={lu[i]} onChange={(e) => { const n = lu.slice(); n[i] = e.target.value; setLu(n); }}>{opts(lu[i])}</select></label>;
  const saveLu = () => {
    if (lu.some((x) => !x)) return toast("Fill all six positions.");
    if (new Set(lu).size !== 6) return toast("Each player can only be in one position.");
    if (lib && lu.includes(lib)) return toast("The libero can't also be in the six.");
    appendEvents(m.id, [{ t: "LU", lu, lib: lib || null, libSrv: ls && lu.includes(ls) ? ls : null } as any]);
    toast("Lineup saved"); setUi({ panel: null });
  };
  return <div className="editor">
    <b>{c.rallies.length ? "Fix who's where on court right now" : `Starting lineup for ${m.scrim ? "game" : "set"} ${c.n}`}</b>
    <div className="rowlab">Front row (at the net)</div><div className="c3">{[3, 2, 1].map(slot)}</div>
    <div className="rowlab">Back row</div><div className="c3">{[4, 5, 0].map(slot)}</div>
    <div className="two">
      <label className="field"><span className="label">Libero</span><select value={lib} onChange={(e) => setLib(e.target.value)}>{opts(lib)}</select></label>
      <label className="field"><span className="label">Libero serves for</span><select value={ls} onChange={(e) => setLs(e.target.value)}><option value="">Nobody</option>{lu.filter(Boolean).map((id) => <option key={id} value={id}>{playerName(id)}</option>)}</select></label>
    </div>
    <p className="small muted">Position 1 is right back, the server. For starting lineups and all six rotations, use the Lineup tab.</p>
    <div className="row"><button className="btn primary" onClick={saveLu}>Save lineup</button><button className="btn" onClick={() => setUi({ panel: null })}>Cancel</button></div>
  </div>;
}

function SubPanel({ m, c }: { m: Match; c: SetState }) {
  const t = team()!, lim = t.settings.subLimit;
  const [out, setOut] = useState<string | null>(null);
  const on = new Set(c.lu!.concat(c.lib ? [c.lib] : []));
  const bench = activePlayers().filter((p) => !on.has(p.id));
  return <div className="editor">
    <b>Substitution</b><span className="small muted">Subs this set: {c.subs}{lim ? " of " + lim : ""}{lim && c.subs >= lim ? " · limit reached" : ""}. You can also drag a bench player onto a court player.</span>
    <div className="label">Coming out</div><div className="pick">{c.lu!.map((id) => <button key={id} aria-pressed={out === id} onClick={() => setOut(id)}>{playerName(id)}</button>)}</div>
    <div className="label">Going in</div><div className="pick">{bench.length ? bench.map((p) => <button key={p.id} disabled={!out} onClick={() => { appendEvents(m.id, [{ t: "SUB", out, in: p.id } as any]); if (ui.sel === out) setUi({ sel: null }); toast(`${playerName(p.id)} in for ${playerName(out)}`); setUi({ panel: null }); }}>{playerName(p.id)}</button>) : <span className="empty">No one on the bench.</span>}</div>
    <div className="row"><button className="btn" onClick={() => setUi({ panel: null })}>Cancel</button></div>
  </div>;
}

function TagPanel({ m, R }: { m: Match; R: Replay }) {
  const [note, setNote] = useState("");
  const add = (n: string) => { appendEvents(m.id, [{ t: "TAG", note: n.slice(0, 140), ...(ui.sel ? { p: ui.sel } : {}) } as any]); toast("Tagged: " + n); };
  return <div className="editor">
    <b>Film tag{ui.sel ? " · " + playerName(ui.sel) : ""}</b>
    <span className="small muted">Tap a label to bookmark this moment{ui.sel ? " for the selected player" : ""}. Find them on video from Stats → One match → Film.</span>
    <div className="pick">{TAGS.map((x) => <button key={x} onClick={() => add(x)}>{x}</button>)}</div>
    <div className="row"><input className="input grow" style={{ flexBasis: 180 }} placeholder="Your note" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { add(note.trim()); setNote(""); } }} /><button className="btn primary sm" disabled={!note.trim()} onClick={() => { add(note.trim()); setNote(""); }}>Save tag</button></div>
    <div className="row"><span className="small muted grow">{m.filmStart ? `Video clock started ${new Date(m.filmStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Tag times count from the first entry. Tap when you press record so times match your video."}</span><button className="btn sm" onClick={() => { patch("matches", m.id, { filmStart: Date.now() }); toast("Video clock started"); }}>Video started now</button><button className="btn sm" onClick={() => setUi({ panel: null })}>Close</button></div>
  </div>;
}

function TeamsPanel({ m }: { m: Match }) {
  const S = m.scrim!;
  const [s, setS] = useState<SplitState>({ aName: S.a.name, bName: S.b.name, a: S.a.ids.slice(), b: S.b.ids.slice(), out: activePlayers().map((p) => p.id).filter((id) => !S.a.ids.includes(id) && !S.b.ids.includes(id)) });
  return <div className="editor">
    <b>Edit teams</b>
    <SplitEditor s={s} onChange={setS} />
    <div className="row"><button className="btn primary" onClick={() => {
      if (!s.a.length || !s.b.length) return toast("Each team needs at least one player.");
      patch("matches", m.id, { scrim: { a: { name: s.aName, ids: s.a }, b: { name: s.bName, ids: s.b }, to: S.to }, opp: `Scrimmage: ${s.aName} vs ${s.bName}` });
      toast("Teams saved"); setUi({ panel: null });
    }}>Save teams</button><button className="btn" onClick={() => setUi({ panel: null })}>Cancel</button><span className="small muted">Stats already recorded stay with the team the player was on.</span></div>
  </div>;
}

/* ---------- players ---------- */
function PlayerButton({ id, cls = "", server, drag, drop }: { id: string; cls?: string; server?: boolean; drag?: boolean; drop?: boolean }) {
  const p = player(id);
  if (!p) return <button className="pl" disabled><span className="n">?</span><span className="nm">Removed</span></button>;
  const isLib = cls.includes("lib");
  return <button className={"pl " + cls} aria-pressed={ui.sel === id} onClick={() => setUi({ sel: ui.sel === id ? null : id })}
    {...(drag ? { "data-drag": "bench", "data-drag-id": id } : {})} {...(drop ? { "data-drop": "court", "data-drop-id": id } : {})}>
    {server && <span className="srv"><Ball /></span>}{isLib && <span className="lb">L</span>}
    <span className="n">{p.num}</span><span className="nm">{p.first || p.last}</span><span className="ps">{p.pos}</span>
  </button>;
}

function CourtPlayers({ c }: { c: SetState }) {
  const srv = serverOf(c), ps = activePlayers();
  if (!ps.length) return <p className="empty">No players yet. Add them on the Team tab.</p>;
  if (!c.lu) return <div className="players">{ps.map((p) => <PlayerButton key={p.id} id={p.id} />)}</div>;
  const L = c.lu, libServing = !!(srv && c.lib && srv === c.lib), on = new Set(L.concat(c.lib ? [c.lib] : []));
  const bench = ps.filter((p) => !on.has(p.id));
  return <>
    <div className="courtgrid" aria-label="On court">
      <div className="netbar"><span>NET</span></div>
      <div className="rowlab">Front row</div>
      <div className="c3">{[L[3], L[2], L[1]].map((id) => <PlayerButton key={id} id={id} drop />)}</div>
      <div className="rowlab">Back row</div>
      <div className="c3"><PlayerButton id={L[4]} drop /><PlayerButton id={L[5]} drop />{libServing ? <PlayerButton id={c.lib!} cls="lib" server /> : <PlayerButton id={L[0]} server={srv === L[0]} drop />}</div>
    </div>
    <div className="row between"><span className="label">{c.lib ? "Libero & bench" : "Bench"}</span><span className="small muted">Drag a bench player onto a court player to sub</span></div>
    <div className="players">
      {c.lib && !libServing && <PlayerButton id={c.lib} cls="lib" />}
      {libServing && <PlayerButton id={L[0]} cls="bench" />}
      {bench.map((p) => <PlayerButton key={p.id} id={p.id} cls="bench" drag />)}
    </div>
    {libServing && <p className="small muted">{playerName(c.lib)} (libero) is serving for {playerName(L[0])}.</p>}
  </>;
}

function ScrimPlayers({ m }: { m: Match }) {
  const S = m.scrim!;
  const col = (k: "a" | "b") => <div className="card" style={{ padding: 10, background: k === "a" ? "var(--us-soft)" : "var(--them-soft)" }}>
    <div className="row between"><b style={{ fontFamily: "var(--display)", fontSize: 18, letterSpacing: ".04em", textTransform: "uppercase", color: k === "a" ? "var(--us)" : "var(--them)" }}>{S[k].name}</b><span className="small muted">{S[k].ids.length} players</span></div>
    <div className="players" style={{ marginTop: 6 }}>{S[k].ids.filter((id) => player(id)).map((id) => <PlayerButton key={id} id={id} cls={k} />)}</div>
  </div>;
  return <div className="grid2">{col("a")}{col("b")}</div>;
}

function PlannedSub({ c, m }: { c: SetState; m: Match }) {
  const plan = (team()!.subPlan || []).filter((x) => x.rot === c.rot && c.lu && c.lu.includes(x.out) && !c.lu.includes(x.in) && x.in !== c.lib);
  if (m.scrim || !plan.length) return null;
  const lim = team()!.settings.subLimit;
  return <>{plan.map((x) => <div key={x.id} className="banner accent"><p><b>Planned sub, rotation {c.rot}:</b> {playerName(x.in)} in for {playerName(x.out)}.</p>
    <button className="btn sm primary" disabled={!!lim && c.subs >= lim} onClick={() => { appendEvents(m.id, [{ t: "SUB", out: x.out, in: x.in } as any]); toast(`${playerName(x.in)} in for ${playerName(x.out)}`); }}>Make sub</button></div>)}</>;
}

function Hint({ c, m }: { c: SetState; m: Match }) {
  const srv = serverOf(c), job = jobOf(m);
  if (job === "stats") return <div className="hint job-note"><b>Stats only.</b> What you enter here counts for players but never changes the score; another coach keeps score. {ui.sel ? <>Recording for <b>{playerName(ui.sel, "full")}</b>.</> : "Tap a player, then what they did."} <button className="linkish" onClick={() => setUi({ panel: "job" })}>Change</button>
    <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={ui.prevRally} onChange={(e) => setUi({ prevRally: e.target.checked })} /> Next entry belongs to the rally that just ended{c.rallies.length ? ` (${c.rallies[c.rallies.length - 1].w === "us" ? "our" : "their"} point)` : ""}</label></div>;
  if (job === "score") return <p className="hint job-note"><b>Score only.</b> Tap who won each rally; other coaches add the player stats. <button className="linkish" onClick={() => setUi({ panel: "job" })}>Change</button></p>;
  if (ui.sel) return <p className="hint">Recording for <b>{playerName(ui.sel, "full")}</b>{m.scrim ? ` (${m.scrim.b.ids.includes(ui.sel) ? m.scrim.b.name : m.scrim.a.name})` : ""}. Tap again to deselect.</p>;
  if (m.scrim) return <p className="hint">Tap a player from either team, then what they did. Points go to the right team automatically.</p>;
  if (srv) return <p className="hint">Tap a player, then what they did. Serve buttons go to <b>{playerName(srv)}</b>{srv === c.lib ? " (libero)" : ""}, who's serving. <span className="kbd-tip muted">Laptop? Press <kbd>?</kbd> for keyboard entry.</span></p>;
  return <p className="hint">Tap a player, then what they did. Misc, Transition and Opponent work without a player. <span className="kbd-tip muted">Laptop? Press <kbd>?</kbd> for keyboard entry.</span></p>;
}

/* ---------- pad ---------- */
function Pad({ m, c, setA, mA, record }: { m: Match; c: SetState; setA: ReturnType<typeof aggregate>; mA: ReturnType<typeof aggregate>; record: (k: ActionCode) => boolean | void }) {
  const scr = m.scrim, sel = ui.sel, srv = serverOf(c);
  const selSide = scr && sel ? (scr.b.ids.includes(sel) ? "b" : "a") : null;
  const job = jobOf(m);
  const groups: [string, ActionCode[]][] = scr ? GROUPS.filter((g) => g[0] !== "Opponent").map(([g, ks]) => [g, ks.filter((k) => k !== "REF")] as [string, ActionCode[]]).concat([["Points", ["UP", "TP"]]]) : jobGroups(m);
  const srvSrc = sel ? mA.ps[sel] : setA.T, srvN = sel ? mA.srv[sel]?.n || 0 : setA.psc.n;
  return <div className="pad">{groups.map(([g, ks]) => <div className="grp" key={g}><div className="label">{g}</div><div className="acts">
    {ks.map((k) => {
      const a: any = ACTIONS[k];
      let label = a.label, cls = a.point || "";
      if (scr && k === "UP") label = "+1 " + scr.a.name;
      if (scr && k === "TP") label = "+1 " + scr.b.name;
      if (selSide === "b" && !a.team && cls) cls = cls === "us" ? "them" : "us";
      if (job === "stats") cls = "";
      const on = !!sel || a.team || (!scr && (a.optionalPlayer || (a.serve && srv)));
      return <button key={k} className={"act " + cls} aria-disabled={!on} onClick={() => record(k)} aria-label={label}>{a.short ? <><span className="lbl-long">{label}</span><span className="lbl-short">{a.short}</span></> : label}</button>;
    })}
    {g === "Serve" && <span className="auto" title="Every serve counts, even ones nobody tapped: a rally on our serve that wasn't an ace or an error was a serve in">Serves {srvSrc ? serves(srvSrc, srvN) : srvN}<br /><small>{sel ? "this player, match" : "team, this set"}</small></span>}
  </div></div>)}</div>;
}

/* ---------- side cards ---------- */
function SetSummary({ c, setA }: { c: SetState; setA: ReturnType<typeof aggregate> }) {
  const T = setA.T;
  return <Card title={`Set ${c.n} so far`}><div className="mini">
    <div><div className="label">Hitting</div><div className="v">{fmtHit(hitting(T))}</div></div>
    <div><div className="label">Side-out</div><div className="v">{fmtPct(ratio(setA.so.w, setA.so.n))}</div></div>
    <div><div className="label">Pass avg</div><div className="v">{fmtAvg(passAvg(T))}</div></div>
    <div><div className="label">Serve errors</div><div className="v">{serveErrors(T)}</div><div className="small muted">{T.SEN} net · {T.SEO + T.SE} out</div></div>
  </div></Card>;
}

function ScrimSummary({ m, c }: { m: Match; c: SetState }) {
  const S = m.scrim!, setA = aggregate([c]);
  const so = (k: "a" | "b") => { const r = c.rallies.filter((x) => x.server === (k === "a" ? "them" : "us")); return fmtPct(ratio(r.filter((x) => x.w === (k === "a" ? "us" : "them")).length, r.length)); };
  const rows: [string, (k: "a" | "b") => any][] = [["Hitting %", (k) => fmtHit(hitting(setA.side[k]))], ["Kills", (k) => setA.side[k].K], ["Aces", (k) => setA.side[k].SA], ["Serve errors", (k) => serveErrors(setA.side[k])], ["Pass avg", (k) => fmtAvg(passAvg(setA.side[k]))], ["Digs", (k) => setA.side[k].D], ["Blocks", (k) => blocks(setA.side[k])], ["Side-out", so]];
  return <Card title={`Game ${c.n} so far`}><div className="tbl"><table><thead><tr><th className="l" /><th style={{ color: "var(--us)" }}>{S.a.name}</th><th style={{ color: "var(--them)" }}>{S.b.name}</th></tr></thead>
    <tbody>{rows.map(([l, f]) => <tr key={l}><td className="l">{l}</td><td>{f("a")}</td><td>{f("b")}</td></tr>)}</tbody></table></div></Card>;
}

function FlagsCard({ R, m }: { R: Replay; m: Match }) {
  const t = team()!;
  const fl = flags(R, { us: t.name, them: m.opp, subLimit: t.settings.subLimit, playerIds: activePlayers().map((p) => p.id), short: (id) => playerName(id) });
  return <Card title="Coach flags">{fl.length ? <ul className="flags">{fl.slice(0, 6).map((f, i) => <li key={i} className={"flag " + f.lvl}><span><b>{f.title}</b> {f.detail}</span></li>)}</ul> : <p className="empty">Nothing stands out yet. Flags appear as patterns build.</p>}</Card>;
}

export function logText(l: LogEntry, m: Match, teamName: string): string {
  const names = sideNames(m, teamName);
  switch (l.kind) {
    case "stat": return (l.p ? playerName(l.p) + " · " : "") + (ACTIONS as any)[l.t].long + (l.op ? " · #" + l.op : "");
    case "set": return `${m.scrim ? "Game" : "Set"} ${l.set} started · ${names[l.serve]} serving`;
    case "rot": return "Rotation set to " + l.v;
    case "srv": return "Serve changed to " + names[l.v];
    case "to": return "Timeout · " + names[l.v];
    case "adj": return `Score corrected to ${l.us}–${l.them}`;
    case "lu": return "Lineup updated";
    case "sub": return `Sub: ${playerName(l.in)} in for ${playerName(l.out)}`;
    case "tag": return "Tag: " + l.note + (l.p ? " (" + playerName(l.p) + ")" : "");
  }
}

function RecentCard({ m, R }: { m: Match; R: Replay }) {
  const t = team()!, [edit, setEdit] = useState<string | null>(null);
  return <Card title="Recent" actions={<span className="small muted">Tap a play to fix the player</span>}><ul className="log">{R.log.slice(-10).reverse().map((l) => {
    const canEdit = l.kind === "stat" && !!l.p && isMine(l.id) && !m.scrim;
    return <li key={l.id} className={edit === l.id ? "editing" : ""}>
      {canEdit ? <button className="log-edit" onClick={() => setEdit(edit === l.id ? null : l.id)} aria-expanded={edit === l.id}>{logText(l, m, t.name)}</button> : <span className={l.kind === "stat" ? "" : "ctl"}>{logText(l, m, t.name)}</span>}
      <span className={"sc " + (l.kind === "stat" && l.w ? l.w : "")}>{l.kind === "stat" && l.w ? `${l.us}–${l.them}` : ""}</span>
      <DeleteX onDelete={() => { deleteEvent(m.id, l.id); toast("Entry deleted"); }} />
      {edit === l.id && l.kind === "stat" && <div className="log-fix"><span className="small muted">Who actually did it?</span>
        <div className="pick">{activePlayers().map((p) => <button key={p.id} aria-pressed={p.id === l.p} onClick={() => { patchEvent(m.id, l.id, { p: p.id }); setEdit(null); toast(`Changed to ${playerName(p.id)}`); }}>#{p.num} {p.first}</button>)}</div></div>}
    </li>; })}</ul></Card>;
}

function DeleteX({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return <button className="x" title={armed ? "Tap again to delete" : "Delete"} aria-label="Delete this entry" onClick={() => { if (armed) onDelete(); else { setArmed(true); setTimeout(() => setArmed(false), 2500); } }}>{armed ? "?" : "✕"}</button>;
}

/* ---------- where did it land ---------- */
function FollowSheet({ m }: { m: Match }) {
  const f = ui.follow;
  if (!f) return null;
  const e: any = eventsOf(m.id).find((x) => x.id === f.id);
  if (!e) return null;
  const done = () => setUi({ follow: null });
  const setOpp = (op: string) => {
    patchEvent(m.id, f.id, { op });
    if (!m.oppPlayers.includes(op)) patch("matches", m.id, { oppPlayers: m.oppPlayers.concat(op) });
    if (!f.half || e.x != null) done();
  };
  return <div className="sheet"><div className="in">
    <div className="row between"><b>{f.label}</b><div className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => { const u = undoLast(m.id); done(); toast(u ? "Undid " + describe(u as any) : "Nothing of yours to undo."); }}>Undo</button><button className="btn sm" onClick={done}>{e.x != null || e.op ? "Done" : "Skip"}</button></div></div>
    {f.askOpp && <OppPicker m={m} value={e.op} onPick={setOpp} />}
    {f.half && <>
      <div className="label">Where did it land? Tap the court{f.half === "them" ? " (their side)" : " (our side)"}</div>
      <CourtSvg half={f.half} mark={e.x != null ? [e.x, e.y] : null} label="Tap where the ball landed" className="courtsvg" onTap={(x, y) => {
        patchEvent(m.id, f.id, { x, y });
        const z = zoneOf(x, y); toast(z === "out" ? "Marked out of bounds" : "Marked zone " + z);
        if (!f.askOpp || e.op) done();
      }} />
    </>}
  </div></div>;
}

function OppPicker({ m, value, onPick }: { m: Match; value?: string; onPick: (n: string) => void }) {
  const [v, setV] = useState("");
  const add = () => { const n = v.replace(/[^0-9A-Za-z]/g, "").slice(0, 3); if (n) { onPick(n); setV(""); } };
  return <><div className="label">Their player</div><div className="ochips">
    {m.oppPlayers.map((n) => <button key={n} aria-pressed={value === n} onClick={() => onPick(n)}>{n}</button>)}
    <input className="input" style={{ width: 80 }} inputMode="numeric" placeholder="Add #" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Add their jersey number" />
    <button className="btn sm" onClick={add}>Add</button>
  </div></>;
}

export { isMine };

/* ---------- phone: action sheet for the selected player ---------- */
const SHEET_GROUPS: [string, ActionCode[]][] = [["Attack", ["K", "KT", "TA", "AE", "AB"]], ["Pass", ["P3", "P2", "P1", "P0"]], ["Serve", ["SA", "SI", "SEN", "SEO"]], ["Defense", ["D", "DE"]], ["Set", ["AST", "SATT", "BHE"]], ["Block", ["BS", "BA", "BE"]], ["Errors", ["CE", "EE", "PE"]]];
function ActionSheet({ m, c, record }: { m: Match; c: SetState; record: (k: ActionCode) => boolean | void }) {
  const sel = ui.sel; if (!sel || !player(sel)) return null;
  const p = player(sel)!, scr = m.scrim, flip = !!(scr && scr.b.ids.includes(sel));
  const pos = (p.pos || "").toUpperCase();
  // Put the most likely actions first for the player's position.
  const first = pos.startsWith("S") && pos !== "SUB" ? "Set" : /^L|DS/.test(pos) ? "Pass" : null;
  const job = jobOf(m); if (job === "score") return null;
  const PAD_NAME: Record<string, string> = { Attack: "Hitting", Pass: "Serve receive", Serve: "Serve", Defense: "Defense", Set: "Setting", Block: "Block", Errors: "Misc" };
  const allowed = new Set(jobGroups(m).map((g) => g[0]));
  const mine = SHEET_GROUPS.filter((g) => job !== "stats" || allowed.has(PAD_NAME[g[0]]));
  if (!mine.length) return null;
  const groups = first && mine.some((g) => g[0] === first) ? [mine.find((g) => g[0] === first)!, ...mine.filter((g) => g[0] !== first)] : mine;
  const tap = (k: ActionCode) => { if (record(k) !== false) setUi({ sel: null }); };
  return <div className="actsheet" role="dialog" aria-label={"Actions for " + playerName(sel)}>
    <div className="as-head"><b>#{p.num} {p.first}</b><span className="small muted">{p.pos}{serverOf(c) === sel ? " · serving" : ""}</span><button className="btn sm ghost" onClick={() => setUi({ sel: null })}>Close</button></div>
    <div className="as-grid">{groups.map(([g, ks]) => <div className="as-row" key={g}><span className="as-l">{g}</span><div className="as-b">{ks.map((k) => {
      const a: any = ACTIONS[k]; let cls = job === "stats" ? "" : a.point || ""; if (flip && cls) cls = cls === "us" ? "them" : "us";
      const label = ({ CE: "Comms", PE: "Position", TA: "Att." } as Record<string, string>)[k] || a.label.replace(/^Error · /, "Err ");
      return <button key={k} className={"act " + cls} onClick={() => tap(k)}>{label}</button>;
    })}</div></div>)}</div>
  </div>;
}

/* ---------- keyboard help ---------- */
function KeyHelp({ onClose }: { onClose: () => void }) {
  return <div className="keyhelp" role="dialog" aria-label="Keyboard shortcuts">
    <div className="row between"><b>Keyboard entry</b><button className="btn sm ghost" onClick={onClose}>Close</button></div>
    <p className="small muted">Type a jersey number, then a letter. Two digits in a row make one number. Shift for the opponent.</p>
    <div className="kh-grid">
      {KEYMAP.map(([k, , l]) => <div key={k}><kbd>{k === k.toUpperCase() && /[A-Z]/.test(k) ? "⇧" + k : k}</kbd><span>{l}</span></div>)}
      <div><kbd>p</kbd><kbd>3</kbd>…<kbd>0</kbd><span>Pass grade</span></div>
      <div><kbd>⌫</kbd><span>Undo</span></div><div><kbd>Esc</kbd><span>Clear player</span></div><div><kbd>?</kbd><span>Show or hide this</span></div>
    </div>
  </div>;
}

/* ---------- my job (several coaches on one match) ---------- */
function JobPanel({ m }: { m: Match }) {
  const job = state.prefs.job || "all", picked = state.prefs.jobGroups?.length ? state.prefs.jobGroups : STAT_GROUP_NAMES;
  const set = (p: Parameters<typeof setPrefs>[0]) => { setPrefs(p); stampLog(m.id); };
  const toggle = (g: string) => { const next = picked.includes(g) ? picked.filter((x) => x !== g) : picked.concat(g); set({ jobGroups: next.length ? next : [g] }); };
  return <div className="editor">
    <b>My job on this device</b>
    <span className="small muted">When several coaches track the same match, split the work. Only one device should keep score.</span>
    <div className="pick">
      {([["all", "Everything", "stats and score"], ["score", "Score only", "who won each rally"], ["stats", "Stats only", "never changes the score"]] as const).map(([k, l, d]) =>
        <button key={k} aria-pressed={job === k} onClick={() => set({ job: k })}>{l}<small style={{ display: "block", fontWeight: 400 }}>{d}</small></button>)}
    </div>
    <Crew m={m} />
    {job === "stats" && <><span className="label">What I'm tracking</span>
      <div className="pick">{STAT_GROUP_NAMES.map((g) => <button key={g} aria-pressed={picked.includes(g)} onClick={() => toggle(g)}>{g}</button>)}</div>
      <span className="small muted">Example: the head coach keeps score and hitting; an assistant tracks serve receive, serving and digs.</span></>}
    <div className="row"><button className="btn sm" onClick={() => setUi({ panel: null })}>Done</button></div>
  </div>;
}

/* ---------- other coaches on this match ---------- */
const JOB_LABEL = { all: "everything", score: "score only", stats: "stats only" } as const;
function crewOf(m: Match) {
  const now = Date.now();
  return logsOf(m.id).filter((l) => l.device !== DEVICE && (l.seen || l.events[l.events.length - 1]?.ts || 0) > now - 20 * 60000)
    .map((l) => ({ by: l.by ? l.by.split("@")[0] : "Another device", job: (l.job || "all") as keyof typeof JOB_LABEL, groups: l.groups || [], n: l.events.length }));
}
function Crew({ m }: { m: Match }) {
  const crew = crewOf(m);
  if (!crew.length) return <span className="small muted">No other coaches have tracked this match in the last 20 minutes.</span>;
  return <div className="small"><span className="label">Also on this match</span>
    <ul className="crew">{crew.map((x, i) => <li key={i}><b>{x.by}</b> · {JOB_LABEL[x.job]}{x.job === "stats" && x.groups.length ? ` (${x.groups.join(", ").toLowerCase()})` : ""}</li>)}</ul></div>;
}
function CrewWarning({ m }: { m: Match }) {
  if (m.kind !== "match" || m.scrim) return null;
  const me = jobOf(m), crew = crewOf(m);
  if (!crew.length) return null;
  const scorers = crew.filter((x) => x.job !== "stats");
  const clash = me !== "stats" && scorers.length > 0;
  return <div className={"banner " + (clash ? "warn" : "")}><p>{clash
    ? <><b>Two devices are keeping score.</b> {scorers.map((x) => x.by).join(", ")} is also on {JOB_LABEL[scorers[0].job]}. Points will count twice; one of you should switch to stats only.</>
    : <>Tracking with {crew.map((x) => `${x.by} (${JOB_LABEL[x.job]})`).join(", ")}.</>}</p>
    <button className="btn sm" onClick={() => setUi({ panel: "job" })}>My job</button></div>;
}

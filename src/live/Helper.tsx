/** Stats helper (FloorCall Live, #/h/CODE): a parent tracks one match from a link the coach sent. No account.
 *  Plays are kept on the phone first and saved in the background, so a weak gym signal never loses a point. */
import { useEffect, useMemo, useRef, useState } from "react";
import { cloudAvailable, rpc, tooMany } from "../cloud/client";
import { replayOf, LPlayer, LMatch } from "./data";
import { useWakeLock } from "../ui/wakeLock";
import { tr } from "../lib/i18n";

type Mode = "points" | "basic" | "stats";
interface HelperData { mode: Mode; name: string; team: { name: string; color?: string } | null; match: LMatch | null; logs: { device: string; events: any[] }[]; players: LPlayer[]; ended?: string }
interface Mine { dev: string; events: any[]; dirty: boolean }

const KEY = (c: string) => "fc-helper-" + c;
const rid = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
function loadMine(code: string): Mine {
  try { const m = JSON.parse(localStorage.getItem(KEY(code)) || "null"); if (m && Array.isArray(m.events) && typeof m.dev === "string") return m; } catch { /* private mode */ }
  return { dev: rid(12), events: [], dirty: false };
}
const keep = (code: string, m: Mine) => { try { localStorage.setItem(KEY(code), JSON.stringify(m)); } catch { /* private mode: still works until the tab closes */ } };

/** Player actions, in the order a parent sees them happen. */
const PLAYER_ACTIONS: [string, string, boolean?][] = [["K", "Kill", true], ["AE", "Hit error"], ["TA", "Hit (in play)"], ["SA", "Ace", true], ["SE", "Serve error"], ["BS", "Block", true], ["BA", "Block assist", true], ["D", "Dig"], ["AST", "Assist"]];
const THEIR: [string, string][] = [["OE", "Their error"], ["OK", "Their kill"], ["OA", "Their ace"]];
const LABEL: Record<string, string> = { UP: "Point us", TP: "Point them", NS: "New set", OE: "Their error", OK: "Their kill", OA: "Their ace", ...Object.fromEntries(PLAYER_ACTIONS.map(([k, l]) => [k, l])) };

export function HelperRoute({ code, Shell }: { code: string; Shell: (p: { team?: string; children: any }) => any }) {
  const [d, setD] = useState<HelperData | null>(null), [err, setErr] = useState(""), [mine, setMine] = useState<Mine>(() => loadMine(code));
  const [save, setSave] = useState<"saved" | "saving" | "waiting" | "stopped">("saved"), [stopMsg, setStopMsg] = useState(""), [sel, setSel] = useState<string | null>(null);
  const mineRef = useRef(mine); mineRef.current = mine;
  const pushing = useRef(false), again = useRef(false);

  const load = async () => {
    try {
      const r: HelperData | null = await rpc("helper_open", { c: code }, true);
      if (!r) { setErr(tr("This helper link isn't active. Ask the coach for a new one.")); return; }
      if (r.ended) { setErr(tr("This helper link has expired. Ask the coach for a new one.")); return; }
      setD(r); setErr("");
    } catch (e) { setErr((x) => (tooMany(e) ? tr("Too many tries. Wait a few minutes.") : x || tr("Reconnecting…"))); }
  };
  useEffect(() => {
    if (!cloudAvailable()) { setErr(tr("This site isn't connected yet.")); return; }
    load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 6000);
    return () => clearInterval(t);
  }, [code]);

  /** Send the whole list of my plays; if more come in while sending, send again after. */
  const push = async () => {
    if (pushing.current) { again.current = true; return; }
    pushing.current = true; setSave("saving");
    try {
      do {
        again.current = false;
        const m = mineRef.current;
        await rpc("helper_push", { c: code, dev: m.dev, ev: m.events }, true);
        if (mineRef.current.events === m.events) { const next = { ...m, dirty: false }; mineRef.current = next; keep(code, next); setMine(next); }
      } while (again.current);
      setSave("saved");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/ended this match|expired|isn't active|deleted this match/.test(msg)) { setSave("stopped"); setStopMsg(msg.replace(/^.*?:\s*/, "")); }
      else { setSave("waiting"); setTimeout(() => { pushing.current = false; push(); }, 5000); return; }
    }
    pushing.current = false;
  };
  useEffect(() => { if (mine.dirty) push(); const on = () => push(); addEventListener("online", on); return () => removeEventListener("online", on); }, []);

  const add = (e: Record<string, unknown>) => {
    if (save === "stopped") return;
    const last = mineRef.current.events[mineRef.current.events.length - 1]?.ts || 0;
    const ev = { id: "h" + rid(10), ts: Math.max(Date.now(), last + 1), ...e };
    const next = { ...mineRef.current, events: mineRef.current.events.concat(ev), dirty: true }; mineRef.current = next; keep(code, next); setMine(next);
    if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* not allowed */ }
    push();
  };
  const undo = () => {
    if (!mineRef.current.events.length || save === "stopped") return;
    const next = { ...mineRef.current, events: mineRef.current.events.slice(0, -1), dirty: true }; mineRef.current = next; keep(code, next); setMine(next); push();
  };

  const live = !!d?.match && d.match.status === "live" && save !== "stopped";
  useWakeLock(live);
  useEffect(() => { if (d?.team) document.title = `${tr("Stats helper")} · ${d.team.name} vs ${d.match?.opp || ""}`; }, [d?.team?.name, d?.match?.opp]);

  const R = useMemo(() => {
    if (!d?.match) return null;
    const others = d.logs.filter((l) => l.device !== "helper-" + mine.dev).map((l) => l.events);
    return replayOf(d.match, [...others, mine.events]);
  }, [d, mine.events]);

  if (!d) return <Shell><p className="lv-empty">{err || tr("Loading…")}</p></Shell>;
  if (!d.match || !R) return <Shell team={d.team?.name}><p className="lv-empty">{tr("The coach deleted this match.")}</p></Shell>;
  const us = d.team?.name || tr("Us"), them = d.match.opp || tr("Them"), c = R.cur, mode = d.mode;
  const P = new Map(d.players.map((p) => [p.id, p]));
  const who = (p: LPlayer) => `#${p.num}${p.first ? " " + p.first : ""}${p.last ? " " + p.last + "." : ""}`;
  const done = R.matchOver || d.match.status === "done" || save === "stopped";
  const needSet = mode !== "stats" && !done && (!c || c.over);
  const last = mine.events.slice(-4).reverse();

  return <Shell team={us}>
    <div className="hp">
      <div className="hp-score" aria-live="polite">
        <div><span>{us}</span><b className="num">{c ? c.us : 0}</b></div>
        <div className="hp-mid"><small>{c ? `${tr("Set")} ${c.n}` : tr("Not started")}</small><b className="num">{R.wonUs}–{R.wonThem}</b><small>{tr("sets")}</small></div>
        <div><span>{them}</span><b className="num">{c ? c.them : 0}</b></div>
      </div>
      {c && !c.over && <p className="hp-serve">{c.serve === "us" ? `${us} ${tr("serving")}` : `${them} ${tr("serving")}`}</p>}

      <p className={"hp-save " + save} role="status">{save === "stopped" ? stopMsg || tr("This match is closed.") : save === "waiting" ? tr("No signal. Your plays are kept on this phone and will send when you're back online.") : save === "saving" ? tr("Saving…") : mine.events.length ? tr("All plays saved.") : `${tr("You're tracking for")} ${us}${d.name ? ` · ${d.name}` : ""}.`}</p>

      {done ? <div className="lv-card hp-done"><b>{R.matchOver ? `${tr("Match over")}: ${R.wonUs > R.wonThem ? us : them} ${Math.max(R.wonUs, R.wonThem)}–${Math.min(R.wonUs, R.wonThem)}.` : tr("This match is closed.")}</b><p>{tr("Thanks for tracking! The coach has every play. You can close this page.")}</p></div>
        : needSet ? <div className="lv-card hp-set"><b>{c ? `${tr("Set")} ${c.n} ${tr("over")}, ${c.us}–${c.them}. ${tr("Who serves first in set")} ${c.n + 1}?` : tr("Who serves first?")}</b>
            <div className="hp-two"><button className="hp-big us" onClick={() => add({ t: "NS", serve: "us" })}>{us}</button><button className="hp-big them" onClick={() => add({ t: "NS", serve: "them" })}>{them}</button></div></div>
        : <>
          {mode === "points" && <div className="hp-two"><button className="hp-big us" onClick={() => add({ t: "UP" })}>{tr("Point")}<span>{us}</span></button><button className="hp-big them" onClick={() => add({ t: "TP" })}>{tr("Point")}<span>{them}</span></button></div>}
          {mode !== "points" && <>
            <p className="hp-hint">{mode === "stats" ? tr("Tap a player, then what they did. The coach keeps the score.") : tr("Tap a player, then what they did. Points without a player go below.")}</p>
            <div className="hp-players" role="group" aria-label={tr("Players")}>{d.players.map((p) => <button key={p.id} aria-pressed={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)}><b className="num">{p.num}</b><span>{p.first || " "}</span></button>)}</div>
            <div className="hp-acts" role="group" aria-label={tr("What they did")}>{PLAYER_ACTIONS.map(([k, l, good]) => <button key={k} className={good ? "good" : k === "AE" || k === "SE" ? "bad" : ""} disabled={!sel} onClick={() => { add({ t: k, p: sel }); setSel(null); }}>{tr(l)}</button>)}</div>
            {!sel && <p className="hp-hint small">{tr("Pick a player first.")}</p>}
            {mode === "basic" && <div className="hp-team"><span>{tr("No player:")}</span>{THEIR.map(([k, l]) => <button key={k} onClick={() => add({ t: k })}>{tr(l)}</button>)}<button onClick={() => add({ t: "UP" })}>{tr("Our point (other)")}</button><button onClick={() => add({ t: "TP" })}>{tr("Their point (other)")}</button></div>}
          </>}
        </>}

      {!done && <div className="hp-foot">
        <button className="btn" disabled={!mine.events.length} onClick={undo}>{tr("Undo")}{mine.events.length ? `: ${playLine(mine.events[mine.events.length - 1], P, who, us, them)}` : ""}</button>
      </div>}
      {last.length > 0 && <ul className="hp-log" aria-label={tr("Your last plays")}>{last.map((e) => <li key={e.id}>{playLine(e, P, who, us, them)}</li>)}</ul>}
      <p className="hp-note">{tr("Only one phone should keep score. If the coach is also tapping points, tell them you've got it.")}</p>
    </div>
  </Shell>;
}

function playLine(e: any, P: Map<string, LPlayer>, who: (p: LPlayer) => string, us: string, them: string) {
  if (e.t === "UP" || e.t === "TP") return `${tr("Point")}: ${e.t === "UP" ? us : them}`;
  const p = e.p ? P.get(e.p) : null, l = tr(LABEL[e.t] || e.t);
  if (e.t === "NS") return `${l}: ${e.serve === "us" ? tr("we serve") : tr("they serve")}`;
  return p ? `${who(p)}: ${l}` : l;
}

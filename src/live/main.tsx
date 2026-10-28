/** Benchboard Live: the public site for families and fans. Separate from the coaching app: no accounts, nothing to edit.
 *   #/t/CODE            team hub (season link)       #/t/CODE/m/MATCH  a game from the team hub
 *   #/t/CODE/p/PLAYER   a player's season            #/g/CODE          a single game link
 *   #/                  enter a code from the coach */
import "../styles/app.css";
import "./live.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { cloudAvailable, rpc } from "../cloud/client";
import { applyTheme } from "../app/theme";
import { useWakeLock } from "../ui/wakeLock";
import { Game, replayOf, useSeason, useWatch } from "./data";
import { GameView } from "./GameView";
import { TeamHub } from "./TeamHub";

const parse = () => (location.hash.replace(/^#\/?/, "").split("/").filter(Boolean));
function useRoute() { const [r, setR] = useState(parse()); useEffect(() => { const f = () => { setR(parse()); window.scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []); return r; }
const freshText = (got: number, err: string) => err ? err : !got ? "" : Date.now() - got < 15000 ? "Updated just now" : `Updated ${Math.round((Date.now() - got) / 1000)}s ago`;
function useTick(ms = 1000) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]); }

function Shell({ team, children, home }: { team?: string; children: any; home?: string }) {
  return <div className="lv">
    <header className="lv-top"><a className="lv-brand" href={home || "#/"} aria-label="Benchboard Live home"><i aria-hidden="true" /><b>Benchboard</b><span>Live</span></a>{team && <span className="lv-top-team">{team}</span>}</header>
    <main className="lv-main">{children}</main>
    <footer className="lv-foot">Stats recorded by the team's coaches with Benchboard · <a href="../legal/privacy.html">Privacy</a> · <a href="../legal/terms.html">Terms</a></footer>
  </div>;
}

function TeamRoute({ code, rest }: { code: string; rest: string[] }) {
  const { d, err, got } = useSeason(code); useTick();
  useEffect(() => { if (d?.team) { document.title = `${d.team.name} · Benchboard Live`; if (d.team.color) applyTheme(d.team.color, "system", "normal", null); } }, [d?.team?.name, d?.team?.color]);
  useWakeLock(!!d?.matches.some((m) => m.status === "live") && rest[0] === "m");
  if (!d) return <Shell><p className="lv-empty">{err || "Loading…"}</p></Shell>;
  const view = rest[0] === "m" ? { match: rest[1] } : rest[0] === "p" ? { player: rest[1] } : { tab: rest[0] };
  return <Shell team={d.team?.name} home={`#/t/${code}`}><TeamHub code={code} d={d} fresh={freshText(got, err)} view={view} /></Shell>;
}

function GameRoute({ code }: { code: string }) {
  const { d, err, got } = useWatch(code); useTick();
  useEffect(() => { if (d?.team) { document.title = `${d.team.name} vs ${d.match.opp} · Benchboard Live`; if (d.team.color) applyTheme(d.team.color, "system", "normal", null); } }, [d?.team?.name, d?.match?.opp]);
  useWakeLock(d?.match?.status === "live");
  if (!d) return <Shell><p className="lv-empty">{err || "Loading the game…"}</p></Shell>;
  const g: Game = { m: d.match, R: replayOf(d.match, d.logs || []) };
  return <Shell team={d.team?.name}><GameView g={g} team={d.team?.name || "Us"} players={d.players} fresh={freshText(got, err)} /></Shell>;
}

function Landing() {
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = async () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length < 4) { setErr("Codes are 6 letters and numbers, like K7Q2XM."); return; }
    if (!cloudAvailable()) { setErr("This site isn't connected yet."); return; }
    setBusy(true); setErr("");
    try {
      const s: any = await rpc("season_view", { share: c }, true); if (s?.team) { location.hash = `#/t/${c}`; return; }
      const w: any = await rpc("watch", { share: c }, true); if (w?.match) { location.hash = `#/g/${c}`; return; }
      setErr("No team or game uses that code. Check it with the coach.");
    } catch { setErr("Couldn't check the code. Check your connection."); }
    setBusy(false);
  };
  return <Shell><section className="lv-hero">
    <h1>Follow the game, point by point.</h1>
    <p>Live scores, box scores and player stats, straight from the bench. Enter the code your coach shared, or open their link.</p>
    <form className="lv-code" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <label htmlFor="code">Team or game code</label>
      <div><input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7Q2XM" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} /><button className="btn primary" disabled={busy}>{busy ? "Finding…" : "Follow"}</button></div>
      {err && <p className="lv-err" role="alert">{err}</p>}
    </form>
  </section></Shell>;
}

function LiveApp() {
  const r = useRoute();
  if (r[0] === "t" && r[1]) return <TeamRoute key={r[1]} code={r[1].toUpperCase()} rest={r.slice(2)} />;
  if (r[0] === "g" && r[1]) return <GameRoute key={r[1]} code={r[1].toUpperCase()} />;
  return <Landing />;
}

createRoot(document.getElementById("root")!).render(<LiveApp />);

/** Benchboard Live: the public site for families and fans. Separate from the coaching app: no accounts, nothing to edit.
 *   #/t/CODE            team hub (season link)       #/t/CODE/m/MATCH  a game from the team hub
 *   #/t/CODE/p/PLAYER   a player's season            #/g/CODE          a single game link
 *   #/                  enter a code from the coach */
import "../styles/app.css";
import "./live.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { watchErrors } from "../app/errors";
import { getLang, initLang, Lang, setLang, tr } from "../lib/i18n";
import { cloudAvailable, rpc } from "../cloud/client";
import { applyTheme } from "../app/theme";
import { useWakeLock } from "../ui/wakeLock";
import { Game, replayOf, useSeason, useWatch } from "./data";
import { GameView } from "./GameView";
import { TeamHub } from "./TeamHub";
import { GameOverlay, TeamOverlay } from "./Overlay";
import { TeamLogo } from "../ui/Logo";

const parse = () => (location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean));
const query = () => location.hash.split("?")[1] || "";
function useRoute() { const [r, setR] = useState(parse()); useEffect(() => { const f = () => { setR(parse()); window.scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []); return r; }
const freshText = (got: number, err: string) => err ? err : !got ? "" : Date.now() - got < 15000 ? tr("Updated just now") : tr("Updated {n}s ago", { n: Math.round((Date.now() - got) / 1000) });
function useTick(ms = 1000) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]); }

function Shell({ team, children, home }: { team?: string; children: any; home?: string }) {
  return <div className="lv">
    <header className="lv-top"><a className="lv-brand" href={home || "#/"} aria-label="Benchboard Live home"><i aria-hidden="true" /><b>Benchboard</b><span>Live</span></a>{team && <span className="lv-top-team">{team}</span>}</header>
    <main className="lv-main">{children}</main>
    <footer className="lv-foot">{tr("Stats recorded by the team's coaches with Benchboard")} · <a href="../legal/privacy.html">{tr("Privacy")}</a> · <a href="../legal/terms.html">{tr("Terms")}</a>
      <div className="lv-lang" role="group" aria-label="Language / Idioma">{([["en", "English"], ["es", "Español"]] as [Lang, string][]).map(([k, l]) => <button key={k} aria-pressed={getLang() === k} onClick={() => { setLang(k); location.reload(); }}>{l}</button>)}</div></footer>
  </div>;
}

function TeamRoute({ code, rest }: { code: string; rest: string[] }) {
  const { d, err, got } = useSeason(code); useTick();
  useEffect(() => { if (d?.team) { document.title = `${d.team.name} · Benchboard Live`; if (d.team.color) applyTheme(d.team.color, "system", "normal", null); } }, [d?.team?.name, d?.team?.color]);
  useWakeLock(!!d?.matches.some((m) => m.status === "live") && rest[0] === "m");
  useEffect(() => { if (d?.team) rememberTeam({ code, name: d.team.name, logo: d.team.logo || null }); }, [code, d?.team?.name, d?.team?.logo]);
  if (!d) return <Shell><p className="lv-empty">{err || tr("Loading…")}</p></Shell>;
  const view = rest[0] === "m" ? { match: rest[1] } : rest[0] === "p" ? { player: rest[1] } : { tab: rest[0] };
  return <Shell team={d.team?.name} home={`#/t/${code}`}><TeamHub code={code} d={d} fresh={freshText(got, err)} view={view} /></Shell>;
}

function GameRoute({ code }: { code: string }) {
  const { d, err, got } = useWatch(code); useTick();
  useEffect(() => { if (d?.team) { document.title = `${d.team.name} vs ${d.match.opp} · Benchboard Live`; if (d.team.color) applyTheme(d.team.color, "system", "normal", null); } }, [d?.team?.name, d?.match?.opp]);
  useWakeLock(d?.match?.status === "live");
  if (!d) return <Shell><p className="lv-empty">{err || tr("Loading the game…")}</p></Shell>;
  const g: Game = { m: d.match, R: replayOf(d.match, d.logs || []) };
  return <Shell team={d.team?.name}><GameView g={g} team={d.team?.name || "Us"} players={d.players} fresh={freshText(got, err)} logo={d.team?.logo} /></Shell>;
}

/** Teams this phone has followed, most recent first (a family with kids on several teams sees them all on the home page). */
type Followed = { code: string; name: string; logo?: string | null };
const myTeams = (): Followed[] => { try { const a = JSON.parse(localStorage.getItem("bbl-teams") || "null"); if (Array.isArray(a)) return a; const l = JSON.parse(localStorage.getItem("bbl-last") || "null"); return l ? [l] : []; } catch { return []; } };
function rememberTeam(t: Followed) { try { localStorage.setItem("bbl-teams", JSON.stringify([t, ...myTeams().filter((x) => x.code !== t.code)].slice(0, 8))); } catch { /* private window */ } }
const forgetTeam = (code: string) => { try { localStorage.setItem("bbl-teams", JSON.stringify(myTeams().filter((x) => x.code !== code))); localStorage.removeItem("bbl-last"); } catch { /* private window */ } };

function Landing() {
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [mine, setMine] = useState(myTeams);
  // opened from the Home Screen with one team followed: straight to it
  useEffect(() => { if (mine.length === 1 && matchMedia("(display-mode: standalone)").matches) location.replace(`#/t/${mine[0].code}`); }, []);
  const go = async () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length < 4) { setErr(tr("Codes are 6 letters and numbers, like K7Q2XM.")); return; }
    if (!cloudAvailable()) { setErr(tr("This site isn't connected yet.")); return; }
    setBusy(true); setErr("");
    try {
      const s: any = await rpc("season_view", { share: c }, true); if (s?.team) { location.hash = `#/t/${c}`; return; }
      const w: any = await rpc("watch", { share: c }, true); if (w?.match) { location.hash = `#/g/${c}`; return; }
      setErr(tr("No team or game uses that code. Check it with the coach."));
    } catch { setErr(tr("Couldn't check the code. Check your connection.")); }
    setBusy(false);
  };
  return <Shell><section className="lv-hero">
    <h1>{tr("Follow the game, point by point.")}</h1>
    <p>{tr("Live scores, box scores and player stats, straight from the bench. Enter the code your coach shared, or open their link.")}</p>
    <form className="lv-code" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <label htmlFor="code">{tr("Team or game code")}</label>
      <div><input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7Q2XM" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} /><button className="btn primary" disabled={busy}>{tr(busy ? "Finding…" : "Follow")}</button></div>
      {err && <p className="lv-err" role="alert">{err}</p>}
    </form>
    {mine.length > 0 && <section className="lv-mine" aria-label={tr("Your teams")}><h2>{tr("Your teams")}</h2>
      <ul>{mine.map((t) => <li key={t.code}><a href={`#/t/${t.code}`}><TeamLogo src={t.logo} name={t.name} size={40} /><b>{t.name}</b><span aria-hidden="true">›</span></a>
        <button className="lv-x" aria-label={tr("Remove {team}", { team: t.name })} onClick={() => { forgetTeam(t.code); setMine(myTeams()); }}>×</button></li>)}</ul></section>}
  </section></Shell>;
}

function LiveApp() {
  const r = useRoute();
  if (r[0] === "t" && r[1] && r[2] === "overlay") return <TeamOverlay key={r[1]} code={r[1].toUpperCase()} q={query()} />;
  if (r[0] === "g" && r[1] && r[2] === "overlay") return <GameOverlay key={r[1]} code={r[1].toUpperCase()} q={query()} />;
  if (r[0] === "t" && r[1]) return <TeamRoute key={r[1]} code={r[1].toUpperCase()} rest={r.slice(2)} />;
  if (r[0] === "g" && r[1]) return <GameRoute key={r[1]} code={r[1].toUpperCase()} />;
  return <Landing />;
}

watchErrors();
initLang();
createRoot(document.getElementById("root")!).render(<LiveApp />);

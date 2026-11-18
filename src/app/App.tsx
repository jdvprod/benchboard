import { lazy, Suspense, useEffect } from "react";
import { all, currentMatch, matchesOf, setPrefs, state, team, useVersion } from "../data/store";
import { go, useRoute } from "./router";
import { siteUrl } from "../cloud/links";
import { applyTheme } from "./theme";
import { Scoreboard } from "./Scoreboard";
import { Icon } from "../ui/icons";
import { Toast } from "../ui/kit";
import { TrackPage } from "../features/track/TrackPage";
import { Home } from "../features/home/Home";
import { SitesMenu } from "./SitesMenu";
import { TeamMenu } from "./TeamMenu";
import { Welcome } from "../features/team/Welcome";
import { createSampleTeam } from "../data/seed";
import { ErrorBoundary } from "./ErrorBoundary";
import { TermsGate } from "../cloud/AuthPage";
import { JoinPage } from "../cloud/CloudCard";
import { COACH_ONLY, isViewer } from "./viewAs";
import { setUi, ui } from "./ui";
import { access, BILLING } from "./flags";
import { Paywall } from "./Paywall";
import { AccountChip, AccountPage, AuthPage, skipAccounts, syncDot, wantsAuthGate } from "../cloud/AuthPage";
import { needsTermsAgreement, currentUser } from "../cloud/client";

// Pages other than Track and Team load on first visit (then stay cached for offline use), so the app opens fast on gym wifi.
const LineupPage = lazy(() => import("../features/lineup/LineupPage").then((m) => ({ default: m.LineupPage })));
const FormationsPage = lazy(() => import("../features/formations/FormationsPage").then((m) => ({ default: m.FormationsPage })));
const FilmRoom = lazy(() => import("../features/film/FilmRoom").then((m) => ({ default: m.FilmRoom })));
const TournamentPage = lazy(() => import("../features/tournament/TournamentPage").then((m) => ({ default: m.TournamentPage })));
const MatchupPage = lazy(() => import("../features/matchup/MatchupPage").then((m) => ({ default: m.MatchupPage })));
const PracticePage = lazy(() => import("../features/practice/PracticePage").then((m) => ({ default: m.PracticePage })));
const StatsPage = lazy(() => import("../features/stats/StatsPage").then((m) => ({ default: m.StatsPage })));
const CourtPage = lazy(() => import("../features/court/CourtPage").then((m) => ({ default: m.CourtPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const PlayerPage = lazy(() => import("../features/player/PlayerPage").then((m) => ({ default: m.PlayerPage })));
const LivePage = lazy(() => import("../features/live/LivePage").then((m) => ({ default: m.LivePage })));
const AdminPage = lazy(() => import("../features/admin/AdminPage").then((m) => ({ default: m.AdminPage })));
const TryoutsPage = lazy(() => import("../features/tryouts/TryoutsPage").then((m) => ({ default: m.TryoutsPage })));
const JoinTryout = lazy(() => import("../features/tryouts/TryoutsPage").then((m) => ({ default: m.JoinTryout })));
const TeamPage = lazy(() => import("../features/team/TeamPage").then((m) => ({ default: m.TeamPage })));
const ClubPage = lazy(() => import("../features/club/ClubPage").then((m) => ({ default: m.ClubPage })));
const Wait = () => <div className="page"><p className="empty" style={{ padding: 24 }}>Loading…</p></div>;

const HOST_THEME = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
const NAV: [string, string, string?][] = [["home", "Home"], ["track", "Track"], ["lineup", "Lineup"], ["matchup", "Matchup"], ["practice", "Practice"], ["stats", "Stats"], ["court", "Court"], ["team", "Team"], ["film", "Film", "wide-only"], ["live", "Live", "wide-only"]];


export function App() {
  useVersion();
  const route = useRoute(), t = team();
  useEffect(() => { applyTheme(t?.color || "#2A78AE", state.prefs.theme, state.prefs.size, HOST_THEME); }, [t?.color, state.prefs.theme, state.prefs.size]);
  useEffect(() => { document.body.classList.toggle("nav-mini", !!state.prefs.navMini); }, [state.prefs.navMini]);
  // public pages moved to their own sites: Floorcall Live and Floorcall Recruit (old links keep working)
  if ((route.page === "watch" || route.page === "season" || route.page === "recruit") && route.id) {
    location.replace(siteUrl(route.page === "recruit" ? "recruit" : "live", (route.page === "watch" ? "g/" : route.page === "season" ? "t/" : "p/") + route.id));
    return <Wait />;
  }
  if (!state.ready) return <div className="content"><p className="empty" style={{ padding: 24 }}>Loading…</p></div>;
  const user = currentUser();
  if (route.page === "sample") {
    // from the product page: open straight into a full sample season
    setTimeout(() => {
      const existing = all("teams").find((x) => x.sample);
      if (existing) setPrefs({ teamId: existing.id }); else createSampleTeam();
      if (!user) skipAccounts();
      location.replace("#/home");
    }, 0);
    return <div className="content"><p className="empty" style={{ padding: 24 }}>Loading the sample season…</p></div>;
  }
  // an assistant rating at someone else's tryout needs no team of their own (the page signs them in itself)
  if (route.page === "tryout-join" || (route.page === "tryouts" && route.id?.startsWith("tj-") && user && !t))
    return <><div className="content solo"><Suspense fallback={<Wait />}>{route.page === "tryout-join" ? <JoinTryout code={route.id || ""} /> : <TryoutsPage id={route.id} />}</Suspense></div><Toast /></>;
  if (!user && (route.page === "account" || (route.page === "join" && route.id && wantsAuthGate()))) {
    if (route.page === "join" && route.id) try { sessionStorage.setItem("bs-join", route.id); } catch { /* ignore */ }
    return <><AuthPage key={route.id || "a"} initial={route.id === "signup" || route.page === "join" ? "signup" : "signin"} onSkip={() => { skipAccounts(); location.hash = "#/home"; }} /><Toast /></>;
  }
  if (route.page === "account" && route.id === "new-password") return <><AuthPage initial="newpw" /><Toast /></>;
  if (user && needsTermsAgreement()) return <><TermsGate /><Toast /></>;
  // an account is required (the sample season from the product page can be explored first)
  if (!user && wantsAuthGate() && !(t && t.sample)) return <><AuthPage initial={all("teams").some((x) => !x.sample) ? "signin" : "signup"} onSkip={skipAccounts} /><Toast /></>;
  if (!t) {
    if (route.page === "join" && route.id && user) return <><div className="content"><JoinPage code={route.id} /></div><Toast /></>;
    return <>{wantsAuthGate() ? <AuthPage onSkip={skipAccounts} /> : <Welcome />}<Toast /></>;
  }

  // View-only members (players and families) get the team's stats, never the coaching tools
  const viewer = !!t && isViewer(t.id);
  const page = viewer && COACH_ONLY.includes(route.page) ? "home" : route.page;
  const showBoard = !!currentMatch() && ["track", "practice", "lineup", "formations", "stats", "court", "matchup"].includes(page) && !(page === "practice" && currentMatch()?.kind === "match");
  const teams = all("teams").sort((a, b) => a.createdAt - b.createdAt);
  let body;
  switch (page) {
    case "club": body = <ClubPage />; break;
    case "tryouts": body = <TryoutsPage id={route.id} />; break;
    case "tryout-join": body = <JoinTryout code={route.id || ""} />; break;
    case "lineup": body = <LineupPage />; break;
    case "formations": body = <FormationsPage />; break;
    case "labs": body = <SettingsPage />; break; // Labs moved: formations are under Lineup, the rest is in Settings
    case "film": body = <FilmRoom id={route.id} />; break;
    case "matchup": body = <MatchupPage id={route.id} />; break;
    case "tournament": body = <TournamentPage id={route.id} />; break;
    case "join": body = <JoinPage code={route.id || ""} />; break;
    case "account": body = <AccountPage />; break;
    case "practice": body = <PracticePage id={route.id} />; break;
    case "stats": body = <StatsPage />; break;
    case "court": body = <CourtPage />; break;
    case "team": body = <TeamPage sub={route.id} />; break;
    case "settings": body = <SettingsPage />; break;
    case "admin": body = <AdminPage />; break;
    case "player": body = <PlayerPage id={route.id!} />; break;
    case "live": body = <LivePage />; break;
    case "track": body = <TrackPage />; break;
    // opening the app mid-match (no page in the link) goes straight back to the match
    default: body = <div className="page"><Home /></div>;
  }
  return <>
    <nav className="nav" aria-label="Sections">
      <div className="brand"><i><Icon name="brand" /></i><b>Floorcall</b></div>
      <div className="teamswitch"><TeamMenu compact={!!state.prefs.navMini} /></div>
      {NAV.filter(([k]) => !viewer || !COACH_ONLY.includes(k)).map(([k, l, cls]) => <a key={k} className={"tab " + (cls || "")} href={"#/" + k} title={state.prefs.navMini ? l : undefined} aria-current={page === k || (k === "stats" && page === "player") || (k === "lineup" && page === "formations") || (k === "matchup" && page === "tournament") ? "page" : undefined}><Icon name={k} /><span>{l}</span></a>)}
      <SitesMenu mini={!!state.prefs.navMini} />
      <AccountChip />
      <a className="tab wide-only" href="#/settings" aria-current={page === "settings" ? "page" : undefined} title={state.prefs.navMini ? "Settings" : undefined}><Icon name="settings" /><span>Settings</span></a>
      <button className="tab wide-only nav-fold" onClick={() => { document.body.classList.add("nav-anim"); setTimeout(() => document.body.classList.remove("nav-anim"), 300); setPrefs({ navMini: !state.prefs.navMini }); }} aria-label={state.prefs.navMini ? "Expand the sidebar" : "Collapse the sidebar"} title={state.prefs.navMini ? "Expand the sidebar" : "Collapse the sidebar"}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />{state.prefs.navMini ? <path d="m13 10 2 2-2 2" /> : <path d="m16 10-2 2 2 2" />}</svg><span>Collapse</span></button>
    </nav>
    <div className="content">
      <div className="mobilebar"><b>Floorcall</b><TeamMenu />{user ? <a className={"avatar " + syncDot()} href="#/account" aria-label="Account">{user.email.slice(0, 1).toUpperCase()}</a> : null}</div>
      {showBoard && page !== "live" && <Scoreboard />}
      {!state.persistent && <div className="banner warn" style={{ marginTop: 12 }}><p>This browser isn't letting Floorcall save. Stats will be lost when you close it. Try a regular (not private) window.</p></div>}
      {ui.previewPlayer && <div className="preview-bar" role="status"><span><b>Players' view.</b> This is what your players and families see when they join {t?.name || "the team"} with a view-only code.</span><button className="btn sm" onClick={() => { setUi({ previewPlayer: false }); go("settings"); }}>Exit preview</button></div>}
      <ErrorBoundary resetKey={page + (route.id || "")}><Suspense fallback={<Wait />}>{BILLING && t && !viewer && !["settings", "team", "home", "stats", "player", "admin"].includes(page) && !access(t, matchesOf().filter((m) => m.status === "done" && m.kind === "match").length).ok ? <Paywall /> : body}</Suspense></ErrorBoundary>
    </div>
    <Toast />
  </>;
}

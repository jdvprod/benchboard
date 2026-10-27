import { useEffect } from "react";
import { all, currentMatch, setPrefs, state, team, useVersion } from "../data/store";
import { useRoute } from "./router";
import { applyTheme } from "./theme";
import { Scoreboard } from "./Scoreboard";
import { Icon } from "../ui/icons";
import { Toast } from "../ui/kit";
import { TrackPage } from "../features/track/TrackPage";
import { LineupPage } from "../features/lineup/LineupPage";
import { FormationsPage } from "../features/formations/FormationsPage";
import { LabsPage } from "../features/labs/LabsPage";
import { MatchupPage } from "../features/matchup/MatchupPage";
import { PracticePage } from "../features/practice/PracticePage";
import { StatsPage } from "../features/stats/StatsPage";
import { CourtPage } from "../features/court/CourtPage";
import { TeamPage } from "../features/team/TeamPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { PlayerPage } from "../features/player/PlayerPage";
import { LivePage } from "../features/live/LivePage";
import { Welcome } from "../features/team/Welcome";
import { createSampleTeam } from "../data/seed";
import { ErrorBoundary } from "./ErrorBoundary";
import { WatchPage } from "../cloud/WatchPage";
import { SeasonPage } from "../cloud/SeasonPage";
import { TermsGate } from "../cloud/AuthPage";
import { RecruitPage } from "../cloud/RecruitPage";
import { ClubPage } from "../features/club/ClubPage";
import { JoinPage } from "../cloud/CloudCard";
import { AccountChip, AccountPage, AuthPage, skipAccounts, syncDot, wantsAuthGate } from "../cloud/AuthPage";
import { needsTermsAgreement, currentUser } from "../cloud/client";

const HOST_THEME = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
const NAV: [string, string, string?][] = [["track", "Track"], ["lineup", "Lineup"], ["matchup", "Matchup"], ["practice", "Practice"], ["stats", "Stats"], ["court", "Court"], ["team", "Team"], ["live", "Live", "wide-only"], ["labs", "Labs", "wide-only"]];

export function App() {
  useVersion();
  const route = useRoute(), t = team();
  useEffect(() => { applyTheme(t?.color || "#2A78AE", state.prefs.theme, state.prefs.size, HOST_THEME); }, [t?.color, state.prefs.theme, state.prefs.size]);
  if (route.page === "watch" && route.id) return <><WatchPage code={route.id} /><Toast /></>;
  if (route.page === "season" && route.id) return <><SeasonPage code={route.id} /><Toast /></>;
  if (route.page === "recruit" && route.id) return <RecruitPage code={route.id} />;
  if (!state.ready) return <div className="content"><p className="empty" style={{ padding: 24 }}>Loading…</p></div>;
  const user = currentUser();
  if (route.page === "sample") {
    // from the product page: open straight into a full sample season
    setTimeout(() => {
      const existing = all("teams").find((x) => x.sample);
      if (existing) setPrefs({ teamId: existing.id }); else createSampleTeam();
      if (!user) skipAccounts();
      location.replace("#/track");
    }, 0);
    return <div className="content"><p className="empty" style={{ padding: 24 }}>Loading the sample season…</p></div>;
  }
  if (!user && (route.page === "account" || (route.page === "join" && route.id && wantsAuthGate()))) {
    if (route.page === "join" && route.id) try { sessionStorage.setItem("bs-join", route.id); } catch { /* ignore */ }
    return <><AuthPage key={route.id || "a"} initial={route.id === "signup" || route.page === "join" ? "signup" : "signin"} onSkip={() => { skipAccounts(); location.hash = "#/track"; }} /><Toast /></>;
  }
  if (route.page === "account" && route.id === "new-password") return <><AuthPage initial="newpw" /><Toast /></>;
  if (user && needsTermsAgreement()) return <><TermsGate /><Toast /></>;
  if (!t) {
    if (route.page === "join" && route.id && user) return <><div className="content"><JoinPage code={route.id} /></div><Toast /></>;
    return <>{wantsAuthGate() ? <AuthPage onSkip={skipAccounts} /> : <Welcome />}<Toast /></>;
  }

  const page = route.page;
  const showBoard = !!currentMatch() && ["track", "practice", "lineup", "formations", "stats", "court", "matchup"].includes(page) && !(page === "practice" && currentMatch()?.kind === "match");
  const teams = all("teams").sort((a, b) => a.createdAt - b.createdAt);
  const switcher = (cls: string) => (
    <select className={cls} value={t.id} aria-label="Team" onChange={(e) => { if (e.target.value === "__new") location.hash = "#/team/new"; else if (e.target.value === "__club") location.hash = "#/club"; else setPrefs({ teamId: e.target.value }); }}>
      {teams.map((x) => <option key={x.id} value={x.id}>{x.name}{x.level ? " · " + x.level : ""}</option>)}
      {teams.filter((x) => !x.sample).length > 1 && <option value="__club">All teams overview</option>}
      <option value="__new">+ Add a team</option>
    </select>
  );
  let body;
  switch (page) {
    case "club": body = <ClubPage />; break;
    case "lineup": body = <LineupPage />; break;
    case "formations": body = <FormationsPage />; break;
    case "labs": body = <LabsPage />; break;
    case "matchup": body = <MatchupPage id={route.id} />; break;
    case "join": body = <JoinPage code={route.id || ""} />; break;
    case "account": body = <AccountPage />; break;
    case "practice": body = <PracticePage />; break;
    case "stats": body = <StatsPage />; break;
    case "court": body = <CourtPage />; break;
    case "team": body = <TeamPage sub={route.id} />; break;
    case "settings": body = <SettingsPage />; break;
    case "player": body = <PlayerPage id={route.id!} />; break;
    case "live": body = <LivePage />; break;
    default: body = <TrackPage />;
  }
  return <>
    <nav className="nav" aria-label="Sections">
      <div className="brand"><i><Icon name="brand" /></i><b>Benchboard</b></div>
      <div className="teamswitch">{switcher("")}</div>
      {NAV.map(([k, l, cls]) => <a key={k} className={"tab " + (cls || "")} href={"#/" + k} aria-current={page === k || (k === "stats" && page === "player") || (k === "labs" && page === "formations") ? "page" : undefined}><Icon name={k} /><span>{l}</span></a>)}
      <AccountChip />
      <a className="tab" href="#/settings" aria-current={page === "settings" ? "page" : undefined}><Icon name="settings" /><span>Settings</span></a>
    </nav>
    <div className="content">
      <div className="mobilebar"><b>Benchboard</b>{switcher("")}{user ? <a className={"avatar " + syncDot()} href="#/account" aria-label="Account">{user.email.slice(0, 1).toUpperCase()}</a> : null}</div>
      {showBoard && page !== "live" && <Scoreboard />}
      {!state.persistent && <div className="banner warn" style={{ marginTop: 12 }}><p>This browser isn't letting Benchboard save. Stats will be lost when you close it. Try a regular (not private) window.</p></div>}
      <ErrorBoundary resetKey={page + (route.id || "")}>{body}</ErrorBoundary>
    </div>
    <Toast />
  </>;
}

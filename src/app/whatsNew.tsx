/** "New in Floorcall": a short card on Home with recent features, shown once until dismissed. Newest first. */
import { useState } from "react";
import { go } from "./router";
import { setUi } from "./ui";

const NEWS: { id: string; title: string; body: string; page?: string; cta?: string }[] = [
  { id: "filmreview", title: "Film breakdown", body: "Film Room now reviews each match for you: where points went, the stuck rotation, their best hitter, what to keep doing. Every finding plays as clips and becomes a film session in one tap.", page: "film", cta: "Open Film Room" },
  { id: "filmsearch", title: "Search all your film", body: "Ask across the whole season: “Maya's kills vs Buchanan”, “aces in the last 3 matches”. And Best rallies ranks every rally by the crowd's reaction, no stats needed.", page: "film", cta: "Search your film" },
  { id: "tryouts", title: "Tryouts", body: "Rate players skill by skill with your staff on their phones, rank them, and turn offers into a roster.", page: "tryouts", cta: "Open tryouts" },
  { id: "playbook", title: "Playbook in 3D", body: "Defenses, blocking and hitting plays on a court you can turn. Draw routes, run them, save a picture, share with the team.", page: "court", cta: "Open the playbook" },
  { id: "teamtools", title: "Who's coming and volunteers", body: "Families say if their player can make each match or practice, and sign up for line judge, scorebook or snacks.", page: "matchup", cta: "See your schedule" },
  { id: "recaps", title: "Recap videos", body: "A vertical video of a match or the whole season, with plays from your film, ready for Reels and TikTok.", page: "stats", cta: "Go to stats" },
];
const KEY = "fc-news-seen";

export function WhatsNew() {
  const seen = (() => { try { return new Set((localStorage.getItem(KEY) || "").split(",").filter(Boolean)); } catch { return new Set<string>(); } })();
  const [hide, setHide] = useState(false), items = NEWS.filter((n) => !seen.has(n.id));
  if (hide || !items.length) return null;
  const done = () => { try { localStorage.setItem(KEY, NEWS.map((n) => n.id).join(",")); } catch { /* private window */ } setHide(true); };
  return <section className="card news-card" aria-label="New in Floorcall">
    <div className="row between"><h3 style={{ margin: 0 }}>New in Floorcall</h3><button className="btn sm ghost" onClick={done}>Got it</button></div>
    <ul>{items.slice(0, 4).map((n) => <li key={n.id}><b>{n.title}</b><span>{n.body}</span>{n.page && <button className="btn sm" onClick={() => { if (n.page === "court") setUi({ courtTab: "playbook" }); go(n.page!); }}>{n.cta}</button>}</li>)}</ul>
  </section>;
}

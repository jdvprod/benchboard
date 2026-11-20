/** Where each Floorcall site lives.
 * On the real domain each site has its own address: getfloorcall.com (product page), app.getfloorcall.com (coaches),
 * live.getfloorcall.com (families and fans) and recruit.getfloorcall.com (athletes, college coaches). Anywhere else
 * (test deployments, previews) they sit side by side as paths: /, /live/, /recruit/. */
declare const __SITES__: { home: string; app: string; live: string; recruit: string; beach: string; academy: string; lessons: string } | null;
export type Site = "live" | "recruit" | "beach" | "academy" | "lessons";
export type Place = "home" | "app" | Site;
const SITES = typeof __SITES__ !== "undefined" ? __SITES__ : null;
const onDomain = () => { if (!SITES) return false; try { return Object.values(SITES).some((u) => new URL(u).host === location.host); } catch { return false; } };

export function placeUrl(p: Place, hashPath = ""): string {
  let base: string;
  if (onDomain()) base = SITES![p];
  else {
    const root = location.href.split("#")[0].split("?")[0].replace(/\/(live|recruit|beach|academy|lessons)\/.*$/, "/").replace(/[^/]*$/, "");
    base = p === "app" ? root : p === "home" ? root + "about.html" : root + p + "/";
  }
  return base + (hashPath ? "#/" + hashPath : "");
}
export const siteUrl = (site: Site, hashPath = "") => placeUrl(site, hashPath);

/** The three Floorcall places, for the switchers at the top of each site. */
export const PLACES: [Place, string, string][] = [["app", "Coaches", "Stat, scout and run the team"], ["live", "Live", "Scores and team film for families"], ["recruit", "Recruit", "Recruiting for athletes"], ["beach", "Beach", "Score and stat beach doubles"], ["academy", "Academy", "Learn and teach each skill"], ["lessons", "Lessons", "Private lessons, training and clinics"]];

/** The Contact page on getfloorcall.com, with where the person came from (and, for a problem report, device details). */
export function contactUrl(from: string, topic?: "question" | "bug" | "billing" | "club" | "privacy" | "idea", details?: string): string {
  const q = new URLSearchParams({ from, ...(topic ? { topic } : {}), ...(details ? { d: details.slice(0, 1200) } : {}) });
  return placeUrl("home").replace(/[^/]*$/, "") + "contact.html?" + q.toString();
}

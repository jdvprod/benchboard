/** Switch between the three Floorcall sites: Coaches (the app), Live (families) and Recruit (athletes).
 * Each is its own place with its own address; this is how you get from one to another. */
import "./siteswitch.css";
import { Place, placeUrl, PLACES } from "../cloud/links";

export function SiteSwitch({ here, label = (s: string) => s }: { here: Place; label?: (en: string) => string }) {
  return <nav className="site-switch" aria-label={label("Floorcall sites")}>
    {PLACES.map(([p, name]) => <a key={p} href={placeUrl(p)} aria-current={p === here ? "page" : undefined} {...(p === here ? {} : { rel: "noopener" })}>{label(name)}</a>)}
  </nav>;
}

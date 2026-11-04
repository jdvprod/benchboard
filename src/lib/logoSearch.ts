/** Finds team logos by name: Wikipedia articles (their infobox picture), Wikidata's logo for the school, and the
 * school website's icon. Works from the browser (these APIs allow it) with no key. `get` is swappable for tests. */
export interface LogoHit { url: string; label: string; source: "Wikidata" | "Wikipedia" | "Website"; title: string; desc?: string }
type Get = (url: string) => Promise<any>;
const defaultGet: Get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error("search failed"); return r.json(); };

const WP = "https://en.wikipedia.org/w/api.php", WD = "https://www.wikidata.org/w/api.php", CM = "https://commons.wikimedia.org/w/api.php";
const qs = (o: Record<string, string>) => new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...o }).toString();
const STOP = new Set(["the", "of", "and", "high", "school", "hs", "volleyball", "vb", "vbc", "club", "girls", "boys", "varsity", "jv", "frosh", "team", "academy", "a", "at", "vs"]);
const SCHOOLISH = /\b(high school|school|academy|college|university|preparatory|prep|institute)\b/i;
export const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

/** Does a Wikipedia title name this team? Most of its words, starting with the first ("Clovis North Broncos" ~ "Clovis North High School"). */
export function titleMatches(name: string, title: string) {
  const w = words(name), tw = words(title.replace(/\(.*\)/, "")), t = new Set(tw);
  if (!w.length || tw[0] !== w[0]) return false;
  return w.filter((x) => t.has(x)).length / w.length >= 0.6;
}
/** Where a school is, from its article: "Buchanan High School (Clovis, California)" or "Public high school in Fresno, California" → "California" */
export const regionOf = (title: string, desc = "") => {
  const m = /\(([^)]*)\)\s*$/.exec(title), from = m ? m[1] : /\bin\s+(.+)$/i.exec(desc)?.[1] || "";
  const parts = from.split(",").map((x) => x.trim()).filter((x) => x && !/^(united states|usa|u\.s\.)$/i.test(x));
  return parts.length > 1 || m ? parts[parts.length - 1] || "" : "";
};

export async function findLogos(name: string, o: { region?: string; get?: Get } = {}): Promise<LogoHit[]> {
  const get = o.get || defaultGet, n = name.trim(); if (!n) return [];
  const queries = SCHOOLISH.test(n) ? [n + (o.region ? " " + o.region : "")] : [`${n} high school${o.region ? " " + o.region : ""}`, n];
  const pages: { title: string; thumb?: string; qid?: string; desc?: string }[] = [];
  for (const q of queries) {
    const r = await get(`${WP}?${qs({ action: "query", generator: "search", gsrsearch: q, gsrlimit: "6", prop: "pageimages|pageprops|description", piprop: "thumbnail", pithumbsize: "256", pilicense: "any", ppprop: "wikibase_item" })}`).catch(() => null);
    const ps: any[] = (r?.query?.pages || []).slice().sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
    for (const p of ps) if (!pages.some((x) => x.title === p.title)) pages.push({ title: p.title, thumb: p.thumbnail?.source, qid: p.pageprops?.wikibase_item, desc: p.description });
  }
  // the articles that are about this team come first
  pages.sort((a, b) => Number(titleMatches(n, b.title)) - Number(titleMatches(n, a.title)));
  const hits: LogoHit[] = [];
  const ids = pages.filter((p) => p.qid && titleMatches(n, p.title)).slice(0, 5);
  if (ids.length) {
    const r = await get(`${WD}?${qs({ action: "wbgetentities", ids: ids.map((p) => p.qid!).join("|"), props: "claims" })}`).catch(() => null);
    const files: { file: string; title: string; desc?: string }[] = [], sites: { host: string; title: string }[] = [];
    for (const p of ids) {
      const c = r?.entities?.[p.qid!]?.claims || {};
      const file = c.P154?.[0]?.mainsnak?.datavalue?.value; if (typeof file === "string") files.push({ file, title: p.title, desc: p.desc });
      const site = c.P856?.[0]?.mainsnak?.datavalue?.value; if (typeof site === "string") { try { sites.push({ host: new URL(site).hostname, title: p.title }); } catch { /* not a link */ } }
    }
    if (files.length) {
      const ci = await get(`${CM}?${qs({ action: "query", titles: files.map((f) => "File:" + f.file).join("|"), prop: "imageinfo", iiprop: "url", iiurlwidth: "256" })}`).catch(() => null);
      const norm = (s: string) => s.replace(/^File:/, "").replace(/_/g, " ").toLowerCase();
      for (const f of files) {
        const pg = (ci?.query?.pages || []).find((x: any) => norm(x.title) === norm(f.file));
        const u = pg?.imageinfo?.[0]?.thumburl || pg?.imageinfo?.[0]?.url; if (u) hits.push({ url: u, label: f.title + " · logo", source: "Wikidata", title: f.title, desc: f.desc });
      }
    }
    for (const p of pages) if (p.thumb && !hits.some((h) => h.url === p.thumb)) hits.push({ url: p.thumb, label: p.title, source: "Wikipedia", title: p.title, desc: p.desc });
    for (const s of sites) hits.push({ url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.host)}&sz=128`, label: s.host + " · website icon", source: "Website", title: s.title });
  } else for (const p of pages) if (p.thumb) hits.push({ url: p.thumb, label: p.title, source: "Wikipedia", title: p.title, desc: p.desc });
  return hits.slice(0, 9);
}

/** A logo to fill in without asking: only a school's official logo, and only when exactly one school matches (in the team's region if known). */
export function autoPick(name: string, hits: LogoHit[], region?: string): LogoHit | null {
  let c = hits.filter((h) => h.source === "Wikidata" && titleMatches(name, h.title));
  if (c.length > 1 && region) c = c.filter((h) => regionOf(h.title, h.desc).toLowerCase() === region.toLowerCase());
  return c.length === 1 ? c[0] : null;
}

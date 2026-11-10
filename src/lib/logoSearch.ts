/** Finds team logos by name: Wikipedia articles (their infobox picture), Wikidata's logo for the school, and the
 * school website's icon. Works from the browser (these APIs allow it) with no key. `get` is swappable for tests. */
export interface LogoHit { url: string; label: string; source: "Wikidata" | "Wikipedia" | "Website"; title: string; desc?: string; /** a file named as a logo on the school's article */ named?: boolean }
type Get = (url: string) => Promise<any>;
const defaultGet: Get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error("search failed"); return r.json(); };

const WP = "https://en.wikipedia.org/w/api.php", WD = "https://www.wikidata.org/w/api.php", CM = "https://commons.wikimedia.org/w/api.php";
const qs = (o: Record<string, string>) => new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...o }).toString();
const STOP = new Set(["the", "of", "and", "high", "school", "hs", "volleyball", "vb", "vbc", "club", "girls", "boys", "varsity", "jv", "frosh", "team", "academy", "a", "at", "vs"]);
const SCHOOLISH = /\b(high school|school|academy|college|university|preparatory|prep|institute)\b/i;
/** File names that are logos (not campus photos): "Clovis North Broncos logo.svg", "CNHS seal.png" */
const LOGO_WORD = /\b(logo|logos|seal|crest|emblem|wordmark|insignia|shield|athletics?|mascot|monogram)\b/i;
const PHOTO_WORD = /\b(campus|building|buildings|entrance|front|aerial|stadium|gym|gymnasium|view|photo|exterior|interior|sign|marquee|hall|field|library|theater|theatre|students?|map)\b/i;
const fname = (u: string) => decodeURIComponent((u.split("/").pop() || "").replace(/^\d+px-/, "")).replace(/[_-]+/g, " ");
/** How likely a file is the school's logo, from its name: 2 = named a logo, 1 = a drawing format with no photo words, 0 = a photo. Pure: unit tested. */
export function logoFileScore(file: string): 0 | 1 | 2 {
  const f = fname(file);
  if (LOGO_WORD.test(f)) return 2;
  if (/\.(jpe?g|tiff?|webp)(\.png)?$/i.test(f) || PHOTO_WORD.test(f)) return 0;
  return /\.(svg|png|gif)$/i.test(f) ? 1 : 0;
}
/** Does a picture look like a logo rather than a photo? A few flat colors or a see-through background, from its pixels
 * (RGBA, any size; 64×64 is plenty). Pure: unit tested. */
export function looksLikeLogo(px: Uint8ClampedArray): boolean {
  const bins = new Map<number, number>(); let opaque = 0, clear = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 24) { clear++; continue; }
    opaque++; const k = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4); bins.set(k, (bins.get(k) || 0) + 1);
  }
  const n = opaque + clear; if (!n) return false;
  if (clear / n > 0.12) return true; // logos are cut out; photos never are
  const top = [...bins.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
  return opaque > 0 && top / opaque >= 0.7;
}
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
  const pages: { title: string; thumb?: string; image?: string; qid?: string; desc?: string }[] = [];
  for (const q of queries) {
    const r = await get(`${WP}?${qs({ action: "query", generator: "search", gsrsearch: q, gsrlimit: "6", prop: "pageimages|pageprops|description", piprop: "thumbnail|name", pithumbsize: "256", pilicense: "any", ppprop: "wikibase_item" })}`).catch(() => null);
    const ps: any[] = (r?.query?.pages || []).slice().sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
    for (const p of ps) if (!pages.some((x) => x.title === p.title)) pages.push({ title: p.title, thumb: p.thumbnail?.source, image: p.pageimage, qid: p.pageprops?.wikibase_item, desc: p.description });
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
    // the article's own logo files (high-school logos are usually uploaded to the article, not Wikidata)
    hits.push(...(await articleLogos(get, ids.map((p) => ({ title: p.title, desc: p.desc })))).filter((h) => !hits.some((x) => x.url === h.url)));
    // the article's main picture only when it's a drawing, never a campus photo
    for (const p of pages) if (p.thumb && titleMatches(n, p.title) && logoFileScore(p.image || p.thumb) > 0 && !hits.some((h) => h.url === p.thumb)) hits.push({ url: p.thumb, label: p.title, source: "Wikipedia", title: p.title, desc: p.desc });
    for (const s of sites) hits.push({ url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.host)}&sz=128`, label: s.host + " · website icon", source: "Website", title: s.title });
  } else for (const p of pages) if (p.thumb && logoFileScore(p.image || p.thumb) > 0) hits.push({ url: p.thumb, label: p.title, source: "Wikipedia", title: p.title, desc: p.desc });
  return hits.slice(0, 9);
}

/** Logo files used on the matched articles, best-named first. */
async function articleLogos(get: Get, pages: { title: string; desc?: string }[]): Promise<LogoHit[]> {
  if (!pages.length) return [];
  const r = await get(`${WP}?${qs({ action: "query", prop: "images", titles: pages.map((p) => p.title).join("|"), imlimit: "max" })}`).catch(() => null);
  const files: { file: string; score: number; page: { title: string; desc?: string } }[] = [];
  for (const pg of r?.query?.pages || []) {
    const page = pages.find((p) => p.title === pg.title); if (!page) continue;
    for (const im of pg.images || []) { const score = logoFileScore(im.title); if (score && !/^File:(Commons|Wiki|Edit|Question|Symbol|Flag|Location|Map|Disambig|Ambox|Text document)/i.test(im.title)) files.push({ file: im.title, score, page }); }
  }
  files.sort((a, b) => b.score - a.score);
  const pick = files.slice(0, 8); if (!pick.length) return [];
  const ii = await get(`${WP}?${qs({ action: "query", titles: pick.map((f) => f.file).join("|"), prop: "imageinfo", iiprop: "url", iiurlwidth: "256" })}`).catch(() => null);
  const out: LogoHit[] = [];
  for (const f of pick) {
    const pg = (ii?.query?.pages || []).find((x: any) => x.title === f.file);
    const u = pg?.imageinfo?.[0]?.thumburl || pg?.imageinfo?.[0]?.url;
    if (u) out.push({ url: u, label: f.page.title + (f.score === 2 ? " · logo" : ""), source: "Wikipedia", title: f.page.title, desc: f.page.desc, named: f.score === 2 });
  }
  return out;
}

/** A logo to fill in without asking: only a school's official logo, and only when exactly one school matches (in the team's region if known). */
export function autoPick(name: string, hits: LogoHit[], region?: string): LogoHit | null {
  let c = hits.filter((h) => (h.source === "Wikidata" || h.named) && titleMatches(name, h.title));
  // one school, possibly several files: its Wikidata logo, else its first named logo
  const schools = [...new Set(c.map((h) => h.title))];
  if (schools.length >= 1) c = schools.map((t) => c.find((h) => h.title === t && h.source === "Wikidata") || c.find((h) => h.title === t)!);
  if (c.length > 1 && region) c = c.filter((h) => regionOf(h.title, h.desc).toLowerCase() === region.toLowerCase());
  return c.length === 1 ? c[0] : null;
}

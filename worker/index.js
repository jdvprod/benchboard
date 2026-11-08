/** Floorcall on Cloudflare: one Worker, four addresses.
 *   getfloorcall.com          product page (about.html), legal pages, shared images
 *   app.getfloorcall.com      the coaching app
 *   live.getfloorcall.com     Floorcall Live   (files under /live/)
 *   recruit.getfloorcall.com  Floorcall Recruit (files under /recruit/)
 * workers.dev and other test addresses work as before: /, /live/, /recruit/ side by side. */
const PAGE = /(\.html|\/)$/;
export default {
  async fetch(req, env) {
    const url = new URL(req.url), host = url.hostname;
    const m = /^(app|live|recruit|www)\.(.+)$/.exec(host);
    const test = /(^localhost$|^127\.|\.workers\.dev$)/.test(host);
    if (test) return env.ASSETS.fetch(req);
    const apex = m ? m[2] : host, kind = m ? m[1] : "home";
    const go = (sub, path) => Response.redirect(`https://${sub ? sub + "." : ""}${apex}${path}${url.search}`, 301);
    const asset = (path) => env.ASSETS.fetch(new Request(new URL(path, url), req));
    let p = url.pathname;
    if (kind === "www") return go("", p);
    // old links: getfloorcall.com/live/… and /recruit/… now live on their own addresses
    for (const s of ["live", "recruit"]) if (kind !== s && (p === "/" + s || p.startsWith("/" + s + "/"))) return go(s, p.slice(s.length + 1) || "/");
    if (kind === "live" || kind === "recruit") {
      if (p.startsWith("/" + kind + "/")) p = p.slice(kind.length + 1);
      const r = await asset("/" + kind + p);
      if (r.status !== 404) return r;
      if (PAGE.test(p)) return go("", p); // legal pages and the product page live on the main address
      return asset(p); // shared icons and images
    }
    if (kind === "app") {
      if (p === "/" || p === "/index.html") return asset("/");
      if (PAGE.test(p)) return go("", p);
      return asset(p);
    }
    // the main address: the product page; the app's own files go to app.
    if (p === "/" || p === "/about.html") return asset("/about.html");
    if (p === "/index.html") return go("app", "/");
    return asset(p);
  },
};

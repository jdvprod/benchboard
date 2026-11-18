/* Floorcall Academy works without a signal (the gym, the bus): the page and its files are kept on the device after the first visit.
 * Pages and scripts come from the network when there is one (so updates arrive) and from the copy when there isn't. */
const CACHE = "fc-academy-1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
const put = async (req, res) => { if (res && (res.ok || res.type === "opaque")) { const c = await caches.open(CACHE); await c.put(req, res.clone()); } return res; };
// the page tells us which files it loaded, so they are saved even on the very first visit
self.addEventListener("message", (e) => {
  const urls = (e.data && e.data.cache) || [];
  e.waitUntil(Promise.all(urls.map((u) => fetch(u, { cache: "no-cache" }).then((r) => put(u, r)).catch(() => {}))));
});
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url), fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !fonts) return;
  if (/\/chunks\//.test(url.pathname) || fonts) { // these never change under the same address
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r)))); return;
  }
  e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => hit || Response.error())));
});

/* Benchboard offline support: the app keeps working in gyms with no Wi-Fi. */
const CACHE = "benchboard-%VERSION%";
const CORE = ["./", "./index.html", "./app.js", "./app.css", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./favicon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.hostname === "api.anthropic.com") return;
  if (req.mode === "navigate" || url.origin === location.origin) {
    const key = req.mode === "navigate" ? "./index.html" : req;
    // Chunks have the content hash in their names and never change: cached copy first.
    if (url.pathname.includes("/chunks/")) { e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; }))); return; }
    // The app itself: network first so updates arrive, but on weak gym Wi-Fi use the cached copy after 3 seconds.
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); } return r; });
    const cached = () => caches.match(key, { ignoreSearch: true });
    const slow = new Promise((res) => setTimeout(res, 3000)).then(cached).then((hit) => hit || net);
    // no connection at all: the cached copy right away; a hanging connection: the cached copy after 3 seconds
    e.respondWith(Promise.race([net.catch(() => cached().then((hit) => hit || Promise.reject(new Error("offline")))), slow]));
    return;
  }
  // Fonts: cached copy first. Everything else (cloud sync, AI) always goes to the network.
  if (!/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })));
});

/** Hash routes: #/home, #/track, #/stats, #/player/<id> ... (hash routing works on any static host). The app opens to Home. */
import { useEffect, useState } from "react";

export type Route = { page: string; id?: string };
export function parse(hash = location.hash): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] || "home", id: parts[1] ? decodeURIComponent(parts[1]) : undefined };
}
export function go(page: string, id?: string) {
  const h = "#/" + page + (id ? "/" + encodeURIComponent(id) : "");
  if (location.hash !== h) location.hash = h; else window.dispatchEvent(new HashChangeEvent("hashchange"));
  window.scrollTo({ top: 0 });
}
export function useRoute(): Route {
  const [r, setR] = useState(parse());
  useEffect(() => { const f = () => setR(parse()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return r;
}

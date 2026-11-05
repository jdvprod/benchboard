/** Crash reports for the people who run Benchboard (Admin → Problems): the error, the app version and which screen.
 * Never team data, names or stats. At most five a session, each message once. */
import { cloudAvailable, rest } from "../cloud/client";
import { APP_VERSION } from "./legal";

const seen = new Set<string>(); let sent = 0;
const IGNORE = /ResizeObserver loop|Script error\.?$|Load failed|NetworkError|Failed to fetch|dynamically imported module|Importing a module script failed|AbortError|The operation was aborted/i;
export function reportError(e: unknown, where = "") {
  try {
    const err = e instanceof Error ? e : new Error(String((e as any)?.reason?.message || (e as any)?.message || e));
    const message = String(err.message || err).slice(0, 300);
    if (!message || IGNORE.test(message) || seen.has(message) || sent >= 5 || !cloudAvailable() || !navigator.onLine) return;
    seen.add(message); sent++;
    const page = (location.hash.replace(/^#\/?/, "").split("/")[0] || "track") + (where ? " · " + where : "");
    rest("app_errors", { method: "POST", headers: { prefer: "return=minimal" } as any, body: JSON.stringify({ version: APP_VERSION, message, stack: String(err.stack || "").slice(0, 2000), page: page.slice(0, 80), agent: navigator.userAgent.slice(0, 200) }) }).catch(() => {});
  } catch { /* reporting must never cause problems of its own */ }
}
export function watchErrors() {
  addEventListener("error", (ev) => reportError(ev.error || ev.message));
  addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}

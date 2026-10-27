/**
 * Supabase over plain fetch (no SDK): email + password accounts, table reads and writes, and RPC calls.
 * The project URL and public "anon" key are safe to ship in the app; Row Level Security protects the data.
 */
import { CLOUD_CONFIG } from "./config";
import { LEGAL_VERSION } from "../app/legal";

const SESSION_KEY = "bs-session", CONFIG_KEY = "bs-cloud-config";

export interface Session { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }
export class CloudError extends Error { constructor(public status: number, message: string) { super(message); } }

const read = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** Built-in project, or one entered in Settings (for testing your own project). */
export function config(): { url: string; key: string } | null {
  const own = read<{ url: string; key: string }>(CONFIG_KEY);
  const c = own && own.url && own.key ? own : CLOUD_CONFIG;
  return c.url && c.key ? { url: c.url.replace(/\/+$/, ""), key: c.key } : null;
}
export function setConfig(c: { url: string; key: string } | null) { write(CONFIG_KEY, c); }
export const cloudAvailable = () => !!config();

let session: Session | null = read<Session>(SESSION_KEY);
export const currentUser = () => session?.user || null;
function setSession(s: Session | null) { session = s; write(SESSION_KEY, s); }

function msg(body: any, fallback: string) {
  const m = body && (body.error_description || body.msg || body.message || body.error || body.hint);
  if (!m) return fallback;
  if (/invalid login/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first. Check your inbox for the link, then sign in.";
  if (/already registered/i.test(m)) return "That email already has an account. Sign in instead.";
  if (/password should be/i.test(m)) return "Use a password with at least 6 characters.";
  return String(m);
}

async function call(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<any> {
  const c = config(); if (!c) throw new CloudError(0, "Cloud sync isn't set up in this version of the app.");
  if (init.auth !== false && session && session.expires_at * 1000 < Date.now() + 60_000) await refresh();
  const headers: Record<string, string> = { apikey: c.key, "content-type": "application/json", ...(init.headers as any) };
  if (init.auth !== false && session) headers.authorization = "Bearer " + session.access_token;
  let res: Response;
  try { res = await fetch(c.url + path, { ...init, headers }); }
  catch { throw new CloudError(0, "Couldn't reach the cloud. Check your internet connection."); }
  const text = await res.text(); let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (res.status === 401 && session && init.auth !== false) { setSession(null); throw new CloudError(401, "Your sign-in expired. Sign in again."); }
  if (!res.ok) throw new CloudError(res.status, msg(body, `Cloud error (${res.status}).`));
  return body;
}

function fromAuth(b: any): Session {
  return { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600), user: { id: b.user.id, email: b.user.email } };
}
export async function signUp(email: string, password: string): Promise<"signed-in" | "confirm-email"> {
  // the agreement is recorded with the account: which version of the terms, and when
  const b = await call("/auth/v1/signup?redirect_to=" + encodeURIComponent(home()), { method: "POST", auth: false, body: JSON.stringify({ email, password, data: { terms_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() } }) });
  if (b && b.access_token) { setSession(fromAuth(b)); return "signed-in"; }
  return "confirm-email";
}
export async function signIn(email: string, password: string) {
  setSession(fromAuth(await call("/auth/v1/token?grant_type=password", { method: "POST", auth: false, body: JSON.stringify({ email, password }) })));
}
let refreshing: Promise<void> | null = null;
async function refresh() {
  if (!session) return;
  refreshing ||= (async () => {
    try { setSession(fromAuth(await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: JSON.stringify({ refresh_token: session!.refresh_token }) }))); }
    catch (e) { if (e instanceof CloudError && e.status >= 400 && e.status < 500) setSession(null); throw e; }
    finally { refreshing = null; }
  })();
  return refreshing;
}
export async function sendPasswordReset(email: string) {
  await call("/auth/v1/recover?redirect_to=" + encodeURIComponent(home()), { method: "POST", auth: false, body: JSON.stringify({ email }) });
}
const home = () => location.origin + location.pathname;
export async function resendConfirmation(email: string) {
  await call("/auth/v1/resend?redirect_to=" + encodeURIComponent(home()), { method: "POST", auth: false, body: JSON.stringify({ type: "signup", email }) });
}
export async function updatePassword(password: string) {
  await call("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password }) });
}
/**
 * Email links (confirm account, reset password) come back as #access_token=...&type=...
 * Turn that into a session before the app's router reads the hash. Returns the link type.
 */
export async function consumeAuthRedirect(): Promise<string | null> {
  const h = location.hash.replace(/^#/, "");
  if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, "", location.pathname + location.search);
  if (p.get("error_description")) { location.hash = "#/account"; return "error:" + p.get("error_description"); }
  const access = p.get("access_token")!, type = p.get("type") || "signup";
  try {
    const c = config(); if (!c) return null;
    const res = await fetch(c.url + "/auth/v1/user", { headers: { apikey: c.key, authorization: "Bearer " + access } });
    const u = await res.json();
    setSession({ access_token: access, refresh_token: p.get("refresh_token") || "", expires_at: +(p.get("expires_at") || 0) || Math.floor(Date.now() / 1000) + +(p.get("expires_in") || 3600), user: { id: u.id, email: u.email } });
  } catch { return null; }
  location.hash = type === "recovery" ? "#/account/new-password" : "#/account";
  return type;
}
export function signOut() { const s = session; setSession(null); if (s) call("/auth/v1/logout", { method: "POST", headers: { authorization: "Bearer " + s.access_token } as any, auth: false }).catch(() => {}); }

/* ---------- data ---------- */
export const rest = (path: string, init: RequestInit = {}) => call("/rest/v1/" + path, init);
/** Call a Supabase Edge Function as the signed-in user. */
export const fn = (name: string, body: unknown, signal?: AbortSignal) => call("/functions/v1/" + name, { method: "POST", body: JSON.stringify(body), signal });
export const rpc = (fn: string, args: Record<string, unknown>, anon = false) => call("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args), auth: !anon });
export const upsert = (table: string, rows: unknown[], onConflict?: string) =>
  rest(table + (onConflict ? "?on_conflict=" + onConflict : ""), { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" } as any, body: JSON.stringify(rows) });

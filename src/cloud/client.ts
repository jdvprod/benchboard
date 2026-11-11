/**
 * Supabase over plain fetch (no SDK): email + password accounts, table reads and writes, and RPC calls.
 * The project URL and public "anon" key are safe to ship in the app; Row Level Security protects the data.
 */
import { CLOUD_CONFIG } from "./config";
import { LEGAL_VERSION } from "../app/legal";

const SESSION_KEY = "bs-session", CONFIG_KEY = "bs-cloud-config";

export type AccountKind = "coach" | "athlete" | "parent" | "fan";
export interface UserMeta { name?: string; kind?: AccountKind; email_ok?: boolean; teams?: string[]; athlete?: Record<string, unknown> }
export interface Session { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string; terms?: string; meta?: UserMeta } }
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
  // Supabase's built-in email only reaches the project's own team and a couple of emails an hour; real use needs custom SMTP (see README)
  if (/email address not authorized|error sending (confirmation|recovery|magic link)? ?(email|mail)|smtp/i.test(m)) return "We couldn't send the email. The app's email service isn't fully set up yet; tell the person who runs your Floorcall.";
  if (/token has expired|otp.*(expired|invalid)|invalid.*(otp|token)/i.test(m)) return "That code didn't work. Use the code in the newest email, or send a new one.";
  if (/signups not allowed for otp|user not found/i.test(m)) return "Wrong email or password.";
  if (/rate limit|too many|over_email_send_rate|for security purposes, you can only request/i.test(m)) return "Too many emails were requested. Wait a few minutes and try again.";
  return String(m);
}

async function call(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<any> {
  const c = config(); if (!c) throw new CloudError(0, "Cloud sync isn't set up in this version of the app.");
  if (init.auth !== false && session && session.expires_at * 1000 < Date.now() + 60_000) await refresh();
  const headers: Record<string, string> = { apikey: c.key, "content-type": "application/json", ...(init.headers as any) };
  if (init.auth !== false && session) headers.authorization = "Bearer " + session.access_token;
  // Edge Functions want a bearer token even from visitors who aren't signed in (Floorcall Live notifications): the legacy anon key is one
  else if (path.startsWith("/functions/") && /^eyJ/.test(c.key)) headers.authorization = "Bearer " + c.key;
  let res: Response;
  try { res = await fetch(c.url + path, { ...init, headers }); }
  catch { throw new CloudError(0, "Couldn't reach the cloud. Check your internet connection."); }
  const text = await res.text(); let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (res.status === 401 && session && init.auth !== false) { setSession(null); throw new CloudError(401, "Your sign-in expired. Sign in again."); }
  if (!res.ok) throw new CloudError(res.status, msg(body, `Cloud error (${res.status}).`));
  return body;
}

function fromAuth(b: any): Session {
  return { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600), user: { id: b.user.id, email: b.user.email, terms: b.user.user_metadata?.terms_version, meta: pickMeta(b.user.user_metadata) } };
}
const pickMeta = (m: any): UserMeta => ({ name: m?.name, kind: m?.kind, email_ok: m?.email_ok, teams: Array.isArray(m?.teams) ? m.teams : undefined, athlete: m?.athlete && typeof m.athlete === "object" ? m.athlete : undefined });
/** Account details kept with the login (Supabase user metadata): name, who they are, email updates, followed teams, athlete details. */
export const userMeta = (): UserMeta => session?.user.meta || {};
export async function updateMeta(p: Partial<UserMeta>) {
  const b = await call("/auth/v1/user", { method: "PUT", body: JSON.stringify({ data: p }) });
  if (session) setSession({ ...session, user: { ...session.user, meta: pickMeta(b?.user_metadata || { ...session.user.meta, ...p }) } });
}
export async function signUp(email: string, password: string, about: { name?: string; kind?: AccountKind; email_ok?: boolean } = {}): Promise<"signed-in" | "confirm-email"> {
  // the agreement is recorded with the account: which version of the terms, and when
  const b = await call("/auth/v1/signup?redirect_to=" + encodeURIComponent(home()), { method: "POST", auth: false, body: JSON.stringify({ email, password, data: { terms_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString(), ...about } }) });
  await trustDevice(email); // the device that made the account; with Confirm email on, the account still can't sign in until the inbox is proven
  if (b && b.access_token) { setSession(fromAuth(b)); return "signed-in"; }
  return "confirm-email";
}
/**
 * Password sign-in. On a device (browser) this account has used before, that's it. Anywhere else the right password isn't
 * enough: Floorcall throws that sign-in away and emails a one-time code (and a sign-in link) to prove the person also has the inbox.
 */
export async function signIn(email: string, password: string): Promise<"signed-in" | "check-device"> {
  const s = fromAuth(await call("/auth/v1/token?grant_type=password", { method: "POST", auth: false, body: JSON.stringify({ email, password }) }));
  if (await deviceTrusted(s.user.email || email)) { setSession(s); return "signed-in"; }
  call("/auth/v1/logout?scope=local", { method: "POST", headers: { authorization: "Bearer " + s.access_token } as any, auth: false }).catch(() => {});
  await sendDeviceCode(s.user.email || email);
  return "check-device";
}
/** Email a one-time sign-in code (the same email has a sign-in link). Never creates an account. */
export async function sendDeviceCode(email: string) {
  try { sessionStorage.setItem("fc-return", location.hash); } catch { /* ignore */ }
  await call("/auth/v1/otp?redirect_to=" + encodeURIComponent(home()), { method: "POST", auth: false, body: JSON.stringify({ email, create_user: false }) });
}
export async function verifyDeviceCode(email: string, code: string) {
  const b = await call("/auth/v1/verify", { method: "POST", auth: false, body: JSON.stringify({ type: "email", email, token: code.replace(/\D/g, "") }) });
  setSession(fromAuth(b)); await trustDevice(b?.user?.email || email);
}

/* Devices this account has proven its email on: a short hash of the email (never the email itself), kept on this browser and,
   on the live domain, in a cookie shared by the app, Live and Recruit, so one check covers all three on that device. */
const TRUST_KEY = "fc-trusted";
declare const __SITES__: { home: string } | null;
async function deviceTag(email: string) {
  const text = "floorcall:" + email.trim().toLowerCase();
  try { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))); return [...h.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  catch { let a = 0x811c9dc5, b = 0x01000193; for (const ch of text) { a = Math.imul(a ^ ch.charCodeAt(0), 16777619) >>> 0; b = Math.imul(b ^ a, 2654435761) >>> 0; } return a.toString(16) + b.toString(16); }
}
function trusted(): string[] {
  const own = read<string[]>(TRUST_KEY) || [];
  let shared: string[] = []; try { shared = (document.cookie.match(/(?:^|; )fc-trusted=([^;]*)/)?.[1] || "").split(".").filter(Boolean); } catch { /* ignore */ }
  return [...new Set([...own, ...shared])];
}
function sharedDomain() {
  try { const home = new URL((typeof __SITES__ !== "undefined" && __SITES__?.home) || "").hostname; return home && (location.hostname === home || location.hostname.endsWith("." + home)) ? home : ""; } catch { return ""; }
}
export async function trustDevice(email: string) {
  if (!email) return;
  const tag = await deviceTag(email), all = [tag, ...trusted().filter((x) => x !== tag)].slice(0, 8);
  write(TRUST_KEY, all);
  try { const d = sharedDomain(); document.cookie = `fc-trusted=${all.join(".")}; path=/; max-age=${400 * 86400}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}${d ? "; domain=" + d : ""}`; } catch { /* ignore */ }
}
export const deviceTrusted = async (email: string) => trusted().includes(await deviceTag(email));
/** Forget this device (account deleted): the next sign-in here needs an email code again. */
export function forgetDevices() { write(TRUST_KEY, null); try { const d = sharedDomain(); document.cookie = `fc-trusted=; path=/; max-age=0${d ? "; domain=" + d : ""}`; } catch { /* ignore */ } }
// people already signed in when this check arrived keep this device
if (session && !(read<string[]>(TRUST_KEY) || []).length) trustDevice(session.user.email).catch(() => {});
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
/** Record that the signed-in user agreed to the current Terms and Privacy Policy. */
export async function acceptTerms() {
  await call("/auth/v1/user", { method: "PUT", body: JSON.stringify({ data: { terms_version: LEGAL_VERSION, terms_accepted_at: new Date().toISOString() } }) });
  if (session) setSession({ ...session, user: { ...session.user, terms: LEGAL_VERSION } });
}
/** Signed in but hasn't agreed to the current version of the terms (older accounts, or after the terms change). */
export const needsTermsAgreement = () => !!session && session.user.terms !== LEGAL_VERSION;

export async function consumeAuthRedirect(fallback = "#/account"): Promise<string | null> {
  const h = location.hash.replace(/^#/, "");
  if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, "", location.pathname + location.search);
  if (p.get("error_description")) { location.hash = fallback; return "error:" + p.get("error_description"); }
  const access = p.get("access_token")!, type = p.get("type") || "signup";
  try {
    const c = config(); if (!c) return null;
    const res = await fetch(c.url + "/auth/v1/user", { headers: { apikey: c.key, authorization: "Bearer " + access } });
    const u = await res.json();
    setSession({ access_token: access, refresh_token: p.get("refresh_token") || "", expires_at: +(p.get("expires_at") || 0) || Math.floor(Date.now() / 1000) + +(p.get("expires_in") || 3600), user: { id: u.id, email: u.email, terms: u.user_metadata?.terms_version, meta: pickMeta(u.user_metadata) } });
    await trustDevice(u.email); // every email link proves the inbox on this device
  } catch { return null; }
  let back = ""; try { back = sessionStorage.getItem("fc-return") || ""; sessionStorage.removeItem("fc-return"); } catch { /* ignore */ }
  location.hash = type === "recovery" ? "#/account/new-password" : type === "magiclink" && back ? back : fallback;
  return type;
}
export function signOut() { const s = session; setSession(null); if (s) call("/auth/v1/logout", { method: "POST", headers: { authorization: "Bearer " + s.access_token } as any, auth: false }).catch(() => {}); }

/* ---------- data ---------- */
export const rest = (path: string, init: RequestInit = {}) => call("/rest/v1/" + path, init);
/** Supabase Storage: put a file (replacing one at the same path) and the public link to it. */
export const uploadFile = (path: string, blob: Blob) => call("/storage/v1/object/" + path, { method: "POST", headers: { "content-type": blob.type || "application/octet-stream", "x-upsert": "true" } as any, body: blob });
export const publicFileUrl = (path: string) => { const c = config(); return c ? `${c.url}/storage/v1/object/public/${path}` : ""; };
/** Call a Supabase Edge Function as the signed-in user. */
export const fn = (name: string, body: unknown, signal?: AbortSignal) => call("/functions/v1/" + name, { method: "POST", body: JSON.stringify(body), signal });
/** Public sign-up settings (e.g. whether new accounts must confirm their email). */
export const authSettings = (): Promise<{ mailer_autoconfirm?: boolean; disable_signup?: boolean }> => call("/auth/v1/settings", { auth: false });
export const rpc = (fn: string, args: Record<string, unknown>, anon = false) => call("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args), auth: !anon });
export const upsert = (table: string, rows: unknown[], onConflict?: string) =>
  rest(table + (onConflict ? "?on_conflict=" + onConflict : ""), { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" } as any, body: JSON.stringify(rows) });

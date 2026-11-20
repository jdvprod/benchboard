// Used by the end-to-end tests. Minimal in-memory stand-in for the Supabase endpoints FloorCall uses, mirroring schema.sql rules.
const http = require("http");
const notes = [], noteLinks = [];
const users = new Map(); // email -> {id,email,pw}
const tokens = new Map(); // token -> userId
const fees = new Map(), teams = new Map(), members = [], records = new Map(), invites = new Map(), shares = new Map(), seasonShares = new Map(), recruits = new Map(), boards = new Map();
const otps = new Map(); // email -> one-time sign-in code (new-device check)
const admins = new Set(), appErrors = [], staff = new Map();
const files = new Map(); // storage: "media/<team>/<file>" -> { type, data }
const tryoutsCloud = new Map(); // code -> {owner, data}
const tryoutRatings = new Map(); // code|user -> {code, user, name, ratings, at}
const signups = new Map(); // "team|item|job|user" -> {team_id, item, job, user, name, at}
const teamPlays = new Map(); // team_id -> plays the coaches shared
const beach = new Map(); // beach live shares: code -> {owner, data, updated}
const interest = []; // college staff -> a player's coaches {id, team_id, code, player, from, name, school, title, email, body, at, read}
const rsvps = new Map(); // availability: "team|item|user" -> {team_id, item, user, name, status, at}
const posts = []; // team announcements {id, team_id, body, by, pinned, at, reads:Set}
const films = new Map(), filmViews = new Map(); // film sessions by code; views by code:user
const L = { athletes: new Map(), access: [], sessions: new Map(), roster: new Map(), requests: [] }; // FloorCall Lessons (version 31)
const support = [], drillPicks = []; // drillPicks: version 33 // version 32: contact form messages
const pushSubs = new Map(), pushSent = new Set(), pushes = []; // notify function: subscriptions, sent (match:kind), and what went out
let clock = Date.now();
const now = () => new Date(++clock).toISOString();
const uid = () => "u" + Math.random().toString(36).slice(2, 10);
const isMember = (t, u) => members.some((m) => m.team_id === t && m.user_id === u && m.status !== "pending");
const canEdit = (t, u) => members.some((m) => m.team_id === t && m.user_id === u && m.role !== "viewer" && m.status !== "pending");
// verified coaches (version 30): accounts whose email has "unverified" in it start unverified; everyone else is verified
const coachVerify = new Map();
const coachOk = (u) => admins.has(u) || (coachVerify.get(u)?.status || (/unverified/.test(users.get(u)?.email || "") ? "none" : "approved")) === "approved";
const COACH_STORES = ["opponents", "drills", "plans", "boards"];
function session(u) { const at = "at_" + uid(), rt = "rt_" + uid(); tokens.set(at, u.id); tokens.set(rt, u.id); return { access_token: at, refresh_token: rt, expires_in: 3600, user: { id: u.id, email: u.email, user_metadata: u.meta || {} } }; }
function send(res, code, body) { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(body === undefined ? "" : JSON.stringify(body)); }
function q(url) { const out = {}; for (const [k, v] of url.searchParams) out[k] = v; return out; }
const val = (s) => s.replace(/^(eq|gte|gt|in)\./, "");

module.exports = (port) => new Promise((ok) => { const srv = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    const raw = Buffer.concat(chunks), isJson = !/^(image|video)\//.test(req.headers["content-type"] || ""), body = isJson ? raw.toString() : "";
    const url = new URL(req.url, "http://x"), p = url.pathname, b = body ? JSON.parse(body) : null;
    // Storage: public pictures (no key needed, like Supabase's public buckets)
    if (p.startsWith("/storage/v1/object/public/")) { const f = files.get(p.slice("/storage/v1/object/public/".length)); if (!f) return send(res, 404, { message: "not found" }); res.writeHead(200, { "content-type": f.type, "access-control-allow-origin": "*" }); return res.end(f.data); }
    const tok = (req.headers.authorization || "").replace("Bearer ", ""), me = tokens.get(tok) || null;
    if (p === "/__mock/strip-terms") { for (const u of users.values()) if (u.meta) delete u.meta.terms_version; return send(res, 204); } // simulate accounts made before the terms existed
    if (p === "/__mock/pushes") return send(res, 200, { subs: [...pushSubs.values()], pushes }); // test inspection only
    if (p === "/__mock/make-admin") { const u = [...users.values()].find((x) => x.email === url.searchParams.get("email")); if (u) admins.add(u.id); return send(res, u ? 204 : 404); }
    if (p === "/__mock/otp") return send(res, 200, { code: otps.get(url.searchParams.get("email")) || null }); // test inspection only: "read the email"
    if (p === "/__mock/records") return send(res, 200, [...records.values()]); // test inspection only
    if (p === "/__mock/users") return send(res, 200, [...users.values()].map((u) => ({ email: u.email, meta: u.meta }))); // test inspection only
    if (!req.headers.apikey) return send(res, 401, { message: "no apikey" });
    // auth
    if (p === "/auth/v1/signup") { if ([...users.values()].some((u) => u.email === b.email)) return send(res, 400, { msg: "User already registered" }); const u = { id: uid(), email: b.email, pw: b.password, meta: b.data || {} }; users.set(u.id, u); return send(res, 200, session(u)); }
    if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") { const u = [...users.values()].find((x) => x.email === b.email && x.pw === b.password); return u ? send(res, 200, session(u)) : send(res, 400, { error_description: "Invalid login credentials" }); }
    if (p === "/auth/v1/token") { const id = tokens.get(b.refresh_token); return id ? send(res, 200, session(users.get(id))) : send(res, 400, { error: "invalid" }); }
    if (p === "/auth/v1/otp") { const u = [...users.values()].find((x) => x.email === b.email); if (!u && b.create_user === false) return send(res, 422, { msg: "Signups not allowed for otp" }); otps.set(b.email, String(100000 + Math.floor(Math.random() * 900000))); return send(res, 200, {}); }
    if (p === "/auth/v1/verify") { const u = [...users.values()].find((x) => x.email === b.email); if (!u || b.type !== "email" || !otps.has(b.email) || otps.get(b.email) !== b.token) return send(res, 403, { code: "otp_expired", msg: "Token has expired or is invalid" }); otps.delete(b.email); return send(res, 200, session(u)); }
    if (p === "/auth/v1/logout" || p === "/auth/v1/recover") return send(res, 204);
    if (p === "/auth/v1/user" && req.method === "PUT") { const u = users.get(me); if (!u) return send(res, 401, { message: "JWT required" }); if (b.data) u.meta = { ...(u.meta || {}), ...b.data }; if (b.password) u.pw = b.password; return send(res, 200, { id: u.id, email: u.email, user_metadata: u.meta }); }
    // rpc
    if (p === "/rest/v1/rpc/beach_view") { const s = beach.get(String(b.c).toUpperCase()); return send(res, 200, s ? { data: s.data, updated: s.updated } : null); }
    if (p === "/rest/v1/rpc/beach_publish") { if (!me) return send(res, 401, { message: "Sign in to share a match live" }); if (b.c) { const s = beach.get(String(b.c).toUpperCase()); if (!s || s.owner !== me) return send(res, 400, { message: "That link isn't yours to update" }); s.data = b.d; s.updated = now(); return send(res, 200, String(b.c).toUpperCase()); } const k = uid().replace(/[^a-z0-9]/gi, "").slice(0, 7).toUpperCase(); beach.set(k, { owner: me, data: b.d, updated: now() }); return send(res, 200, k); }
    if (p === "/rest/v1/rpc/beach_unshare") { const s = beach.get(String(b.c).toUpperCase()); if (s && s.owner === me) beach.delete(String(b.c).toUpperCase()); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/join_team") { if (!me) return send(res, 401, { message: "Sign in first" }); const inv = invites.get(String(b.invite).toUpperCase()); if (!inv) return send(res, 400, { message: "That code doesn't match a team" }); if (!members.some((m) => m.team_id === inv.team_id && m.user_id === me)) members.push({ team_id: inv.team_id, user_id: me, role: inv.role, email: users.get(me).email, joined_at: now(), status: inv.role === "viewer" ? "active" : "pending" }); return send(res, 200, inv.team_id); }
    if (p === "/rest/v1/rpc/team_decide_member") { if (!members.some((m) => m.team_id === b.t && m.user_id === me && m.role === "owner")) return send(res, 400, { message: "Only the team's owner can approve coaches" }); const i = members.findIndex((m) => m.team_id === b.t && m.user_id === b.uid && m.status === "pending"); if (i >= 0) { if (b.approve) members[i].status = "active"; else members.splice(i, 1); } return send(res, 200, null); }
    // version 32: contact form, one code box, coverage
    if (p === "/rest/v1/rpc/support_send") { if (b.trap) return send(res, 200, null); const e = String(b.email || "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return send(res, 400, { message: "Add an email address we can reply to." }); if (String(b.msg || "").trim().length < 5) return send(res, 400, { message: "Add a message." });
      if (support.filter((m) => m.email === e && Date.now() - Date.parse(m.created_at) < 3600e3).length >= 5) return send(res, 400, { message: "Too many messages just now. Try again in an hour, or email support@getfloorcall.com." });
      support.push({ id: uid(), created_at: now(), user_id: me || null, name: String(b.who || "").trim(), email: e, topic: ["question", "bug", "billing", "club", "privacy", "idea"].includes(b.topic) ? b.topic : "question", message: String(b.msg).trim(), site: b.site || null, status: "open" }); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/admin_support") return admins.has(me) ? send(res, 200, [...support].reverse().sort((a, c) => (a.status === "open" ? 0 : 1) - (c.status === "open" ? 0 : 1))) : send(res, 400, { message: "Admins only" });
    if (p === "/rest/v1/rpc/admin_support_done") { if (!admins.has(me)) return send(res, 400, { message: "Admins only" }); const m = support.find((x) => x.id === b.mid); if (m) m.status = b.done === false ? "open" : "done"; return send(res, 200, null); }
    if (p === "/rest/v1/rpc/redeem_code") { if (!me) return send(res, 401, { message: "Sign in first." }); const c = String(b.invite || "").trim().toUpperCase(); const inv = invites.get(c);
      if (inv) { if (!members.some((m) => m.team_id === inv.team_id && m.user_id === me)) members.push({ team_id: inv.team_id, user_id: me, role: inv.role, email: users.get(me).email, joined_at: now(), status: inv.role === "viewer" ? "active" : "pending" }); return send(res, 200, { kind: "team", id: inv.team_id, name: teams.get(inv.team_id)?.name || "", role: inv.role }); }
      const a = [...L.athletes.values()].find((y) => y.code === c); if (a) { if (!L.access.some((x) => x.athlete_id === a.id && x.user_id === me)) L.access.push({ athlete_id: a.id, user_id: me, role: (b.as_role || users.get(me)?.meta?.kind) === "parent" ? "parent" : "athlete", joined_at: now() }); return send(res, 200, { kind: "lessons", id: a.id, name: a.name }); }
      return send(res, 400, { message: "That code doesn't match. Check it with your coach or trainer." }); }
    if (p === "/rest/v1/rpc/my_coverage") { if (!me) return send(res, 200, { teams: [], lessons: [] });
      return send(res, 200, { teams: members.filter((m) => m.user_id === me && (m.status || "active") === "active").map((m) => ({ id: m.team_id, name: teams.get(m.team_id)?.name || "", role: m.role })),
        lessons: L.access.filter((x) => x.user_id === me).map((x) => { const a = L.athletes.get(x.athlete_id); return { athlete: a?.name, trainer: users.get(a?.trainer)?.meta?.name || "Your trainer" }; }) }); }
    // version 33: badges and drill picks
    const onTeam = (t, roles) => members.some((m) => m.team_id === t && m.user_id === me && (m.status || "active") === "active" && (!roles || roles.includes(m.role)));
    if (p === "/rest/v1/rpc/team_badges") return send(res, 200, !onTeam(b.t) ? [] : members.filter((m) => m.team_id === b.t && m.role !== "viewer").map((m) => ({ user_id: m.user_id, role: m.role, badge: admins.has(m.user_id) ? "admin" : coachVerify.get(m.user_id)?.status === "approved" || (!coachVerify.get(m.user_id) && coachOk(m.user_id) && m.role === "owner") ? "verified" : m.role === "coach" && (m.status || "active") === "active" ? "assistant" : m.role === "owner" ? "not" : null })));
    if (p === "/rest/v1/rpc/team_pick_drill") { if (!onTeam(b.t, ["owner", "coach"])) return send(res, 400, { message: "Only the team's coaches pick drills." }); const i = drillPicks.findIndex((x) => x.team_id === b.t && x.drill_id === b.drill); if (i >= 0) drillPicks.splice(i, 1); if (b.pick) drillPicks.push({ team_id: b.t, drill_id: b.drill, note: b.note || null, at: now() }); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/team_drill_list") return send(res, 200, onTeam(b.t) ? drillPicks.filter((x) => x.team_id === b.t).reverse().map((x) => ({ drill: x.drill_id, note: x.note, at: x.at })) : []);
    if (p === "/rest/v1/rpc/my_drill_picks") return send(res, 200, drillPicks.filter((x) => members.some((m) => m.team_id === x.team_id && m.user_id === me && (m.status || "active") === "active")).reverse().map((x) => ({ team: teams.get(x.team_id)?.name || "", drill: x.drill_id, note: x.note, at: x.at })));
    // ---- notes from coaches (version 34) ----
    if (p.startsWith("/rest/v1/rpc/team_note") || p === "/rest/v1/rpc/my_notes" || p === "/rest/v1/rpc/note_read" || p === "/rest/v1/rpc/team_link_member" || p === "/rest/v1/rpc/team_member_links") {
      const staff = (t) => canEdit(t, me), linked = (t) => noteLinks.filter((x) => x.team_id === t && x.user_id === me).map((x) => x.player_id);
      const visible = (n) => staff(n.team_id) || (isMember(n.team_id, me) && (n.audience === "team" || n.players.some((x) => linked(n.team_id).includes(x))));
      const view = (n) => ({ id: n.id, kind: n.kind, about: n.about, match_id: n.match_id, title: n.title, body: n.body, audience: n.audience, players: staff(n.team_id) ? n.players : n.players.filter((x) => linked(n.team_id).includes(x)), group: n.group, by: n.by, at: n.at, edited: n.edited, read: n.reads.has(me), reads: staff(n.team_id) ? n.reads.size : null, team: teams.get(n.team_id)?.name, team_id: n.team_id });
      if (p === "/rest/v1/rpc/team_note_save") {
        if (!staff(b.t)) return send(res, 400, { message: "Only the team's coaches write notes." });
        if (!String(b.bo || "").trim()) return send(res, 400, { message: "Write the note first." });
        if (b.aud === "players" && !(b.ps || []).length) return send(res, 400, { message: "Pick at least one player." });
        const u = [...users.values()].find((x) => x.id === me), fields = { kind: b.k || "general", about: (b.ab || "").trim() || null, match_id: b.mid || null, title: (b.ti || "").trim() || null, body: b.bo.trim(), audience: b.aud || "team", players: b.aud === "players" ? b.ps : [], group: b.aud === "players" ? b.grp || null : null };
        if (b.nid) { const n = notes.find((x) => x.id === b.nid && x.team_id === b.t); if (!n) return send(res, 400, { message: "That note is gone." }); Object.assign(n, fields, { edited: now() }); n.reads = new Set(); return send(res, 200, n.id); }
        const n = { id: "nt-" + Math.random().toString(36).slice(2, 10), team_id: b.t, by: u?.meta?.name || (u?.email || "Coach").split("@")[0], at: now(), edited: null, reads: new Set(), ...fields }; notes.push(n); return send(res, 200, n.id);
      }
      if (p === "/rest/v1/rpc/team_note_delete") { if (!staff(b.t)) return send(res, 400, { message: "Only the team's coaches delete notes." }); const i = notes.findIndex((x) => x.id === b.nid); if (i >= 0) notes.splice(i, 1); return send(res, 200, null); }
      if (p === "/rest/v1/rpc/team_notes_list") return send(res, 200, notes.filter((n) => n.team_id === b.t && visible(n)).sort((x, y) => y.at.localeCompare(x.at)).map(view));
      if (p === "/rest/v1/rpc/my_notes") return send(res, 200, notes.filter(visible).sort((x, y) => y.at.localeCompare(x.at)).map(view));
      if (p === "/rest/v1/rpc/note_read") { const n = notes.find((x) => x.id === b.nid); if (n && visible(n)) n.reads.add(me); return send(res, 200, null); }
      if (p === "/rest/v1/rpc/team_link_member") { if (!staff(b.t)) return send(res, 400, { message: "Only the team's coaches link players." }); for (let i = noteLinks.length - 1; i >= 0; i--) if (noteLinks[i].team_id === b.t && noteLinks[i].user_id === b.u) noteLinks.splice(i, 1); (b.ps || []).forEach((x) => noteLinks.push({ team_id: b.t, user_id: b.u, player_id: x })); return send(res, 200, null); }
      if (p === "/rest/v1/rpc/team_member_links") { if (!staff(b.t)) return send(res, 200, []); return send(res, 200, members.filter((m) => m.team_id === b.t && m.role === "viewer" && m.status !== "pending").map((m) => ({ user_id: m.user_id, email: m.email, role: m.role, players: noteLinks.filter((x) => x.team_id === b.t && x.user_id === m.user_id).map((x) => x.player_id) }))); }
    }
    if (p === "/rest/v1/rpc/coach_status") { if (admins.has(me)) return send(res, 200, { status: "approved", admin: true }); const c = coachVerify.get(me); return send(res, 200, c ? { status: c.status, name: c.name, org: c.org } : { status: coachOk(me) ? "approved" : "none" }); }
    if (p === "/rest/v1/rpc/coach_request") { if (String(b.name || "").trim().length < 2 || String(b.org || "").trim().length < 2) return send(res, 400, { message: "Add your name and your school or club." }); const cur = coachVerify.get(me); if (cur?.status !== "approved") coachVerify.set(me, { user_id: me, email: users.get(me).email, name: b.name, org: b.org, title: b.title, phone: b.phone, status: "pending", at: now() }); return send(res, 200, coachVerify.get(me).status); }
    // FloorCall Lessons (version 31): mirrors the lesson_* functions in schema.sql
    if (p.startsWith("/rest/v1/rpc/lesson_") || p === "/rest/v1/rpc/my_lessons") {
      const fn = p.slice("/rest/v1/rpc/".length), bad = (m) => send(res, 400, { message: m });
      const code6 = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
      const mineA = (id) => { const a = L.athletes.get(id); return a && a.trainer === me ? a : null; };
      const mineS = (id) => { const x = L.sessions.get(id); return x && x.trainer === me ? x : null; };
      const myAthletes = () => L.access.filter((x) => x.user_id === me).map((x) => x.athlete_id);
      const trainerName = (u) => users.get(u)?.meta?.name || "Your trainer";
      const pending = (sid) => L.requests.filter((q) => q.session_id === sid && q.status === "pending").length;
      if (fn === "lesson_public") { const x = [...L.sessions.values()].find((y) => y.public && y.code === String(b.c).trim().toUpperCase()); return send(res, 200, x ? { title: x.title, starts: x.starts, minutes: x.minutes, place: x.place, focus: x.focus, price: x.price, shared_note: x.shared_note, spots: x.capacity == null ? null : Math.max(x.capacity - x.athletes.length - pending(x.id), 0), trainer: trainerName(x.trainer), status: x.status } : null); }
      if (fn === "lesson_signup") { const x = [...L.sessions.values()].find((y) => y.public && y.code === String(b.c).trim().toUpperCase() && y.status === "scheduled" && y.starts > new Date().toISOString()); if (!x) return bad("Sign-ups for this clinic are closed."); if (String(b.who || "").trim().length < 2 || String(b.contact || "").trim().length < 5) return bad("Add the player's name and a parent's email or phone."); if (x.capacity != null && x.athletes.length + pending(x.id) >= x.capacity) return bad("This clinic is full."); L.requests.push({ id: uid(), session_id: x.id, name: String(b.who).trim(), contact: String(b.contact).trim(), note: b.note || null, status: "pending", created_at: now() }); return send(res, 200, null); }
      if (!me) return send(res, 401, { message: "Sign in first." });
      if (fn === "lesson_trainer_data") { const S = [...L.sessions.values()].filter((x) => x.trainer === me).sort((a, c) => a.starts.localeCompare(c.starts)); const ids = new Set(S.map((x) => x.id));
        return send(res, 200, { athletes: [...L.athletes.values()].filter((a) => a.trainer === me).sort((a, c) => a.name.localeCompare(c.name)).map((a) => ({ ...a, joined: L.access.filter((x) => x.athlete_id === a.id).map((x) => ({ role: x.role, email: users.get(x.user_id)?.email })) })),
          sessions: S, roster: [...L.roster.values()].filter((r) => ids.has(r.session_id)), requests: L.requests.filter((q) => ids.has(q.session_id) && q.status === "pending"), verified: coachOk(me) }); }
      if (fn === "lesson_save_athlete") { const a = b.a || {}; if (!coachOk(me)) return bad("Verify your coach account first: FloorCall checks every trainer before they add athletes."); if (!String(a.name || "").trim()) return bad("Add the athlete's name."); const cur = L.athletes.get(a.id); if (cur && cur.trainer !== me) return bad("Not your athlete."); L.athletes.set(a.id, { ...(cur || { code: null, created_at: now() }), id: a.id, trainer: me, name: String(a.name).trim().slice(0, 80), grad: a.grad || null, position: a.position || null, club: a.club || null, contact: a.contact || null, notes: a.notes || null, updated_at: now() }); return send(res, 200, null); }
      if (fn === "lesson_delete_athlete") { if (mineA(b.aid)) { L.athletes.delete(b.aid); for (const x of L.sessions.values()) if (x.trainer === me) x.athletes = x.athletes.filter((i) => i !== b.aid); L.access = L.access.filter((x) => x.athlete_id !== b.aid); for (const [k, r] of L.roster) if (r.athlete_id === b.aid) L.roster.delete(k); } return send(res, 200, null); }
      if (fn === "lesson_invite") { const a = mineA(b.aid); if (!a) return bad("Not your athlete."); if (!a.code || b.fresh) a.code = code6(); return send(res, 200, a.code); }
      if (fn === "lesson_save_session") { const x = b.x || {}; if (!coachOk(me)) return bad("Verify your coach account first."); const cur = L.sessions.get(x.id); if (cur && cur.trainer !== me) return bad("Not your session.");
        const pub = !!x.public; L.sessions.set(x.id, { id: x.id, trainer: me, starts: new Date(x.starts).toISOString(), minutes: +x.minutes || 60, kind: x.kind || "private", title: x.title || null, place: x.place || null, capacity: x.capacity === "" || x.capacity == null ? null : +x.capacity, focus: x.focus || [], athletes: (x.athletes || []).filter((i) => mineA(i)), open: !!x.open, public: pub, code: cur?.code || (pub ? code6() : null), price: x.price || null, notes: x.notes || null, shared_note: x.shared_note || null, status: x.status || "scheduled", created_at: cur?.created_at || now(), updated_at: now() }); return send(res, 200, null); }
      if (fn === "lesson_delete_session") { if (mineS(b.sid)) { L.sessions.delete(b.sid); for (const [k, r] of L.roster) if (r.session_id === b.sid) L.roster.delete(k); } return send(res, 200, null); }
      if (fn === "lesson_save_roster") { if (!mineS(b.sid) || !mineA(b.aid)) return bad("Not your session."); L.roster.set(b.sid + "|" + b.aid, { session_id: b.sid, athlete_id: b.aid, reps: b.reps || {}, attended: b.attended ?? null, paid: !!b.paid, updated_at: now() }); return send(res, 200, null); }
      if (fn === "lesson_request_decide") { const q = L.requests.find((r) => r.id === b.rid); const x = q && mineS(q.session_id); if (!x) return bad("Not your clinic."); q.status = b.accept ? "accepted" : "declined"; if (!b.accept) return send(res, 200, null); const aid = "la_" + uid(); L.athletes.set(aid, { id: aid, trainer: me, name: q.name, contact: q.contact, code: null, created_at: now(), updated_at: now() }); x.athletes.push(aid); return send(res, 200, aid); }
      if (fn === "lesson_join") { const a = [...L.athletes.values()].find((y) => y.code && y.code === String(b.invite).trim().toUpperCase()); if (!a) return bad("That code doesn't match. Check it with your trainer."); L.access = L.access.filter((x) => !(x.athlete_id === a.id && x.user_id === me)); L.access.push({ athlete_id: a.id, user_id: me, role: b.as_role === "parent" ? "parent" : "athlete", joined_at: now() }); return send(res, 200, a.name); }
      if (fn === "my_lessons") { const mine = myAthletes(), trainers = new Set(mine.map((i) => L.athletes.get(i)?.trainer)); const t = new Date().toISOString();
        return send(res, 200, { athletes: L.access.filter((x) => x.user_id === me).map((x) => { const a = L.athletes.get(x.athlete_id); return { id: a.id, name: a.name, role: x.role, trainer: trainerName(a.trainer) }; }),
          sessions: [...L.sessions.values()].filter((x) => x.status !== "canceled" && (x.athletes.some((i) => mine.includes(i)) || (x.open && x.starts > t && trainers.has(x.trainer)))).sort((a, c) => a.starts.localeCompare(c.starts))
            .map((x) => ({ id: x.id, starts: x.starts, minutes: x.minutes, kind: x.kind, title: x.title, place: x.place, focus: x.focus, shared_note: x.shared_note, status: x.status, price: x.price, mine: x.athletes.filter((i) => mine.includes(i)), spots: x.capacity == null ? null : Math.max(x.capacity - x.athletes.length, 0), open: x.open })),
          roster: [...L.roster.values()].filter((r) => mine.includes(r.athlete_id)).map(({ session_id, athlete_id, reps, attended, paid }) => ({ session_id, athlete_id, reps, attended, paid })) }); }
      if (fn === "lesson_book") { if (!myAthletes().includes(b.aid)) return bad("Not your athlete."); const x = L.sessions.get(b.sid); if (!x || x.trainer !== L.athletes.get(b.aid).trainer) return bad("That session isn't available."); const t = new Date().toISOString();
        if (b.join_it !== false) { if (!x.open || x.status !== "scheduled" || x.starts < t) return bad("That session isn't open for booking."); if (x.capacity != null && x.athletes.length >= x.capacity && !x.athletes.includes(b.aid)) return bad("That session is full."); x.athletes = [...x.athletes.filter((i) => i !== b.aid), b.aid]; }
        else { if (x.starts < t) return bad("That session has already started."); x.athletes = x.athletes.filter((i) => i !== b.aid); } return send(res, 200, null); }
      return send(res, 404, { message: "no such function " + fn });
    }
    const pubEvents = (ev) => (ev || []).filter((e) => e.t !== "TAG");
    const pubUrl = (u) => (typeof u === "string" && /^https?:\/\//.test(u) ? u : null);
    const pubPlayer = (d) => ({ id: d.id, num: d.num, pos: d.pos, first: d.hidePublic ? "" : d.first || "", last: d.hidePublic ? "" : (d.last || "").slice(0, 1), photo: d.hidePublic ? null : pubUrl(d.photo) });
    const pubMatch = (m) => m && ({ id: m.id, opp: m.opp, date: m.date, event: m.event, status: m.status, kind: m.kind, bestOf: m.bestOf, setTo: m.setTo, cap: m.cap, scrim: m.scrim, oppLogo: pubUrl(m.oppLogo), oppRoster: m.oppRoster });
    if (p === "/rest/v1/rpc/recruit_seen") { const r = recruits.get(String(b.share).toUpperCase()); if (r) { r.views = (r.views || 0) + 1; r.last_viewed = new Date().toISOString(); } return send(res, 200, null); }
    if (p === "/rest/v1/rpc/watch") {
      const s = shares.get(String(b.share).toUpperCase()); if (!s) return send(res, 200, null);
      const R = [...records.values()].filter((r) => r.team_id === s.team_id && !r.deleted);
      const tr = R.find((r) => r.store === "teams" && r.id === s.team_id);
      return send(res, 200, { team: tr && { name: tr.data.name, color: tr.data.color, level: tr.data.level, logo: pubUrl(tr.data.logo) }, match: pubMatch((R.find((r) => r.store === "matches" && r.id === s.match_id) || {}).data) || null,
        logs: R.filter((r) => r.store === "logs" && r.data.matchId === s.match_id).map((r) => pubEvents(r.data.events)), players: R.filter((r) => r.store === "players").map((r) => pubPlayer(r.data)), at: new Date().toISOString() });
    }
    if (p === "/rest/v1/rpc/delete_my_account") {
      if (!me) return send(res, 401, { message: "JWT required" });
      for (const [id, t] of teams) if (t.owner === me) { teams.delete(id); for (const [k, r] of records) if (r.team_id === id) records.delete(k); for (let i = members.length - 1; i >= 0; i--) if (members[i].team_id === id) members.splice(i, 1); }
      for (let i = members.length - 1; i >= 0; i--) if (members[i].user_id === me) members.splice(i, 1);
      users.delete(me); for (const [k, v] of tokens) if (v === me) tokens.delete(k); return send(res, 204);
    }
    if (p === "/auth/v1/settings") return send(res, 200, { mailer_autoconfirm: true, disable_signup: false });
    if (p === "/rest/v1/rpc/schema_version") return send(res, 200, 34);
    if (p === "/rest/v1/rpc/server_time") return send(res, 200, Date.now() + (+process.env.MOCK_CLOCK_SKEW || 0));
    if (p === "/rest/v1/rpc/recruit_view") { const r = recruits.get(String(b.share).toUpperCase()); return send(res, 200, r ? { html: r.html, data: r.data || null, updated_at: r.updated_at } : null); }
    if (p === "/rest/v1/rpc/recruit_board") { const bd = boards.get(String(b.share).toUpperCase()); if (!bd) return send(res, 200, null); const tr = [...records.values()].find((r) => r.store === "teams" && r.id === bd.team_id && !r.deleted);
      return send(res, 200, { team: tr && { name: tr.data.name, level: tr.data.level }, players: [...recruits.values()].filter((r) => r.team_id === bd.team_id && r.data).map((r) => ({ code: r.code, updated_at: r.updated_at, player: r.data.player, profile: { club: r.data.profile?.club, video: r.data.profile?.video }, season: r.data.season, clips: (r.data.clips || []).length })) }); }
    if (p === "/rest/v1/rpc/season_view") {
      const s = seasonShares.get(String(b.share).toUpperCase()); if (!s) return send(res, 200, null);
      const R = [...records.values()].filter((r) => r.team_id === s.team_id && !r.deleted);
      const tr = R.find((r) => r.store === "teams" && r.id === s.team_id), se = R.find((r) => r.store === "seasons" && r.id === s.season_id);
      const ms = R.filter((r) => r.store === "matches" && r.data.seasonId === s.season_id && r.data.kind === "match").map((r) => r.data), ids = new Set(ms.map((m) => m.id));
      return send(res, 200, { team: tr && { name: tr.data.name, level: tr.data.level, color: tr.data.color, logo: pubUrl(tr.data.logo), schedule: tr.data.schedule || [], tournaments: tr.data.tournaments || [] }, season: se && se.data.name,
        matches: ms.map((m) => ({ id: m.id, opp: m.opp, date: m.date, bestOf: m.bestOf, setTo: m.setTo, cap: m.cap, status: m.status, event: m.event, site: m.site, imported: m.imported ? { season: m.imported.season } : null, tournamentId: m.tournamentId, oppLogo: pubUrl(m.oppLogo), oppRoster: m.oppRoster })),
        logs: R.filter((r) => r.store === "logs" && ids.has(r.data.matchId)).map((r) => ({ matchId: r.data.matchId, events: pubEvents(r.data.events) })),
        players: R.filter((r) => r.store === "players" && r.data.active !== false).map((r) => pubPlayer(r.data)), live: [...shares.values()].filter((x) => x.team_id === s.team_id).map((x) => ({ matchId: x.match_id, code: x.code })),
        practices: R.filter((r) => r.store === "plans" && r.data.status !== "done" && r.data.date >= new Date(Date.now() - 864e5).toISOString().slice(0, 10)).map((r) => ({ id: r.data.id, date: r.data.date, start: r.data.start, title: String(r.data.title || "").slice(0, 80), plan: r.data.share ? (r.data.blocks || []).map((b) => ({ title: String(b.title || "").slice(0, 60), minutes: b.minutes })) : null })).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), at: new Date().toISOString() });
    }
    if (p === "/rest/v1/app_errors" && req.method === "POST") { if (!b?.message || b.message.length > 300) return send(res, 403, { message: "row-level security" }); appErrors.push({ ...b, uid: me, at: new Date().toISOString() }); return send(res, 201); }
    if (p === "/__mock/errors") return send(res, 200, appErrors);
    if (p === "/functions/v1/notify") {
      if (b.action === "key") return send(res, 200, { key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" });
      if (b.action === "subscribe") { if (!me) return send(res, 401, { error: "Sign in to turn on notifications." }); const s = seasonShares.get(String(b.code).toUpperCase()); if (!s) return send(res, 404, { error: "That team page isn't shared anymore." }); if (!b.sub?.endpoint) return send(res, 400, { error: "bad" }); pushSubs.set(b.sub.endpoint, { endpoint: b.sub.endpoint, team_id: s.team_id, starts: b.starts !== false, finals: b.finals !== false, player: b.player || null, user_id: me }); return send(res, 200, { ok: true }); }
      if (b.action === "unsubscribe") { pushSubs.delete(b.endpoint); return send(res, 200, { ok: true }); }
      if (b.action === "send") {
        if (!me || !canEdit(b.team_id, me)) return send(res, 403, { error: "Only the team's coaches can send notifications." });
        const k = b.match_id + ":" + b.kind; if (pushSent.has(k)) return send(res, 200, { sent: 0, duplicate: true }); pushSent.add(k);
        const to = [...pushSubs.values()].filter((x) => x.team_id === b.team_id && (b.kind === "post" || (b.kind === "start" ? x.starts : x.finals)));
        pushes.push({ kind: b.kind, title: b.title, body: b.body, base: b.base, match_id: b.match_id, to: to.length, bodies: to.map((x) => (x.player && b.lines?.[x.player] ? b.lines[x.player] + " · " : "") + b.body) });
        return send(res, 200, { sent: to.length });
      }
      return send(res, 400, { error: "Unknown action." });
    }
    if (p === "/functions/v1/ai") { if (!me) return send(res, 401, { message: "JWT required" }); return send(res, 200, { content: [{ type: "text", text: "Strengths:\n- Mock report from the server function (" + b.model + ")" }], stop_reason: "end_turn" }); }
    if (!me) return send(res, 401, { message: "JWT required" });
    if (p === "/rest/v1/rpc/college_request") { const u = [...users.values()].find((x) => x.id === me); if (!/\.edu$/i.test(u.email)) return send(res, 400, { message: "Use your school email (ending in .edu) so we can confirm you coach at a college." }); const cur = staff.get(me); if (cur?.status !== "approved") staff.set(me, { user_id: me, email: u.email, name: b.name, school: b.school, title: b.title, status: cur?.status === "denied" ? "denied" : "pending", at: now() }); return send(res, 200, staff.get(me).status); }
    if (p === "/rest/v1/rpc/college_status") { const s = staff.get(me); return send(res, 200, s ? { status: s.status, name: s.name, school: s.school } : { status: "none" }); }
    if (p === "/rest/v1/rpc/college_contact") { const s = staff.get(me); if (s?.status !== "approved") return send(res, 400, { message: "College staff only" }); if (!String(b.b || "").trim()) return send(res, 400, { message: "Write a message first" }); const r = recruits.get(String(b.c).toUpperCase()); if (!r || !r.listed) return send(res, 400, { message: "That player isn't listed anymore" }); if (interest.some((x) => x.from === me && x.code === r.code)) return send(res, 400, { message: "You wrote to this player's coaches this week. They have your message." }); interest.push({ id: uid(), team_id: r.team_id, code: r.code, player: `${r.data?.player?.first || ""} ${r.data?.player?.last || ""}`.trim(), from: me, name: s.name, school: s.school, title: s.title, email: s.email, body: String(b.b).trim().slice(0, 1500), at: now(), read: false }); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/college_inbox") { if (!canEdit(b.t, me)) return send(res, 200, null); return send(res, 200, interest.filter((x) => x.team_id === b.t).sort((a, c) => c.at.localeCompare(a.at)).map((x) => ({ id: x.id, player: x.player, code: x.code, name: x.name, school: x.school, title: x.title, email: x.email, body: x.body, at: x.at, new: !x.read }))); }
    if (p === "/rest/v1/rpc/college_inbox_read") { if (canEdit(b.t, me)) interest.forEach((x) => { if (x.team_id === b.t) x.read = true; }); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/recruit_search") {
      if (staff.get(me)?.status !== "approved") return send(res, 400, { message: "College staff only" });
      const f = b?.f || {}, out = [...recruits.values()].filter((r) => r.listed && r.data).filter((r) => { const d = r.data, s = d.season || {};
        if (f.grad?.length && !f.grad.includes(d.player.grad)) return false; if (f.pos?.length && !f.pos.some((x) => String(d.player.pos || "").toUpperCase().includes(x))) return false;
        if (f.q && !`${d.player.first} ${d.player.last} ${d.team?.name || ""} ${d.profile?.club || ""}`.toLowerCase().includes(String(f.q).toLowerCase())) return false;
        if (f.region && String(d.team?.region || "").toLowerCase() !== String(f.region).toLowerCase()) return false;
        for (const [k, v] of Object.entries(f.min || {})) if (typeof v === "number" && !(typeof s[k] === "number" && s[k] >= v)) return false; return true; })
        .map((r) => ({ code: r.code, updated: r.updated_at, player: r.data.player, team: r.data.team, ranks: r.data.ranks || [], clips: (r.data.clips || []).length, season: r.data.season }));
      return send(res, 200, out);
    }
    if (p === "/__mock/staff") return send(res, 200, [...staff.values()]);
    if (p === "/rest/v1/rpc/post_send") { if (!canEdit(b.t, me)) return send(res, 400, { message: "Only the team's coaches can post announcements" }); if (!String(b.b || "").trim()) return send(res, 400, { message: "Write a message first" }); const u = [...users.values()].find((x) => x.id === me); const po = { id: uid(), team_id: b.t, body: String(b.b).trim(), by: u?.meta?.name || "Coach", pinned: !!b.pin, at: now(), reads: new Set() }; posts.push(po); return send(res, 200, { ...po, reads: 0, team_id: undefined }); }
    if (p === "/rest/v1/rpc/post_update") { const i = posts.findIndex((x) => x.id === b.pid); if (i < 0 || !canEdit(posts[i].team_id, me)) return send(res, 400, { message: "Only the team's coaches can change announcements" }); if (b.del) posts.splice(i, 1); else if (b.pin != null) posts[i].pinned = !!b.pin; return send(res, 200, null); }
    if (p === "/rest/v1/rpc/posts_for_team") { if (!isMember(b.t, me)) return send(res, 200, null); return send(res, 200, posts.filter((x) => x.team_id === b.t).sort((a, c) => +c.pinned - +a.pinned || c.at.localeCompare(a.at)).map((x) => ({ id: x.id, body: x.body, by: x.by, pinned: x.pinned, at: x.at, reads: x.reads.size }))); }
    if (p === "/rest/v1/rpc/rsvp_set") { if (!me) return send(res, 401, { message: "Sign in to answer" }); const ss = seasonShares.get(String(b.c).toUpperCase()); if (!ss) return send(res, 400, { message: "That team page isn't shared anymore" }); const k = ss.team_id + "|" + b.item + "|" + me; if (!b.s) rsvps.delete(k); else if (!["yes", "no", "maybe"].includes(b.s)) return send(res, 400, { message: "Choose going, can't go or maybe" }); else { const u = [...users.values()].find((x) => x.id === me); rsvps.set(k, { team_id: ss.team_id, item: b.item, user: me, name: u?.meta?.name || "A follower", status: b.s, player: b.p || null, at: now() }); } return send(res, 200, null); }
    if (p === "/rest/v1/rpc/rsvps_by_code") { if (!me) return send(res, 401, { message: "Sign in to answer" }); const ss = seasonShares.get(String(b.c).toUpperCase()); if (!ss) return send(res, 200, null); const out = {}; for (const r of rsvps.values()) if (r.team_id === ss.team_id) { const o = (out[r.item] = out[r.item] || { yes: 0, no: 0, maybe: 0, mine: null }); o[r.status]++; if (r.user === me) o.mine = r.status; } return send(res, 200, out); }
    if (p === "/rest/v1/rpc/rsvps_for_team") { if (!isMember(b.t, me)) return send(res, 200, null); return send(res, 200, [...rsvps.values()].filter((r) => r.team_id === b.t).map((r) => ({ item: r.item, name: r.name, status: r.status, player: r.player || null, at: r.at }))); }
    if (p === "/rest/v1/rpc/tryout_publish") { if (!me) return send(res, 401, { message: "Sign in to share a tryout" }); if (b.c) { const t = tryoutsCloud.get(String(b.c).toUpperCase()); if (!t || t.owner !== me) return send(res, 400, { message: "That tryout isn't yours to update" }); t.data = b.d; return send(res, 200, String(b.c).toUpperCase()); } const k = uid().replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase(); tryoutsCloud.set(k, { owner: me, data: b.d }); return send(res, 200, k); }
    if (p === "/rest/v1/rpc/tryout_open") { if (!me) return send(res, 401, { message: "Sign in to rate at this tryout" }); const k = String(b.c).toUpperCase(), t = tryoutsCloud.get(k); if (!t) return send(res, 200, null); return send(res, 200, { code: k, data: t.data, mine: tryoutRatings.get(k + "|" + me)?.ratings || null, owner: t.owner === me }); }
    if (p === "/rest/v1/rpc/tryout_rate") { if (!me) return send(res, 401, { message: "Sign in to rate at this tryout" }); const k = String(b.c).toUpperCase(); if (!tryoutsCloud.has(k)) return send(res, 400, { message: "That tryout isn't shared anymore" }); tryoutRatings.set(k + "|" + me, { code: k, user: me, name: String(b.nm || "Evaluator").slice(0, 40), ratings: b.r, at: now() }); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/tryout_all") { const k = String(b.c).toUpperCase(), t = tryoutsCloud.get(k); if (!t || t.owner !== me) return send(res, 200, null); return send(res, 200, [...tryoutRatings.values()].filter((x) => x.code === k).map((x) => ({ name: x.name, ratings: x.ratings, at: x.at }))); }
    if (p === "/rest/v1/rpc/tryout_unshare") { const k = String(b.c).toUpperCase(), t = tryoutsCloud.get(k); if (t && t.owner === me) { tryoutsCloud.delete(k); for (const x of [...tryoutRatings.keys()]) if (x.startsWith(k + "|")) tryoutRatings.delete(x); } return send(res, 200, null); }
    if (p === "/rest/v1/rpc/job_take") { if (!me) return send(res, 401, { message: "Sign in to volunteer" }); const ss = seasonShares.get(String(b.c).toUpperCase()); if (!ss) return send(res, 400, { message: "That team page isn't shared anymore" }); const k = [ss.team_id, b.item, b.job, me].join("|"); if (b.take === false) signups.delete(k); else { if ([...signups.values()].filter((x) => x.team_id === ss.team_id && x.item === b.item && x.job === b.job).length >= 10) return send(res, 400, { message: "That job is full" }); const u = [...users.values()].find((x) => x.id === me); if (!signups.has(k)) signups.set(k, { team_id: ss.team_id, item: b.item, job: b.job, user: me, name: u?.meta?.name || "A volunteer", at: now() }); } return send(res, 200, null); }
    if (p === "/rest/v1/rpc/jobs_by_code") { if (!me) return send(res, 401, { message: "Sign in to volunteer" }); const ss = seasonShares.get(String(b.c).toUpperCase()); if (!ss) return send(res, 200, null); const out = {}; for (const x of signups.values()) if (x.team_id === ss.team_id) { const o = (out[x.item + "/" + x.job] = out[x.item + "/" + x.job] || { n: 0, mine: false }); o.n++; if (x.user === me) o.mine = true; } return send(res, 200, out); }
    if (p === "/rest/v1/rpc/jobs_for_team") { if (!isMember(b.t, me)) return send(res, 200, null); return send(res, 200, [...signups.values()].filter((x) => x.team_id === b.t).map((x) => ({ item: x.item, job: x.job, name: x.name, at: x.at }))); }
    if (p === "/rest/v1/rpc/plays_publish") { if (!canEdit(b.t, me)) return send(res, 400, { message: "Only the team's coaches can share plays" }); if (!Array.isArray(b.d)) return send(res, 400, { message: "Those plays can't be shared" }); if (b.d.length) teamPlays.set(b.t, b.d); else teamPlays.delete(b.t); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/plays_by_code") { if (!me) return send(res, 401, { message: "Sign in to see the team's plays" }); const ss = seasonShares.get(String(b.c).toUpperCase()); if (!ss) return send(res, 200, null); return send(res, 200, teamPlays.get(ss.team_id) || []); }
    if (p === "/rest/v1/rpc/posts_by_code") { if (!me) return send(res, 401, { message: "Sign in to read team announcements" }); const ss = seasonShares.get(String(b.c).toUpperCase()); if (!ss) return send(res, 200, null); const out = posts.filter((x) => x.team_id === ss.team_id).sort((a, c) => +c.pinned - +a.pinned || c.at.localeCompare(a.at)).map((x) => ({ id: x.id, body: x.body, by: x.by, pinned: x.pinned, at: x.at, new: !x.reads.has(me) })); posts.forEach((x) => { if (x.team_id === ss.team_id) x.reads.add(me); }); return send(res, 200, out); }
    if (p === "/rest/v1/rpc/film_share") { if (!canEdit(b.t, me)) return send(res, 400, { message: "Only the team's coaches can share film" }); let f = [...films.values()].find((x) => x.team_id === b.t && x.session_id === b.sid); if (!f) { f = { code: uid().slice(1, 9).toUpperCase().padEnd(8, "X"), team_id: b.t, session_id: b.sid }; films.set(f.code, f); } f.data = b.d; return send(res, 200, f.code); }
    if (p === "/rest/v1/rpc/film_open") { const f = films.get(String(b.c).toUpperCase()); if (!f) return send(res, 200, null); const k = f.code + ":" + me; const v = filmViews.get(k) || { code: f.code, user: me, watched: [] }; v.last = now(); filmViews.set(k, v); return send(res, 200, { ...f.data, watched: v.watched }); }
    if (p === "/rest/v1/rpc/film_watched") { const v = filmViews.get(String(b.c).toUpperCase() + ":" + me); if (v && !v.watched.includes(b.n)) v.watched.push(b.n); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/film_viewers") { const f = films.get(String(b.c).toUpperCase()); if (!f || !canEdit(f.team_id, me)) return send(res, 400, { message: "Only the team's coaches can see who watched" }); return send(res, 200, [...filmViews.values()].filter((v) => v.code === f.code).map((v) => { const u = users.get(v.user); return { name: u?.meta?.name || (u?.email || "").split("@")[0], watched: v.watched.length, last: v.last }; })); }
    if (p === "/rest/v1/rpc/film_unshare") { const f = films.get(String(b.c).toUpperCase()); if (!f || !canEdit(f.team_id, me)) return send(res, 400, { message: "Only the team's coaches can take film down" }); films.delete(f.code); return send(res, 200, null); }
    if (p === "/rest/v1/rpc/admin_email_list" && admins.has(me)) return send(res, 200, [...users.values()].filter((u) => u.meta?.email_ok === true).map((u) => ({ email: u.email, name: u.meta?.name || "", kind: u.meta?.kind || "", joined: now() })));
    if (p === "/rest/v1/rpc/admin_accounts" && admins.has(me)) { const byKind = {}; for (const u of users.values()) { const k = u.meta?.kind || "coach"; byKind[k] = (byKind[k] || 0) + 1; } return send(res, 200, { byKind, emailOk: [...users.values()].filter((u) => u.meta?.email_ok === true).length }); }
    if (p === "/rest/v1/rpc/is_admin") return send(res, 200, admins.has(me));
    if (p.startsWith("/rest/v1/rpc/admin_") && !admins.has(me)) return send(res, 400, { message: "Admins only" });
    if (p === "/rest/v1/rpc/admin_college_staff") return send(res, 200, [...staff.values()]);
    if (p === "/rest/v1/rpc/admin_coach_requests") return send(res, 200, [...coachVerify.values()]);
    if (p === "/rest/v1/rpc/admin_decide_coach") { const c = coachVerify.get(b.uid); if (c) c.status = b.approve ? "approved" : "denied"; return send(res, 200, null); }
    if (p === "/rest/v1/rpc/admin_decide_college") { const s = staff.get(b.uid); if (s) s.status = b.approve ? "approved" : "denied"; return send(res, 200, null); }
    if (p === "/rest/v1/rpc/admin_overview") {
      const R = [...records.values()].filter((r) => !r.deleted), ms = R.filter((r) => r.store === "matches" && r.data.kind === "match");
      return send(res, 200, { users: users.size, users7: users.size, teams: teams.size, activeTeams7: new Set(R.map((r) => r.team_id)).size, matches: ms.length, matches7: ms.length, liveNow: ms.filter((r) => r.data.status === "live").length,
        teamPages: seasonShares.size, gamecasts: shares.size, recruitProfiles: recruits.size, notifyPhones: pushSubs.size,
        errors: Object.values(appErrors.reduce((g, e) => { const x = g[e.message] || (g[e.message] = { message: e.message, count: 0, users: 0, last: e.at, version: e.version, page: e.page, stack: e.stack }); x.count++; x.last = e.at; return g; }, {})),
        recentUsers: [...users.values()].reverse().slice(0, 12).map((u) => ({ email: u.email, at: new Date().toISOString() })),
        teamsList: [...teams.values()].map((t) => ({ id: t.id, name: t.name, members: members.filter((m) => m.team_id === t.id).length, matches: ms.filter((r) => r.team_id === t.id).length, last: new Date().toISOString(), created: new Date().toISOString() })), at: new Date().toISOString() });
    }
    if (p === "/rest/v1/rpc/admin_pictures") return send(res, 200, [...files.keys()].reverse().map((k) => { const path = k.replace(/^media\//, ""), t = teams.get(path.split("/")[0]); return { path, at: new Date().toISOString(), team: t ? t.name : null }; }));
    if (p === "/rest/v1/rpc/admin_remove_picture") {
      files.delete("media/" + b.path);
      for (const r of records.values()) for (const k of ["photo", "logo", "oppLogo"]) if (typeof r.data?.[k] === "string" && r.data[k].includes("/media/" + b.path)) { delete r.data[k]; r.u = Date.now(); r.updated_at = now(); }
      return send(res, 200, null);
    }
    if (p.startsWith("/storage/v1/object/") && req.method === "POST") { const path = p.slice("/storage/v1/object/".length), team = path.split("/")[1]; if (!canEdit(team, me)) return send(res, 403, { message: "new row violates row-level security policy" }); files.set(path, { type: req.headers["content-type"], data: raw }); return send(res, 200, { Key: path }); }
    const P = q(url);
    if (p === "/rest/v1/teams_cloud" && req.method === "POST") { if (!coachOk(me)) return send(res, 403, { message: "new row violates row-level security policy for table \"teams_cloud\"" }); if (teams.has(b.id)) return send(res, 409, { message: "duplicate key" }); teams.set(b.id, { ...b, owner: me }); members.push({ team_id: b.id, user_id: me, role: "owner", email: users.get(me).email, joined_at: now() }); return send(res, 201); }
    // player fees: the owner and coaches only (as row-level security does)
    if (p === "/rest/v1/team_fees" && req.method === "POST") { for (const r of b) { if (!canEdit(r.team_id, me)) return send(res, 403, { message: "new row violates row-level security policy" }); fees.set(r.team_id, { team_id: r.team_id, data: r.data, u: r.u }); } return send(res, 201, null); }
    if (p === "/rest/v1/team_fees" && req.method === "GET") { const t = val(P.team_id); return send(res, 200, canEdit(t, me) && fees.has(t) ? [fees.get(t)] : []); }
    if (p === "/rest/v1/records" && req.method === "POST") {
      for (const r of b) { if (!canEdit(r.team_id, me)) return send(res, 403, { message: "new row violates row-level security policy" }); const k = r.store + "|" + r.id, old = records.get(k); if (old && r.u < old.u) continue; records.set(k, { ...r, updated_at: now() }); }
      return send(res, 201);
    }
    if (p === "/rest/v1/records" && req.method === "GET") {
      const t = val(P.team_id), since = val(P.updated_at), inclusive = P.updated_at.startsWith("gte."); if (!isMember(t, me)) return send(res, 200, []);
      const rows = [...records.values()].filter((r) => r.team_id === t && (canEdit(t, me) || !COACH_STORES.includes(r.store)) && (inclusive ? r.updated_at >= since : r.updated_at > since)).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(0, +P.limit || 500);
      return send(res, 200, rows);
    }
    if (p === "/rest/v1/invites" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); invites.set(b.code, b); return send(res, 201); }
    if (p === "/rest/v1/members" && req.method === "GET" && P.user_id) { return send(res, 200, members.filter((m) => m.user_id === val(P.user_id) && m.user_id === me)); }
    if (p === "/rest/v1/members" && req.method === "GET") { const t = val(P.team_id); return send(res, 200, members.filter((m) => m.team_id === t && (canEdit(t, me) || m.user_id === me))); }
    if (p === "/rest/v1/recruit_boards" && req.method === "GET") { const t = val(P.team_id); return send(res, 200, [...boards.values()].filter((x) => x.team_id === t && isMember(t, me))); }
    if (p === "/rest/v1/recruit_boards" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); boards.set(b.code, b); return send(res, 201); }
    if (p === "/rest/v1/recruit_shares" && req.method === "GET") { const t = val(P.team_id), pl = val(P.player_id); return send(res, 200, [...recruits.values()].filter((r) => r.team_id === t && r.player_id === pl && isMember(t, me))); }
    if (p === "/rest/v1/recruit_shares" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); recruits.set(b.code, { ...b, updated_at: now() }); return send(res, 201); }
    if (p === "/rest/v1/recruit_shares" && req.method === "DELETE") { const t = val(P.team_id), pl = val(P.player_id); if (!canEdit(t, me)) return send(res, 403, { message: "rls" }); for (const [k, r] of recruits) if (r.team_id === t && r.player_id === pl) recruits.delete(k); return send(res, 204); }
    if (p === "/rest/v1/recruit_shares" && req.method === "PATCH" && P.team_id) { const t = val(P.team_id), pl = val(P.player_id); if (!canEdit(t, me)) return send(res, 403, { message: "rls" }); for (const r of recruits.values()) if (r.team_id === t && r.player_id === pl) Object.assign(r, b); return send(res, 204); }
    if (p === "/rest/v1/recruit_shares" && req.method === "PATCH") { const r = recruits.get(val(P.code)); if (!r || !canEdit(r.team_id, me)) return send(res, 403, { message: "rls" }); Object.assign(r, b); return send(res, 204); }
    if (p === "/rest/v1/season_shares" && req.method === "GET") { const t = val(P.team_id), se = val(P.season_id); return send(res, 200, [...seasonShares.values()].filter((s) => s.team_id === t && s.season_id === se && isMember(t, me))); }
    if (p === "/rest/v1/season_shares" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); seasonShares.set(b.code, b); return send(res, 201); }
    if (p === "/rest/v1/live_shares" && req.method === "GET") { const t = val(P.team_id), m = val(P.match_id); return send(res, 200, [...shares.values()].filter((s) => s.team_id === t && s.match_id === m && isMember(t, me))); }
    if (p === "/rest/v1/live_shares" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); shares.set(b.code, b); return send(res, 201); }
    send(res, 404, { message: "not mocked: " + req.method + " " + p });
  });
}); srv.listen(port, () => ok(srv)); });
if (require.main === module) module.exports(+(process.argv[2] || 54321)).then(() => console.log("mock supabase running"));

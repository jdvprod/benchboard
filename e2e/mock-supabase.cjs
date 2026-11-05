// Used by the end-to-end tests. Minimal in-memory stand-in for the Supabase endpoints Benchboard uses, mirroring schema.sql rules.
const http = require("http");
const users = new Map(); // email -> {id,email,pw}
const tokens = new Map(); // token -> userId
const teams = new Map(), members = [], records = new Map(), invites = new Map(), shares = new Map(), seasonShares = new Map(), recruits = new Map(), boards = new Map();
const admins = new Set(), appErrors = [], staff = new Map();
const files = new Map(); // storage: "media/<team>/<file>" -> { type, data }
const pushSubs = new Map(), pushSent = new Set(), pushes = []; // notify function: subscriptions, sent (match:kind), and what went out
let clock = Date.now();
const now = () => new Date(++clock).toISOString();
const uid = () => "u" + Math.random().toString(36).slice(2, 10);
const isMember = (t, u) => members.some((m) => m.team_id === t && m.user_id === u);
const canEdit = (t, u) => members.some((m) => m.team_id === t && m.user_id === u && m.role !== "viewer");
function session(u) { const at = "at_" + uid(), rt = "rt_" + uid(); tokens.set(at, u.id); tokens.set(rt, u.id); return { access_token: at, refresh_token: rt, expires_in: 3600, user: { id: u.id, email: u.email, user_metadata: u.meta || {} } }; }
function send(res, code, body) { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(body === undefined ? "" : JSON.stringify(body)); }
function q(url) { const out = {}; for (const [k, v] of url.searchParams) out[k] = v; return out; }
const val = (s) => s.replace(/^(eq|gte|gt|in)\./, "");

module.exports = (port) => new Promise((ok) => { const srv = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    const raw = Buffer.concat(chunks), isJson = !/^image\//.test(req.headers["content-type"] || ""), body = isJson ? raw.toString() : "";
    const url = new URL(req.url, "http://x"), p = url.pathname, b = body ? JSON.parse(body) : null;
    // Storage: public pictures (no key needed, like Supabase's public buckets)
    if (p.startsWith("/storage/v1/object/public/")) { const f = files.get(p.slice("/storage/v1/object/public/".length)); if (!f) return send(res, 404, { message: "not found" }); res.writeHead(200, { "content-type": f.type, "access-control-allow-origin": "*" }); return res.end(f.data); }
    const tok = (req.headers.authorization || "").replace("Bearer ", ""), me = tokens.get(tok) || null;
    if (p === "/__mock/strip-terms") { for (const u of users.values()) if (u.meta) delete u.meta.terms_version; return send(res, 204); } // simulate accounts made before the terms existed
    if (p === "/__mock/pushes") return send(res, 200, { subs: [...pushSubs.values()], pushes }); // test inspection only
    if (p === "/__mock/make-admin") { const u = [...users.values()].find((x) => x.email === url.searchParams.get("email")); if (u) admins.add(u.id); return send(res, u ? 204 : 404); }
    if (p === "/__mock/users") return send(res, 200, [...users.values()].map((u) => ({ email: u.email, meta: u.meta }))); // test inspection only
    if (!req.headers.apikey) return send(res, 401, { message: "no apikey" });
    // auth
    if (p === "/auth/v1/signup") { if ([...users.values()].some((u) => u.email === b.email)) return send(res, 400, { msg: "User already registered" }); const u = { id: uid(), email: b.email, pw: b.password, meta: b.data || {} }; users.set(u.id, u); return send(res, 200, session(u)); }
    if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") { const u = [...users.values()].find((x) => x.email === b.email && x.pw === b.password); return u ? send(res, 200, session(u)) : send(res, 400, { error_description: "Invalid login credentials" }); }
    if (p === "/auth/v1/token") { const id = tokens.get(b.refresh_token); return id ? send(res, 200, session(users.get(id))) : send(res, 400, { error: "invalid" }); }
    if (p === "/auth/v1/logout" || p === "/auth/v1/recover") return send(res, 204);
    if (p === "/auth/v1/user" && req.method === "PUT") { const u = users.get(me); if (!u) return send(res, 401, { message: "JWT required" }); if (b.data) u.meta = { ...(u.meta || {}), ...b.data }; if (b.password) u.pw = b.password; return send(res, 200, { id: u.id, email: u.email, user_metadata: u.meta }); }
    // rpc
    if (p === "/rest/v1/rpc/join_team") { if (!me) return send(res, 401, { message: "Sign in first" }); const inv = invites.get(String(b.invite).toUpperCase()); if (!inv) return send(res, 400, { message: "That code doesn't match a team" }); if (!isMember(inv.team_id, me)) members.push({ team_id: inv.team_id, user_id: me, role: inv.role, email: users.get(me).email, joined_at: now() }); return send(res, 200, inv.team_id); }
    const pubEvents = (ev) => (ev || []).filter((e) => e.t !== "TAG");
    const pubUrl = (u) => (typeof u === "string" && /^https?:\/\//.test(u) ? u : null);
    const pubPlayer = (d) => ({ id: d.id, num: d.num, pos: d.pos, first: d.hidePublic ? "" : d.first || "", last: d.hidePublic ? "" : (d.last || "").slice(0, 1), photo: d.hidePublic ? null : pubUrl(d.photo) });
    const pubMatch = (m) => m && ({ id: m.id, opp: m.opp, date: m.date, event: m.event, status: m.status, kind: m.kind, bestOf: m.bestOf, setTo: m.setTo, cap: m.cap, scrim: m.scrim, oppLogo: pubUrl(m.oppLogo) });
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
    if (p === "/rest/v1/rpc/schema_version") return send(res, 200, 15);
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
        matches: ms.map((m) => ({ id: m.id, opp: m.opp, date: m.date, bestOf: m.bestOf, setTo: m.setTo, cap: m.cap, status: m.status, event: m.event, site: m.site, imported: m.imported ? { season: m.imported.season } : null, tournamentId: m.tournamentId, oppLogo: pubUrl(m.oppLogo) })),
        logs: R.filter((r) => r.store === "logs" && ids.has(r.data.matchId)).map((r) => ({ matchId: r.data.matchId, events: pubEvents(r.data.events) })),
        players: R.filter((r) => r.store === "players" && r.data.active !== false).map((r) => pubPlayer(r.data)), live: [...shares.values()].filter((x) => x.team_id === s.team_id).map((x) => ({ matchId: x.match_id, code: x.code })), at: new Date().toISOString() });
    }
    if (p === "/rest/v1/app_errors" && req.method === "POST") { if (!b?.message || b.message.length > 300) return send(res, 403, { message: "row-level security" }); appErrors.push({ ...b, uid: me, at: new Date().toISOString() }); return send(res, 201); }
    if (p === "/__mock/errors") return send(res, 200, appErrors);
    if (p === "/functions/v1/notify") {
      if (b.action === "key") return send(res, 200, { key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" });
      if (b.action === "subscribe") { const s = seasonShares.get(String(b.code).toUpperCase()); if (!s) return send(res, 404, { error: "That team page isn't shared anymore." }); if (!b.sub?.endpoint) return send(res, 400, { error: "bad" }); pushSubs.set(b.sub.endpoint, { endpoint: b.sub.endpoint, team_id: s.team_id, starts: b.starts !== false, finals: b.finals !== false, player: b.player || null }); return send(res, 200, { ok: true }); }
      if (b.action === "unsubscribe") { pushSubs.delete(b.endpoint); return send(res, 200, { ok: true }); }
      if (b.action === "send") {
        if (!me || !canEdit(b.team_id, me)) return send(res, 403, { error: "Only the team's coaches can send notifications." });
        const k = b.match_id + ":" + b.kind; if (pushSent.has(k)) return send(res, 200, { sent: 0, duplicate: true }); pushSent.add(k);
        const to = [...pushSubs.values()].filter((x) => x.team_id === b.team_id && (b.kind === "start" ? x.starts : x.finals));
        pushes.push({ kind: b.kind, title: b.title, body: b.body, base: b.base, match_id: b.match_id, to: to.length, bodies: to.map((x) => (x.player && b.lines?.[x.player] ? b.lines[x.player] + " · " : "") + b.body) });
        return send(res, 200, { sent: to.length });
      }
      return send(res, 400, { error: "Unknown action." });
    }
    if (p === "/functions/v1/ai") { if (!me) return send(res, 401, { message: "JWT required" }); return send(res, 200, { content: [{ type: "text", text: "Strengths:\n- Mock report from the server function (" + b.model + ")" }], stop_reason: "end_turn" }); }
    if (!me) return send(res, 401, { message: "JWT required" });
    if (p === "/rest/v1/rpc/college_request") { const u = [...users.values()].find((x) => x.id === me); if (!/\.edu$/i.test(u.email)) return send(res, 400, { message: "Use your school email (ending in .edu) so we can confirm you coach at a college." }); const cur = staff.get(me); if (cur?.status !== "approved") staff.set(me, { user_id: me, email: u.email, name: b.name, school: b.school, title: b.title, status: cur?.status === "denied" ? "denied" : "pending", at: now() }); return send(res, 200, staff.get(me).status); }
    if (p === "/rest/v1/rpc/college_status") { const s = staff.get(me); return send(res, 200, s ? { status: s.status, name: s.name, school: s.school } : { status: "none" }); }
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
    if (p === "/rest/v1/rpc/is_admin") return send(res, 200, admins.has(me));
    if (p.startsWith("/rest/v1/rpc/admin_") && !admins.has(me)) return send(res, 400, { message: "Admins only" });
    if (p === "/rest/v1/rpc/admin_college_staff") return send(res, 200, [...staff.values()]);
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
    if (p === "/rest/v1/teams_cloud" && req.method === "POST") { if (teams.has(b.id)) return send(res, 409, { message: "duplicate key" }); teams.set(b.id, { ...b, owner: me }); members.push({ team_id: b.id, user_id: me, role: "owner", email: users.get(me).email, joined_at: now() }); return send(res, 201); }
    if (p === "/rest/v1/records" && req.method === "POST") {
      for (const r of b) { if (!canEdit(r.team_id, me)) return send(res, 403, { message: "new row violates row-level security policy" }); const k = r.store + "|" + r.id, old = records.get(k); if (old && r.u < old.u) continue; records.set(k, { ...r, updated_at: now() }); }
      return send(res, 201);
    }
    if (p === "/rest/v1/records" && req.method === "GET") {
      const t = val(P.team_id), since = val(P.updated_at), inclusive = P.updated_at.startsWith("gte."); if (!isMember(t, me)) return send(res, 200, []);
      const rows = [...records.values()].filter((r) => r.team_id === t && (inclusive ? r.updated_at >= since : r.updated_at > since)).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(0, +P.limit || 500);
      return send(res, 200, rows);
    }
    if (p === "/rest/v1/invites" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); invites.set(b.code, b); return send(res, 201); }
    if (p === "/rest/v1/members" && req.method === "GET" && P.user_id) { return send(res, 200, members.filter((m) => m.user_id === val(P.user_id) && m.user_id === me)); }
    if (p === "/rest/v1/members" && req.method === "GET") { const t = val(P.team_id); return send(res, 200, isMember(t, me) ? members.filter((m) => m.team_id === t) : []); }
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

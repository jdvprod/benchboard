// Used by the end-to-end tests. Minimal in-memory stand-in for the Supabase endpoints Benchboard uses, mirroring schema.sql rules.
const http = require("http");
const users = new Map(); // email -> {id,email,pw}
const tokens = new Map(); // token -> userId
const teams = new Map(), members = [], records = new Map(), invites = new Map(), shares = new Map(), seasonShares = new Map(), recruits = new Map();
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
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const url = new URL(req.url, "http://x"), p = url.pathname, b = body ? JSON.parse(body) : null;
    const tok = (req.headers.authorization || "").replace("Bearer ", ""), me = tokens.get(tok) || null;
    if (p === "/__mock/strip-terms") { for (const u of users.values()) if (u.meta) delete u.meta.terms_version; return send(res, 204); } // simulate accounts made before the terms existed
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
    const pubPlayer = (d) => ({ id: d.id, num: d.num, pos: d.pos, first: d.hidePublic ? "" : d.first || "", last: d.hidePublic ? "" : (d.last || "").slice(0, 1) });
    const pubMatch = (m) => m && ({ id: m.id, opp: m.opp, date: m.date, event: m.event, status: m.status, kind: m.kind, bestOf: m.bestOf, setTo: m.setTo, cap: m.cap, scrim: m.scrim });
    if (p === "/rest/v1/rpc/watch") {
      const s = shares.get(String(b.share).toUpperCase()); if (!s) return send(res, 200, null);
      const R = [...records.values()].filter((r) => r.team_id === s.team_id && !r.deleted);
      const tr = R.find((r) => r.store === "teams" && r.id === s.team_id);
      return send(res, 200, { team: tr && { name: tr.data.name, color: tr.data.color, level: tr.data.level }, match: pubMatch((R.find((r) => r.store === "matches" && r.id === s.match_id) || {}).data) || null,
        logs: R.filter((r) => r.store === "logs" && r.data.matchId === s.match_id).map((r) => pubEvents(r.data.events)), players: R.filter((r) => r.store === "players").map((r) => pubPlayer(r.data)), at: new Date().toISOString() });
    }
    if (p === "/rest/v1/rpc/delete_my_account") {
      if (!me) return send(res, 401, { message: "JWT required" });
      for (const [id, t] of teams) if (t.owner === me) { teams.delete(id); for (const [k, r] of records) if (r.team_id === id) records.delete(k); for (let i = members.length - 1; i >= 0; i--) if (members[i].team_id === id) members.splice(i, 1); }
      for (let i = members.length - 1; i >= 0; i--) if (members[i].user_id === me) members.splice(i, 1);
      users.delete(me); for (const [k, v] of tokens) if (v === me) tokens.delete(k); return send(res, 204);
    }
    if (p === "/auth/v1/settings") return send(res, 200, { mailer_autoconfirm: true, disable_signup: false });
    if (p === "/rest/v1/rpc/schema_version") return send(res, 200, 8);
    if (p === "/rest/v1/rpc/server_time") return send(res, 200, Date.now() + (+process.env.MOCK_CLOCK_SKEW || 0));
    if (p === "/rest/v1/rpc/recruit_view") { const r = recruits.get(String(b.share).toUpperCase()); return send(res, 200, r ? { html: r.html, updated_at: r.updated_at } : null); }
    if (p === "/rest/v1/rpc/season_view") {
      const s = seasonShares.get(String(b.share).toUpperCase()); if (!s) return send(res, 200, null);
      const R = [...records.values()].filter((r) => r.team_id === s.team_id && !r.deleted);
      const tr = R.find((r) => r.store === "teams" && r.id === s.team_id), se = R.find((r) => r.store === "seasons" && r.id === s.season_id);
      const ms = R.filter((r) => r.store === "matches" && r.data.seasonId === s.season_id && r.data.kind === "match").map((r) => r.data), ids = new Set(ms.map((m) => m.id));
      return send(res, 200, { team: tr && { name: tr.data.name, level: tr.data.level, schedule: tr.data.schedule || [] }, season: se && se.data.name,
        matches: ms.map((m) => ({ id: m.id, opp: m.opp, date: m.date, bestOf: m.bestOf, status: m.status, event: m.event, site: m.site })),
        logs: R.filter((r) => r.store === "logs" && ids.has(r.data.matchId)).map((r) => ({ matchId: r.data.matchId, events: pubEvents(r.data.events) })),
        players: R.filter((r) => r.store === "players" && r.data.active !== false).map((r) => pubPlayer(r.data)), at: new Date().toISOString() });
    }
    if (p === "/functions/v1/ai") { if (!me) return send(res, 401, { message: "JWT required" }); return send(res, 200, { content: [{ type: "text", text: "Strengths:\n- Mock report from the server function (" + b.model + ")" }], stop_reason: "end_turn" }); }
    if (!me) return send(res, 401, { message: "JWT required" });
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
    if (p === "/rest/v1/recruit_shares" && req.method === "GET") { const t = val(P.team_id), pl = val(P.player_id); return send(res, 200, [...recruits.values()].filter((r) => r.team_id === t && r.player_id === pl && isMember(t, me))); }
    if (p === "/rest/v1/recruit_shares" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); recruits.set(b.code, { ...b, updated_at: now() }); return send(res, 201); }
    if (p === "/rest/v1/recruit_shares" && req.method === "DELETE") { const t = val(P.team_id), pl = val(P.player_id); if (!canEdit(t, me)) return send(res, 403, { message: "rls" }); for (const [k, r] of recruits) if (r.team_id === t && r.player_id === pl) recruits.delete(k); return send(res, 204); }
    if (p === "/rest/v1/recruit_shares" && req.method === "PATCH") { const r = recruits.get(val(P.code)); if (!r || !canEdit(r.team_id, me)) return send(res, 403, { message: "rls" }); Object.assign(r, b); return send(res, 204); }
    if (p === "/rest/v1/season_shares" && req.method === "GET") { const t = val(P.team_id), se = val(P.season_id); return send(res, 200, [...seasonShares.values()].filter((s) => s.team_id === t && s.season_id === se && isMember(t, me))); }
    if (p === "/rest/v1/season_shares" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); seasonShares.set(b.code, b); return send(res, 201); }
    if (p === "/rest/v1/live_shares" && req.method === "GET") { const t = val(P.team_id), m = val(P.match_id); return send(res, 200, [...shares.values()].filter((s) => s.team_id === t && s.match_id === m && isMember(t, me))); }
    if (p === "/rest/v1/live_shares" && req.method === "POST") { if (!canEdit(b.team_id, me)) return send(res, 403, { message: "rls" }); shares.set(b.code, b); return send(res, 201); }
    send(res, 404, { message: "not mocked: " + req.method + " " + p });
  });
}); srv.listen(port, () => ok(srv)); });
if (require.main === module) module.exports(+(process.argv[2] || 54321)).then(() => console.log("mock supabase running"));

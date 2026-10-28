// Supabase Edge Function: match notifications for families who follow a team on Benchboard Live.
// Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor, name it "notify", paste this file.
//         (or: supabase functions deploy notify)
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (make them in the app: Settings → Setup check →
//         Make notification keys), and VAPID_SUBJECT (mailto: your contact email).
// Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
//
// Actions (POST JSON):
//   { action: "key" }                                     → { key } public key for subscribing (anyone)
//   { action: "subscribe", code, sub, starts, finals }    → follow a team by its Benchboard Live team code (anyone)
//   { action: "unsubscribe", endpoint }                   → stop (anyone with the subscription)
//   { action: "send", team_id, match_id, kind, title, body, base }  → a coach of that team announces a start or a final
import webpush from "npm:web-push@3.6.7";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const svc = { apikey: SERVICE, authorization: "Bearer " + SERVICE, "content-type": "application/json" };
const rest = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  let b: any; try { b = await req.json(); } catch { return json(400, { error: "Bad request." }); }
  if (!pub || !priv) return json(503, { error: "Notifications aren't set up on the server yet." });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:notifications@example.com", pub, priv);

  if (b.action === "key" || b.ping) return json(200, { key: pub });

  if (b.action === "subscribe") {
    const code = String(b.code || "").toUpperCase().trim(), sub = b.sub || {};
    if (!/^[A-Z0-9]{4,12}$/.test(code) || !/^https:\/\//.test(sub.endpoint || "") || !sub.keys?.p256dh || !sub.keys?.auth) return json(400, { error: "That subscription isn't valid." });
    const share = await rest(`season_shares?select=team_id&code=eq.${code}&limit=1`).then((r) => r.json()).catch(() => []);
    if (!share?.[0]) return json(404, { error: "That team page isn't shared anymore." });
    const row = { endpoint: sub.endpoint, team_id: share[0].team_id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, starts: b.starts !== false, finals: b.finals !== false };
    const r = await rest("push_subs?on_conflict=endpoint", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
    return r.ok ? json(200, { ok: true }) : json(500, { error: "Couldn't save the subscription." });
  }

  if (b.action === "unsubscribe") {
    if (!b.endpoint) return json(400, { error: "Missing subscription." });
    await rest(`push_subs?endpoint=eq.${encodeURIComponent(b.endpoint)}`, { method: "DELETE" });
    return json(200, { ok: true });
  }

  if (b.action === "send") {
    // only a coach or owner of the team can announce its matches: ask the database as the caller
    const auth = req.headers.get("authorization") || "";
    const team = String(b.team_id || ""), match = String(b.match_id || ""), kind = b.kind === "final" ? "final" : b.kind === "start" ? "start" : "";
    if (!team || !match || !kind) return json(400, { error: "Missing match details." });
    const can = await fetch(`${URL_}/rest/v1/rpc/can_edit`, { method: "POST", headers: { apikey: ANON, authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ t: team }) }).then((r) => r.ok ? r.json() : false).catch(() => false);
    if (can !== true) return json(403, { error: "Only the team's coaches can send notifications." });
    // once per match and kind, however many coaches' devices ask
    const first = await rest("push_sent", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ match_id: match, kind, team_id: team }) });
    if (!first.ok) return json(200, { sent: 0, duplicate: true });
    const code = (await rest(`season_shares?select=code&team_id=eq.${encodeURIComponent(team)}&order=created_at.desc&limit=1`).then((r) => r.json()).catch(() => []))?.[0]?.code;
    const base = /^https?:\/\//.test(b.base || "") ? String(b.base) : "";
    const url = code && base ? `${base}#/t/${code}/m/${match}` : base || "/";
    const subs: any[] = await rest(`push_subs?select=endpoint,p256dh,auth&team_id=eq.${encodeURIComponent(team)}&${kind === "start" ? "starts" : "finals"}=is.true`).then((r) => r.json()).catch(() => []);
    const payload = JSON.stringify({ title: String(b.title || "").slice(0, 120), body: String(b.body || "").slice(0, 240), url, tag: match + ":" + kind });
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: kind === "start" ? 3600 : 86400 }); sent++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }); }
    }));
    return json(200, { sent });
  }
  return json(400, { error: "Unknown action." });
});

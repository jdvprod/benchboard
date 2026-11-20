// Supabase Edge Function: email the FloorCall admin when the app is throwing errors, plus a short daily summary.
// Deploy: Dashboard → Edge Functions → New function "alerts" (Verify JWT off: it checks its own secret instead).
// Secrets (Dashboard → Edge Functions → Secrets):
//   ALERTS_SECRET   any long random string; the scheduler sends it so nobody else can trigger emails
//   RESEND_API_KEY  the same Resend key used for sign-in emails (or any Resend key)
//   ALERT_EMAIL     where alerts go, e.g. your own email
//   ALERT_FROM      optional, default "FloorCall alerts <alerts@getfloorcall.com>"
//   ALERT_MIN       optional, crash reports in an hour that count as a spike (default 10)
// Schedule it (SQL Editor, once; pg_cron and pg_net are under Database → Extensions): see LAUNCH.md, "Error alerts".
// It's called every 15 minutes with {"kind":"check"} and once a day with {"kind":"daily"}.

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("ALERTS_SECRET") || "";
  if (!secret || req.headers.get("x-alerts-secret") !== secret) return json(403, { error: "no" });
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const h = { apikey: service, authorization: "Bearer " + service, "content-type": "application/json" };
  const rpc = (name: string, body: unknown = {}) => fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: h, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const kind = (await req.json().catch(() => ({})))?.kind === "daily" ? "daily" : "check";

  let subject = "", lines: string[] = [];
  if (kind === "check") {
    const d = await rpc("error_digest", { mins: 60 }), min = +(Deno.env.get("ALERT_MIN") || 10);
    if (!d || d.total < min) return json(200, { sent: false, total: d?.total ?? null });
    // one spike email every 3 hours at most
    const recent = await fetch(`${url}/rest/v1/app_alerts?kind=eq.spike&at=gt.${new Date(Date.now() - 3 * 3600e3).toISOString()}&select=id`, { headers: h }).then((r) => r.json()).catch(() => []);
    if (Array.isArray(recent) && recent.length) return json(200, { sent: false, total: d.total, quiet: true });
    subject = `FloorCall: ${d.total} errors in the last hour`;
    lines = [`${d.total} crash reports from ${d.people} people in the last hour.`, "", "Most common:", ...d.top.map((x: any) => `• ${x.n}× ${x.message} (screen: ${x.page || "?"}, v${x.version || "?"})`), "", "Details: Admin → Problems in the last two weeks."];
    await fetch(`${url}/rest/v1/app_alerts`, { method: "POST", headers: h, body: JSON.stringify({ kind: "spike", total: d.total }) });
  } else {
    const d = await rpc("error_digest", { mins: 1440 }), o = await rpc("ops_digest");
    subject = `FloorCall daily: ${o?.new_accounts ?? "?"} new accounts, ${o?.messages ?? "?"} open messages`;
    lines = [`New accounts (24 h): ${o?.new_accounts ?? "?"}`, `Contact messages waiting: ${o?.messages ?? "?"}`, `Coaches waiting for verification: ${o?.verify ?? "?"}`,
      `Crash reports (24 h): ${d?.total ?? "?"} from ${d?.people ?? "?"} people`, ...(d?.top || []).map((x: any) => `• ${x.n}× ${x.message}`), "", "Open the Admin page in the FloorCall app to follow up."];
    await fetch(`${url}/rest/v1/app_alerts`, { method: "POST", headers: h, body: JSON.stringify({ kind: "daily", total: d?.total ?? 0 }) });
  }
  const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("ALERT_EMAIL");
  if (!key || !to) return json(200, { sent: false, reason: "RESEND_API_KEY or ALERT_EMAIL not set", subject });
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("ALERT_FROM") || "FloorCall alerts <alerts@getfloorcall.com>", to: [to], subject, text: lines.join("\n") }) }).catch(() => null);
  return json(200, { sent: !!r?.ok, subject });
});

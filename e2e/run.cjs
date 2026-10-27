/**
 * End-to-end tests: drives the built app in Chromium like a coach would, on desktop and phone, light and dark,
 * with a mock Supabase for accounts, sync and share links. Run after `npm run build`:  node e2e/run.cjs
 * Fails (exit 1) on any broken step, page error, or sideways scroll on a phone.
 */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const startMock = require("./mock-supabase.cjs");

const DIST = path.join(__dirname, "..", "dist"), APP_PORT = 5199, MOCK_PORT = 54399, U = `http://localhost:${APP_PORT}/`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
const only = process.argv[2] || "";

let failures = 0, passes = 0; const OPEN = new Set();
const ok = (name, cond, detail = "") => { if (cond) { passes++; } else { failures++; console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`); } };

/** Apply dist/_headers like Cloudflare does (so the content security policy is tested), letting the app reach the local mock. */
function headersFor(urlPath) {
  const file = path.join(DIST, "_headers"); if (!fs.existsSync(file)) return {};
  const out = {}; let match = false;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) { const pat = line.trim(); match = pat === urlPath || (pat.endsWith("*") && urlPath.startsWith(pat.slice(0, -1))); continue; }
    if (match) { const i = line.indexOf(":"); out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  if (out["Content-Security-Policy"]) out["Content-Security-Policy"] = out["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://localhost:* http://127.0.0.1:*");
  return out;
}

/** While true the app server drops every request, like a gym with no Wi-Fi. (Playwright's offline mode doesn't cover service worker fetches.) */
let NO_WIFI = false; const HANGING = [];
function serveDist() {
  return new Promise((done) => {
    const srv = http.createServer((req, res) => {
      if (NO_WIFI === "slow") { HANGING.push(req.socket); return; } // the request just hangs, like weak gym Wi-Fi
      if (NO_WIFI) return req.socket.destroy();
      let f = decodeURIComponent(new URL(req.url, U).pathname); if (f.endsWith("/")) f += "index.html";
      const file = path.join(DIST, f);
      if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", ...headersFor(f) }); fs.createReadStream(file).pipe(res);
    });
    srv.listen(APP_PORT, () => done(srv));
  });
}

async function newPage(browser, { phone = false, tablet = false, dark = false, cloud = true, skew = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : tablet ? { width: 820, height: 1180 } : { width: 1360, height: 900 }, colorScheme: dark ? "dark" : "light", acceptDownloads: true, hasTouch: phone });
  if (cloud) await ctx.addInitScript((url) => { try { localStorage.setItem("bs-cloud-config", JSON.stringify({ url, key: "anon" })); } catch { /* sandboxed frame */ } }, `http://localhost:${MOCK_PORT}`);
  if (skew) await ctx.addInitScript((ms) => { const real = Date.now; Date.now = () => real() + ms; }, skew);
  const page = await ctx.newPage(); page.errors = []; OPEN.add(page); page.on("close", () => OPEN.delete(page));
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" && (/Content Security Policy/.test(t) || !/Failed to load resource|ERR_|fonts\.g/.test(t))) page.errors.push(t); });
  page.setDefaultTimeout(8000);
  return page;
}
const go = async (p, hash) => { await p.goto(U + "#/" + hash); await p.waitForTimeout(350); };
const score = async (p) => { const t = (await p.locator(".board").first().innerText()).replace(/\s+/g, " "); const n = t.match(/(\d+) SET (\d) .* (\d+) (?:Rotation|Our)/); return t; };
const download = async (p, click) => { const [d] = await Promise.all([p.waitForEvent("download"), click()]); const f = await d.path(); return { name: d.suggestedFilename(), size: fs.statSync(f).size, text: () => fs.readFileSync(f, "utf8") }; };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
/** Basic accessibility: every control has a name screen readers can announce, images have alt text, ids are unique. */
const a11y = (p) => p.evaluate(() => {
  const out = [];
  const name = (e) => (e.getAttribute("aria-label") || (e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent) || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest("label")?.textContent || e.textContent || e.getAttribute("title") || (e.tagName === "INPUT" && ["submit", "button"].includes(e.type) && e.value) || "").trim();
  for (const e of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")) {
    const st = getComputedStyle(e); if (st.display === "none" || st.visibility === "hidden" || e.closest("[hidden],[aria-hidden=true]")) continue;
    if (!name(e) && !(e.tagName === "INPUT" && e.placeholder && e.type !== "checkbox")) out.push(`${e.tagName.toLowerCase()}${e.className ? "." + String(e.className).split(" ")[0] : ""} has no label`);
  }
  for (const i of document.querySelectorAll("img")) if (!i.hasAttribute("alt")) out.push("img without alt: " + i.src.slice(-30));
  const ids = {}; for (const e of document.querySelectorAll("[id]")) ids[e.id] = (ids[e.id] || 0) + 1;
  for (const [k, n] of Object.entries(ids)) if (n > 1) out.push(`duplicate id "${k}"`);
  return [...new Set(out)].slice(0, 5);
});
/** Text contrast (WCAG AA): 4.5:1 for normal text, 3:1 for large text, in light and dark. */
const contrastFn = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (e) => { let stack = []; for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255 }; for (const c of stack.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
  const out = [];
  for (const e of document.querySelectorAll("body *")) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const st = getComputedStyle(e); if (st.visibility === "hidden" || st.display === "none" || +st.opacity < 1) continue;
    if (e.closest("[aria-disabled=true],:disabled,svg")) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const fg = parse(st.color); if (!fg) continue;
    const bg = bgOf(e), L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(st.fontSize), bold = +st.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
    if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)} ${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${e.textContent.trim().slice(0, 25)}" ${st.color} on rgb(${bg.r|0},${bg.g|0},${bg.b|0})`);
  }
  return [...new Set(out)];
};
const contrast = (p) => p.evaluate(contrastFn);
/** Text squeezed into a sliver (a layout bug): long text in a very narrow, tall box. */
const squashed = (p) => p.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => {
  if (e.children.length || !e.textContent || e.textContent.trim().length < 24) return false;
  const r = e.getBoundingClientRect(); return r.width > 0 && r.width < 90 && r.height > 70;
}).slice(0, 3).map((e) => e.tagName + ": " + e.textContent.trim().slice(0, 30)));
const skipIfAsked = async (p) => { const s = p.getByRole("button", { name: "Skip" }); if (await s.count()) await s.first().click(); };

/* ---------- scenarios ---------- */
const scenarios = {
  async tour(browser) {
    for (const opts of [{}, { phone: true }, { phone: true, dark: true }, { tablet: true }]) {
      const tag = opts.phone ? (opts.dark ? "phone dark" : "phone") : opts.tablet ? "tablet" : "desktop", p = await newPage(browser, opts);
      await go(p, "sample"); await p.waitForTimeout(900);
      ok(`${tag}: sample team loads on Track`, (await p.locator(".board").count()) > 0);
      for (const r of ["track", "lineup", "matchup", "practice", "stats", "court", "team", "settings", "labs", "live", "account"]) {
        await go(p, r);
        ok(`${tag}: ${r} renders`, (await p.locator(".page, .content, .auth, main").count()) > 0);
        { const cx = await contrast(p); ok(`${tag}: ${r} text has enough contrast`, !cx.length, cx.slice(0, 3).join(" | ")); }
        if (!opts.dark) { const ax = await a11y(p); ok(`${tag}: ${r} controls all have names`, !ax.length, ax.join(" | ")); }
        if (opts.phone) { const sq = await squashed(p); ok(`${tag}: ${r} has no squeezed text`, !sq.length, sq.join(" | ")); }
        if (opts.phone || opts.tablet) ok(`${tag}: ${r} has no sideways scroll`, (await overflow(p)) <= 1, `${await overflow(p)}px`);        if (r === "team") { const w = await p.locator(".roster-tbl").evaluate((e) => e.scrollWidth - e.clientWidth); ok(`${tag}: roster fits without scrolling sideways`, w <= 1, `${w}px`); }
      }
      await go(p, "stats");
      for (const sc of [/^Season \(/, /^Event$/, /^One match$/]) {
        await p.getByRole("button", { name: sc }).first().click(); await p.waitForTimeout(150);
        const tabs = await p.locator('[aria-label="Section"] button, .seg[aria-label="Section"] button').allInnerTexts().catch(() => []);
        for (const t of ["Overview", "Players", "Offense", "Serve & pass", "Rotations", "Situations", "Opponent", "Film", "Fix plays"]) {
          const b = p.getByRole("button", { name: t, exact: true }); if (!(await b.count())) continue;
          await b.first().click(); await p.waitForTimeout(120);
          if (opts.phone || opts.tablet) ok(`${tag}: stats ${t} fits`, (await overflow(p)) <= 1);
        }
        void tabs;
      }
      ok(`${tag}: no page errors`, !p.errors.length, p.errors.slice(0, 3).join(" | "));
      await p.context().close();
    }
  },

  async match(browser) {
    const p = await newPage(browser);
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill("E2E High"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click();
    await p.locator("textarea").first().fill("1 Ava Setter S 2027\n2 Bea Outside OH 2027\n3 Cam Middle MB 2028\n4 Dee Oppo OPP 2028\n5 Eve Outside OH 2029\n6 Fay Middle MB 2029\n7 Gia Libero L 2027\n8 Hal Defense DS 2028");
    await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(200);
    ok("roster: 8 players added", (await p.locator(".card", { hasText: "Roster" }).locator("tbody tr").count()) === 8);
    { const r2 = p.locator(".card", { hasText: "Roster" }).locator("tbody tr").nth(1).locator("input, select");
      ok("pasted line splits name and position", (await r2.nth(1).inputValue()) === "Bea" && (await r2.nth(2).inputValue()) === "Outside" && (await r2.nth(3).inputValue()) === "OH", await r2.nth(2).inputValue()); }
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill("Rival Prep"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(300);
    ok("match starts at 0–0", /E2E HIGH 0 SET 1/.test(await score(p)), await score(p));
    // keyboard: #2 kills x 25 → set 1
    for (let i = 0; i < 25; i++) { await p.keyboard.type("2"); await p.keyboard.press("k"); }
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    ok("keyboard entry wins set 1 25–0", (await p.locator(".banner", { hasText: "Set 1 to E2E High, 25–0" }).count()) === 1);
    await p.getByRole("button", { name: "E2E High serve" }).click(); await p.waitForTimeout(150);
    // buttons: tool, blocked, ace by server, their kill, timeout, undo
    const pl = (n) => p.locator(".pl", { hasText: n }).first();
    await pl("Bea").click(); await p.getByRole("button", { name: "Tool", exact: true }).click(); await skipIfAsked(p);
    ok("tool scores for us", /E2E HIGH 1 SET 2/.test(await score(p)), await score(p));
    ok("selection clears after a play", (await p.locator(".pl[aria-pressed=true]").count()) === 0);
    await pl("Eve").click(); await p.getByRole("button", { name: "Blocked", exact: true }).click(); await skipIfAsked(p);
    ok("blocked gives them the point", / 1 SET 2 .* 1 /.test(await score(p)), await score(p));
    await p.getByRole("button", { name: "Their kill", exact: true }).click(); await skipIfAsked(p); await p.keyboard.press("Escape");
    await p.getByRole("button", { name: /^Timeout · E2E High/ }).click(); await p.waitForTimeout(100);
    await p.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(p); await p.keyboard.press("Escape");
    const before = await score(p); await p.keyboard.press("Backspace"); await p.waitForTimeout(150);
    ok("undo removes the last point", (await score(p)) !== before, before + " → " + (await score(p)));
    // misc errors never touch passing
    await pl("Gia").click(); await p.getByRole("button", { name: "2", exact: true }).click(); await skipIfAsked(p); await p.keyboard.press("Escape");
    await pl("Gia").click(); await p.getByRole("button", { name: "Positioning", exact: true }).click(); await skipIfAsked(p);
    const passTxt = (await p.locator(".card", { hasText: "so far" }).first().innerText()).replace(/\s+/g, " ");
    ok("positioning error leaves pass average alone", /Pass avg 2\.00/.test(passTxt), passTxt);
    // finish sets 2 and 3 quickly
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < 30; i++) { if (await p.locator(".banner", { hasText: /to E2E High|Match over/ }).count()) break; await p.keyboard.type("4"); await p.keyboard.press("k"); }
      await p.keyboard.press("Escape"); await p.waitForTimeout(150);
      const next = p.getByRole("button", { name: "E2E High serve" }); if (await next.count()) await next.click();
    }
    ok("match ends 3–0", (await p.locator(".banner", { hasText: "Match over" }).count()) === 1);
    await p.getByRole("button", { name: "Finish" }).click(); await p.waitForTimeout(200);
    ok("home shows last match W 3–0", (await p.locator(".home-last", { hasText: "3–0 vs Rival Prep" }).count()) === 1);
    // stats for the match
    await go(p, "stats"); await p.getByRole("button", { name: "One match", exact: true }).click(); await p.waitForTimeout(150);
    await p.getByRole("button", { name: "Players", exact: true }).click();
    const bea = (await p.locator("tr", { hasText: "Bea" }).first().innerText()).split(/\s+/);
    ok("Bea's tool is on her line", bea.includes("1"), bea.join(" "));
    await p.getByRole("button", { name: "Fix plays", exact: true }).click(); await p.locator(".card button[aria-pressed]", { hasText: "Set 1" }).click();
    const last1 = await p.locator(".log.pe li .sc").last().innerText();
    await p.locator(".log.pe li button.log-edit").first().click(); await p.getByRole("button", { name: "Delete", exact: true }).click(); await p.waitForTimeout(150);
    ok("fix plays: deleting a kill drops the set score", (await p.locator(".log.pe li .sc").last().innerText()) === "24–0", last1);
    await p.getByRole("button", { name: "Film", exact: true }).click(); ok("film lists plays", (await p.locator(".log.film li").count()) > 10);
    const xl = await download(p, () => p.getByRole("button", { name: "Download spreadsheet" }).click()); ok("spreadsheet downloads", xl.size > 3000, xl.name);
    const mr = await download(p, () => p.getByRole("button", { name: "Match report" }).click()); ok("match report has the box score", mr.text().includes("Box score") && mr.text().includes("Rival Prep"));
    const gfx = await download(p, () => p.getByRole("button", { name: "Share graphic" }).click()); ok("share graphic is a PNG", gfx.name.endsWith(".png") && gfx.size > 20000, gfx.size + " bytes");
    await p.getByRole("button", { name: /^Season \(/ }).click();
    const sr = await download(p, () => p.getByRole("button", { name: "Season report" }).click()); ok("season report has awards and situations", sr.text().includes("Situations") && sr.text().includes("1–0"));
    // family requests: copy of a player's data, then erase her name but keep the team's totals
    await go(p, "team"); await p.locator(".card", { hasText: "Roster" }).locator("tbody tr").nth(1).getByRole("button", { name: "View" }).click(); await p.waitForTimeout(200);
    const pd = await download(p, () => p.getByRole("button", { name: "Download their information" }).click());
    { const j = JSON.parse(pd.text()); ok("player data export has her profile and every match", j.player.first === "Bea" && j.matches.length === 1 && j.matches[0].stats.KT === 1, pd.name); }
    await p.getByRole("button", { name: "Erase personal information" }).click();
    ok("erase waits for typed confirmation", await p.getByRole("button", { name: "Erase Bea Outside" }).isDisabled());
    await p.getByLabel("Type ERASE to confirm").fill("erase"); await p.getByRole("button", { name: "Erase Bea Outside" }).click(); await p.waitForTimeout(200);
    ok("erased player shows as a former player", (await p.locator("h1", { hasText: "Former player 1" }).count()) === 1);
    await go(p, "stats"); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.waitForTimeout(150);
    const stx = await p.locator(".page").first().innerText();
    ok("her name is gone from stats, her plays still count", !stx.includes("Bea") && stx.includes("Former"), "");
    ok("match: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async formats(browser) {
    const p = await newPage(browser);
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill("Club 16s"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill("3 Ana OH\n5 Bo MB"); await p.getByRole("button", { name: "Add players" }).click();
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill("Pool Team"); await p.getByRole("button", { name: "2 sets (pool)" }).click();
    await p.getByLabel("Scoring").selectOption("21c23"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(200);
    for (let i = 0; i < 21; i++) { await p.keyboard.type("3"); await p.keyboard.press("k"); } await p.keyboard.press("Escape"); await p.waitForTimeout(150);
    ok("set to 21 ends at 21–0", (await p.locator(".banner", { hasText: "Set 1 to Club 16s, 21–0" }).count()) === 1);
    await p.getByRole("button", { name: "Pool Team serve" }).click();
    for (let i = 0; i < 4; i++) { await p.getByRole("button", { name: "Their point", exact: true }).click(); await skipIfAsked(p); await p.keyboard.press("Escape"); }
    await p.locator("button.ctrl", { hasText: "Fix score" }).click(); await p.getByRole("button", { name: /End set · Club 16s serve next/ }).click(); await p.getByRole("button", { name: /End at 0–4\?/ }).click(); await p.waitForTimeout(200);
    ok("pool play ends 1–1 after two sets", (await p.locator(".banner", { hasText: "Match over. Split 1–1." }).count()) === 1, await p.locator(".banner").first().innerText().catch(() => ""));
    await p.getByRole("button", { name: "Finish" }).click(); await p.waitForTimeout(200);
    ok("home shows the tie", (await p.locator(".home-last", { hasText: "T 1–1 vs Pool Team" }).count()) === 1 && (await p.getByText("0–0–1 this season").count()) === 1);
    ok("formats: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async offline(browser) {
    const A = await newPage(browser), SW = `http://127.0.0.1:${APP_PORT}/#/`; // the service worker is skipped on "localhost" (dev)
    await A.goto(SW + "track"); await A.waitForTimeout(300); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("gym@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("No Wifi High"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept*=csv]").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.goto(SW + "track"); await A.waitForTimeout(400); await A.reload(); await A.waitForTimeout(1500); // let the service worker install and cache the app
    NO_WIFI = "slow"; { const t0 = Date.now(); await A.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await A.locator(".page").first().waitFor({ timeout: 9000 }).catch(() => {});
      ok("weak Wi-Fi: the app still opens from the cache within a few seconds", (await A.locator(".page").count()) > 0 && Date.now() - t0 < 7000, `${Date.now() - t0}ms`); }
    await A.context().setOffline(true); NO_WIFI = true; HANGING.splice(0).forEach((sk) => sk.destroy());
    { const t0 = Date.now(); await A.reload(); await A.locator(".page").first().waitFor({ timeout: 5000 }).catch(() => {}); ok("no Wi-Fi: the app opens right away", Date.now() - t0 < 2500, `${Date.now() - t0}ms`); }
    await A.waitForTimeout(300);
    ok("app opens with no connection", (await A.locator(".page, .content").count()) > 0);
    await A.getByPlaceholder("e.g. Buchanan").fill("Away Gym"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(200);
    for (let i = 0; i < 3; i++) { await A.locator(".pl", { hasText: "Nia" }).first().click(); await A.getByRole("button", { name: "Kill", exact: true }).click(); await skipIfAsked(A); }
    ok("tracking works offline", /NO WIFI HIGH 3/.test(await score(A)), await score(A));
    // pages load on first visit; the service worker must already have them, even ones never opened online
    for (const r of ["stats", "practice", "lineup", "court", "matchup", "settings", "labs", "live"]) {
      await A.goto(SW + r); await A.waitForTimeout(400);
      ok(`offline: ${r} opens without a connection`, (await A.locator(".page").count()) > 0 && !(await A.getByText("isn't on this device yet").count()) && !(await A.getByText("hit a problem").count()));
    }
    await A.goto(SW + "track"); await A.waitForTimeout(300);
    await A.context().setOffline(false); NO_WIFI = false; await A.waitForTimeout(500);
    await A.goto(SW + "team"); await A.waitForTimeout(300); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1200);
    const N = await newPage(browser, { phone: true });
    await go(N, "account"); await N.getByLabel("Email").fill("gym@e2e.test"); await N.locator("#auth-pw").fill("secret123"); await N.getByRole("button", { name: "Sign in" }).click(); await N.waitForTimeout(2500);
    await go(N, "track"); await N.waitForTimeout(500);
    ok("offline plays reach another device after reconnecting", /NO WIFI HIGH 3/.test(await score(N).catch(() => "")), await score(N).catch(() => "no board"));
    for (const [n, pg] of [["gym", A], ["second device", N]]) ok(`offline: no page errors (${n})`, !pg.errors.filter((e) => !/fetch|network|Failed/i.test(e)).length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, N]) await pg.context().close();
  },

  async longnames(browser) {
    const p = await newPage(browser, { phone: true }); await p.setViewportSize({ width: 360, height: 740 });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill("Clovis North Educational Center Broncos"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click();
    await p.locator("textarea").first().fill("12 Maximiliana Alexandrovna-Rodriguez OH\n3 Bo Li MB"); await p.getByRole("button", { name: "Add players" }).click();
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill("Saint Bartholomew Preparatory Academy of the Valley"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(200);
    await p.locator(".pl", { hasText: "Maximiliana" }).first().click(); await p.locator(".actsheet button", { hasText: /^Kill$/ }).click(); await skipIfAsked(p);
    for (const r of ["track", "lineup", "matchup", "practice", "stats", "court", "team", "live", "settings"]) { await go(p, r); ok(`long names: ${r} fits a small phone`, (await overflow(p)) <= 1, `${await overflow(p)}px`); }
    ok("long names: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async backup(browser) {
    const p = await newPage(browser);
    await go(p, "sample"); await p.waitForTimeout(800);
    await go(p, "team");
    const bk = await download(p, () => p.getByRole("button", { name: "Save all teams" }).click());
    ok("backup file saved", bk.name.endsWith(".json") && bk.size > 20000, bk.size + " bytes");
    const file = path.join(require("os").tmpdir(), "bb-e2e-backup.json"); fs.writeFileSync(file, bk.text());
    const q = await newPage(browser, { phone: true });
    await go(q, "track"); await q.getByRole("button", { name: "Use without an account" }).click();
    await q.locator(".auth-alt-btn input[type=file]").setInputFiles(file); await q.waitForTimeout(1200);
    await go(q, "stats"); await q.getByRole("button", { name: /^Season \(/ }).click();
    ok("restored on a new device with every match", /Season \(5\)/.test(await q.getByRole("button", { name: /^Season \(/ }).innerText()));
    ok("backup: no page errors", !p.errors.length && !q.errors.length, p.errors.concat(q.errors).slice(0, 3).join(" | "));
    fs.unlinkSync(file); await p.context().close(); await q.context().close();
  },

  async practice(browser) {
    const p = await newPage(browser);
    await go(p, "sample"); await p.waitForTimeout(800);
    await p.locator("button.ctrl", { hasText: "End match" }).click(); await p.locator("button.ctrl", { hasText: "Tap again" }).click(); await p.waitForTimeout(200);
    // scrimmage: a kill by the second team scores for them
    await go(p, "practice"); await p.getByRole("button", { name: "Scrimmage", exact: true }).click(); await p.getByRole("button", { name: "Start scrimmage" }).click(); await p.waitForTimeout(300);
    const white = p.locator(".grid2 .card").nth(1);
    await white.locator(".pl").first().click(); await p.getByRole("button", { name: "Kill", exact: true }).click(); await p.waitForTimeout(150);
    // the court asks where it landed: tap it
    const court = p.locator(".sheet svg.courtsvg");
    if (await court.count()) { const bx = await court.boundingBox(); await p.mouse.click(bx.x + bx.width * 0.5, bx.y + bx.height * 0.3); await p.waitForTimeout(150); }
    ok("scrimmage kill scores for the second team", /^BLUE 0 GAME 1 0–0 SCRIMMAGE WHITE 1/.test(await score(p)), await score(p));
    await skipIfAsked(p); await p.keyboard.press("Escape");
    // type-in codes from Labs
    await go(p, "labs"); await p.getByLabel("Type-in stat codes").check({ force: true }); await go(p, "practice");
    const num = (await white.locator(".pl .n").first().innerText()).trim();
    await p.getByLabel("Type stat codes").fill(`${num}k ${num}ace oe`); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
    ok("type-in codes record three plays", (await p.locator(".card", { hasText: "Recent" }).last().locator("li").count()) >= 4);
    await go(p, "stats"); await p.getByRole("button", { name: /^Practice \(/ }).click(); await p.waitForTimeout(200);
    ok("practice stats show the scrimmage", (await p.locator(".card").filter({ hasText: /Blue|White/ }).count()) > 0);
    ok("practice: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async clockskew(browser) {
    // The assistant's phone clock is 90 seconds fast. Plays must still merge in the order they happened.
    const A = await newPage(browser);
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("clock@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clock High"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept*=csv]").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.getByRole("button", { name: "Invite a coach" }).click(); await A.waitForTimeout(300);
    const code = (await A.locator(".hint b").first().innerText()).trim();
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Skew Prep"); await A.getByRole("button", { name: "Start · they serve first" }).click(); await A.waitForTimeout(200);
    await A.locator("button.ctrl", { hasText: "My job" }).click(); await A.getByRole("button", { name: /^Score only/ }).click(); await A.getByRole("button", { name: "Done", exact: true }).click();
    await A.waitForTimeout(2200);
    const B = await newPage(browser, { phone: true, skew: 90000 });
    await go(B, "join/" + code); await B.getByLabel("Email").fill("fast@e2e.test"); await B.locator("#auth-pw").fill("secret123"); await B.locator(".auth-agree input").check(); await B.getByRole("button", { name: "Create account" }).click(); await B.waitForTimeout(500);
    await B.getByRole("button", { name: "Join team" }).click(); await B.waitForTimeout(1500);
    await go(B, "track"); await B.locator("button.ctrl", { hasText: "My job" }).click(); await B.getByRole("button", { name: /^Stats only/ }).click(); await B.getByRole("button", { name: "Done", exact: true }).click();
    await B.locator(".pl", { hasText: "Nia" }).first().click(); await B.locator(".actsheet button", { hasText: /^3$/ }).click(); await skipIfAsked(B); await B.waitForTimeout(2200);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(900);
    await go(A, "track"); await A.getByRole("button", { name: "Our point", exact: true }).click(); await A.waitForTimeout(300);
    await go(A, "stats"); await A.getByRole("button", { name: "Fix plays", exact: true }).click(); await A.waitForTimeout(200);
    const order = (await A.locator(".log.pe li button.log-edit").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
    ok("a fast phone's pass still lands before the point it led to", order.length >= 2 && /Pass 3/.test(order[0]) && /Point/.test(order[1]), order.join(" | "));
    for (const [n, pg] of [["scorer", A], ["fast phone", B]]) ok(`clock skew: no page errors (${n})`, !pg.errors.length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, B]) await pg.context().close();
  },

  async legal(browser) {
    const p = await newPage(browser, { phone: true });
    { const h = (await p.goto(U)).headers(); ok("pages are served with a content security policy", /script-src 'self'/.test(h["content-security-policy"] || "") && h["x-content-type-options"] === "nosniff"); }
    for (const f of ["privacy", "terms", "schools", "consent-form"]) {
      const r = await p.goto(U + "legal/" + f + ".html"); const body = await p.content();
      ok(`${f} page is published`, r.status() === 200 && !body.includes("%LEGAL"), String(r.status()));
      if (f === "consent-form") { await p.fill("#team", "E2E Varsity"); ok("parent form fills in the team name", (await p.locator("#teamOut").innerText()).includes("E2E Varsity")); }
      ok(`${f} page fits a phone`, (await overflow(p)) <= 1);
      { const cx = await contrast(p); ok(`${f} page text has enough contrast`, !cx.length, cx.slice(0, 3).join(" | ")); }
    }
    await go(p, "track"); await p.getByRole("button", { name: "Create an account" }).click();
    await p.getByLabel("Email").fill("legal@e2e.test"); await p.locator("#auth-pw").fill("secret123");
    { const ax = await a11y(p); ok("sign-up form controls all have names", !ax.length, ax.join(" | ")); }
    await p.getByRole("button", { name: "Create account" }).click(); await p.waitForTimeout(300);
    ok("sign-up asks for agreement first", (await p.getByText("Please confirm you're 13 or older").count()) === 1);
    await p.locator(".auth-agree input").check(); await p.getByRole("button", { name: "Create account" }).click(); await p.waitForTimeout(600);
    const users = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/users`)).json();
    const me = users.find((u) => u.email === "legal@e2e.test");
    ok("the agreement is recorded with the account", me && me.meta && me.meta.terms_version === "1" && !!me.meta.terms_accepted_at, JSON.stringify(me && me.meta));
    await p.getByLabel("Team name").fill("Legal Eagles"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(900);
    await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill("5 Ana OH\n6 Bea MB"); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(300);
    ok("roster permission reminder shows once players are added", (await p.locator(".banner", { hasText: "Permission to record players" }).count()) === 1);
    await p.getByRole("button", { name: "I have permission" }).click(); await p.waitForTimeout(200);
    ok("reminder goes away after confirming", (await p.locator(".banner", { hasText: "Permission to record players" }).count()) === 0);
    await go(p, "track"); { const sq = await squashed(p); ok("home checklist isn't squeezed on a phone", !sq.length, sq.join(" | ")); }
    // an account from before the terms existed is asked to agree once on its next sign-in
    await fetch(`http://localhost:${MOCK_PORT}/__mock/strip-terms`);
    const q = await newPage(browser, { phone: true });
    await go(q, "account"); await q.getByLabel("Email").fill("legal@e2e.test"); await q.locator("#auth-pw").fill("secret123"); await q.getByRole("button", { name: "Sign in" }).click(); await q.waitForTimeout(1200);
    ok("older accounts are asked to agree", (await q.getByText("Our Terms and Privacy Policy").count()) === 1);
    await q.getByRole("button", { name: "Agree and continue" }).click(); await q.waitForTimeout(200);
    ok("…and can't skip the checkbox", (await q.getByText("Check the box to agree.").count()) === 1);
    await q.locator(".auth-agree input").check(); await q.getByRole("button", { name: "Agree and continue" }).click(); await q.waitForTimeout(1200);
    ok("agreeing opens the app", (await q.getByText("Our Terms and Privacy Policy").count()) === 0 && (await q.locator(".page, .content").count()) > 0);
    await q.context().close();
    // delete the account, then the same sign-in fails
    await go(p, "settings"); await p.getByRole("button", { name: "Delete account" }).click();
    await p.getByLabel("Type DELETE to confirm").fill("DELETE"); await p.getByRole("button", { name: "Delete my account" }).click(); await p.waitForTimeout(800);
    ok("account deleted", (await p.getByText("Your account is deleted").count()) === 1);
    const after = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/users`)).json();
    ok("the account is gone from the server", !after.some((u) => u.email === "legal@e2e.test"));
    await p.getByRole("button", { name: "Erase this device" }).click(); await p.getByRole("button", { name: "Erase everything here?" }).click(); await p.waitForTimeout(1500);
    ok("erasing the device starts fresh", (await p.getByRole("button", { name: "Use without an account" }).count()) === 1);
    ok("legal: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async planning(browser) {
    const p = await newPage(browser);
    await go(p, "sample"); await p.waitForTimeout(800);
    await go(p, "lineup");
    const cards = await download(p, () => p.getByRole("button", { name: "Lineup cards" }).click()); ok("lineup cards for 5 sets", (cards.text().match(/class="card"/g) || []).length === 5);
    ok("start-rotation advice shows", (await p.locator(".card", { hasText: "Which rotation to start in" }).count()) === 1);
    await go(p, "matchup"); await p.getByRole("button", { name: "Paste schedule" }).click();
    await p.locator('textarea[placeholder*="Buchanan 6:00"]').fill("Tue 11/3 vs Buchanan 6:00 PM\n11/7 @ Clovis West 5:30pm (League)\nnot a game");
    await p.getByRole("button", { name: /^Add 2 to schedule/ }).click(); await p.waitForTimeout(150);
    ok("pasted schedule adds 2 games", (await p.locator(".mu-sched li", { hasText: "Clovis West" }).count()) >= 1);
    const ics = await download(p, () => p.getByRole("button", { name: "Calendar" }).click()); ok("calendar file", ics.text().includes("BEGIN:VCALENDAR") && ics.text().includes("Clovis West"));
    await go(p, "practice"); ok("practice plan shows", (await p.locator(".block").count()) > 2);
    await p.getByRole("button", { name: "Run practice" }).click(); await p.waitForTimeout(200);
    ok("run practice timer opens", (await p.locator(".run").count()) > 0 || (await p.getByText(/Next up|Block 1|of \d+ min/).count()) > 0);
    ok("planning: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async cloud(browser) {
    const A = await newPage(browser);
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("head@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Cloud Club"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept*=csv]").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.getByRole("button", { name: "Invite a coach" }).click(); await A.waitForTimeout(300);
    const code = (await A.locator(".hint b").first().innerText()).trim(); ok("invite code made", /^[A-Z0-9]{6}$/.test(code), code);
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "Start · they serve first" }).click(); await A.waitForTimeout(200);
    await A.locator("button.ctrl", { hasText: "My job" }).click(); await A.getByRole("button", { name: /^Score only/ }).click(); await A.getByRole("button", { name: "Done", exact: true }).click();
    await A.waitForTimeout(2200);
    const B = await newPage(browser, { phone: true });
    await go(B, "join/" + code); await B.getByLabel("Email").fill("assistant@e2e.test"); await B.locator("#auth-pw").fill("secret123"); await B.locator(".auth-agree input").check(); await B.getByRole("button", { name: "Create account" }).click(); await B.waitForTimeout(500);
    await B.getByRole("button", { name: "Join team" }).click(); await B.waitForTimeout(1200);
    await go(B, "track"); ok("assistant sees the live match", /CLOUD CLUB 0/.test(await score(B)));
    await B.locator("button.ctrl", { hasText: "My job" }).click(); await B.getByRole("button", { name: /^Stats only/ }).click(); await B.getByRole("button", { name: "Done", exact: true }).click();
    await B.locator(".pl", { hasText: "Nia" }).first().click(); await B.locator(".actsheet button", { hasText: /^3$/ }).click(); await skipIfAsked(B);
    ok("stats-only pass doesn't score", /CLOUD CLUB 0 .* 0 /.test(await score(B)), await score(B));
    await A.getByRole("button", { name: "Our point", exact: true }).click(); await A.waitForTimeout(2200);
    for (const P of [B, A]) { await go(P, "team"); await P.getByRole("button", { name: "Sync now" }).click(); await P.waitForTimeout(900); }
    await go(A, "track"); ok("head coach sees 1–0 and the assistant", /CLOUD CLUB 1/.test(await score(A)) && (await A.locator(".banner", { hasText: "Tracking with assistant" }).count()) === 1);
    // live link + parent
    await go(A, "live"); await A.getByRole("button", { name: "Share live link" }).click(); await A.waitForTimeout(1200);
    const live = (await A.locator("span.small.muted", { hasText: "#/watch/" }).first().innerText()).trim();
    const P = await newPage(browser, { phone: true }); await P.goto(live); await P.waitForTimeout(1200);
    ok("parent gamecast shows 1–0", /1\s*–\s*0/.test(await P.locator(".gc-score").innerText()));
    ok("parent gamecast fits a phone", (await overflow(P)) <= 1);
    { const ax = await a11y(P); ok("gamecast controls all have names", !ax.length, ax.join(" | ")); }
    { const cx = await contrast(P); ok("gamecast text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    // season page + recruiting link
    await go(A, "team"); await A.getByRole("button", { name: "Share season page" }).click(); await A.waitForTimeout(1200);
    const season = await A.locator("a", { hasText: "#/season/" }).first().getAttribute("href");
    await P.goto(season); await P.waitForTimeout(1200); ok("season page loads", (await P.locator(".sh-hero", { hasText: "CLOUD CLUB" }).count()) === 1);
    ok("season page shows first names", (await P.locator("body").innerText()).includes("Nia"));
    // a family that said no to team pages: Nia shows only as her number
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    await A.getByLabel("Keep off public pages").check(); await A.waitForTimeout(2500);
    await P.reload(); await P.waitForTimeout(1500);
    { const body = await P.locator("body").innerText(); ok("player kept off public pages shows only her number", !body.includes("Nia") && /22\s+Player/.test(body), body.slice(0, 400).replace(/\s+/g, " ")); }
    await A.getByLabel("Keep off public pages").uncheck(); await A.waitForTimeout(300);
    { const ax = await a11y(P); ok("season page controls all have names", !ax.length, ax.join(" | ")); }
    { const cx = await contrast(P); ok("season page text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    { const ax = await a11y(A); ok("player page controls all have names", !ax.length, ax.join(" | ")); }
    ok("recruiting link needs family consent first", await A.getByRole("button", { name: "Share profile link" }).isDisabled());
    await A.locator(".consent-check input").check();
    await A.getByRole("button", { name: "Share profile link" }).click(); await A.waitForTimeout(1000);
    const rec = await A.locator("a", { hasText: "#/recruit/" }).first().getAttribute("href");
    await P.goto(rec); await P.waitForTimeout(1000); ok("recruiting page shows full name", (await P.frameLocator("iframe.recruit-frame").locator("h1").innerText()) === "Nia Lopez");
    await A.getByRole("button", { name: "Stop sharing" }).click(); await A.getByRole("button", { name: "Take it down?" }).click(); await A.waitForTimeout(600);
    await P.goto(rec); await P.reload(); await P.waitForTimeout(1000); ok("taken-down profile no longer opens", (await P.getByText("isn't active").count()) === 1);
    // AI through the server function, and the setup check
    const sent = []; A.on("request", (r) => { if (r.url().includes("/functions/v1/ai")) sent.push(r.postData() || ""); });
    await go(A, "stats"); await A.getByRole("button", { name: "Who should pass in rotation 2?" }).click(); await A.waitForTimeout(800);
    ok("ask your stats answers", (await A.locator(".ask-turn").count()) === 1);
    { const lasts = fs.readFileSync(path.join(__dirname, "roster.csv"), "utf8").split("\n").slice(1).map((l) => l.split(",")[2]).filter(Boolean);
      ok("AI requests carry first names only, never last names", sent.length > 0 && sent.join("").includes("Nia") && !lasts.some((n) => sent.join("").includes(n)), lasts.filter((n) => sent.join("").includes(n)).join(", ")); }
    await go(A, "settings"); await A.getByRole("button", { name: "Run check" }).click(); await A.waitForTimeout(1000);
    const notOk = await A.locator(".check-list li:not(.sc-ok) b").allInnerTexts();
    ok("setup check: the cloud, account, sync and AI are all ✓", (await A.locator(".check-list li.sc-ok").count()) >= 5 && notOk.every((x) => ["Installed on this device", "Privacy contact"].includes(x)), notOk.join(", "));
    // a view-only parent account can follow along but can't change the team's data
    await go(A, "team"); await A.getByRole("button", { name: "Invite view-only" }).click(); await A.waitForTimeout(300);
    const vcode = (await A.locator(".hint b").first().innerText()).trim();
    const V = await newPage(browser, { phone: true });
    await go(V, "join/" + vcode); await V.getByLabel("Email").fill("parent@e2e.test"); await V.locator("#auth-pw").fill("secret123"); await V.locator(".auth-agree input").check(); await V.getByRole("button", { name: "Create account" }).click(); await V.waitForTimeout(500);
    await V.getByRole("button", { name: "Join team" }).click(); await V.waitForTimeout(1500);
    await go(V, "team"); await V.getByRole("button", { name: "Sync now" }).click(); await V.waitForTimeout(800);
    await go(V, "track"); ok("viewer sees the view-only note", (await V.locator(".banner", { hasText: "View-only." }).count()) === 1);
    await V.locator(".pl", { hasText: "Maya" }).first().click(); await V.locator(".actsheet button", { hasText: /^Kill$/ }).click(); await skipIfAsked(V); await V.waitForTimeout(2500);
    await go(V, "team"); await V.getByRole("button", { name: "Sync now" }).click(); await V.waitForTimeout(800);
    ok("viewer's sync says it's view-only instead of failing forever", (await V.getByText("view-only access").count()) > 0);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(800); await go(A, "track");
    ok("viewer's entry never reaches the team", /CLOUD CLUB 1/.test(await score(A)), await score(A));
    for (const [n, pg] of [["head coach", A], ["assistant", B], ["parent", P], ["viewer", V]]) ok(`cloud: no page errors (${n})`, !pg.errors.length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, B, P, V]) await pg.context().close();
  },
};

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("Build first: npm run build"); process.exit(1); }
  const app = await serveDist(), mock = await startMock(MOCK_PORT), browser = await chromium.launch();
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && name !== only) continue;
    const t0 = Date.now(), f0 = failures; console.log(`• ${name}`);
    try { await fn(browser); } catch (e) {
      failures++; console.log(`  ✗ ${name} crashed: ${String(e.message || e).split("\n")[0]}`);
      let i = 0; for (const pg of OPEN) { const f = path.join(require("os").tmpdir(), `e2e-${name}-${i++}.png`); await pg.screenshot({ path: f }).catch(() => {}); console.log("    screenshot: " + f); }
    }
    for (const pg of OPEN) await pg.context().close().catch(() => {});
    console.log(`  ${failures === f0 ? "✓" : "✗"} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  await browser.close(); app.close(); mock.close();
  console.log(`\n${passes} checks passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();

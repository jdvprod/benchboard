/**
 * End-to-end tests: drives the built app in Chromium like a coach would, on desktop and phone, light and dark,
 * with a mock Supabase for accounts, sync and share links. Run after `npm run build`:  node e2e/run.cjs
 * Fails (exit 1) on any broken step, page error, or sideways scroll on a phone.
 */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const startMock = require("./mock-supabase.cjs");

const DIST = process.env.E2E_DIST || path.join(__dirname, "..", "dist"), APP_PORT = 5199, MOCK_PORT = 54399, U = `http://localhost:${APP_PORT}/`;
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
  if (out["Content-Security-Policy"]) out["Content-Security-Policy"] = out["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://localhost:* http://127.0.0.1:*").replace("img-src 'self'", "img-src 'self' http://localhost:* http://127.0.0.1:*").replace("media-src 'self'", "media-src 'self' http://localhost:* http://127.0.0.1:*").replace("; upgrade-insecure-requests", ""); // the local test servers are plain http
  return out;
}

/** While true the app server drops every request, like a gym with no Wi-Fi. (Playwright's offline mode doesn't cover service worker fetches.) */
let NO_WIFI = false; const HANGING = [];
function serveDist() {
  return new Promise((done) => {
    const srv = http.createServer((req, res) => {
      if (NO_WIFI === "slow") { HANGING.push(req.socket); return; } // the request just hangs, like weak gym Wi-Fi
      if (NO_WIFI) return req.socket.destroy();
      if (req.url.startsWith("/__fixtures/")) { // test media, with byte ranges so video can seek
        const file = path.join(__dirname, "fixtures", path.basename(new URL(req.url, U).pathname)); if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        const size = fs.statSync(file).size, r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
        if (r) { const a = r[1] ? +r[1] : 0, b = r[2] ? +r[2] : size - 1; res.writeHead(206, { "content-type": "video/webm", "accept-ranges": "bytes", "content-range": `bytes ${a}-${b}/${size}`, "content-length": b - a + 1 }); return fs.createReadStream(file, { start: a, end: b }).pipe(res); }
        res.writeHead(200, { "content-type": "video/webm", "accept-ranges": "bytes", "content-length": size }); return fs.createReadStream(file).pipe(res);
      }
      let f = decodeURIComponent(new URL(req.url, U).pathname); if (f.endsWith("/")) f += "index.html";
      const file = path.join(DIST, f);
      if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", ...headersFor(f) }); fs.createReadStream(file).pipe(res);
    });
    srv.listen(APP_PORT, () => done(srv));
  });
}

async function newPage(browser, { phone = false, tablet = false, dark = false, cloud = true, skew = 0, strict = false, scale = 1, size = null } = {}) {
  const ctx = await browser.newContext({ viewport: size || (phone ? { width: 390, height: 844 } : tablet ? { width: 820, height: 1180 } : { width: 1360, height: 900 }), deviceScaleFactor: scale, colorScheme: dark ? "dark" : "light", acceptDownloads: true, hasTouch: phone });
  if (cloud) await ctx.addInitScript((url) => { try { localStorage.setItem("bs-cloud-config", JSON.stringify({ url, key: "anon" })); } catch { /* sandboxed frame */ } }, `http://localhost:${MOCK_PORT}`);
  if (!strict) await ctx.addInitScript(() => { try { localStorage.setItem("bs-allow-offline", "1"); } catch { /* sandboxed frame */ } }); // tests may use the app without an account; real visitors can't
  if (skew) await ctx.addInitScript((ms) => { const real = Date.now; Date.now = () => real() + ms; }, skew);
  // WIDE_FONTS=1: a wide fallback font, like CI machines without the web fonts, to catch layouts that only just fit
  if (process.env.WIDE_FONTS) await ctx.addInitScript(() => addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "*{font-family:Verdana,'DejaVu Sans',sans-serif!important}"; document.head.append(st); }));
  const page = await ctx.newPage(); page.errors = []; OPEN.add(page); page.on("close", () => OPEN.delete(page));
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" && (/Content Security Policy/.test(t) || !/Failed to load resource|ERR_|fonts\.g/.test(t))) page.errors.push(t); });
  page.setDefaultTimeout(8000);
  return page;
}
/** New-device check: sign-in on a device the account hasn't used asks for the emailed code. Reads the code from the mock's "inbox". */
async function deviceCode(pg, email, { expect = true } = {}) {
  const box = pg.locator("#auth-code, .ma-code").first();
  const shown = await box.waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
  if (!expect) return shown;
  if (!shown) { ok("a new device asks for the emailed code (" + email + ")", false); return false; }
  const { code } = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/otp?email=${encodeURIComponent(email)}`)).json();
  await box.fill(code || ""); await pg.locator(".auth-form .auth-btn, .ma .ma-go").first().click(); await pg.waitForTimeout(900);
  return true;
}
const go = async (p, hash) => { await p.goto(U + "#/" + hash); await p.waitForTimeout(350); };
const score = async (p) => { const t = (await p.locator(".board").first().innerText()).replace(/\s+/g, " "); const n = t.match(/(\d+) SET (\d) .* (\d+) (?:Rotation|Our)/); return t; };
const download = async (p, click, timeout = 8000) => { const [d] = await Promise.all([p.waitForEvent("download", { timeout }), click()]); const f = await d.path(); return { name: d.suggestedFilename(), path: f, size: fs.statSync(f).size, text: () => fs.readFileSync(f, "utf8") }; };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
/** Basic accessibility: every control has a name screen readers can announce, images have alt text, ids are unique. */
const a11y = (p) => p.evaluate(() => {
  const out = [];
  const name = (e) => (e.getAttribute("aria-label") || (e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent) || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest("label")?.textContent || e.textContent || e.getAttribute("title") || (e.tagName === "INPUT" && ["submit", "button"].includes(e.type) && e.value) || "").trim();
  for (const e of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")) {
    const st = getComputedStyle(e); if (st.display === "none" || st.visibility === "hidden" || e.closest("[hidden],[aria-hidden=true]")) continue;
    if (!name(e) && !(e.tagName === "INPUT" && e.placeholder && e.type !== "checkbox")) out.push(`${e.tagName.toLowerCase()}${e.className ? "." + String(e.className).split(" ")[0] : ""}${e.getAttribute("href") ? "[" + e.getAttribute("href").slice(0, 40) + "]" : ""} has no label`);
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
/** Built-but-held features (src/app/flags.ts): their tests run only when they're on. */
const FEES_ON = /FEES = true/.test(fs.readFileSync(path.join(__dirname, "..", "src/app/flags.ts"), "utf8"));
/** Academy, Beach and Recruit ask for an account first: create one in the site's sign-up box. */
async function siteSignUp(p, email, kind = "athlete", name = "Test Person") {
  const box = p.locator(".sg .ma");
  ok(`${email}: the site asks for an account before showing anything`, (await box.count()) === 1);
  await box.getByLabel("Your name").fill(name); await box.locator("select").selectOption(kind);
  await box.getByLabel("Email", { exact: true }).fill(email); await box.getByLabel("Password", { exact: true }).fill("secret-pass-1");
  await box.locator(".ma-check input").first().check(); await box.getByRole("button", { name: "Create free account" }).last().click();
  await p.waitForTimeout(1500);
}

/** The head coach (A) approves the coach (B) who joined with a coach code; B's next sync brings the team down. */
async function approveCoach(A, B) {
  await go(A, "team"); await A.waitForTimeout(600);
  await A.locator(".mem-wait").getByRole("button", { name: "Approve" }).first().click(); await A.waitForTimeout(500);
  await B.reload(); await B.waitForTimeout(2000);
  await go(A, "track"); await A.waitForTimeout(200);
}

const scenarios = {
  async home(browser) {
    const p = await newPage(browser, { cloud: false, phone: true });
    await p.goto(U); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill("Clovis North"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(400);
    await p.goto(U); await p.waitForTimeout(400);
    ok("the app opens to Home", (await p.getByRole("heading", { name: "Clovis North", level: 1 }).count()) === 1 && (await p.locator(".hm-goto a").count()) >= 10 && (await p.locator(".nav .tab[aria-current=page]").innerText()).includes("Home"));
    ok("Home: a tile for every section, with what's in it", /Set your starting six/.test(await p.locator(".hm-goto").innerText()) && /Plan a practice/.test(await p.locator(".hm-goto").innerText()));
    await p.locator(".hm-goto a", { hasText: "Practice" }).click(); await p.waitForTimeout(300);
    ok("Home: a tile opens its section", /#\/practice$/.test(p.url()));
    await p.getByRole("link", { name: "Home" }).click(); await p.waitForTimeout(200);
    await p.getByRole("button", { name: "Start a match" }).click(); await p.waitForTimeout(300);
    ok("Home: Start a match goes to Track's start form", /#\/track$/.test(p.url()) && (await p.getByPlaceholder("e.g. Buchanan").count()) === 1);
    await p.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(300);
    await go(p, "home"); await p.waitForTimeout(200);
    ok("Home: a live match shows at the top with Resume", /Match in progress vs Buchanan/.test(await p.locator(".home-live").innerText()) && (await p.getByRole("button", { name: "Start a match" }).count()) === 0);
    await p.goto(U); await p.waitForTimeout(500);
    ok("reopening the app mid-match goes straight to the match", (await p.locator(".pl").count()) > 0 || (await p.getByText(/Set your starting lineup|lineup/i).count()) > 0);
    await go(p, "home"); await p.locator(".home-live").click(); await p.waitForTimeout(200);
    ok("Home: Resume opens the match", /#\/track$/.test(p.url()));
    ok("Home fits a phone", (await overflow(p)) <= 1); { const ax = await a11y(p); ok("Home: controls all have names", !ax.length, ax.join(" | ")); }
    ok("Home: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async gallery(browser) {
    // phone screenshots of every page of the sample season, to look at by eye (SHOTS=dir)
    const p = await newPage(browser, { phone: true }); await go(p, "sample"); await p.waitForTimeout(900);
    for (const r of ["home", "track", "lineup", "matchup", "practice", "stats", "court", "team", "film", "tryouts", "club", "settings", "live"]) {
      await go(p, r); await p.waitForTimeout(500);
      if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "g-" + r + ".png"), fullPage: true });
    }
    ok("gallery: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    if (process.env.SHOTS) { const d = await newPage(browser, {}); await go(d, "sample"); await d.waitForTimeout(900); await go(d, "home"); await d.waitForTimeout(500); await d.screenshot({ path: path.join(process.env.SHOTS, "g-home-desktop.png"), fullPage: true });
      await d.locator(".nav .tm-btn").click(); await d.waitForTimeout(250); await d.screenshot({ path: path.join(process.env.SHOTS, "g-teammenu.png"), clip: { x: 0, y: 0, width: 520, height: 420 } }); await d.keyboard.press("Escape");
      await d.getByRole("button", { name: "Collapse the sidebar" }).click(); await d.waitForTimeout(400); await d.screenshot({ path: path.join(process.env.SHOTS, "g-folded.png") }); await d.context().close(); }
  },
  async tour(browser) {
    for (const opts of [{}, { phone: true }, { phone: true, dark: true }, { tablet: true }]) {
      const tag = opts.phone ? (opts.dark ? "phone dark" : "phone") : opts.tablet ? "tablet" : "desktop", p = await newPage(browser, opts);
      await go(p, "sample"); await p.waitForTimeout(900);
      ok(`${tag}: sample team opens on Home`, (await p.locator(".hm-head").count()) > 0);
      if (opts.dark) { await go(p, "settings"); await p.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click(); await p.waitForTimeout(150); }
      await go(p, "track"); ok(`${tag}: sample team loads on Track`, (await p.locator(".board").count()) > 0);
      for (const r of ["track", "lineup", "matchup", "practice", "stats", "court", "team", "film", "tryouts", "settings", "labs", "live", "account"]) {
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
    await p.keyboard.type("2"); await p.keyboard.press("k"); await p.waitForTimeout(200);
    ok("a play after set point doesn't add to the finished set", (await p.locator(".banner", { hasText: "Set 1 to E2E High, 25–0" }).count()) === 1 && (await p.getByText("Pick who serves first in set 2").count()) > 0);
    await p.keyboard.press("Escape");
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
    ok("home shows last match W 3–0", /W\s*3–0\s*vs Rival Prep/.test(await p.locator(".hm-score").innerText()), await p.locator(".hm-score").innerText().catch(() => ""));
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
    const mp = await download(p, () => p.getByRole("button", { name: "MaxPreps sheet" }).click());
    { const h = mp.text(); ok("MaxPreps sheet has every category and Bea's tool kill counts as a kill", ["SP", "PTS", "ATT", "RE", "BHA", "DE"].every((c) => h.includes(`>${c}</th>`)) && /Bea Outside<\/td><td>\d+<\/td>/.test(h), mp.name); }
    const gfx = await download(p, () => p.getByRole("button", { name: "Share graphic" }).click()); ok("share graphic is a PNG", gfx.name.endsWith(".png") && gfx.size > 20000, gfx.size + " bytes");
    await p.getByRole("button", { name: "Recap video" }).click(); await p.waitForTimeout(900);
    ok("recap video opens a vertical preview that is drawing", await p.locator(".rv-cv").evaluate((c) => c.width === 1080 && c.height === 1920 && c.getContext("2d").getImageData(60, 70, 1, 1).data[0] > 200));
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    ok("Escape closes the recap video", (await p.locator(".rv-back").count()) === 0);
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
    ok("home shows the tie", /T\s*1–1\s*vs Pool Team/.test(await p.locator(".hm-score").innerText()) && /0–0–1/.test(await p.locator(".hm-record").innerText()));
    ok("formats: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async offline(browser) {
    const A = await newPage(browser), SW = `http://127.0.0.1:${APP_PORT}/#/`; // the service worker is skipped on "localhost" (dev)
    await A.goto(SW + "track"); await A.waitForTimeout(300); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("gym@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("No Wifi High"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.goto(SW + "track"); await A.waitForTimeout(400); await A.reload(); await A.waitForTimeout(1500); // let the service worker install and cache the app
    await A.goto(SW.replace("#/", "") + "legal/privacy.html"); await A.waitForTimeout(300); await A.goto(SW.replace("#/", "") + "live/"); await A.waitForTimeout(300); await A.goto(SW + "track"); await A.waitForTimeout(500); // other pages must not replace the app's offline copy
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
    await go(N, "account"); await N.getByLabel("Email").fill("gym@e2e.test"); await N.locator("#auth-pw").fill("secret123"); await N.getByRole("button", { name: "Sign in" }).click();
    ok("the right password on a new device isn't enough: it asks for an emailed code", await deviceCode(N, "gym@e2e.test", { expect: false }));
    ok("nothing is signed in before the code", !(await N.evaluate(() => localStorage.getItem("bs-session"))));
    await N.locator("#auth-code").fill("000000"); await N.locator(".auth-form .auth-btn").click(); await N.waitForTimeout(600);
    ok("a wrong code is turned away", /code didn't work/i.test(await N.locator(".auth-err").innerText().catch(() => "")));
    await deviceCode(N, "gym@e2e.test"); await N.waitForTimeout(1600);
    ok("the right code signs in and remembers the device", !!(await N.evaluate(() => localStorage.getItem("bs-session"))) && !!(await N.evaluate(() => localStorage.getItem("fc-trusted"))));
    await go(N, "track"); await N.waitForTimeout(500);
    ok("offline plays reach another device after reconnecting", /NO WIFI HIGH 3/.test(await score(N).catch(() => "")), await score(N).catch(() => "no board"));
    for (const [n, pg] of [["gym", A], ["second device", N]]) ok(`offline: no page errors (${n})`, !pg.errors.filter((e) => !/fetch|network|Failed/i.test(e)).length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, N]) await pg.context().close();
  },

  async fees(browser) {
    if (!FEES_ON) { ok("fees are on hold (src/app/flags.ts), so nothing shows", true); return; }
    const p = await newPage(browser, { cloud: false, phone: true });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill("Clovis North"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click();
    await p.locator("textarea").first().fill("7 Maya Chen OH\n12 Sofia Nguyen MB\n3 Lily Torres L"); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(200);
    const card = p.locator(".card", { has: p.getByRole("heading", { name: "Player fees" }) });
    await card.getByLabel("Fee per player").fill("$450"); await card.getByLabel("Due date (optional)").fill("2026-12-01");
    await card.getByRole("button", { name: "Start tracking fees" }).click(); await p.waitForTimeout(200);
    ok("fees: a season fee starts every family at owes", /\$0 of \$1,350 collected/.test(await card.innerText()) && (await card.locator(".fee-st.owes").count()) === 3, await card.innerText());
    await card.locator(".fee-row", { hasText: "Maya" }).click();
    await card.getByLabel("Amount Maya paid").fill("200"); await card.getByLabel("How they paid (optional)").fill("Venmo"); await card.getByRole("button", { name: "Record payment" }).click(); await p.waitForTimeout(150);
    await card.getByLabel("Amount Maya paid").fill("250"); await card.getByRole("button", { name: "Record payment" }).click(); await p.waitForTimeout(150);
    ok("fees: payments add up to paid", /\$450 of \$1,350 collected/.test(await card.innerText()) && (await card.locator(".fee-row", { hasText: "Maya" }).locator(".fee-st.paid").count()) === 1 && /2 families still owe \$900/.test(await card.innerText()));
    await card.locator(".fee-row", { hasText: "Maya" }).click(); await card.locator(".fee-row", { hasText: "Lily" }).click();
    await card.getByText("Different amount, waiver or note").click(); await card.getByLabel("Amount waived").fill("450"); await card.getByLabel("Note (coaches only)").fill("Scholarship"); await card.getByRole("button", { name: "Save", exact: true }).click(); await p.waitForTimeout(150);
    ok("fees: a waiver clears what a family owes", (await card.locator(".fee-row", { hasText: "Lily" }).locator(".fee-st.waived").count()) === 1 && /1 family still owes \$450/.test(await card.innerText()));
    await card.getByLabel("Only who owes").check(); await p.waitForTimeout(100);
    ok("fees: filter to who owes", (await card.locator(".fee-row").count()) === 1 && /Sofia/.test(await card.locator(".fee-list").innerText()));
    { const [d] = await Promise.all([p.waitForEvent("download"), card.getByRole("button", { name: "Download spreadsheet" }).click()]); const csv = fs.readFileSync(await d.path(), "utf8");
      ok("fees: the spreadsheet has every family", /^Number,First,Last,Owed,Paid,Balance/.test(csv) && /7,Maya,Chen,450\.00,450\.00,0\.00,paid/.test(csv) && /Venmo/.test(csv), csv.slice(0, 300)); }
    ok("fees: fits a phone", (await overflow(p)) <= 1);
    { const ax = await a11y(p); ok("fees: controls all have names", !ax.length, ax.join(" | ")); }
    await go(p, "club"); await p.getByRole("button", { name: "Fees", exact: true }).click(); await p.waitForTimeout(200);
    ok("fees: the club sees every team's collections", /\$450 of \$900 collected across 1 team/.test(await p.locator(".page").innerText()) && /1 of 3/.test(await p.locator(".page").innerText()), await p.locator(".page").innerText());
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "fees-club.png"), fullPage: true });
    await go(p, "team"); if (process.env.SHOTS) await card.screenshot({ path: path.join(process.env.SHOTS, "fees.png") });
    await p.context().close();
  },

  async xss(browser) {
    // names are typed by coaches, parents and players: markup in them must show as text everywhere, never become part of the page
    const N1 = "<img src=x id=pwn>", N2 = '"><b id=pwn2>x', TEAM = "<i id=pwn3>Broncos";
    const clean = (pg) => pg.evaluate(() => !document.querySelector("#pwn,#pwn2,#pwn3"));
    const p = await newPage(browser, { cloud: false, phone: true });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill(TEAM); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click();
    await p.locator("textarea").first().fill(`7 ${N1} OH\n8 ${N2} S`); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(200);
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill(N2); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(200);
    await p.locator(".pl", { hasText: "<img" }).first().click(); await p.locator(".actsheet button", { hasText: /^Kill$/ }).click(); await skipIfAsked(p);
    await go(p, "team"); { const t = await p.evaluate(() => document.body.innerText + [...document.querySelectorAll("input")].map((i) => i.value).join(" ")); ok("markup in a name shows as plain text", t.includes("<img") && t.includes("<b id=pwn2>") && t.includes(TEAM), t.slice(-300)); }
    let bad = [];
    for (const r of ["track", "lineup", "matchup", "practice", "stats", "court", "team", "live", "film", "tryouts", "settings"]) { await go(p, r); if (!(await clean(p))) bad.push(r); }
    ok("names never turn into page markup in the coach app", !bad.length, bad.join(", "));
    await go(p, "tryouts"); await p.getByLabel("Name").fill(N1); await p.getByRole("button", { name: "Start" }).click(); await p.waitForTimeout(300);
    await p.getByLabel("Players trying out, one per line").fill(`21 ${N1} OH\n22 ${N2} S`); await p.getByRole("button", { name: "Add", exact: true }).click(); await p.waitForTimeout(200);
    ok("or in tryouts", await clean(p));
    { const [pop] = await Promise.all([p.waitForEvent("popup", { timeout: 5000 }), p.getByRole("button", { name: "Print rating sheet" }).click()]); await pop.waitForLoadState();
      ok("or in a printed rating sheet", (await clean(pop)) && (await pop.locator("body").innerText()).includes(N1)); await pop.close(); }
    ok("no page errors (including blocked scripts)", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
    // Beach: names travel inside a share link, so a link someone else made is untrusted input
    const pk = Buffer.from(JSON.stringify([1, "bo3", 0, [0, 2], [N1, N2, "Kim", "<script>window.__pwn=1</script>"], N1 + " / " + N2, TEAM, Date.now(), "K0uA2t"])).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const b = await newPage(browser, { phone: true }); await b.goto(U + "beach/#/v/" + pk); await b.waitForTimeout(500);
    ok("a beach share link with markup in the names opens as text", (await b.locator(".bv-box tbody tr").count()) > 0 && (await clean(b)) && !(await b.evaluate(() => window.__pwn)) && (await b.locator("body").innerText()).includes("<img src=x"));
    ok("beach: no page errors", !b.errors.length, b.errors.slice(0, 3).join(" | "));
    await b.context().close();
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
    await go(p, "sample"); await p.waitForTimeout(800); await go(p, "track"); await p.waitForTimeout(300);
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
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("clock@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clock High"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.getByRole("button", { name: "Invite a coach" }).click(); await A.waitForTimeout(300);
    const code = (await A.locator(".hint b").first().innerText()).trim();
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Skew Prep"); await A.getByRole("button", { name: "Start · they serve first" }).click(); await A.waitForTimeout(200);
    await A.locator("button.ctrl", { hasText: /^Tracking/ }).click(); await A.getByRole("button", { name: /^Score only/ }).click(); await A.getByRole("button", { name: "Done", exact: true }).click();
    await A.waitForTimeout(2200);
    const B = await newPage(browser, { phone: true, skew: 90000 });
    await go(B, "join/" + code); await B.getByLabel("Email").fill("fast@e2e.test"); await B.locator("#auth-pw").fill("secret123"); await B.locator("#auth-name").fill("Test Coach"); await B.locator(".auth-agree input").first().check(); await B.getByRole("button", { name: "Create account" }).click(); await B.waitForTimeout(500);
    await B.getByRole("button", { name: "Join team" }).click(); await B.waitForTimeout(1500);
    await approveCoach(A, B);
    await go(B, "track"); await B.locator("button.ctrl", { hasText: /^Tracking/ }).click(); await B.getByRole("button", { name: /^Stats only/ }).click(); await B.getByRole("button", { name: "Done", exact: true }).click();
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
    { const get = async (u) => (await fetch(U + u)).text();
      const [app, live, rec, robots] = await Promise.all([get(""), get("live/"), get("recruit/"), get("robots.txt")]);
      ok("link previews: every site has a title, description and 1200×630 image", [app, live, rec].every((h) => /og:title/.test(h) && /og:image" content="[^"]*og\.png"/.test(h)));
      ok("team pages and recruiting profiles stay out of search engines", /noindex/.test(live) && /noindex/.test(rec) && !/noindex/.test(app) && /Disallow: \/live\//.test(robots) && /Disallow: \/recruit\//.test(robots)); }
    const p = await newPage(browser, { phone: true });
    { const h = (await p.goto(U)).headers(); ok("pages are served with a content security policy", /script-src 'self'/.test(h["content-security-policy"] || "") && h["x-content-type-options"] === "nosniff"); }
    for (const f of ["privacy", "terms", "schools", "accessibility", "consent-form"]) {
      const r = await p.goto(U + "legal/" + f + ".html"); const body = await p.content();
      ok(`${f} page is published`, r.status() === 200 && !body.includes("%LEGAL"), String(r.status()));
      if (f === "consent-form") { await p.fill("#team", "E2E Varsity"); ok("parent form fills in the team name", (await p.locator("#teamOut").innerText()).includes("E2E Varsity")); }
      ok(`${f} page fits a phone`, (await overflow(p)) <= 1);
      { const cx = await contrast(p); ok(`${f} page text has enough contrast`, !cx.length, cx.slice(0, 3).join(" | ")); }
    }
    await go(p, "track"); { const ca = p.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await p.getByLabel("Email", { exact: true }).fill("legal@e2e.test"); await p.locator("#auth-pw").fill("secret123"); await p.locator("#auth-name").fill("Legal Coach");
    { const ax = await a11y(p); ok("sign-up form controls all have names", !ax.length, ax.join(" | ")); }
    await p.getByRole("button", { name: "Create account" }).click(); await p.waitForTimeout(300);
    ok("sign-up asks for agreement first", (await p.getByText("Please confirm you're 13 or older").count()) === 1);
    await p.locator("#auth-name").fill("Test Coach"); await p.locator(".auth-agree input").first().check(); await p.getByRole("button", { name: "Create account" }).click(); await p.waitForTimeout(600);
    const users = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/users`)).json();
    const me = users.find((u) => u.email === "legal@e2e.test");
    ok("the agreement is recorded with the account", me && me.meta && me.meta.terms_version === String(require("../package.json").legal.version) && !!me.meta.terms_accepted_at, JSON.stringify(me && me.meta));
    await p.getByLabel("Team name").fill("Legal Eagles"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(900);
    await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill("5 Ana OH\n6 Bea MB"); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(300);
    ok("roster permission reminder shows once players are added", (await p.locator(".banner", { hasText: "Permission to record players" }).count()) === 1);
    await p.getByRole("button", { name: "I have permission" }).click(); await p.waitForTimeout(200);
    ok("reminder goes away after confirming", (await p.locator(".banner", { hasText: "Permission to record players" }).count()) === 0);
    await go(p, "track"); { const sq = await squashed(p); ok("home checklist isn't squeezed on a phone", !sq.length, sq.join(" | ")); }
    // an account from before the terms existed is asked to agree once on its next sign-in
    await fetch(`http://localhost:${MOCK_PORT}/__mock/strip-terms`);
    const q = await newPage(browser, { phone: true });
    await go(q, "account"); await q.getByLabel("Email").fill("legal@e2e.test"); await q.locator("#auth-pw").fill("secret123"); await q.getByRole("button", { name: "Sign in" }).click(); await deviceCode(q, "legal@e2e.test"); await q.waitForTimeout(1200);
    ok("older accounts are asked to agree", (await q.getByText("Our Terms and Privacy Policy").count()) === 1);
    await q.getByRole("button", { name: "Agree and continue" }).click(); await q.waitForTimeout(200);
    ok("…and can't skip the checkbox", (await q.getByText("Check the box to agree.").count()) === 1);
    await q.locator(".auth-agree input").first().check(); await q.getByRole("button", { name: "Agree and continue" }).click(); await q.waitForTimeout(1200);
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
    { const md = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getMonth() + 1}/${d.getDate()}`; }; // always upcoming, whatever day the tests run
      await p.locator('textarea[placeholder*="Buchanan 6:00"]').fill(`${md(3)} vs Buchanan 6:00 PM\n${md(7)} @ Clovis West 5:30pm (League)\nnot a game`); }
    await p.getByRole("button", { name: /^Add 2 to schedule/ }).click(); await p.waitForTimeout(150);
    ok("pasted schedule adds 2 games", (await p.locator(".mu-sched li", { hasText: "Clovis West" }).count()) >= 1);
    const ics = await download(p, () => p.getByRole("button", { name: "Calendar" }).click()); ok("calendar file", ics.text().includes("BEGIN:VCALENDAR") && ics.text().includes("Clovis West"));
    await go(p, "practice"); ok("practice plan shows", (await p.locator(".block").count()) > 2);
    await p.getByRole("button", { name: "Run practice" }).click(); await p.waitForTimeout(200);
    ok("run practice timer opens", (await p.locator(".run").count()) > 0 || (await p.getByText(/Next up|Block 1|of \d+ min/).count()) > 0);
    ok("planning: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async imports(browser) {
    const p = await newPage(browser);
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click();
    await p.getByLabel("Team name").fill("Import High"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste a roster" }).click();
    await p.locator("textarea").first().fill("1 Ava Ramirez S\n4 Jordan Lee OH\n7 Maya Chen OH\n10 Emma Diaz DS"); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(200);
    const card = p.locator(".card", { hasText: "Import stats from another app" });
    await card.locator("input[type=file]").setInputFiles([path.join(__dirname, "fixtures", "Buchanan.txt"), path.join(__dirname, "fixtures", "game-log.csv")]); await p.waitForTimeout(500);
    const files = card.locator(".imp-file");
    ok("import reads a Hudl/SoloStats MaxPreps file and a spreadsheet", (await files.count()) === 2 && (await files.nth(0).innerText()).includes("MaxPreps file"));
    ok("opponent comes from the file name", (await files.nth(0).getByLabel("Opponent").inputValue()) === "Buchanan");
    ok("team totals line is left out and the new player is flagged", /3 players · 1 total lines left out/.test(await files.nth(0).innerText()) && /1 not yet: #99/.test(await files.nth(0).innerText()));
    await files.nth(0).getByLabel("Set scores (optional)").fill("25-20, 22-25, 15-12");
    ok("a game log splits into its matches", /2 matches by date and opponent/.test(await files.nth(1).innerText()));
    await files.nth(0).locator("summary").click(); ok("columns can be checked", (await files.nth(0).locator(".imp-colgrid select").count()) === 13);
    { const ax = await a11y(p); ok("import controls all have names", !ax.length, ax.join(" | ")); }
    await card.getByRole("button", { name: "Import 3 matches" }).click(); await p.waitForTimeout(400);
    ok("three matches imported", (await p.locator(".card", { hasText: "Matches & practices" }).locator(".tag", { hasText: "Imported" }).count()) === 3);
    ok("player not on the roster was added", (await p.locator(".card", { hasText: "Roster" }).locator("tbody tr").count()) === 5);
    await go(p, "stats"); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.waitForTimeout(200);
    { const row = (await p.locator("tr", { hasText: "Maya" }).first().innerText()).split(/\s+/); ok("Maya's season kills add up across the imported files (12 + 9 + 14)", row.includes("35"), row.join(" ")); }
    await go(p, "home"); ok("record counts the imported results", /3–0/.test(await p.locator(".hm-record").innerText().catch(() => "")));
    // importing the same file again skips it
    await go(p, "team"); await card.locator("input[type=file]").setInputFiles([path.join(__dirname, "fixtures", "Buchanan.txt")]); await p.waitForTimeout(300);
    await card.locator(".imp-file").first().getByLabel("Set scores (optional)").fill("25-20, 22-25, 15-12");
    ok("a file already imported is skipped", (await card.getByRole("button", { name: "Import 0 matches" }).isDisabled()) && (await card.getByText("already imported").count()) === 1);
    // FloorCall's own spreadsheet comes back in as season totals
    await card.getByRole("button", { name: "Cancel" }).click();
    await go(p, "stats"); const xl = await download(p, () => p.getByRole("button", { name: "Download spreadsheet" }).click());
    ok("own spreadsheet export downloads", xl.size > 3000);
    await go(p, "team"); await card.locator("input[type=file]").setInputFiles({ name: "Import High season.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fs.readFileSync(xl.path) }); await p.waitForTimeout(800);
    { const txt = await card.locator(".imp-file").first().innerText(); ok("an Excel file picks its player sheet and reads as season totals", txt.includes("Excel spreadsheet") && /sheet "/.test(txt) && (await card.locator(".imp-file").first().getByRole("button", { name: "Season totals" }).getAttribute("aria-pressed")) === "true", txt.slice(0, 160)); }
    await card.getByRole("button", { name: "Cancel" }).click();
    await go(p, "stats"); { const body = await p.locator("body").innerText();
      ok("imported stats don't invent rally numbers", /Side-out\s*—/.test(body) && /In-system %\s*—/.test(body) && /Free points\s*—/.test(body), body.slice(450, 900).replace(/\s+/g, " ")); }
    await go(p, "stats"); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.locator("tr.click", { hasText: "Maya" }).first().click(); await p.waitForTimeout(300);
    await p.getByRole("button", { name: "Stat graphic" }).click();
    { const g = await download(p, () => p.getByRole("button", { name: /^Last match: vs / }).click(), 15000);
      const dim = await p.evaluate(async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); return img.width + "x" + img.height; }, fs.readFileSync(g.path).toString("base64"));
      ok("a player's stat graphic saves as a 1080×1350 image", g.name.endsWith(".png") && dim === "1080x1350" && g.size > 20000, `${g.name} ${dim} ${g.size}`);
      if (process.env.SHOTS) fs.copyFileSync(g.path, path.join(process.env.SHOTS, "player-graphic.png")); }
    await go(p, "home"); ok("imports don't tick off 'Track your first match'", (await p.locator(".setup-list li.ok", { hasText: "Track your first match" }).count()) === 0 && (await p.locator(".setup-list li", { hasText: "Track your first match" }).count()) === 1);
    ok("imports: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async tournament(browser) {
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("tn@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("TN Club"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").first().setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(800);
    await go(A, "matchup"); await A.getByRole("button", { name: "New tournament" }).click();
    await A.getByLabel("Name", { exact: true }).fill("Fall Classic"); await A.getByLabel("Where").fill("Fresno Convention Center"); await A.getByRole("button", { name: "Create tournament" }).click(); await A.waitForTimeout(300);
    const addGame = async (stage, opp, time, court, round) => {
      if (await A.getByRole("button", { name: "Add a game" }).count()) await A.getByRole("button", { name: "Add a game" }).click();
      await A.getByRole("button", { name: stage, exact: true }).click();
      await A.locator(".tn-add input[list=tn-teams]").fill(opp); await A.getByLabel("Time").fill(time); await A.getByLabel("Court").fill(court);
      if (round) await A.getByLabel("Round").fill(round);
      await A.getByRole("button", { name: "Add game" }).click(); await A.waitForTimeout(150);
    };
    await addGame("Pool", "Buchanan", "09:00", "3"); await addGame("Pool", "Central", "10:00", "3"); await addGame("Work (ref)", "Buchanan vs Central", "11:00", "3"); await addGame("Bracket", "Fresno Elite", "13:00", "1", "Semifinal");
    ok("tournament lists our games in time order", (await A.locator(".tn-games li").allInnerTexts()).map((x) => x.split("\n").find((l) => /vs |Work/.test(l))).join("|") === "vs Buchanan|vs Central|Work: Buchanan vs Central|vs Fresno Elite");
    await A.getByLabel("Add a team to the pool").fill("Fresno Elite"); await A.getByRole("button", { name: "Add", exact: true }).click();
    await A.getByLabel("First team", { exact: true }).selectOption("Central"); await A.getByLabel("Second team", { exact: true }).selectOption("Fresno Elite"); await A.getByLabel("Set scores, first team's points first").fill("25-10, 25-12"); await A.getByRole("button", { name: "Add result" }).click(); await A.waitForTimeout(200);
    { const ax = await a11y(A); ok("tournament controls all have names", !ax.length, ax.join(" | ")); }
    // the Track home screen offers the next game
    await go(A, "track"); ok("home shows today's tournament with the next game", (await A.locator(".tn-today", { hasText: "Up next: vs Buchanan" }).count()) === 1);
    await A.locator(".tn-today").getByRole("button", { name: "Start" }).click(); await A.waitForTimeout(400);
    ok("the tournament game starts as a 2-set pool match", /TN CLUB 0 SET 1/.test(await score(A)));
    for (let s = 0; s < 2; s++) { for (let i = 0; i < 25; i++) { await A.keyboard.type("7"); await A.waitForTimeout(860); await A.keyboard.press("k"); } await A.keyboard.press("Escape"); await A.waitForTimeout(200); const nx = A.getByRole("button", { name: "TN Club serve" }); if (await nx.count()) await nx.click(); }
    ok("pool match ends 2–0", (await A.locator(".banner", { hasText: "Match over" }).count()) === 1);
    await A.getByRole("button", { name: "Finish" }).click(); await A.waitForTimeout(300);
    await go(A, "matchup"); await A.locator(".tn-list button", { hasText: "Fall Classic" }).click(); await A.waitForTimeout(300);
    ok("our result shows in the tournament", (await A.locator(".tn-games li", { hasText: "vs Buchanan" }).innerText()).includes("W 2–0"));
    ok("up next moves to the following game", (await A.locator(".tn-next", { hasText: "vs Central" }).count()) === 1);
    const st = (await A.locator(".card", { hasText: "standings" }).locator("tbody tr").allInnerTexts()).map((r) => r.split("\t")[0].trim());
    ok("pool standings rank by record, then sets, then points", st.join("|") === "TN Club|Central|Fresno Elite|Buchanan", st.join("|"));
    // families see it on FloorCall Live
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(800);
    await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1000);
    const teamUrl = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    const P = await newPage(browser, { phone: true }); await P.goto(teamUrl); await P.waitForTimeout(1500);
    const card = P.locator(".lv-tn");
    ok("Live team page shows the tournament day", (await card.count()) === 1 && (await card.innerText()).toLowerCase().includes("fall classic"), (await P.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " "));
    ok("Live shows our result, the next game's court and the work duty", /W 2–0/.test(await card.innerText()) && /Court 3/.test(await card.innerText()) && /Working: Buchanan vs Central/.test(await card.innerText()));
    ok("Live shows pool standings and the bracket path", (await card.locator("tbody tr").count()) === 4 && /Semifinal/.test(await card.innerText()));
    ok("Live tournament fits a phone", (await overflow(P)) <= 1);
    { const cx = await contrast(P); ok("Live tournament text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    // a Spanish-speaking family: the phone's language picks Spanish; the footer switches back
    { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-MX", hasTouch: true });
      await ctx.addInitScript((url) => { try { localStorage.setItem("bs-cloud-config", JSON.stringify({ url, key: "anon" })); } catch {} }, `http://localhost:${MOCK_PORT}`);
      const E = await ctx.newPage(); const errs = []; E.on("pageerror", (e) => errs.push(e.message));
      await E.goto(teamUrl); await E.waitForTimeout(1500);
      const t = await E.locator("body").innerText();
      ok("Live speaks Spanish on a Spanish phone", /Inicio/i.test(t) && /Récord/i.test(t) && /Cancha 3/.test(t) && /Arbitrando: Buchanan vs Central/.test(t) && /Resultados/i.test(t), t.slice(0, 300).replace(/\s+/g, " "));
      await E.locator(".lv-res", { hasText: /G 2–0/ }).first().click(); await E.waitForTimeout(500);
      await E.getByRole("button", { name: "Jugadas", exact: true }).click();
      ok("play-by-play in Spanish", (await E.locator(".lv-espn").first().innerText()).includes("Remate"), (await E.locator(".lv-espn").first().innerText()).slice(0, 120));
      if (process.env.SHOTS) await E.screenshot({ path: path.join(process.env.SHOTS, "live-es.png"), fullPage: true });
      await E.getByRole("button", { name: "English" }).click(); await E.waitForTimeout(1200);
      ok("the footer switches back to English", /Play-by-play/i.test(await E.locator("body").innerText()));
      ok("Spanish pages: no errors", !errs.length, errs.join(" | ")); await ctx.close(); }
    for (const [n, pg] of [["coach", A], ["parent", P]]) ok(`tournament: no page errors (${n})`, !pg.errors.length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, P]) await pg.context().close();
  },

  async notify(browser) {
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("notify@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Ping Club"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await go(A, "team"); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1200);
    const season = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    { const f = await download(A, () => A.getByRole("button", { name: "Printable flyer" }).click()); const html = f.text();
      ok("printable flyer has the team, the code and a QR code", html.includes("Ping Club") && html.includes(season.split("/").pop()) && /<svg/.test(html) && /Turn on notifications/.test(html));
      const pg = await A.context().newPage(); await pg.setContent(html); await pg.waitForTimeout(200); if (process.env.SHOTS) await pg.screenshot({ path: path.join(process.env.SHOTS, "flyer.png"), fullPage: true }); await pg.close();
      const im = await download(A, () => A.getByRole("button", { name: "Flyer image" }).click(), 15000); ok("flyer image saves for group chats", im.name.endsWith(".png") && im.size > 20000, `${im.name} ${im.size}`);
      if (process.env.SHOTS) fs.copyFileSync(im.path, path.join(process.env.SHOTS, "flyer-image.png")); }
    // a parent on the team page: browsers' push services aren't reachable from the test, so the subscription is stubbed
    const P = await newPage(browser, { phone: true });
    await P.context().grantPermissions(["notifications"], { origin: new URL(season).origin });
    await P.context().addInitScript(() => {
      const fake = { endpoint: "https://push.example.test/sub-1", toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } }; }, unsubscribe: async () => { localStorage.removeItem("__sub"); return true; } };
      if (self.Notification) { Object.defineProperty(Notification, "permission", { get: () => "granted" }); Notification.requestPermission = async () => "granted"; } // headless Chromium reports "denied" even when granted
      if (self.PushManager) { PushManager.prototype.subscribe = async function () { localStorage.setItem("__sub", "1"); return fake; }; PushManager.prototype.getSubscription = async function () { return localStorage.getItem("__sub") ? fake : null; }; }
    });
    await P.goto(season); await P.waitForTimeout(1200);
    ok("notifications ask for a free account first", (await P.locator(".lv-notify .ma").count()) === 1 && !(await P.getByRole("button", { name: "Turn on notifications" }).count()));
    await P.locator(".lv-notify").getByLabel("Your name").fill("Dana Lopez"); await P.locator(".lv-notify").getByLabel("Email", { exact: true }).fill("dana@example.com"); await P.locator(".lv-notify").getByLabel("Password", { exact: true }).fill("family-pass-1");
    await P.locator(".lv-notify").getByRole("button", { name: "Create free account" }).last().click(); await P.waitForTimeout(300);
    ok("the account form says what's missing", /13 or older/.test(await P.locator(".lv-notify .ma-err").innerText().catch(() => "")));
    await P.locator(".lv-notify .ma-check input").first().check(); await P.locator(".lv-notify").getByRole("button", { name: "Create free account" }).last().click(); await P.waitForTimeout(800);
    { const us = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/users`)).json(); const d = us.find((u) => u.email === "dana@example.com");
      ok("a family account keeps their name, that they're a parent, and the news email choice", d && d.meta.name === "Dana Lopez" && d.meta.kind === "parent" && d.meta.email_ok === true, JSON.stringify(d)); }
    ok("team page offers notifications", (await P.getByRole("button", { name: "Turn on notifications" }).count()) === 1);
    if (process.env.SHOTS) await P.locator(".lv-notify").screenshot({ path: path.join(process.env.SHOTS, "notify-off.png") });
    await P.getByLabel("Your player (optional)").selectOption({ label: "#22 Nia L." });
    await P.getByRole("button", { name: "Turn on notifications" }).click(); await P.waitForTimeout(1500);
    ok("notifications turn on", (await P.locator(".lv-notify h2", { hasText: "Notifications on" }).count()) === 1, await P.locator(".lv-notify").innerText().catch(() => ""));
    { // the coach sends an announcement: followers are notified and read it on the team page; the coach sees it was read
      await go(A, "team"); const ann = A.locator(".card", { hasText: "Announcements" });
      await ann.locator("textarea").fill("Practice moved to 4pm. Bring both jerseys."); await ann.getByRole("button", { name: "Send to followers" }).click(); await A.waitForTimeout(1500);
      const M0 = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(), pp = M0.pushes.find((x) => x.kind === "post" && /Practice moved/.test(x.body));
      ok("an announcement notifies the team's followers", !!pp && pp.to >= 1 && /Ping Club/.test(pp.title), JSON.stringify(pp));
      await P.reload(); await P.waitForTimeout(1500);
      ok("followers read it on the team page, marked new", /Practice moved to 4pm/.test(await P.locator(".lv-news").innerText().catch(() => "")) && (await P.locator(".lv-news li.new").count()) === 1);
      await A.reload(); await A.waitForTimeout(1500);
      ok("the coach sees it was read", /read by 1/.test(await A.locator(".ann-list").innerText().catch(() => "")), await A.locator(".ann-list").innerText().catch(() => ""));
    }
    { // the same family on a new phone, in Spanish: signing in brings back the team they follow
      const N = await newPage(browser, { phone: true }); await N.context().addInitScript(() => { try { localStorage.setItem("bbl-lang", "es"); } catch { /* ignore */ } });
      await N.goto(new URL(season).origin + "/live/"); await N.waitForTimeout(500);
      await N.locator(".lv-signin").click();
      ok("Live sign-in speaks Spanish", /Crear cuenta gratis/.test(await N.locator(".ma").innerText()), await N.locator(".ma").innerText().catch(() => ""));
      await N.locator(".ma-seg button").nth(1).click(); await N.getByLabel("Correo electrónico", { exact: true }).fill("dana@example.com"); await N.getByLabel("Contraseña", { exact: true }).fill("family-pass-1");
      await N.locator(".ma .ma-go").click(); await deviceCode(N, "dana@example.com"); await N.waitForTimeout(1500);
      ok("signed in on a new phone, the teams they follow are there", /Ping Club/.test(await N.locator(".lv-mine").innerText().catch(() => "")), await N.locator("main").innerText().then((x) => x.slice(0, 300)));
      await N.context().close();
    }
    ok("the live site's service worker is registered", await P.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("./"))));
    let M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club") && x.kind !== "post"); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club") && x.kind !== "post"); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("the phone is subscribed to the team for starts and finals, following Nia", M.subs.length === 1 && M.subs[0].starts && M.subs[0].finals && !!M.subs[0].player, JSON.stringify(M.subs));
    { const ax = await a11y(P); ok("notification card controls all have names", !ax.length, ax.join(" | ")); }
    await P.reload(); await P.waitForTimeout(1200);
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "notify-on.png"), fullPage: true });
    ok("notifications stay on after a reload", (await P.locator(".lv-notify h2", { hasText: "Notifications on" }).count()) === 1);
    // the coach starts a match: one "starting" notification
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "2 sets (pool)" }).click();
    await A.getByLabel("Scoring").selectOption("21c23"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(300);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1200);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club") && x.kind !== "post"); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("families are told the match is starting", M.pushes.length === 1 && M.pushes[0].kind === "start" && M.pushes[0].title === "Ping Club vs Buchanan is starting" && M.pushes[0].to === 1 && /\/live\/$/.test(M.pushes[0].base), JSON.stringify(M.pushes));
    await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(900);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club") && x.kind !== "post"); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1")); ok("the start is announced only once", M.pushes.length === 1, JSON.stringify(M.pushes.map((x) => x.kind)));
    // ...and the final
    await go(A, "track");
    await A.locator(".pl", { hasText: "Nia" }).first().click(); await A.getByRole("button", { name: "Kill", exact: true }).first().click(); await skipIfAsked(A); await A.keyboard.press("Escape");
    for (let set = 0; set < 2; set++) { for (let i = 0; i < (set ? 21 : 20); i++) { await A.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(A); } await A.waitForTimeout(200); const nx = A.getByRole("button", { name: /serve$/ }); if (set === 0 && await nx.count()) await nx.first().click(); }
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1500);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club") && x.kind !== "post"); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("families get the final score", M.pushes.length === 2 && M.pushes[1].kind === "final" && M.pushes[1].title === "Final: Ping Club beat Buchanan 2–0" && M.pushes[1].body.startsWith("21-0, 21-0"), JSON.stringify(M.pushes));
    ok("the family following Nia gets her line first", (M.pushes[1].bodies || [])[0]?.startsWith("Nia L.: 1 kill · 21-0"), JSON.stringify(M.pushes[1].bodies));
    // turning off
    await P.getByRole("button", { name: "Change" }).click(); await P.getByRole("button", { name: "Turn off" }).click(); await P.waitForTimeout(800);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club") && x.kind !== "post"); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("turning off removes the subscription", M.subs.length === 0 && (await P.getByRole("button", { name: "Turn on notifications" }).count()) === 1);
    // setup check (admins only): the notify function answers
    await fetch(`http://localhost:${MOCK_PORT}/__mock/make-admin?email=notify%40e2e.test`, { headers: { apikey: "anon" } }); await A.reload(); await A.waitForTimeout(600);
    await go(A, "settings"); await A.waitForTimeout(600); await A.getByRole("button", { name: "Run check" }).click(); await A.waitForTimeout(1500);
    ok("setup check finds the notify function", (await A.locator(".check-list li.sc-ok", { hasText: "Family notifications" }).count()) === 1);
    ok("notify: no page errors", !A.errors.length && !P.errors.length, A.errors.concat(P.errors).slice(0, 3).join(" | "));
    await A.context().close(); await P.context().close();
  },
  async pictures(browser) {
    // a stand-in for Wikipedia, Wikidata, Commons and the logo files (the real ones aren't reachable from tests)
    const fakeWiki = async (ctx) => {
      await ctx.route("https://en.wikipedia.org/**", (r) => { const q = new URL(r.request().url()).searchParams.get("gsrsearch") || ""; r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ query: { pages: /clovis north/i.test(q) ? [
        { title: "Clovis North High School", index: 1, description: "Public high school in Fresno, California, United States", pageprops: { wikibase_item: "Q1" }, thumbnail: { source: "https://upload.wikimedia.org/cn-campus.png" } }]
        : /buchanan/i.test(q) ? [{ title: "Buchanan High School (Clovis, California)", index: 1, pageprops: { wikibase_item: "Q2" } }, { title: "Buchanan High School (Michigan)", index: 2, pageprops: { wikibase_item: "Q3" } }] : [] } }) }); });
      await ctx.route("https://www.wikidata.org/**", (r) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ entities: { Q1: { claims: { P154: [{ mainsnak: { datavalue: { value: "Clovis North logo.png" } } }] } }, Q2: { claims: { P154: [{ mainsnak: { datavalue: { value: "Buchanan Bears.png" } } }] } }, Q3: { claims: { P154: [{ mainsnak: { datavalue: { value: "Buchanan Bucks.png" } } }] } } } }) }));
      await ctx.route("https://commons.wikimedia.org/**", (r) => r.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ query: { pages: [{ title: "File:Clovis North logo.png", imageinfo: [{ thumburl: "https://upload.wikimedia.org/cn.png" }] }, { title: "File:Buchanan Bears.png", imageinfo: [{ thumburl: "https://upload.wikimedia.org/bb.png" }] }, { title: "File:Buchanan Bucks.png", imageinfo: [{ thumburl: "https://upload.wikimedia.org/bucks.png" }] }] } }) }));
      await ctx.route("https://upload.wikimedia.org/**", (r) => r.fulfill({ contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(path.join(__dirname, "fixtures", /bb|bucks/.test(r.request().url()) ? "logo-bb.png" : "logo-cn.png")) }));
    };
    const A = await newPage(browser); await fakeWiki(A.context());
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("pics@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clovis North"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").first().setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(800);
    // our logo: found by name
    await go(A, "team"); const teamCard = A.locator(".card", { has: A.getByText("Team logo") });
    await teamCard.getByRole("button", { name: "Find logo" }).click(); await A.waitForTimeout(800);
    ok("logo search shows the school's logo first", (await teamCard.locator(".logo-hit").first().getAttribute("aria-label")) === "Use Clovis North High School · logo", await teamCard.locator(".logo-find").innerText().catch(() => ""));
    { const ax = await a11y(A); ok("logo picker controls all have names", !ax.length, ax.join(" | ")); }
    await teamCard.locator(".logo-hit").first().click(); await A.waitForTimeout(300);
    await A.waitForTimeout(800); const ourLogo = await teamCard.locator(".logo-pick > .row .tlogo img").first().getAttribute("src").catch(() => "");
    ok("a picked logo is cleaned up and saved as the team's own copy", /\/storage\/v1\/object\/public\/media\/.+\/team-.+\.png/.test(ourLogo || ""), ourLogo || "(none)");
    ok("the cleaned logo is a square with its artwork filling the tile", await A.evaluate(async (u) => { const i = new Image(); i.crossOrigin = "anonymous"; i.src = u; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, x1 = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } return i.width === i.height && (x1 - x0) / i.width > 0.8; }, ourLogo));
    // a player's photo: uploaded for the team
    const row = A.locator(".roster-tbl tr", { has: A.locator("input[value=Nia]") });
    await row.locator("input[type=file][accept='image/*']").setInputFiles(path.join(__dirname, "fixtures/photo.jpg")); await A.waitForTimeout(500);
    ok("a photo opens the framing step", (await A.getByRole("dialog", { name: /Frame the photo/ }).count()) === 1);
    { const ax = await a11y(A); ok("photo framing controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "photo-framing.png") });
    await A.getByLabel("Zoom").fill("1.3"); await A.getByRole("button", { name: "Save photo" }).click(); await A.waitForTimeout(1200);
    const photo = await row.locator("img.avatar").getAttribute("src").catch(() => "");
    ok("a player photo uploads to the team's pictures", /\/storage\/v1\/object\/public\/media\/.+\/player-.+\.jpg\?v=/.test(photo || ""), photo || "(none)");
    ok("the photo is a small square", await A.evaluate(async (u) => { const i = new Image(); i.src = u; await i.decode(); return i.naturalWidth === 400 && i.naturalHeight === 400; }, photo));
    // a new opponent gets its logo by itself: two Buchanan High Schools, one in our state
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(1500);
    const logos = async () => (await A.locator(".gs .tlogo").evaluateAll((els) => els.map((e) => e.querySelector("img")?.getAttribute("src") || "initials"))).join(" ");
    await go(A, "live"); await A.waitForTimeout(400);
    ok("the opponent's logo is found automatically (the school in our state)", /team-.+\.png.* .*opp-.+\.png/.test(await logos()), await logos());
    for (let i = 0; i < 3; i++) { await go(A, "track"); await A.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(A); }
    await A.locator(".pl", { hasText: "Nia" }).first().click(); await A.getByRole("button", { name: "Kill", exact: true }).first().click(); await skipIfAsked(A); await A.keyboard.press("Escape");
    // families see them
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1000);
    await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1000);
    const teamUrl = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    const P = await newPage(browser, { phone: true }); await fakeWiki(P.context());
    await P.goto(teamUrl); await P.waitForTimeout(1500);
    ok("team page shows the team logo", /team-.+\.png/.test(await P.locator(".lv-team-logo img").getAttribute("src") || ""));
    ok("live score on the team page shows both logos", (await P.locator(".lv-livecard .tlogo img").count()) === 2);
    await P.goto(teamUrl + "/roster"); await P.waitForTimeout(800);
    ok("roster shows the player's photo", (await P.locator(".lv-rp", { hasText: "Nia" }).locator("img.avatar").count()) === 1);
    { const loaded = await P.locator(".lv-rp img.avatar").first().evaluate((i) => i.complete && i.naturalWidth > 0); ok("the photo loads on the public site", loaded); }
    if (process.env.SHOTS) { await P.goto(teamUrl); await P.waitForTimeout(800); await P.screenshot({ path: path.join(process.env.SHOTS, "live-logos.png"), fullPage: true }); await P.goto(teamUrl + "/roster"); await P.waitForTimeout(800); await P.screenshot({ path: path.join(process.env.SHOTS, "live-roster-photos.png"), fullPage: true }); }
    // graphics carry the pictures
    await go(A, "team"); await A.locator(".roster-tbl tr", { has: A.locator("input[value=Nia]") }).getByRole("button", { name: "View" }).click();
    await A.waitForTimeout(400);
    ok("player page shows the photo", (await A.locator(".hero img.avatar").count()) === 1);
    { await A.getByRole("button", { name: "Stat graphic" }).click();
      const g = await download(A, () => A.getByRole("button", { name: /^Last match: vs / }).click(), 15000); ok("stat graphic with a photo saves", g.size > 20000, String(g.size));
      if (process.env.SHOTS) fs.copyFileSync(g.path, path.join(process.env.SHOTS, "player-graphic-photo.png")); }
    // the people who run FloorCall review uploads and take one down
    await go(A, "settings"); await A.waitForTimeout(600); ok("the admin console is hidden from coaches", (await A.getByRole("button", { name: "Open admin" }).count()) === 0);
    await fetch(`http://localhost:${MOCK_PORT}/__mock/make-admin?email=pics%40e2e.test`, { headers: { apikey: "anon" } });
    await A.reload(); await go(A, "settings"); await A.waitForTimeout(800);
    await A.evaluate(() => setTimeout(() => { throw new Error("e2e: deliberate crash"); }, 0)); await A.waitForTimeout(600); A.errors = A.errors.filter((e) => !/deliberate crash/.test(e));
    { const errs = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/errors`, { headers: { apikey: "anon" } })).json(); ok("a crash is reported with the version and screen, no team data", errs.length === 1 && errs[0].message === "e2e: deliberate crash" && errs[0].page === "settings" && /^\d+\.\d+\.\d+$/.test(errs[0].version) && !JSON.stringify(errs[0]).includes("Clovis"), JSON.stringify(errs)); }
    await A.getByRole("button", { name: "Open admin" }).click(); await A.waitForTimeout(800);
    ok("admin console lists the crash", (await A.locator(".admin-errs li", { hasText: "deliberate crash" }).count()) === 1);
    ok("admin console shows accounts, teams and live matches", /Accounts/.test(await A.locator(".kpis").innerText()) && (await A.locator("td", { hasText: "Clovis North" }).count()) >= 1);
    const photoFig = A.locator(".admin-pics figure", { hasText: "Player photo" });
    ok("admin sees uploaded photos and logos", (await photoFig.count()) === 1 && (await A.locator(".admin-pics figure").count()) >= 3, String(await A.locator(".admin-pics figure").count()));
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "admin.png"), fullPage: true });
    await photoFig.getByRole("button", { name: "Take down" }).click(); await photoFig.getByRole("button", { name: "Take down?" }).click(); await A.waitForTimeout(500);
    ok("a picture taken down leaves the admin list", (await A.locator(".admin-pics figure", { hasText: "Player photo" }).count()) === 0);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1200);
    ok("…and the player has no photo anymore", (await A.locator(".roster-tbl tr", { has: A.locator("input[value=Nia]") }).locator("img").count()) === 0);
    ok("pictures: no page errors", !A.errors.length && !P.errors.length, A.errors.concat(P.errors).slice(0, 3).join(" | "));
    await A.context().close(); await P.context().close();
  },
  async gameday(browser) {
    const A = await newPage(browser); await A.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("gameday@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clovis North"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await go(A, "team"); await A.getByRole("button", { name: "Paste list" }).click();
    await A.locator("textarea").first().fill(["1 Ava Ramirez S", "3 Lily Torres L", "4 Jordan Lee OH", "7 Maya Chen OH", "8 Zoe Grant MB", "9 Riley Brooks MB", "12 Sofia Nguyen OPP"].join("\n")); await A.getByRole("button", { name: "Add players" }).click(); await A.waitForTimeout(300);
    await go(A, "lineup"); await A.getByRole("button", { name: "Save as starting lineup" }).click(); await A.waitForTimeout(200);
    await go(A, "matchup"); await A.getByRole("button", { name: "Paste a whole schedule" }).click(); await A.locator("textarea").first().fill("12/1 vs Central 6:00 PM\n12/4 @ Clovis West 5:30pm (League)"); await A.getByRole("button", { name: /^Add 2 to schedule/ }).click(); await A.waitForTimeout(200);
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(300);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(800); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1000);
    const teamUrl = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    const P = await newPage(browser, { phone: true }); await P.goto(teamUrl); await P.waitForTimeout(1500);
    await P.getByRole("link", { name: "Open the gamecast" }).click(); await P.waitForTimeout(600);
    const court = P.locator(".lv-gc");
    ok("gamecast court shows our six with the server and the rotation", (await court.locator(".fc-chip").count()) === 6 && (await court.locator(".fc-chip.srv").count()) === 1 && /Rotation 1/.test(await court.innerText()), (await court.innerText().catch(() => "")).slice(0, 200));
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "on-court.png"), fullPage: true });
    { const ax = await a11y(P); ok("on-court view controls all have names", !ax.length, ax.join(" | ")); }
    // a point from the bench shows up as the last play, with where it landed
    await go(A, "track"); await A.locator(".pl", { hasText: "Maya" }).first().click(); await A.getByRole("button", { name: "Kill", exact: true }).first().click(); await skipIfAsked(A); await A.keyboard.press("Escape");
    { const t0 = Date.now(); let last = ""; while (Date.now() - t0 < 12000) { last = await P.locator(".lv-gc-last").innerText().catch(() => ""); if (/Maya/.test(last)) break; await P.waitForTimeout(400); } ok("gamecast calls out the last play with the player", /#7 Maya.*Kill/s.test(last), last); }
    await P.waitForTimeout(6000); ok("the rotation moves as the match goes on", /Rotation \d/.test(await court.innerText()));
    // families: calendar and their teams list
    await P.goto(teamUrl + "/schedule"); await P.waitForTimeout(800);
    { const f = await download(P, () => P.getByRole("button", { name: "Add to calendar" }).click()); const ics = f.text();
      ok("Add to calendar gives the upcoming matches", f.name.endsWith(".ics") && (ics.match(/BEGIN:VEVENT/g) || []).length === 2 && ics.includes("SUMMARY:Clovis North vs Central") && ics.includes("SUMMARY:Clovis North at Clovis West") && /DTSTART:\d{4}1201T180000/.test(ics), ics.slice(0, 400)); }
    // availability: a parent says she can make the next match; the coach sees who answered
    ok("signed out, the schedule invites families to answer", (await P.locator(".lv-rsvp-in").count()) === 1 && (await P.locator(".lv-rsvp").count()) === 0);
    await P.locator(".lv-rsvp-in").click();
    await P.getByLabel("Your name").fill("Dana Chen"); await P.getByLabel("Email", { exact: true }).fill("dana-rsvp@e2e.test"); await P.getByLabel("Password", { exact: true }).fill("parent-pass");
    await P.locator(".ma-check input").first().check(); await P.locator(".ma").getByRole("button", { name: "Create free account" }).last().click(); await P.waitForTimeout(1200);
    ok("signed in, each upcoming match asks if you can make it", (await P.locator(".lv-rsvp").count()) === 2, String(await P.locator(".lv-rsvp").count()));
    await P.locator(".lv-rsvp").first().getByRole("button", { name: "Going" }).click(); await P.waitForTimeout(500);
    ok("an answer is counted and marked as yours", (await P.locator(".lv-rsvp").first().locator("button.yes.on .n").innerText()) === "1");
    await P.reload(); await P.waitForTimeout(900);
    if (process.env.QASHOT2) await P.screenshot({ path: process.env.QASHOT2 });
    ok("the answer is still there after a reload", (await P.locator(".lv-rsvp").first().locator("button.yes.on").count()) === 1);
    { const ax = await a11y(P); ok("availability buttons all have names", !ax.length, ax.join(" | ")); ok("availability fits a phone", (await overflow(P)) <= 0); }
    await go(A, "matchup"); await A.waitForTimeout(700);
    ok("the coach sees how many are going", /1 going/.test(await A.locator(".mu-avail summary").first().innerText().catch(() => "")));
    // a parent answers for her player: the coach sees which player will miss it
    await P.locator(".lv-rsvp-for select").selectOption({ label: "#7 Maya" }); await P.locator(".lv-rsvp").nth(1).getByRole("button", { name: "Can't go" }).click(); await P.waitForTimeout(500);
    await A.reload(); await A.waitForTimeout(1500);
    ok("the coach sees which player may miss a match", /1 player may miss it/.test(await A.locator(".mu-avail summary").nth(1).innerText().catch(() => "")));
    await A.locator(".mu-avail summary").nth(1).click();
    ok("by name and number, with who answered", /Players who may miss it: #7 Maya/.test(await A.locator(".mu-avail").nth(1).innerText()) && /Can't go: #7 Maya \(Dana Chen\)/.test(await A.locator(".mu-avail").nth(1).innerText()), await A.locator(".mu-avail").nth(1).innerText().catch(() => ""));
    await go(A, "lineup"); await A.waitForTimeout(900);
    ok("the lineup page only warns about the next match (Maya is only out of the one after)", (await A.locator(".mu-next-out").count()) === 0);
    await go(A, "matchup"); await A.waitForTimeout(900);
    await A.locator(".mu-avail summary").first().click();
    if (process.env.QASHOT2) await A.locator(".card", { hasText: "Schedule" }).first().screenshot({ path: process.env.QASHOT2.replace(".png", "-coach.png") });
    ok("and who", /Going: Dana Chen/.test(await A.locator(".mu-avail").first().innerText()));
    // volunteer jobs: the coach asks for line judges; the parent signs up on Live; the coach sees her name
    await A.locator(".mu-jobs summary").first().click(); await A.getByRole("button", { name: "+ Line judge ×2" }).first().click(); await A.waitForTimeout(2600);
    ok("the coach adds a volunteer job to a match", /Volunteers: 0 of 2 filled/.test(await A.locator(".mu-jobs summary").first().innerText()));
    await A.locator(".mu-jobs").first().getByRole("button", { name: "Ask the families" }).click(); await A.waitForTimeout(800);
    await P.reload(); await P.waitForTimeout(1200);
    ok("families see the job on the schedule", (await P.locator(".lv-job").count()) === 1 && /Line judge\s*0\/2/.test(await P.locator(".lv-job").innerText()), await P.locator(".lv-card").first().innerText().catch(() => ""));
    await P.goto(teamUrl + "/news"); await P.waitForTimeout(900);
    ok("asking the families posts the open spots as an announcement", /Volunteers needed for vs Central, .*: 2 line judge\. Sign up on the team's schedule\./.test(await P.locator(".lv-news").innerText().catch(() => "")), await P.locator(".lv-news").innerText().catch(() => "none"));
    await P.goto(teamUrl + "/schedule"); await P.waitForTimeout(900);
    await P.getByRole("button", { name: "Sign up for Line judge" }).click(); await P.waitForTimeout(600);
    ok("a parent signs up", (await P.getByRole("button", { name: "Drop out of Line judge" }).count()) === 1 && /1\/2/.test(await P.locator(".lv-job").innerText()));
    { const ax = await a11y(P); ok("volunteer sign-up controls all have names", !ax.length, ax.join(" | ")); }
    await A.reload(); await A.waitForTimeout(1500); await A.locator(".mu-jobs summary").first().click();
    ok("the coach sees who signed up", /1 of 2 filled/.test(await A.locator(".mu-jobs summary").first().innerText()) && /Line judge.*Dana Chen/s.test(await A.locator(".mu-jobs").first().innerText()));
    await P.locator(".lv-rsvp").first().getByRole("button", { name: "Can't go" }).click(); await P.waitForTimeout(500);
    await go(A, "lineup"); await A.reload(); await A.waitForTimeout(1500);
    ok("the lineup page warns when a starter may miss the next match", /Vs Central[\s\S]*#7 Maya can.t make it, in this lineup/.test(await A.locator(".mu-next-out").innerText().catch(() => "")), await A.locator(".mu-next-out").innerText().catch(() => "none"));
    // playbook: the coach shares a play; a signed-in parent studies it on the team's Live page
    await go(A, "court"); await A.getByRole("button", { name: "Playbook", exact: true }).click(); await A.waitForTimeout(300);
    await A.getByRole("button", { name: "Slide", exact: true }).click(); await A.locator("input[aria-label='Play name']").fill("Slide vs Central"); await A.getByRole("button", { name: "Save to my plays" }).click(); await A.waitForTimeout(300);
    await A.getByLabel(/Share with the team on FloorCall Live/).check(); await A.waitForTimeout(700);
    ok("a saved play can be shared with the team", /Slide vs Central · shared/.test(await A.locator(".pb-group").first().innerText()));
    await P.goto(teamUrl + "/plays"); await P.waitForTimeout(1000);
    ok("the shared play shows on the team's Live page on the 3D court", (await P.locator(".lv-play-pick button").allInnerTexts()).join("|") === "Slide vs Central" && (await P.locator(".lv-plays .c3d").count()) === 1 && (await P.locator(".lv-plays .c3d-route").count()) === 3 && /one foot/.test(await P.locator(".lv-play-note").innerText()));
    await P.getByRole("button", { name: "Run it" }).click(); await P.waitForTimeout(600);
    ok("a player can run the movement", (await P.locator(".lv-plays .c3d-route").count()) === 0);
    await P.waitForTimeout(2200);
    { const f = await download(P, () => P.getByRole("button", { name: "Save picture" }).click(), 10000); ok("a player can save the play as a picture", /Slide vs Central\.png$/.test(f.name) && f.size > 20000, f.name + " " + f.size); }
    { const ax = await a11y(P); ok("playbook controls on Live all have names", !ax.length, ax.join(" | ")); ok("the Live playbook fits a phone", (await overflow(P)) <= 0); }
    if (process.env.QASHOT5) await P.screenshot({ path: process.env.QASHOT5, fullPage: true });
    await A.getByLabel(/Share with the team on FloorCall Live/).uncheck(); await A.waitForTimeout(700);
    await P.reload(); await P.waitForTimeout(1000);
    ok("un-sharing takes the play off the team page", (await P.getByText("The coaches haven't shared any plays yet.").count()) === 1);
    await P.goto(teamUrl.replace(/#.*$/, "")); await P.waitForTimeout(600);
    ok("Live home lists the teams this phone follows", (await P.locator(".lv-mine a", { hasText: "Clovis North" }).count()) === 1);
    // the coach finishes and texts a recap
    await go(A, "track"); for (let set = 0; set < 3; set++) { for (let i = 0; i < 30; i++) { if (await A.locator(".banner", { hasText: /to Clovis|Match over/ }).count()) break; await A.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(A); } if (await A.locator(".banner", { hasText: "Match over" }).count()) break; const nx = A.getByRole("button", { name: /serve$/ }); if (await nx.count()) await nx.first().click(); }
    await A.getByRole("button", { name: "Finish" }).click(); await A.waitForTimeout(300);
    await go(A, "home"); await A.getByRole("button", { name: "Text recap" }).click(); await A.waitForTimeout(400);
    { const txt = await A.evaluate(() => navigator.clipboard.readText()); ok("text recap has the result, set scores and the box score link", /^Final: Clovis North def\. Buchanan 3–0 \(25-0, 25-0, 25-0\)/.test(txt) && /Box score: http.*\/live\/#\/g\//.test(txt), txt); }
    // history imported: the season reads as a story on Live, and as a graphic for the coach
    await go(A, "team"); await A.locator("input[type=file][multiple]").setInputFiles(path.join(__dirname, "fixtures/game-log.csv")); await A.waitForTimeout(600);
    await A.getByRole("button", { name: /^Import \d+ match/ }).click(); await A.waitForTimeout(400);
    await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1200);
    await P.goto(teamUrl); await P.reload(); await P.waitForTimeout(1500);
    { const rv = P.locator(".lv-review"); const t = await rv.innerText().catch(() => "");
      ok("Live shows the season in review", /3–0/.test(t) && /Biggest win/i.test(t) && /vs Buchanan/.test(t) && /Kills\s*14/.test(t), t.replace(/\s+/g, " ").slice(0, 300)); }
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "season-review.png"), fullPage: true });
    await go(A, "stats"); { const g = await download(A, () => A.getByRole("button", { name: "Season graphic" }).click(), 15000); ok("season graphic saves", g.name.endsWith(".png") && g.size > 20000, `${g.name} ${g.size}`); if (process.env.SHOTS) fs.copyFileSync(g.path, path.join(process.env.SHOTS, "season-graphic.png")); }
    await A.getByRole("button", { name: "Season video" }).click(); await A.waitForTimeout(1200);
    ok("season video opens with the record", /Season recap video/.test(await A.locator(".rv-side h2").innerText()) && await A.locator(".rv-cv").evaluate((c) => c.width === 1080 && c.getContext("2d").getImageData(60, 70, 1, 1).data[0] > 200));
    if (process.env.QASHOT7) { for (const [n, ms] of [[0, 1500], [1, 3200], [2, 2600]]) { await A.waitForTimeout(ms); await A.locator(".rv-cv").screenshot({ path: process.env.QASHOT7.replace(".png", "-" + n + ".png") }); } }
    await A.keyboard.press("Escape"); await A.waitForTimeout(200);
    // practices reach the team's Live schedule; a parent says her player will miss one; the coach sees it on the plan
    await go(A, "practice"); await A.waitForTimeout(400); await A.getByRole("button", { name: "New plan" }).click(); await A.waitForTimeout(300); await A.getByLabel("Date").first().fill(new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)); await A.waitForTimeout(2800);
    await P.goto(teamUrl + "/schedule"); await P.reload(); await P.waitForTimeout(1200);
    { const li = P.locator(".lv-games li", { hasText: "Practice" });
      ok("upcoming practices show on the Live schedule", (await li.count()) === 1 && (await li.locator(".lv-rsvp").count()) === 1, await P.locator(".lv-games").first().innerText().catch(() => ""));
      await li.getByRole("button", { name: "Can't go" }).click(); await P.waitForTimeout(500);
      const ics = await download(P, () => P.getByRole("button", { name: "Add to calendar" }).click()); ok("practices are in the team calendar file", /SUMMARY:Clovis North practice/.test(ics.text())); }
    await A.reload(); await A.waitForTimeout(1500);
    await A.locator(".att .mu-avail summary").click().catch(() => {});
    ok("the coach sees who may miss practice on the plan", /Players who may miss it: #7 Maya/.test(await A.locator(".att .mu-avail").innerText().catch(() => "")), await A.locator(".att").innerText().catch(() => "none"));
    // the coach shows the plan; families see the blocks with start times (not the notes)
    await A.getByRole("button", { name: "+ Custom block" }).click(); await A.getByLabel(/Show this plan to the team on FloorCall Live/).check(); await A.waitForTimeout(2800);
    await P.reload(); await P.waitForTimeout(1200);
    { const pl = P.locator(".lv-games li", { hasText: "Practice" }).locator(".lv-plan"); await pl.locator("summary").click().catch(() => {});
      ok("a shown practice plan lists its blocks for the team", (await pl.count()) === 1 && (await pl.locator("li").count()) > 0, await P.locator(".lv-games li", { hasText: "Practice" }).innerText().catch(() => "")); }
    ok("gameday: no page errors", !A.errors.length && !P.errors.length, A.errors.concat(P.errors).slice(0, 3).join(" | "));
    await A.context().close(); await P.context().close();
  },
  async reel(browser) {
    const p = await newPage(browser, { cloud: false });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Clovis North"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(400);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill(["1 Ava Ramirez S", "3 Lily Torres L", "4 Jordan Lee OH", "7 Maya Chen OH 2027", "8 Zoe Grant MB", "9 Riley Brooks MB", "12 Sofia Nguyen OPP"].join("\n")); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(300);
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill("Central"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(300);
    for (let i = 0; i < 4; i++) { await p.waitForTimeout(1200); await p.keyboard.type("7"); await p.waitForTimeout(860); await p.keyboard.press(i === 2 ? "a" : "k"); await p.keyboard.press("Escape"); }
    await go(p, "stats"); await p.getByRole("button", { name: "One match", exact: true }).click(); await p.getByRole("button", { name: "Film", exact: true }).click();
    await p.getByLabel("Video link").fill(U + "__fixtures/match.webm"); await p.getByLabel("Time of first serve in the video").fill("0:12"); await p.getByLabel("Time of first serve in the video").press("Tab"); await p.waitForTimeout(300);
    // the recap video picks up plays from the film
    await p.getByRole("button", { name: "Recap video" }).click(); await p.waitForTimeout(800);
    if (process.env.QASHOT) { await p.waitForTimeout(9500); await p.locator(".rv-cv").screenshot({ path: process.env.QASHOT }); }
    ok("recap video offers plays from the match film", (await p.getByLabel("Include plays from the match film (no sound)").isChecked()) && /\d plays? from the film/.test(await p.locator(".rv-side").innerText()), await p.locator(".rv-side").innerText());
    { const rv = await download(p, () => p.getByRole("button", { name: "Make the video" }).click(), 90000); ok("recap video with plays records to a file", /recap\.(webm|mp4)$/.test(rv.name) && rv.size > 200000, `${rv.name} ${rv.size} bytes`); }
    await p.getByLabel("Include plays from the match film (no sound)").uncheck(); await p.waitForTimeout(300);
    ok("plays can be left out of the recap", !/from the film/.test(await p.locator(".rv-side p").first().innerText()));
    await p.keyboard.press("Escape");
    await go(p, "stats"); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.locator("tr.click", { hasText: "Maya" }).first().click(); await p.waitForTimeout(300);
    await p.getByRole("button", { name: "Make highlight video" }).click(); await p.waitForTimeout(300);
    const items = p.locator(".reel-list li");
    ok("highlight video starts with her best plays picked", (await items.count()) >= 3 && (await p.locator(".reel-list li.on").count()) >= 3, String(await items.count()));
    { const ax = await a11y(p); ok("highlight video controls all have names", !ax.length, ax.join(" | ")); }
    await p.getByRole("button", { name: "5 s" }).click();
    while ((await p.locator(".reel-list li.on").count()) > 2) await p.locator(".reel-list li.on input").last().uncheck();
    await p.getByRole("button", { name: /^Move .* later$/ }).first().click();
    ok("the length shows plays and seconds", /2 plays · about 17 seconds/.test(await p.locator(".reel").innerText()), (await p.locator(".reel").innerText()).slice(0, 300));
    await p.getByRole("button", { name: "Make highlight video" }).last().click();
    await p.waitForTimeout(4500); if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "reel-making.png"), fullPage: true });
    await p.locator("video.reel-out").waitFor({ timeout: 60000 });
    const dur = await p.locator("video.reel-out").evaluate(async (v) => { if (!isFinite(v.duration) || !v.duration) { v.currentTime = 1e9; await new Promise((r) => v.addEventListener("timeupdate", r, { once: true })); } return v.duration; });
    ok("the finished video runs about as long as planned", dur > 13 && dur < 24, String(dur));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "reel-done.png"), fullPage: true });
    const f = await download(p, () => p.getByRole("button", { name: "Save video" }).click(), 15000);
    ok("the highlight video saves", /Maya Chen highlights\.(webm|mp4)$/.test(f.name) && f.size > 100000, `${f.name} ${f.size}`);
    if (process.env.SHOTS) fs.copyFileSync(f.path, path.join(process.env.SHOTS, f.name));
    ok("reel: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },
  // A real-length game film (LONGFILM=/path/to/file.mp4, LONGTRUTH=whistle times as JSON [[serve, end], ...]).
  // Not in the normal run: it takes minutes. Measures finding rallies, memory, seeking and statting late in the film.
  async _longfilm(browser) {
    const file = process.env.LONGFILM, truth = process.env.LONGTRUTH ? JSON.parse(require("fs").readFileSync(process.env.LONGTRUTH, "utf8")) : null;
    if (!file) { ok("set LONGFILM to a video file", false); return; }
    const p = await newPage(browser, { cloud: false, size: { width: 1440, height: 900 } });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Long Film"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(400);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill(["1 Ava Ramirez S", "4 Jordan Lee OH", "7 Maya Chen OH", "8 Zoe Grant MB", "12 Sofia Nguyen OPP", "3 Lily Torres L"].join("\n")); await p.getByRole("button", { name: "Add players" }).click();
    await go(p, "film");
    let t0 = Date.now();
    await p.getByLabel("Game video file").setInputFiles(file);
    await p.getByPlaceholder("e.g. Buchanan").fill("Central"); await p.getByRole("button", { name: "Start · we serve first" }).click();
    await p.locator(".fr-stage video").evaluate((v) => v.readyState >= 1 ? 0 : new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true })));
    const dur = await p.locator(".fr-stage video").evaluate((v) => v.duration);
    console.log(`    opened ${(require("fs").statSync(file).size / 1048576).toFixed(0)} MB, ${(dur / 60).toFixed(1)} min, in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    ok("long film: opens", dur > 600, String(dur));
    t0 = Date.now();
    const heap = async () => p.evaluate(() => (performance).memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1);
    await p.getByRole("button", { name: "Find rallies from the whistle" }).click();
    let peak = 0; const tick = setInterval(async () => { try { peak = Math.max(peak, await heap()); } catch {} }, 1000);
    await p.waitForFunction(() => /found\)/.test(document.querySelector(".fr-tools")?.textContent || "") || /couldn|didn't|failed/i.test(document.querySelector(".fr-tools")?.textContent || ""), null, { timeout: 1500e3, polling: 2000 }).catch(() => {});
    clearInterval(tick);
    const tools = await p.locator(".fr-tools").innerText(), found = +(tools.match(/\((\d+) found\)/) || [])[1] || 0;
    console.log(`    found ${found} rallies in ${((Date.now() - t0) / 1000).toFixed(0)} s; JS heap peak ${peak} MB, now ${await heap()} MB`);
    ok("long film: finds rallies", found > 0, tools.slice(0, 200));
    if (truth) {
      const r = await p.evaluate(async () => { const db = await new Promise((res) => { const q = indexedDB.open("bench-stats"); q.onsuccess = () => res(q.result); }); const tx = db.transaction("matches"); const all = await new Promise((res) => { const q = tx.objectStore("matches").getAll(); q.onsuccess = () => res(q.result); }); return (all.find((m) => m.rallies) || {}).rallies || []; });
      if (process.env.LONGDUMP) require("fs").writeFileSync(process.env.LONGDUMP, JSON.stringify(r));
      const exact = truth.filter(([a, b]) => r.some((x) => Math.abs(x.start + 1 - a) < 1.2 && Math.abs(x.end - 2 - b) < 1.2)).length;
      // found: a rally overlapping the real one with its serve or its end in the right place (a squeak can move the other)
      const found = truth.filter(([a, b]) => r.some((x) => Math.min(x.end - 2, b) > Math.max(x.start + 1, a) && (Math.abs(x.start + 1 - a) < 1.2 || Math.abs(x.end - 2 - b) < 1.2))).length;
      const extra = r.filter((x) => !truth.some(([a, b]) => Math.min(x.end - 2, b) > Math.max(x.start + 1, a))).length;
      console.log(`    found ${found} of ${truth.length} real rallies (${exact} exactly); ${extra} that weren't rallies`);
      ok("long film: finds at least 95% of the rallies", found / truth.length >= 0.95, `${found}/${truth.length}`);
      ok("long film: few false rallies", extra <= truth.length * 0.03, String(extra));
    }
    // stat a play near the end of the film: seeking far is quick and the play keeps its moment
    await p.locator(".fr-top h1").click();
    t0 = Date.now();
    await p.locator(".fr-stage video").evaluate((v, x) => new Promise((r) => { v.pause(); v.addEventListener("seeked", r, { once: true }); v.currentTime = x; }), dur - 300);
    console.log(`    seeked to ${((dur - 300) / 60).toFixed(0)} min in ${Date.now() - t0} ms`);
    await p.keyboard.type("7"); await p.waitForTimeout(900); await p.keyboard.press("k"); await p.keyboard.press("Escape"); await p.waitForTimeout(1500);
    const vts = await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open("bench-stats"); q.onsuccess = () => r(q.result); }); const tx = db.transaction("logs"); const all = await new Promise((r) => { const q = tx.objectStore("logs").getAll(); q.onsuccess = () => r(q.result); }); return all.flatMap((l) => (l.events || []).filter((e) => e.vt != null).map((e) => e.vt)); });
    ok("long film: a play late in the film keeps its moment", vts.some((x) => Math.abs(x - (dur - 300)) < 2), vts.join(","));
    await p.locator(".fr-stage video").evaluate((v) => { v.muted = true; return v.play(); }); await p.waitForTimeout(3000);
    ok("long film: plays smoothly late in the film", await p.locator(".fr-stage video").evaluate((v) => !v.paused && v.currentTime > 0), "");
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "longfilm.png") });
    ok("long film: no errors", !p.errors.length, p.errors.slice(0, 3).join("; "));
    await p.context().close();
  },
  async film(browser) {
    const p = await newPage(browser, { cloud: false });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Clovis North"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(400);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill(["1 Ava Ramirez S", "3 Lily Torres L", "4 Jordan Lee OH", "7 Maya Chen OH 2027", "8 Zoe Grant MB", "12 Sofia Nguyen OPP"].join("\n")); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(300);
    await go(p, "film");
    ok("film room: explains itself", /Stat a whole game from its video/.test(await p.locator(".fr-hero").innerText()));
    await p.getByLabel("Game video file").setInputFiles(path.join(__dirname, "fixtures", "game.webm"));
    await p.getByPlaceholder("e.g. Buchanan").fill("Central"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(600);
    ok("film room: opens the game with its video", /#\/film\/m/.test(p.url()) && (await p.locator(".fr-stage video").count()) === 1, p.url());
    await p.locator(".fr-stage video").evaluate((v) => v.readyState >= 1 ? 0 : new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true })));
    await p.getByRole("button", { name: "Find rallies from the whistle" }).click();
    await p.waitForFunction(() => /found\)/.test(document.querySelector(".fr-tools")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
    ok("film room: finds both rallies from the referee's whistle", /Find rallies again \(2 found\)/.test(await p.locator(".fr-tools").innerText()), await p.locator(".fr-tools").innerText());
    ok("film room: rallies shade the timeline", (await p.locator(".fr-rally").count()) === 2);
    // stat from film: the play keeps the video time
    const at = async (t) => { await p.locator(".fr-stage video").evaluate((v, x) => { v.pause(); v.currentTime = x; }, t); await p.waitForTimeout(250); };
    await p.locator(".fr-top h1").click();
    await at(9); await p.keyboard.type("7"); await p.waitForTimeout(900); await p.keyboard.press("k"); await p.keyboard.press("Escape");
    await at(30); await p.keyboard.type("8"); await p.waitForTimeout(900); await p.keyboard.press("b"); await p.keyboard.press("Escape");
    await at(31); await p.keyboard.type("3"); await p.waitForTimeout(900); await p.keyboard.press("d"); await p.keyboard.press("Escape");
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "film-stat.png"), fullPage: true });
    ok("film room: stats count as they're entered", /2–0|2-0/.test(await p.locator(".fr-side").innerText()) || (await p.locator(".fr-nums").count()) === 1, (await p.locator(".fr-side").innerText()).slice(0, 200));
    await p.waitForTimeout(1200);
    const vts = await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open("bench-stats"); q.onsuccess = () => r(q.result); }); const tx = db.transaction("logs"); const all = await new Promise((r) => { const q = tx.objectStore("logs").getAll(); q.onsuccess = () => r(q.result); }); return all.flatMap((l) => l.events).filter((e) => e.t !== "NS").map((e) => e.t + "@" + e.vt); }).catch((e) => ["err " + e]);
    ok("film room: every stat carries its moment in the video", vts.join(" ") === "K@9 BS@30 D@31", vts.join(" "));
    // Space plays and pauses
    await p.locator(".fr-top h1").click(); await p.keyboard.press(" "); await p.waitForTimeout(400);
    ok("film room: Space plays the video", !(await p.locator(".fr-stage video").evaluate((v) => v.paused)));
    await p.keyboard.press(" ");
    // skip dead time: playing at 15 s jumps to the next rally (24 s)
    await p.locator(".fr-stage video").evaluate((v) => { v.currentTime = 15.5; });
    await p.waitForTimeout(1700); await p.locator(".fr-stage video").evaluate((v) => v.play()); await p.waitForTimeout(1200);
    const t = await p.locator(".fr-stage video").evaluate((v) => { v.pause(); return v.currentTime; });
    ok("film room: skips the dead time between rallies", t >= 23.5, String(t));
    // stat mode: the video stops at each rally's whistle, Space goes to the next serve
    await p.locator(".fr-stage video").evaluate((v) => { v.currentTime = 34.6; }); await p.waitForTimeout(1700);
    await p.locator(".fr-stage video").evaluate((v) => v.play()); await p.waitForTimeout(2200);
    ok("film room: pauses when a rally ends", await p.locator(".fr-stage video").evaluate((v) => v.paused && v.currentTime >= 35.3 && v.currentTime < 36.5) && /Rally 2 over/.test(await p.locator(".fr-wait").innerText()), String(await p.locator(".fr-stage video").evaluate((v) => v.currentTime)));
    await p.getByRole("tab", { name: "Rallies" }).click();
    ok("rally check: every rally found has a point", /Every rally found has a point statted/.test(await p.locator(".fr-side").innerText()), (await p.locator(".fr-side").innerText()).slice(0, 200));
    // ask for clips
    await p.getByRole("tab", { name: "Find clips" }).click();
    await p.getByLabel("Ask for clips").fill("Maya's kills"); await p.getByRole("button", { name: "Find", exact: true }).click(); await p.waitForTimeout(200);
    ok("clip search: understands a player and a play", /Kills/.test(await p.locator(".fr-understood").innerText()) && /#7 Maya/.test(await p.locator(".fr-understood").innerText()), await p.locator(".fr-understood").innerText());
    ok("clip search: finds the kill at its moment", (await p.locator(".fr-rows li").count()) === 1 && /^0:04/.test(await p.locator(".fr-rows li").first().innerText()), await p.locator(".fr-find").innerText());
    await p.getByRole("button", { name: "All solo blocks" }).click(); await p.waitForTimeout(200);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "film-find.png"), fullPage: true });
    ok("clip search: one tap examples", (await p.locator(".fr-rows li").count()) === 1 && /Zoe/.test(await p.locator(".fr-rows").innerText()));
    await p.getByRole("button", { name: /Watch 1 clip back to back/ }).click(); await p.waitForTimeout(500);
    ok("clip search: results play as clips", (await p.locator(".fr-find video").count()) >= 1);
    await p.getByLabel("Ask for clips").fill("purple monkey dishwasher"); await p.getByRole("button", { name: "Find", exact: true }).click(); await p.waitForTimeout(200);
    ok("clip search: says what it can find when the words make no sense", /Try naming a play/.test(await p.locator(".fr-find").innerText()));
    await p.getByRole("tab", { name: "Rallies" }).click();
    ok("rallies: each rally lists its plays", (await p.locator(".fr-rallies li").count()) === 2 && /Zoe/.test(await p.locator(".fr-rallies li").nth(1).innerText()), await p.locator(".fr-rallies").innerText());
    ok("big moments: every rally is rated, with the best ones on top", /Best rallies/.test(await p.locator(".fr-best").innerText()) && (await p.locator(".fr-heat").count()) === 2);
    await p.getByRole("radio", { name: "Best first" }).click().catch(async () => p.locator(".fr-best").getByRole("button", { name: "Best first" }).click());
    ok("big moments: best first reorders the list", (await p.locator(".fr-rallies li").count()) === 2);
    { const ax = await a11y(p); ok("film room controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "film-room.png"), fullPage: true });
    await p.getByRole("button", { name: "Make a film session of them" }).click(); await p.waitForTimeout(300);
    ok("big moments: one tap makes a film session of the best rallies", /best rallies/.test(await p.getByLabel("Session title").inputValue()) && (await p.locator(".fr-items > li").count()) === 2, await p.locator(".fr-side").innerText().then((t) => t.slice(0, 200)));
    // breakdown: three serve errors by Zoe make a finding, with its clips and a film session
    await p.getByRole("tab", { name: "Stat" }).click(); await p.locator(".fr-top h1").click();
    for (const t of [32, 32.5, 33]) { await at(t); await p.keyboard.type("8"); await p.waitForTimeout(900); await p.keyboard.press("n"); await p.keyboard.press("Escape"); }
    await p.evaluate(() => localStorage.setItem("bs-ai-key", "sk-ant-test"));
    await p.route("https://api.anthropic.com/**", (r) => {
      const prompt = JSON.parse(r.request().postData() || "{}").messages?.[0]?.content || "";
      const ids = [...prompt.matchAll(/^(\S+) \| S\d .*Serve error/gm)].map((x) => x[1]);
      const reply = /Coach's question/.test(prompt) ? { answer: "Zoe missed three serves in a row in set 1, the only points Central scored.", plays: ids } : { summary: "We beat Central but gave away free points from the line.", notes: { "err-serve": "Zoe, watch your toss drift right on each of these." } };
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn" }) });
    });
    await p.getByRole("tab", { name: "Breakdown" }).click(); await p.waitForTimeout(300);
    { const t = await p.locator(".fr-bd").innerText(); ok("breakdown: finds the serve errors and who made them", /Serve errors gave them 3 points/.test(t) && /#8 Zoe had 3 of them/.test(t), t.slice(0, 300)); }
    await p.getByRole("button", { name: "Watch 3 clips" }).click(); await p.waitForTimeout(400);
    ok("breakdown: a finding plays as clips", (await p.locator(".fr-bd video").count()) >= 1 && /1 of 3/.test(await p.locator(".fr-bd").innerText()));
    await p.getByRole("button", { name: "Write it up with AI" }).click(); await p.waitForTimeout(800);
    ok("breakdown: the AI writes the summary and the clip notes", /gave away free points/.test(await p.locator(".fr-bd-sum").innerText()) && /toss drift right/.test(await p.locator(".fr-bd-list").innerText()));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "film-breakdown.png"), fullPage: true });
    await p.getByRole("button", { name: "Drill it at practice" }).first().click(); await p.waitForTimeout(200);
    ok("film to practice: a finding brings its drill to the next practice", /Added Serve under pressure to a new practice for/.test(await p.locator(".fr-planned").innerText()), await p.locator(".fr-planned").innerText());
    await p.getByRole("button", { name: "Plan practice from this" }).click(); await p.waitForTimeout(200);
    ok("film to practice: it doesn't add the same drill twice", /already has those drills/.test(await p.locator(".fr-planned").innerText()), await p.locator(".fr-planned").innerText());
    ok("ask the film is off (AI_FEATURES.askFilm): the breakdown has no chat box", (await p.getByLabel("Ask about this match").count()) === 0);
    await p.getByRole("button", { name: "Make a film session from this" }).click(); await p.waitForTimeout(300);
    ok("breakdown: one tap makes the film review session, notes and all", /film review/.test(await p.getByLabel("Session title").inputValue()) && (await p.locator(".fr-items > li").count()) === 3 && /toss drift/.test(await p.locator(".fr-items textarea").first().inputValue()) && /free points/.test(await p.getByLabel("Note to the team (optional)").inputValue()));
    await p.evaluate(() => localStorage.removeItem("bs-ai-key"));
    await go(p, "track");
    ok("film room: a film game never becomes the live match", (await p.locator(".fr-stage").count()) === 0 && !(await p.getByRole("button", { name: "End match" }).count()));
    await go(p, "film");
    ok("film room: the game is listed under Your film", /vs Central/.test(await p.locator(".fr-list").first().innerText()) && /2 rallies/.test(await p.locator(".fr-list").first().innerText()));
    // a second game with film: the season's best rallies come from both
    await p.getByLabel("Game video file").setInputFiles(path.join(__dirname, "fixtures", "game.webm"));
    await p.getByPlaceholder("e.g. Buchanan").fill("North"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(600);
    await p.locator(".fr-stage video").evaluate((v) => v.readyState >= 1 ? 0 : new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true })));
    await p.getByRole("button", { name: "Find rallies from the whistle" }).click();
    await p.waitForFunction(() => /found\)/.test(document.querySelector(".fr-tools")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
    await go(p, "film"); await p.waitForTimeout(300);
    { const card = p.locator(".card", { hasText: "Best of the season" }); ok("best of the season: rallies from every match with film", /from 2 matches of film/.test(await card.innerText()) && (await card.getByRole("button", { name: "Watch the season's best 4" }).count()) === 1, await card.innerText().catch(() => "no card"));
      await card.getByRole("button", { name: "Watch the season's best 4" }).click(); await p.waitForTimeout(400);
      ok("best of the season: plays back to back across matches", (await card.locator("video").count()) >= 1 && /vs (Central|North)/.test(await card.innerText())); }
    // search across the season
    await p.getByLabel("Search all your film").fill("Maya's kills vs Central"); await p.getByRole("button", { name: "Search", exact: true }).click(); await p.waitForTimeout(300);
    { const u = await p.locator(".fr-season .fr-understood").innerText(); ok("season search: reads the player, the play and the opponent", /Kills/.test(u) && /#7 Maya/.test(u) && /vs Central/.test(u), u); }
    ok("season search: finds the play and its match", /1 play in 1 match/.test(await p.locator(".fr-season").innerText()) && (await p.getByRole("button", { name: "Watch 1 clip back to back" }).count()) === 1);
    await p.locator(".fr-group-t").first().click();
    ok("season search: a match opens to its plays with video times", /0:04/.test(await p.locator(".fr-season .fr-rows").innerText()));
    await p.getByRole("button", { name: "Watch 1 clip back to back" }).click(); await p.waitForTimeout(500);
    ok("season search: clips play from the season view", (await p.locator(".fr-season video").count()) >= 1);
    await p.getByLabel("Search all your film").fill("blocks vs Buchanan"); await p.getByRole("button", { name: "Search", exact: true }).click(); await p.waitForTimeout(200);
    ok("season search: an opponent never played says so", /No matches against Buchanan yet/.test(await p.locator(".fr-season").innerText()));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "film-season.png"), fullPage: true });
    await go(p, "matchup"); await p.waitForTimeout(300);
    await p.getByRole("button", { name: "Film vs Central" }).click(); await p.waitForTimeout(400);
    ok("matchup opens every point of film against that team", (await p.getByLabel("Search all your film").inputValue()) === "every point vs Central" && /5 plays in 1 match/.test(await p.locator(".fr-season").innerText()), await p.locator(".fr-season").innerText().catch(() => p.url()));
    await go(p, "practice"); await p.waitForTimeout(300);
    { const v = await p.evaluate(() => [...document.querySelectorAll("input, textarea")].map((x) => x.value).join(" | ")); ok("film to practice: the practice plan shows the drill and why", v.includes("Serve under pressure") && v.includes("From film vs Central: Serve errors gave them 3 points"), v.slice(0, 300)); }
    await go(p, "stats"); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.locator("tr.click", { hasText: "Maya" }).first().click(); await p.waitForTimeout(300);
    await p.getByRole("button", { name: "Search Maya's film" }).click(); await p.waitForTimeout(400);
    ok("a player's page opens a search of their film", /#\/film$/.test(p.url()) && (await p.getByLabel("Search all your film").inputValue()) === "Maya's plays this season" && /1 play in 1 match/.test(await p.locator(".fr-season").innerText()), p.url());
    if (process.env.SHOTS) { await p.setViewportSize({ width: 390, height: 844 }); await p.locator(".fr-list button", { hasText: "vs Central" }).first().click(); await p.waitForTimeout(400); await p.getByRole("tab", { name: "Breakdown" }).click(); await p.waitForTimeout(300);
      ok("film room fits a phone", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await p.screenshot({ path: path.join(process.env.SHOTS, "film-phone.png"), fullPage: true }); await p.setViewportSize({ width: 1360, height: 900 }); }
    ok("film: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },
  async athletes(browser) {
    const p = await newPage(browser);
    await p.goto(U + "recruit/"); await p.waitForTimeout(500);
    await siteSignUp(p, "athlete@e2e.test", "athlete", "Maya Chen");
    ok("recruit landing points athletes to the guide, emails and Reel Studio", (await p.locator(".rg-tiles a").count()) === 3 && !(await p.getByText("College coach?").count()));
    await p.goto(U + "recruit/#/college"); await p.waitForTimeout(300);
    ok("college coach search is paused (no page)", !(await p.locator(".rc-auth").count()) && (await p.locator(".rg-tiles").count()) === 1);
    await p.goto(U + "recruit/#/guide"); await p.waitForTimeout(300);
    if (await p.locator(".ma").count()) { await p.getByLabel("Your name").fill("Maya Chen"); await p.getByLabel("Email", { exact: true }).fill("athlete@e2e.test"); await p.getByLabel("Password", { exact: true }).fill("athlete-pass");
    await p.locator(".ma-check input").first().check(); await p.locator(".ma").getByRole("button", { name: "Create free account" }).last().click(); await p.waitForTimeout(700); }
    await p.locator(".rg-check input").first().check(); await p.locator(".rg-check input").nth(2).check();
    ok("guide: the ready checklist counts", /2 of 9 ready/.test(await p.locator(".rg-count").innerText()));
    await p.reload(); await p.waitForTimeout(300);
    ok("guide: the checklist is remembered on this device", /2 of 9 ready/.test(await p.locator(".rg-count").innerText()));
    ok("guide: year-by-year plan", (await p.locator(".rg-years > li").count()) === 4);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "recruit-guide.png"), fullPage: true });
    await p.getByRole("link", { name: "Emails to coaches" }).click(); await p.waitForTimeout(300);
    await p.getByLabel("Coach's name").fill("Rivera"); await p.getByLabel("School", { exact: true }).fill("Fresno State");
    await p.getByLabel("Why this school (one real reason)").fill("your fast offense");
    await p.getByLabel("First name").fill("Maya"); await p.getByLabel("Last name").fill("Chen"); await p.getByLabel("Grad year").fill("2028"); await p.getByLabel("Position").fill("Outside hitter");
    await p.getByLabel("Highlight video link").fill("https://youtu.be/abc");
    const body = await p.locator(".rg-body").innerText();
    ok("emails: written from the details", /^Dear Coach Rivera,/.test(body) && /interested in Fresno State because your fast offense/.test(body) && /youtu\.be\/abc/.test(body), body.slice(0, 300));
    ok("emails: says what's still missing", /your email/.test(await p.locator(".rg-gaps").innerText()));
    await p.getByRole("tab", { name: /Tournament schedule/ }).click();
    ok("emails: switching email keeps the details", /Maya Chen \(2028/.test(await p.locator(".rg-subj").innerText()));
    { const ax = await a11y(p); ok("emails page controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "recruit-emails.png"), fullPage: true });
    await p.getByRole("link", { name: "Reel Studio" }).click(); await p.waitForTimeout(300);
    await p.getByLabel("Add video files").setInputFiles([path.join(__dirname, "fixtures", "long.webm"), path.join(__dirname, "fixtures", "match.webm")]);
    await p.waitForTimeout(1200);
    ok("studio: a long video opens as a game to mark", /Mark your plays in long\.webm/i.test(await p.locator("main").innerText()));
    const v = p.locator(".rg-mark video");
    await v.evaluate((x) => { x.currentTime = 20; }); await p.waitForTimeout(200); await p.getByRole("button", { name: /^Kill/ }).click();
    await v.evaluate((x) => { x.currentTime = 50; }); await p.waitForTimeout(200); await p.locator("h1").click(); await p.keyboard.press("k");
    await v.evaluate((x) => { x.currentTime = 70; }); await p.waitForTimeout(200); await p.getByRole("button", { name: /^Dig/ }).click();
    ok("studio: plays marked by button and key", (await p.locator(".rg-marks li").count()) >= 3, String(await p.locator(".rg-marks li").count()));
    ok("studio: a marked play runs 6 s before to 2 s after", /0:14–0:22/.test(await p.locator(".rg-marks").innerText()), await p.locator(".rg-marks").innerText());
    ok("studio: hitting reel available, defense needs more plays", /Hitting/.test(await p.locator(".rg-reels li:not(.off)").allInnerTexts().then((x) => x.join("|"))) && (await p.locator(".rg-reels li.off", { hasText: "Defense" }).count()) === 1);
    await p.getByRole("button", { name: "Find big moments" }).click();
    await p.waitForFunction(() => { const t = document.querySelector(".rg-sug")?.textContent || ""; return /Big moments|No clear rallies|can't read/.test(t); }, null, { timeout: 60000 }).catch(() => {});
    { const t = await p.locator(".rg-sug").innerText(); ok("studio: Find big moments listens to the game and answers", /Big moments|No clear rallies|can't read/.test(t), t.slice(0, 200));
      if (await p.locator(".rg-sugs li").count()) { const n = await p.locator(".rg-marks li").count(); await p.locator(".rg-sugs li").first().locator("select").selectOption("BS"); ok("studio: a big moment becomes a marked play", (await p.locator(".rg-marks li").count()) === n + 1); } }
    { const ax = await a11y(p); ok("studio controls all have names", !ax.length, ax.join(" | ")); }
    await p.locator(".rg-reels li", { hasText: "Hitting" }).locator("input").check();
    await p.locator(".rg-reels li", { hasText: "Best of" }).locator("input").uncheck();
    await p.getByRole("button", { name: /^Make 1 video$/ }).click();
    await p.locator(".rg-jobs video").waitFor({ timeout: 90000 });
    ok("studio: makes the hitting video", (await p.locator(".rg-jobs li").first().innerText()).includes("Ready"));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "recruit-studio.png"), fullPage: true });
    ok("athletes: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },
  async phones(browser) {
    for (const dark of [false, true]) {
      const p = await newPage(browser, { cloud: false, phone: true, dark });
      await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Phone High"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
      const pages = [["app", U + "#/film"], ["guide", U + "recruit/#/guide"], ["emails", U + "recruit/#/emails"], ["studio", U + "recruit/#/studio"], ["recruit", U + "recruit/"]];
      for (const [name, url] of pages) {
        await p.goto(url); await p.waitForTimeout(400);
        const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        ok(`phone${dark ? " dark" : ""}: ${name} fits the screen`, w[0] <= w[1] + 1, w.join(" > "));
        if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, `phone-${dark ? "dark-" : ""}${name}.png`), fullPage: true });
      }
      ok("phones: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
      await p.context().close();
    }
  },
  async accounts(browser) {
    // real visitors: an account is required for the coach app and the athlete tools
    const A = await newPage(browser, { strict: true });
    await go(A, "track");
    ok("accounts: the coach app starts at Create your account", /Create your account/.test(await A.locator(".auth-title").innerText()));
    ok("accounts: there's no way in without an account", !(await A.getByRole("button", { name: "Use without an account" }).count()));
    await go(A, "sample"); await A.waitForTimeout(800);
    ok("accounts: the sample season can still be explored first", (await A.locator(".auth-title").count()) === 0, await A.locator("body").innerText().then((x) => x.slice(0, 120)));
    await A.context().clearCookies(); await A.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("bench-stats"); }); await A.reload(); await A.waitForTimeout(600);
    await A.getByLabel("Email", { exact: true }).fill("strict@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").first().check();
    await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(300);
    ok("accounts: a name is required", /Enter your name/.test(await A.locator(".auth-form").innerText()));
    await A.locator("#auth-name").fill("Coach Rivera"); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(700);
    { const us = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/users`)).json(); const u = us.find((x) => x.email === "strict@e2e.test");
      ok("accounts: a coach account keeps the name, kind and news choice", u && u.meta.name === "Coach Rivera" && u.meta.kind === "coach" && u.meta.email_ok === true, JSON.stringify(u)); }
    ok("accounts: signed in, the coach sets up a team", (await A.getByLabel("Team name").count()) === 1);
    await A.context().close();
    // athletes on FloorCall Recruit
    const R = await newPage(browser, { strict: true });
    await R.goto(U + "recruit/#/emails"); await R.waitForTimeout(400);
    ok("accounts: the athlete tools ask for a free account", (await R.locator(".ma").count()) === 1 && !(await R.locator(".rg-body").count()));
    ok("accounts: athletes default to no news emails", !(await R.locator(".ma-check input").nth(1).isChecked()));
    await R.getByLabel("Your name").fill("Maya Chen"); await R.getByLabel("Email", { exact: true }).fill("maya@e2e.test"); await R.getByLabel("Password", { exact: true }).fill("athlete-pass");
    await R.locator(".ma-check input").first().check(); await R.locator(".ma").getByRole("button", { name: "Create free account" }).last().click(); await R.waitForTimeout(700);
    ok("accounts: signed in, the email writer opens", (await R.locator(".rg-body").count()) === 1);
    await R.getByLabel("First name").fill("Maya"); await R.getByLabel("Grad year").fill("2028"); await R.waitForTimeout(1800);
    await R.context().close();
    const R2 = await newPage(browser, { strict: true, phone: true });
    await R2.goto(U + "recruit/#/emails"); await R2.waitForTimeout(400);
    await R2.locator(".ma").getByRole("button", { name: "Sign in" }).first().click(); await R2.getByLabel("Email", { exact: true }).fill("maya@e2e.test"); await R2.getByLabel("Password", { exact: true }).fill("athlete-pass");
    await R2.locator(".ma").getByRole("button", { name: "Sign in" }).last().click(); await deviceCode(R2, "maya@e2e.test"); await R2.waitForTimeout(800);
    if (process.env.SHOTS) await R2.screenshot({ path: path.join(process.env.SHOTS, "phone-emails-signed-in.png"), fullPage: true });
    ok("accounts: on a phone, the email comes right after the coach and school", await R2.evaluate(() => { const a = document.querySelector(".rg-preview").getBoundingClientRect().top, b = document.querySelector(".rg-you").getBoundingClientRect().top, c = document.querySelector(".rg-this").getBoundingClientRect().top; return c < a && a < b; }));
    ok("accounts: an athlete's details follow them to another device", (await R2.getByLabel("First name").inputValue()) === "Maya" && (await R2.getByLabel("Grad year").inputValue()) === "2028");
    { const ax = await a11y(R2); ok("accounts: sign-in controls all have names", !ax.length, ax.join(" | ")); }
    ok("accounts: no page errors", !A.errors.length && !R.errors.length && !R2.errors.length, [...A.errors, ...R.errors, ...R2.errors].slice(0, 3).join(" | "));
    await R2.context().close();
  },
  async filmsession(browser) {
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email", { exact: true }).fill("film@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Coach Film"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Film High"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await go(A, "team"); await A.getByRole("button", { name: "Paste list" }).click(); await A.locator("textarea").first().fill("7 Maya Chen OH\n8 Zoe Grant MB\n3 Lily Torres L"); await A.getByRole("button", { name: "Add players" }).click(); await A.waitForTimeout(300);
    await go(A, "film");
    await A.getByLabel("Game video file").setInputFiles(path.join(__dirname, "fixtures", "game.webm"));
    await A.getByPlaceholder("e.g. Buchanan").fill("Central"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(600);
    await A.locator(".fr-stage video").evaluate((v) => v.readyState >= 1 ? 0 : new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true })));
    const at = async (t) => { await A.locator(".fr-stage video").evaluate((v, x) => { v.pause(); v.currentTime = x; }, t); await A.waitForTimeout(250); };
    await A.locator(".fr-top h1").click();
    await at(9); await A.keyboard.type("7"); await A.waitForTimeout(900); await A.keyboard.press("k"); await A.keyboard.press("Escape");
    await at(30); await A.keyboard.type("8"); await A.waitForTimeout(900); await A.keyboard.press("b"); await A.keyboard.press("Escape");
    await A.getByRole("tab", { name: "Find clips" }).click();
    await A.getByLabel("Ask for clips").fill("points we won"); await A.getByRole("button", { name: "Find", exact: true }).click(); await A.waitForTimeout(200);
    await A.getByRole("button", { name: /^Add 2 clips to a film session$/ }).click(); await A.waitForTimeout(300);
    ok("film session: clips found by asking go into a new session", (await A.locator(".fr-items > li").count()) === 2, await A.locator(".fr-side").innerText().then((x) => x.slice(0, 300)));
    await A.locator(".fr-items > li").first().getByLabel("Coach's note").fill("Watch Maya's approach: three steps, arms back early.");
    await A.locator(".fr-items > li").first().getByRole("button", { name: "Draw on it" }).click(); await A.waitForTimeout(500);
    const cv = A.locator(".fr-tele canvas"), bx = await cv.boundingBox();
    await A.mouse.move(bx.x + bx.width * 0.2, bx.y + bx.height * 0.7); await A.mouse.down(); await A.mouse.move(bx.x + bx.width * 0.5, bx.y + bx.height * 0.4, { steps: 6 }); await A.mouse.up();
    await A.getByRole("button", { name: "Circle" }).click(); await A.mouse.move(bx.x + bx.width * 0.55, bx.y + bx.height * 0.3); await A.mouse.down(); await A.mouse.move(bx.x + bx.width * 0.7, bx.y + bx.height * 0.5, { steps: 6 }); await A.mouse.up();
    { const ax = await a11y(A); ok("telestrator controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "film-telestrator.png") });
    await A.getByRole("button", { name: "Save drawing" }).click(); await A.waitForTimeout(200);
    ok("film session: the drawing is saved with the clip", /Edit drawing \(2\)/.test(await A.locator(".fr-items > li").first().innerText()));
    await A.getByLabel("Session title").fill("Points we won vs Central");
    // the coach evaluates the first clip and says who it is for
    { const li = A.locator(".fr-items > li").first();
      await li.getByRole("button", { name: "Great rep" }).click(); await li.locator(".fr-who summary").click(); { const chip = li.locator(".fr-who-list .chip", { hasText: "Maya" }); if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click(); } await A.waitForTimeout(150);
      const whoName = "Maya";
      ok("film session: a clip can be graded and assigned to a player", (await li.getByRole("button", { name: "Great rep" }).getAttribute("aria-pressed")) === "true" && (await li.locator(".fr-who summary").innerText()) === "For " + whoName && /1 great rep/.test(await A.locator(".fr-sess").innerText()));
      A.whoName = whoName; }
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "film-session.png"), fullPage: true });
    await A.getByRole("button", { name: "Send to team" }).click();
    await A.getByRole("button", { name: "Copy link" }).waitFor({ timeout: 90000 });
    const link = await A.locator(".fr-sess a[href*='/live/#/film/']").getAttribute("href");
    ok("film session: sent to the team with a Live link", /\/live\/#\/film\/[A-Z0-9]{8}$/.test(link || ""), link || "");
    // a player watches, signed in
    const P = await newPage(browser, { phone: true });
    await P.goto(link); await P.waitForTimeout(500);
    ok("team film needs a free account", (await P.locator(".lv-film-gate .ma").count()) === 1);
    await P.getByLabel("Your name").fill("Maya Chen"); await P.getByLabel("Email", { exact: true }).fill("maya-film@e2e.test"); await P.getByLabel("Password", { exact: true }).fill("player-pass");
    await P.locator(".ma-check input").first().check(); await P.locator(".ma").getByRole("button", { name: "Create free account" }).last().click(); await P.waitForTimeout(900);
    ok("team film: the session opens with the coach's notes", /Points we won vs Central/.test(await P.locator(".lv-film-hd").innerText()) && /three steps, arms back early/.test(await P.locator(".lv-film").innerText()), await P.locator("main").innerText().then((x) => x.slice(0, 300)));
    ok("team film: both clips are listed", (await P.locator(".lv-film-list li").count()) === 2);
    ok("team film: players see the coach's evaluation", (await P.locator(".lv-film-list li").first().locator(".lv-grade.great").innerText()) === "Great rep" && (await P.locator(".lv-film-list li").first().locator(".lv-for").innerText()) === "For " + A.whoName);
    await P.locator(".lv-film-who select").selectOption(A.whoName); await P.waitForTimeout(150);
    ok("team film: a player can show only her clips", (await P.locator(".lv-film-list li").count()) === 1);
    await P.locator(".lv-film-who select").selectOption(""); await P.waitForTimeout(150);
    // how long the recorded clip really runs: play it fast to the end
    const dur = await P.locator(".lv-film-player video").evaluate(async (v) => { v.muted = true; v.playbackRate = 8; const end = new Promise((r) => v.addEventListener("ended", r, { once: true })); await v.play().catch(() => {}); await Promise.race([end, new Promise((r) => setTimeout(r, 6000))]); return v.currentTime; });
    if (process.env.KEEP_FILM) { const u = await P.locator(".lv-film-player video").getAttribute("src"); fs.writeFileSync("/tmp/claude-0/clip0.bin", Buffer.from(await (await fetch(u)).arrayBuffer())); }
    await P.locator(".lv-film-list li").first().locator("button").click(); await P.waitForTimeout(300);
    { const d0 = await P.evaluate(async (u) => { const v = document.createElement("video"); v.muted = true; v.src = URL.createObjectURL(await (await fetch(u)).blob()); await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true })); return v.duration; }, await P.locator(".lv-film-player video").getAttribute("src"));
      ok("team film: the clip knows its real length (players can scrub; the test server has no byte ranges, so read it whole)", d0 > 9 && d0 < 16, String(d0)); }
    ok("team film: the first clip holds on the drawing (clip + 4 s freeze)", dur > 9 && dur < 16, String(dur));
    await P.waitForTimeout(500);
    ok("team film: a watched clip is ticked off", (await P.locator(".lv-film-list li.done").count()) >= 1, JSON.stringify(await P.locator(".lv-film-player video").evaluate((v) => [v.currentTime, v.duration, v.paused, v.ended, v.error && v.error.code])));
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "film-live.png"), fullPage: true });
    // the coach sees who watched
    await A.getByRole("button", { name: "‹ Sessions" }).click(); await A.locator(".fr-list button").first().click(); await A.waitForTimeout(800);
    ok("film session: the coach sees who watched", /Watched by 1 person/.test(await A.locator(".fr-viewers").innerText()) && /Maya Chen/.test(await A.locator(".fr-viewers").innerText()), await A.locator(".fr-sess").innerText().then((x) => x.slice(-300)));
    await A.getByRole("button", { name: "Take down" }).click(); await A.waitForTimeout(400);
    await P.reload(); await P.waitForTimeout(800);
    ok("film session: a taken-down session no longer opens", /isn't shared anymore/.test(await P.locator("main").innerText()));
    // the player's page collects the clips tagged for her
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: A.whoName }).first().click(); await A.waitForTimeout(500);
    ok("a player's page lists the film clips tagged for her, with the grade", /1 great/.test(await A.locator(".card", { hasText: "Film review" }).innerText().catch(() => "")) && (await A.locator(".fr-player li").count()) === 1 && /Points we won vs Central/.test(await A.locator(".fr-player").innerText()));
    ok("film session: no page errors", !A.errors.length && !P.errors.length, [...A.errors, ...P.errors].slice(0, 3).join(" | "));
    await A.context().close(); await P.context().close();
  },
  /** Product-page pictures (run with MKT=dir): a believable team, shot crisp on a laptop and a phone. Not a test. */
  async _marketing(browser) {
    const out = process.env.MKT || "/tmp/mkt"; fs.mkdirSync(out, { recursive: true });
    const shot = async (pg, name, o = {}) => { await pg.addStyleTag({ content: ".toast{display:none!important}" }).catch(() => {}); await pg.waitForTimeout(700); await pg.screenshot({ path: path.join(out, name + ".png"), ...o }); console.log("    shot " + name); };
    const A = await newPage(browser, { scale: 2, size: { width: 1440, height: 900 } });
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email", { exact: true }).fill("coach@westbrook.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Coach Rivera"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(800);
    await go(A, "sample"); await A.waitForTimeout(2500);
    await go(A, "team"); await A.getByLabel("Team name").fill("Westbrook"); await A.getByLabel("Team name").press("Tab"); await A.waitForTimeout(800);
    // pictures only: treat the sample season as a real team so it syncs and shares like one
    await A.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open("bench-stats"); q.onsuccess = () => r(q.result); });
      for (const store of ["teams", "matches"]) { const all = await new Promise((r) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); });
        const tx = db.transaction(store, "readwrite"); for (const x of all) if (x.sample) { delete x.sample; tx.objectStore(store).put(x); } await new Promise((r) => (tx.oncomplete = r)); } });
    await A.reload(); await A.waitForTimeout(1200);
    await go(A, "team"); { const sy = A.getByRole("button", { name: "Sync this team" }); if (await sy.count()) { await sy.first().click(); await A.waitForTimeout(2500); } }
    { const ok2 = A.getByRole("button", { name: "I have permission" }); if (await ok2.count()) { await ok2.click(); await A.waitForTimeout(500); } }
    { const ex = A.getByRole("button", { name: "Expand the sidebar" }); if (await ex.count()) { await ex.click(); await A.waitForTimeout(400); } }
    await go(A, "track"); await shot(A, "app-track");
    await go(A, "stats"); await A.waitForTimeout(800); await shot(A, "app-stats");
    await go(A, "matchup"); await A.waitForTimeout(800); await shot(A, "app-matchup");
    await go(A, "court"); await A.waitForTimeout(800); { const pb = A.getByRole("button", { name: "Playbook", exact: true }); if (await pb.count()) { await pb.click(); await A.waitForTimeout(500); }
      const pl = A.getByRole("button", { name: "Perimeter vs outside", exact: true }); if (await pl.count()) { await pl.first().click(); await A.waitForTimeout(800); }
      const cn = A.getByRole("button", { name: "Corner", exact: true }); if (await cn.count()) { await cn.click(); await A.waitForTimeout(1500); } }
    await shot(A, "app-playbook");
    await go(A, "lineup"); await A.waitForTimeout(800); await shot(A, "app-lineup");
    // the phone: tracking courtside
    const M = await newPage(browser, { phone: true, scale: 3 });
    await M.context().addCookies([]); await go(M, "track");
    // reuse the same browser data: copy local storage from A
    const ls = await A.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    await M.evaluate((d) => { const o = JSON.parse(d); for (const k in o) localStorage.setItem(k, o[k]); }, ls);
    // families: share the team page
    await go(A, "team"); const sync = A.getByRole("button", { name: "Sync now" }); if (await sync.count()) { await sync.click(); await A.waitForTimeout(1500); }
    const share = A.getByRole("button", { name: "Share team page" }); if (await share.count()) { await share.click(); await A.waitForTimeout(1500); }
    const season = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href").catch(() => null);
    console.log("    team page: " + season);
    const P = await newPage(browser, { phone: true, scale: 3 });
    if (season) {
      await P.goto(season); await P.waitForTimeout(2000); await shot(P, "live-team");
      const gc = P.getByRole("link", { name: "Open the gamecast" }); if (await gc.count()) { await gc.click(); await P.waitForTimeout(1500); await shot(P, "live-game"); await P.screenshot({ path: path.join(out, "live-game-full.png"), fullPage: true });
        { const ch = P.getByRole("button", { name: /chart$/i }).first(); if (await ch.count()) { await ch.click(); await P.waitForTimeout(400); await P.locator(".lv-gc").screenshot({ path: path.join(out, "live-chart.png") }); await P.getByRole("button", { name: "Last play", exact: true }).click(); }
          const url = P.url(), Dk = await newPage(browser, { size: { width: 1280, height: 900 }, scale: 2 }); await Dk.goto(url); await Dk.waitForTimeout(2500); await Dk.locator(".lv-gc").screenshot({ path: path.join(out, "live-desk.png") }); await Dk.screenshot({ path: path.join(out, "live-desk-page.png"), fullPage: true }); await Dk.context().close(); }
        const box = P.getByRole("button", { name: "Box score", exact: true }); if (await box.count()) { await box.click(); await shot(P, "live-box"); }
        const pbp = P.getByRole("button", { name: "Play-by-play", exact: true }); if (await pbp.count()) { await pbp.click(); await shot(P, "live-pbp"); }
        const ld = P.getByRole("button", { name: "Leaders", exact: true }); if (await ld.count()) { await ld.click(); await P.waitForTimeout(300); await P.screenshot({ path: path.join(out, "live-leaders.png"), fullPage: true }); }
        const bx = P.getByRole("button", { name: "Box score", exact: true }); if (await bx.count()) { await bx.click(); await P.waitForTimeout(300); await P.screenshot({ path: path.join(out, "live-box-full.png"), fullPage: true }); } }
    }
    // athletes: a recruiting profile
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click").first().click(); await A.waitForTimeout(600);
    await shot(A, "app-player");
    const consent = A.locator(".consent-check input").first(); if (await consent.count()) { await consent.check(); await A.getByRole("button", { name: "Share profile link" }).click(); await A.waitForTimeout(1500); }
    const rec = await A.locator("a", { hasText: "/recruit/#/p/" }).first().getAttribute("href").catch(() => null);
    console.log("    profile: " + rec);
    if (rec) { await P.goto(rec); await P.waitForTimeout(2000); await shot(P, "recruit-profile"); }
    await P.goto(U + "recruit/#/guide"); await P.waitForTimeout(800); if (await P.locator(".sg .ma").count()) { await siteSignUp(P, "maya.family@westbrook.test", "parent", "Dana Chen"); await P.goto(U + "recruit/#/guide"); await P.waitForTimeout(1200); }
    await P.evaluate(() => scrollTo(0, 0)); await P.waitForTimeout(300); await shot(P, "recruit-guide");
    await A.context().close(); await M.context().close(); await P.context().close();
  },
  async beach(browser) {
    const p = await newPage(browser, { phone: true });
    await p.goto(U + "beach/"); await p.waitForTimeout(500);
    await siteSignUp(p, "beach-player@e2e.test", "athlete", "Ava Beach");
    ok("beach site opens with a start form and links to the other sites", (await p.getByRole("button", { name: "Start match" }).count()) === 1 && (await p.locator(".site-switch a").count()) === 6);
    await p.getByLabel("Your player 1").fill("Ava"); await p.getByLabel("Your player 2").fill("Maya");
    await p.getByLabel("Opponent 1").fill("Kim"); await p.getByLabel("Opponent 2").fill("Lee");
    await p.getByRole("button", { name: "Start match" }).click(); await p.waitForTimeout(300);
    ok("a new match starts at 0-0 with the first server named", (await p.locator(".bv-pts").allInnerTexts()).join("-") === "0-0" && (await p.locator(".bv-note").innerText()).includes("Ava serves"));
    const pad = (name) => p.locator(".bv-pad", { has: p.getByRole("heading", { name }) });
    ok("only the server gets ace and serve error", (await pad("Ava").getByRole("button", { name: "Ace" }).count()) === 1 && (await pad("Maya").getByRole("button", { name: "Ace" }).count()) === 0);
    await pad("Ava").getByRole("button", { name: "Ace" }).click();
    await pad("Maya").getByRole("button", { name: "Kill" }).click();
    await pad("Kim").getByRole("button", { name: "Kill" }).click(); await p.waitForTimeout(150);
    ok("points score and the serve passes on a side-out", (await p.locator(".bv-pts").allInnerTexts()).join("-") === "2-1" && (await p.locator(".bv-note").innerText()).includes("Kim serves"));
    await pad("Kim").getByRole("button", { name: "Serve error" }).click(); await p.waitForTimeout(100);
    ok("after the next side-out the other partner serves", (await p.locator(".bv-note").innerText()).includes("Maya serves"));
    for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "+1 Ava / Maya" }).click();
    await p.waitForTimeout(150);
    ok("at 7 points it says to switch sides, full width and readable", (await p.locator(".bv-note.bv-alert").count()) === 1 && (await p.locator(".bv-note.bv-alert").evaluate((e) => e.getBoundingClientRect().width)) > 250 && /far side/.test(await p.locator(".bv-sand").getAttribute("aria-label")));
    const box = await p.locator(".bv-box tbody tr").first().innerText();
    ok("the box score counts each player's touches", /Ava\s+1\s+0\s+0\s+0\s+–\s+1/.test(box), box);
    ok("side-out and point-scoring show for each pair", (await p.locator(".bv-so > div").count()) === 2 && /side-out/.test(await p.locator(".bv-so").innerText()));
    await p.getByRole("button", { name: "Undo" }).click(); await p.waitForTimeout(100);
    ok("undo takes the last point back", (await p.locator(".bv-pts").allInnerTexts()).join("-") === "5-1");
    for (let i = 0; i < 16; i++) await p.getByRole("button", { name: "+1 Ava / Maya" }).click();
    await p.waitForTimeout(150);
    ok("the end of a set is announced with who serves next", /Set 1 to Ava \/ Maya, 21–1\. Switch sides\. Kim serves first in set 2/.test(await p.locator(".bv-note").innerText()), await p.locator(".bv-note").innerText());
    for (let i = 0; i < 21; i++) await p.getByRole("button", { name: "+1 Ava / Maya" }).click();
    await p.waitForTimeout(200);
    ok("two sets win the match and entry stops", (await p.locator(".bv-note.win").innerText()).includes("2–0") && (await p.locator(".bv-pad").count()) === 0);
    ok("beach fits a phone", (await overflow(p)) <= 0);
    await p.reload(); await p.waitForTimeout(400);
    ok("the match is still there after a reload", (await p.locator(".bv-set").innerText()) === "Final");
    await p.goto(U + "beach/#/"); await p.waitForTimeout(300);
    ok("finished matches are listed on the beach home page", (await p.locator(".bv-list li").innerText()).includes("Won 2–0"));
    ok("matches are grouped by day with the day's record", (await p.locator(".bv-day").count()) === 1 && /· 1–0/.test(await p.locator(".bv-day h3").innerText()));
    ok("each pair has a record with side-out and point-scoring", /Ava \/ Maya\s+1\s+1–0\s+2–0/.test(await p.locator(".card", { has: p.getByRole("heading", { name: "Pairs", exact: true }) }).innerText()), await p.locator(".card", { has: p.getByRole("heading", { name: "Pairs", exact: true }) }).innerText().catch(() => "none"));
    await p.goto(U + "beach/#/m/" + (await p.evaluate(() => JSON.parse(localStorage.getItem("fc-beach"))[0].id))); await p.waitForTimeout(300);
    await p.evaluate(() => { navigator.share = undefined; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
    await p.getByRole("button", { name: "Share link" }).click(); await p.waitForTimeout(200);
    const shareUrl = await p.evaluate(() => window.__copied);
    const q = await newPage(browser, { phone: true }); await q.goto(shareUrl); await q.waitForTimeout(500);
    ok("a share link opens the final score and box score on another device, read only", (await q.locator(".bv-set").innerText()) === "Final" && (await q.locator(".bv-box tbody tr").count()) === 6 && (await q.getByRole("button", { name: "Undo" }).count()) === 0 && (await q.getByRole("link", { name: "Score your own match" }).count()) === 1);
    await q.goto(U + "beach/#/v/garbage"); await q.waitForTimeout(300);
    ok("a broken share link says so", (await q.getByText("This link didn't open").count()) === 1);
    await p.goto(U + "beach/#/"); await p.waitForTimeout(300);
    ok("player totals add up across matches", /Ava\s+1\s+1\s+0\s+0\s+0\s+–\s+1/.test(await p.locator(".card", { has: p.getByRole("heading", { name: "Player totals" }) }).locator("tbody tr", { hasText: "Ava" }).innerText()));
    // live: the scorer shares a match; a fan follows it on another phone with no account
    await p.goto(U + "beach/#/"); await p.waitForTimeout(300);
    await p.getByLabel("Your player 1").fill("Zoe"); await p.getByLabel("Your player 2").fill("Bea"); await p.getByRole("button", { name: "Start match" }).click(); await p.waitForTimeout(300);
    await p.getByRole("button", { name: "Go live" }).click(); await p.waitForTimeout(200);
    await p.waitForTimeout(1200);
    ok("signed in already, going live needs no second sign-up", (await p.locator(".bv-live .ma").count()) === 0);
    const liveLink = await p.locator(".bv-link a").getAttribute("href").catch(() => null);
    ok("signed in, the match gets a live link", /beach\/#\/live\/[A-Z0-9]{5,8}$/.test(liveLink || ""), String(liveLink));
    { const ax = await a11y(p); ok("live sharing controls all have names", !ax.length, ax.join(" | ")); }
    const fan = await newPage(browser, { phone: true }); await fan.goto(liveLink); await fan.waitForTimeout(900);
    ok("a fan opens the live match with no account", (await fan.locator(".bv-livetag").innerText()) === "Live" && (await fan.locator(".bv-pts").allInnerTexts()).join("-") === "0-0" && (await fan.locator(".bv-pad").count()) === 0);
    await p.locator(".bv-pad", { has: p.getByRole("heading", { name: "Zoe" }) }).getByRole("button", { name: "Ace" }).click();
    { const t0 = Date.now(); let sc = ""; while (Date.now() - t0 < 12000) { sc = (await fan.locator(".bv-pts").allInnerTexts()).join("-"); if (sc === "1-0") break; await fan.waitForTimeout(400); } ok("the fan's score updates when a point is entered", sc === "1-0" && /Ace, Zoe/.test(await fan.locator(".bv-log").innerText()), sc); }
    if (process.env.QASHOT4) { await p.screenshot({ path: process.env.QASHOT4, fullPage: true }); await fan.screenshot({ path: process.env.QASHOT4.replace(".png", "-fan.png") }); }
    await p.getByRole("button", { name: "Stop sharing" }).click(); await p.waitForTimeout(400);
    { const t0 = Date.now(); let gone = false; while (Date.now() - t0 < 12000) { gone = (await fan.getByText("This match isn't being shared").count()) === 1; if (gone) break; await fan.waitForTimeout(400); } ok("stopping takes the live page down", gone && (await p.getByRole("button", { name: "Go live" }).count()) === 1); }
    ok("no errors on the fan's phone", fan.errors.length === 0, fan.errors.join("; "));
    await fan.context().close();
    // no signal at the beach: the site still opens and scores
    await p.goto(U + "beach/#/"); await p.reload(); await p.waitForTimeout(1500);
    await p.context().setOffline(true);
    await p.reload().catch(() => {}); await p.waitForTimeout(800);
    ok("beach opens with no connection", (await p.getByRole("button", { name: "Start match" }).count()) === 1);
    await p.getByRole("button", { name: "Start match" }).click(); await p.waitForTimeout(300);
    await p.getByRole("button", { name: "+1 Player 1 / Player 2" }).click(); await p.waitForTimeout(100);
    ok("and scores a match offline", (await p.locator(".bv-pts").allInnerTexts()).join("-") === "1-0");
    await p.context().setOffline(false);
    ok("no errors on the beach site", p.errors.length === 0, p.errors.join("; "));
  },
  async modes(browser) {
    const p = await newPage(browser, { cloud: false, size: { width: 1280, height: 860 } });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Mode High"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(500);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill(["4 Jordan Lee OH", "7 Maya Chen OH", "9 Riley Brooks MB", "11 Ava Ramirez S", "12 Zoe Grant OPP", "14 Kenzie Park OH"].join("\n")); await p.getByRole("button", { name: "Add players", exact: true }).click(); await p.waitForTimeout(300);
    // the app opens on Home with the sidebar folded, in the light theme
    await p.goto(U); await p.waitForTimeout(600);
    ok("the app opens on Home, sidebar folded, light theme", (await p.locator(".hm-head, .home").count()) > 0 && await p.evaluate(() => document.body.classList.contains("nav-mini") && document.documentElement.getAttribute("data-theme") === "light"));
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill("Modes Prep"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(300);
    ok("full stats has every button", (await p.locator(".pad .act", { hasText: "Tool" }).count()) === 1);
    await p.locator("button.ctrl", { hasText: /^Tracking/ }).click(); await p.getByRole("button", { name: /^Basic stats/ }).click(); await p.getByRole("button", { name: "Done", exact: true }).click(); await p.waitForTimeout(200);
    const basic = await p.locator(".pad .label").allInnerTexts();
    ok("basic stats keeps the box score only", (await p.locator(".pad .act", { hasText: "Tool" }).count()) === 0 && (await p.locator(".pad .act", { hasText: /^Kill$/ }).count()) === 1 && (await p.locator(".pad .act", { hasText: /^Dig$/ }).count()) === 1 && !basic.some((x) => /Transition|Misc|Serve receive/i.test(x)), basic.join(","));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "track-basic.png") });
    await p.locator(".pl", { hasText: "Maya" }).first().click(); await p.locator(".pad .act", { hasText: /^Kill$/ }).click(); await skipIfAsked(p); await p.waitForTimeout(200);
    ok("a basic kill scores", /MODE HIGH 1/.test(await score(p)), await score(p));
    await p.locator("button.ctrl", { hasText: /^Tracking/ }).click(); await p.getByRole("button", { name: /^Points only/ }).click(); await p.getByRole("button", { name: "Done", exact: true }).click(); await p.waitForTimeout(200);
    ok("points only shows just who won the point", (await p.locator(".pad .act").count()) === 2 && (await p.getByRole("button", { name: "Our point", exact: true }).count()) === 1);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "track-points.png") });
    await p.getByRole("button", { name: "Their point", exact: true }).click(); await p.waitForTimeout(150);
    ok("points only keeps score", /MODE HIGH 1 .* 1/.test(await score(p)), await score(p));
    await go(p, "settings"); ok("settings has the tracking choice and the old Labs switches", (await p.getByRole("group", { name: "What to track" }).count()) === 1 && (await p.getByLabel("Type-in stat codes").count()) === 1);
    ok("Labs is gone from the sidebar; Formations sit under Lineup", (await p.locator(".nav a.tab[href='#/labs']").count()) === 0);
    await go(p, "formations"); ok("formations has the lineup tabs", (await p.getByRole("group", { name: "Lineup section" }).count()) === 1);
    // the sidebar's FloorCall sites menu
    await go(p, "home"); await p.locator(".sm-btn").click(); ok("the sidebar lists the other FloorCall sites", (await p.locator(".sm-menu a", { hasText: "FloorCall Academy" }).count()) === 1);
    await p.keyboard.press("Escape");
    // scout an opponent from their film
    await go(p, "film"); await p.waitForTimeout(300);
    const sc = p.locator(".sf-start");
    await sc.getByLabel("Video of their game").setInputFiles(path.join(__dirname, "fixtures", "game.webm"));
    await sc.getByPlaceholder("e.g. Central").fill("Scout Prep"); await sc.getByRole("button", { name: "Start scouting" }).click(); await p.waitForTimeout(600);
    ok("scouting opens their game", /#\/film\/scout(:|%3A)/.test(p.url()) && (await p.locator(".sf-video video").count()) === 1, p.url());
    await p.getByLabel("Type their number").fill("12"); await p.locator(".sf-acts button", { hasText: "Kill" }).click();
    await p.locator(".sf-chips button", { hasText: "12" }).click(); await p.locator(".sf-acts button", { hasText: "Kill" }).click();
    await p.locator("body").click({ position: { x: 5, y: 5 } }); await p.keyboard.type("7"); await p.keyboard.press("a"); await p.waitForTimeout(200);
    const rows = await p.locator(".sf-table tbody tr").allInnerTexts();
    ok("their players add up, most dangerous first, typed numbers and keys work", rows.length === 2 && /^#12\s+2/.test(rows[0].trim()) && /#7/.test(rows[1]), rows.join(" | "));
    await p.locator("body").click({ position: { x: 5, y: 5 } }); await p.keyboard.type("12"); await p.keyboard.press("t"); await p.waitForTimeout(200);
    ok("an attack kept in play counts toward attacks and hitting %", /#12\s+2\s+3\s+\.667/.test((await p.locator(".sf-table tbody tr").first().innerText()).replace(/\s+/g, " ")), await p.locator(".sf-table tbody tr").first().innerText());
    await p.getByLabel("Ask for clips from their film").fill("every attack by #12"); await p.getByRole("button", { name: "Show clips" }).click(); await p.waitForTimeout(400);
    ok("ask for clips: every attack by #12", (await p.locator(".card", { hasText: "#12's attacks · 3 clips" }).count()) === 1);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "scout.png"), fullPage: true });
    await p.getByRole("button", { name: "Open in Matchup" }).click(); await p.waitForTimeout(400);
    ok("the Matchup page shows what their film says", (await p.locator(".card", { hasText: "From their film" }).count()) === 1);
    ok("no errors in tracking modes or scouting", !p.errors.length, p.errors.slice(0, 3).join("; "));
    await p.context().close();
  },
  async verify(browser) {
    // a new head coach must be verified by a FloorCall admin before their team can sync
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("unverified-head@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Dana Park"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Verify Prep"); await A.getByRole("button", { name: "Boys" }).click(); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    ok("a new team starts on the team page with the gender chosen", (await A.locator(".seg button[aria-pressed=true]", { hasText: "Boys" }).count()) === 1);
    ok("an unverified coach is asked to verify before syncing", (await A.getByRole("heading", { name: "Verify your coach account" }).count()) === 1 && (await A.getByRole("button", { name: "Sync this team" }).count()) === 0);
    await go(A, "account"); await A.waitForTimeout(500);
    ok("an unverified coach's account says Not verified", (await A.locator(".acct .vbadge", { hasText: "Not verified" }).count()) === 1);
    await go(A, "team"); await A.waitForTimeout(500);
    await A.getByLabel("School or club").fill("Verify Prep Academy"); await A.getByRole("button", { name: "Ask to be verified" }).click(); await A.waitForTimeout(500);
    ok("after asking, the coach sees it's being checked", (await A.getByRole("heading", { name: "Verifying your coach account" }).count()) === 1);
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "verify-pending.png"), fullPage: true });
    // the FloorCall admin verifies them
    const D = await newPage(browser);
    await go(D, "track"); { const ca = D.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await D.getByLabel("Email").fill("boss@e2e.test"); await D.locator("#auth-pw").fill("secret123"); await D.locator("#auth-name").fill("Boss"); await D.locator(".auth-agree input").first().check(); await D.getByRole("button", { name: "Create account" }).click(); await D.waitForTimeout(500);
    await D.getByLabel("Team name").fill("Boss Team"); await D.getByRole("button", { name: "Create team" }).click(); await D.waitForTimeout(600);
    await fetch(`http://localhost:${MOCK_PORT}/__mock/make-admin?email=boss%40e2e.test`, { headers: { apikey: "anon" } });
    await D.reload(); await go(D, "admin"); await D.waitForTimeout(900);
    ok("the admin console lists coaches waiting to be verified", (await D.locator("td", { hasText: "Verify Prep Academy" }).count()) === 1);
    if (process.env.SHOTS) await D.screenshot({ path: path.join(process.env.SHOTS, "admin-verify.png"), fullPage: true });
    await D.getByRole("button", { name: "Verify", exact: true }).click(); await D.waitForTimeout(400);
    await A.reload(); await go(A, "team"); await A.waitForTimeout(800);
    ok("once verified, the coach can sync the team", (await A.getByRole("button", { name: "Sync this team" }).count()) === 1);
    await A.getByRole("button", { name: "Sync this team" }).click(); await A.waitForTimeout(1200);
    ok("and it syncs", (await A.getByText("Synced").count()) > 0);
    await go(A, "account"); await A.waitForTimeout(500);
    ok("a verified coach's account shows the Verified badge", (await A.locator(".acct .vbadge", { hasText: "Verified coach" }).count()) === 1);
    await go(A, "team"); await A.waitForTimeout(800);
    ok("and so does the team's staff list", (await A.locator(".log li", { hasText: "(you)" }).locator(".vbadge", { hasText: "Verified coach" }).count()) === 1);
    // settings: no setup or background sections for coaches; admins see them
    await go(A, "settings"); await A.waitForTimeout(500);
    ok("coaches' settings leave out setup tools but let them hide AI or bring their own key", (await A.getByRole("heading", { name: "Setup check" }).count()) === 0 && (await A.getByRole("heading", { name: "AI features" }).count()) === 1 && (await A.getByRole("switch", { name: "Show AI buttons" }).or(A.getByLabel("Show AI buttons")).count()) >= 1 && (await A.getByRole("button", { name: "Light" }).count()) === 1 && (await A.getByRole("button", { name: "System" }).count()) === 0);
    await go(D, "settings"); await D.waitForTimeout(800);
    ok("admins see the setup check and admin tools in settings", (await D.getByRole("heading", { name: "Setup check" }).count()) === 1 && (await D.getByRole("button", { name: "Open admin" }).count()) === 1);
    ok("no errors verifying a coach", !A.errors.length && !D.errors.length, [...A.errors, ...D.errors].slice(0, 3).join("; "));
    for (const pg of [A, D]) await pg.context().close();
  },
  async site(browser) {
    // getfloorcall.com: product, pricing and about pages share one nav and fit a phone
    const p = await newPage(browser, { phone: true });
    for (const [file, h1] of [["about.html", null], ["pricing.html", "One price per team."], ["about-us.html", "Built from the bench."]]) {
      await p.goto(U + file); await p.waitForTimeout(300);
      ok(`${file}: loads and fits a phone`, (await overflow(p)) <= 0 && (!h1 || (await p.locator("h1").innerText()) === h1) && !/%[A-Z_]+%/.test(await p.content()), file);
    }
    await p.goto(U + "pricing.html");
    ok("pricing shows the trial, Team, Player, Club and Trainer", (await p.locator(".plan h3").allInnerTexts()).join(",") === "Free trial,Team,Player,Club,Trainer" && (await p.locator(".plan.main .price").innerText()).startsWith("$149"));
    await p.locator(".faq summary", { hasText: "When does the trial end?" }).click();
    ok("pricing questions open", (await p.locator(".faq details[open]").count()) === 1);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "site-pricing-phone.png"), fullPage: true });
    await p.context().close();
    // a coach previews what players see; the folded sidebar's sites menu shows names
    const A = await newPage(browser, { cloud: false, size: { width: 1280, height: 860 } });
    await go(A, "sample"); await A.waitForTimeout(800);
    await A.locator(".sm-btn").click(); await A.waitForTimeout(100);
    ok("the folded sidebar's sites menu shows each site's name", await A.locator(".sm-menu a", { hasText: "FloorCall Live" }).isVisible() && (await A.locator(".sm-menu a", { hasText: "getfloorcall.com" }).count()) === 0);
    await A.keyboard.press("Escape");
    ok("there's no What's New card on Home", (await A.getByText("What's new").count()) === 0);
    await go(A, "settings"); await A.getByRole("button", { name: "Preview", exact: true }).click(); await A.waitForTimeout(400);
    ok("the players' view hides every coaching tool", (await A.locator(".preview-bar").count()) === 1 && (await A.locator(".nav a.tab[href='#/track'], .nav a.tab[href='#/practice'], .nav a.tab[href='#/matchup'], .nav a.tab[href='#/film']").count()) === 0 && (await A.locator(".nav a.tab[href='#/stats']").count()) === 1);
    await go(A, "team"); await A.waitForTimeout(300);
    ok("players see the roster and results, nothing to edit", (await A.locator(".card", { hasText: "Roster" }).count()) === 1 && (await A.getByRole("button", { name: "Add player" }).count()) === 0 && (await A.locator("input").count()) === 0);
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "players-view.png"), fullPage: true });
    await go(A, "practice"); ok("a coaching page opens Home in the players' view", (await A.locator(".hm-head").count()) === 1);
    await A.getByRole("button", { name: "Exit preview" }).click(); await A.waitForTimeout(300);
    ok("exiting brings the coaching tools back", (await A.locator(".preview-bar").count()) === 0 && (await A.locator(".nav a.tab[href='#/track']").count()) === 1);
    ok("no errors on the site pages or in the players' view", !p.errors.length && !A.errors.length, [...p.errors, ...A.errors].slice(0, 3).join("; "));
    await A.context().close();
  },
  async sites() {
    // Each site has its own sign-in (app., academy., lessons. … are separate origins). A site the account isn't set up
    // for says so: "You don't have access". Here *.getfloorcall.com points at a local server that routes like worker/index.js.
    const http = require("http"), fs = require("fs"), PORT = 5213;
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".svg": "image/svg+xml" };
    const srv = http.createServer((q, r) => {
      const sub = (q.headers.host || "").split(".")[0], dir = ["live", "recruit", "beach", "academy", "lessons"].includes(sub) ? sub + "/" : "";
      let p0 = decodeURIComponent(q.url.split("?")[0]); if (p0.endsWith("/")) p0 += "index.html";
      let f = path.join(DIST, dir, p0); if (!fs.existsSync(f)) f = path.join(DIST, p0.replace(/^\/(\.\.\/)*/, "/"));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f));
    }).listen(PORT);
    const b = await chromium.launch({ args: ["--host-resolver-rules=MAP *.getfloorcall.com 127.0.0.1"] });
    const ctx = await b.newContext({ viewport: { width: 1200, height: 860 } });
    await ctx.addInitScript((url) => { try { localStorage.setItem("bs-cloud-config", JSON.stringify({ url, key: "anon" })); } catch {} }, `http://localhost:${MOCK_PORT}`);
    const at = (site) => `http://${site}.getfloorcall.com:${PORT}/`;
    const L = await ctx.newPage();
    await L.goto(at("lessons")); await L.waitForTimeout(800);
    await siteSignUp(L, "sites-kid@e2e.test", "athlete", "Kai Sites");
    const note = L.getByRole("alertdialog");
    ok("sites: an athlete no trainer has added is told they don't have access to Lessons", /don't have access to FloorCall Lessons/.test(await note.innerText().catch(() => "")));
    ok("sites: the note says what to do: code, coach or admin, plan", /code/i.test(await note.innerText()) && /Contact your trainer/.test(await note.innerText()) && /Check your plan/.test(await note.innerText()));
    { const ax = await a11y(L); ok("sites: access note controls all have names", !ax.length, ax.join(" | ")); }
    await note.getByRole("button", { name: /Enter the code/ }).click();
    ok("sites: 'Enter the code' closes the note onto the code form", (await L.getByRole("alertdialog").count()) === 0 && (await L.locator(".ls-page input").count()) >= 1);
    const A = await ctx.newPage(); await A.goto(at("academy")); await A.waitForTimeout(800);
    ok("sites: Academy has its own sign-in", (await A.locator(".sg .ma").count()) === 1);
    const P = await ctx.newPage(); await P.goto(at("app")); await P.waitForTimeout(800);
    { const si = P.getByRole("button", { name: /^Sign in$/ }); if (await si.count()) await si.first().click(); }
    await P.getByLabel("Email").fill("sites-kid@e2e.test"); await P.locator("#auth-pw").fill("secret-pass-1");
    await P.locator("form").getByRole("button", { name: /^Sign in$/ }).click(); await P.waitForTimeout(1500);
    ok("sites: a player's account on no team gets the note on the coaching app", /don't have access to the FloorCall coaching app/.test(await P.getByRole("alertdialog").innerText().catch(() => "")), (await P.locator("body").innerText()).slice(0, 300));
    ok("sites: the app note offers the team code box", (await P.locator(".an .cb").count()) === 1);
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "access-note.png") });
    await P.getByRole("button", { name: "Use a different account" }).click(); await P.waitForTimeout(800);
    ok("sites: 'Use a different account' signs out of this site only", (await P.getByRole("alertdialog").count()) === 0 && (await P.locator("#auth-pw").count()) === 1);
    await L.reload(); await L.waitForTimeout(800);
    ok("sites: still signed in on Lessons", (await L.locator(".sg .ma").count()) === 0);
    await b.close(); srv.close();
  },
  async calendar(browser) {
    // the Calendar tab: matches, practices and team events by month and by week, on a laptop and a phone
    const p = await newPage(browser, { size: { width: 1366, height: 900 } }); await go(p, "sample"); await p.waitForTimeout(900);
    await go(p, "calendar"); await p.waitForTimeout(500);
    ok("calendar: a month of the season with matches", (await p.locator(".cal-month").count()) === 1 && (await p.locator(".cal-item.k-match").count()) > 0, String(await p.locator(".cal-item").count()));
    const before = await p.locator(".cal-title").innerText();
    await p.getByRole("button", { name: "Previous month" }).click();
    ok("calendar: moves by month", (await p.locator(".cal-title").innerText()) !== before);
    await p.getByRole("button", { name: "Today" }).click();
    await p.getByRole("button", { name: "Add event" }).click();
    await p.getByLabel("What").fill("Team dinner"); await p.getByLabel("Time (optional)").fill("18:30"); await p.getByRole("button", { name: "Add event", exact: true }).last().click(); await p.waitForTimeout(300);
    ok("calendar: a team event shows on today", (await p.locator(".cal-day.today .cal-item.k-event", { hasText: "Team dinner" }).count()) === 1);
    await p.getByRole("button", { name: "Week", exact: true }).click(); await p.waitForTimeout(200);
    ok("calendar: the week view shows times and details", (await p.locator(".cal-week .cal-day").count()) === 7 && /6:30pm/.test(await p.locator(".cal-day.today").innerText()));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "calendar-week.png"), fullPage: true });
    await p.getByRole("button", { name: "Month", exact: true }).click(); await p.waitForTimeout(200);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "calendar-month.png"), fullPage: true });
    const ph = await newPage(browser, { phone: true }); await go(ph, "sample"); await ph.waitForTimeout(900); await go(ph, "calendar"); await ph.waitForTimeout(500);
    ok("calendar fits a phone", (await overflow(ph)) <= 0);
    const busy = ph.locator(".cal-day:has(.cal-item) button.cal-num").first();
    if (await busy.count()) { await busy.click(); ok("calendar: on a phone, tapping a day lists what's on it", (await ph.locator(".cal-pick .cal-item").count()) > 0); }
    if (process.env.SHOTS) await ph.screenshot({ path: path.join(process.env.SHOTS, "calendar-phone.png"), fullPage: true });
    // a day view, places with a map link, and two teams on one calendar
    const q = await newPage(browser, { size: { width: 1280, height: 900 } }); await go(q, "home"); await q.waitForTimeout(500);
    { const w = q.getByRole("button", { name: "Use without an account" }); if (await w.count()) { await w.click(); await q.waitForTimeout(300); } }
    await q.getByLabel("Team name").fill("North 16 Blue"); await q.getByLabel("Level").fill("16U").catch(() => {}); await q.getByRole("button", { name: "Create team" }).click(); await q.waitForTimeout(600);
    await go(q, "team"); await q.getByLabel(/^Home gym/).fill("North High Gym, 100 Main St"); await q.getByLabel(/^Home gym/).blur();
    await go(q, "calendar"); await q.waitForTimeout(300);
    await q.getByRole("button", { name: "Add event" }).click(); await q.getByLabel("What").fill("Film session"); await q.getByLabel("Where (optional)").fill("Room 12, North High"); await q.getByLabel("Time (optional)").fill("16:00");
    await q.getByRole("button", { name: "Add event", exact: true }).last().click(); await q.waitForTimeout(200);
    await go(q, "team/new"); await q.waitForTimeout(300); await q.locator("#nt-name").fill("North 14 White"); await q.locator("#nt-level").fill("14U"); await q.getByRole("button", { name: "Create team" }).click(); await q.waitForTimeout(600);
    await go(q, "calendar"); await q.waitForTimeout(300);
    await q.getByRole("button", { name: "Add event" }).click(); await q.getByLabel("What").fill("Team photos"); await q.getByRole("button", { name: "Add event", exact: true }).last().click(); await q.waitForTimeout(200);
    ok("calendar: one team at a time by default", (await q.locator(".cal-day.today .cal-item").count()) === 1);
    await q.getByLabel("Teams on the calendar").selectOption("all"); await q.waitForTimeout(200);
    ok("calendar: 'All my teams' shows both teams, each item tagged with its team", (await q.locator(".cal-day.today .cal-item").count()) === 2 && (await q.locator(".cal-day.today .cal-tm").allInnerTexts()).sort().join(",") === "14U,16U");
    await q.getByRole("button", { name: "Day", exact: true }).click(); await q.waitForTimeout(200);
    ok("calendar: a day view lists today's items", (await q.locator(".cal-dayview .cal-entry").count()) === 2);
    const map = q.locator(".cal-dayview a.cal-map");
    ok("calendar: a place links to a map", (await map.count()) === 1 && /google\.com\/maps\/search/.test(await map.getAttribute("href")) && /Room 12/.test(await map.innerText()));
    await q.getByLabel("Teams on the calendar").selectOption("pick"); await q.waitForTimeout(200);
    await q.locator(".cal-teamchk", { hasText: "North 14 White" }).locator("input").uncheck().catch(() => {}); await q.waitForTimeout(200);
    ok("calendar: or pick which teams", (await q.locator(".cal-dayview .cal-entry").count()) >= 1);
    { const ax = await a11y(q); ok("calendar controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await q.screenshot({ path: path.join(process.env.SHOTS, "calendar-day.png"), fullPage: true });
    ok("no errors on the calendar", !p.errors.length && !ph.errors.length && !q.errors.length, [...p.errors, ...ph.errors, ...q.errors].slice(0, 3).join("; "));
    for (const x of [p, ph, q]) await x.context().close();
  },
  async trends(browser) {
    // a player's key numbers for their position, each with a trend line and last 3 / 5 / 10 / season
    const p = await newPage(browser, { size: { width: 1366, height: 900 } }); await go(p, "sample"); await p.waitForTimeout(900);
    await go(p, "stats"); await p.waitForTimeout(500); await p.getByRole("button", { name: /^Season/ }).first().click(); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.waitForTimeout(400);
    await p.locator("tr.click").first().click(); await p.waitForTimeout(500);
    const tiles = p.locator(".tt-tile");
    ok("player trends: key numbers as tiles with a trend line", (await tiles.count()) >= 3 && (await p.locator(".tt-tile .tt-spark path").count()) >= 2, String(await tiles.count()));
    ok("player trends: some show better or worse lately", (await p.locator(".tt-chip.good, .tt-chip.bad, .tt-chip.flat").count()) >= 1);
    await tiles.first().click(); await p.waitForTimeout(300);
    ok("player trends: a tile opens last 5 by default", (await p.locator(".tt-detail .tt-wins button[aria-pressed=true]").innerText()) === "Last 5" && (await p.locator(".tt-detail svg").count()) >= 1);
    await p.locator(".tt-wins").getByRole("button", { name: "Last 3" }).click(); await p.waitForTimeout(200);
    ok("player trends: and switches to the last 3 matches", /Last 3 matches/.test(await p.locator(".tt-facts").innerText()));
    await p.locator(".tt-wins").getByRole("button", { name: "Season" }).click(); await p.waitForTimeout(200);
    ok("player trends: or the season, with the best and lowest match", /Best/.test(await p.locator(".tt-facts").innerText()));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "trends.png"), fullPage: false });
    const ph = await newPage(browser, { phone: true }); await go(ph, "sample"); await ph.waitForTimeout(900); await go(ph, "stats"); await ph.waitForTimeout(400); await ph.getByRole("button", { name: /^Season/ }).first().click(); await ph.getByRole("button", { name: "Players", exact: true }).click(); await ph.waitForTimeout(400);
    await ph.locator("tr.click").first().click(); await ph.waitForTimeout(500);
    ok("player trends fit a phone", (await overflow(ph)) <= 0);
    if (process.env.SHOTS) await ph.screenshot({ path: path.join(process.env.SHOTS, "trends-phone.png"), fullPage: true });
    ok("no errors on player trends", !p.errors.length && !ph.errors.length, [...p.errors, ...ph.errors].slice(0, 3).join("; "));
    for (const x of [p, ph]) await x.context().close();
  },
  async wheel(browser) {
    // Lineup → rotation wheel: who serves, front row, setter and libero in each rotation
    const p = await newPage(browser, { size: { width: 1366, height: 900 } }); await go(p, "sample"); await p.waitForTimeout(900);
    await go(p, "lineup"); await p.waitForTimeout(500);
    const w = p.locator(".rw");
    ok("rotation wheel: on the lineup page with six players", (await w.count()) === 1 && (await w.locator(".rw-node").count()) === 6);
    const s1 = await w.locator(".rw-info dl div", { hasText: "Serving" }).innerText();
    await w.getByRole("button", { name: "2", exact: true }).click(); await p.waitForTimeout(600);
    const s2 = await w.locator(".rw-info dl div", { hasText: "Serving" }).innerText();
    ok("rotation wheel: the next rotation has the next server", (await w.locator("h3").innerText()) === "Rotation 2" && s1 !== s2, s1 + " / " + s2);
    if (process.env.SHOTS) await w.screenshot({ path: path.join(process.env.SHOTS, "wheel.png") });
    const ph = await newPage(browser, { phone: true }); await go(ph, "sample"); await ph.waitForTimeout(900); await go(ph, "lineup"); await ph.waitForTimeout(500);
    ok("rotation wheel fits a phone", (await overflow(ph)) <= 0);
    if (process.env.SHOTS) await ph.locator(".rw").screenshot({ path: path.join(process.env.SHOTS, "wheel-phone.png") });
    ok("no errors on the wheel", !p.errors.length && !ph.errors.length, [...p.errors, ...ph.errors].slice(0, 3).join("; "));
    for (const x of [p, ph]) await x.context().close();
  },
  async drills(browser) {
    // the drill library: levels and filters; a coach sends a drill to their players, who see it as "From your coach"
    const C = await newPage(browser, { size: { width: 1366, height: 900 } });
    await go(C, "account/signup"); { const ca = C.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await C.getByLabel("Email").fill("drill-coach@e2e.test"); await C.locator("#auth-pw").fill("secret-pass-1"); await C.locator("#auth-name").fill("Drew Coach"); await C.locator(".auth-agree input").first().check();
    await C.getByRole("button", { name: "Create account" }).click(); await C.waitForTimeout(800);
    await C.getByLabel("Team name").fill("Drill Prep"); await C.getByRole("button", { name: "Create team" }).click(); await C.waitForTimeout(800);
    await go(C, "team"); { const sy = C.getByRole("button", { name: "Sync this team" }); if (await sy.count()) { await sy.click(); await C.waitForTimeout(1200); } }
    await C.getByRole("button", { name: "Invite view-only" }).click(); await C.waitForTimeout(400);
    const vcode = (await C.locator(".hint b").first().innerText()).trim();
    ok("drills: the coach has a view-only code for players", /^[A-Z0-9]{4,}$/.test(vcode), vcode);
    await C.goto(U + "academy/#/coaches/drills"); await C.waitForTimeout(800);
    const total = +(await C.locator(".ac-count").innerText()).match(/\d+/)[0];
    ok("drills: the library has well over a hundred drills", total >= 110, String(total));
    ok("drills: every level is there", (await C.locator(".ac-lvlsec").count()) === 3);
    await C.getByRole("group", { name: "Skill" }).getByRole("button", { name: "Blocking" }).click();
    await C.getByRole("group", { name: "Level" }).getByRole("button", { name: "Beginner" }).click(); await C.waitForTimeout(200);
    const names = await C.locator(".ac-drill-name b").allInnerTexts();
    ok("drills: filters by skill and level", names.length >= 2 && names.includes("Block footwork") && !names.includes("Swing blocking"), names.join(", "));
    await C.getByLabel("Search drills").fill("seam"); await C.getByRole("group", { name: "Skill" }).getByRole("button", { name: "All skills" }).click(); await C.getByRole("group", { name: "Level" }).getByRole("button", { name: "All levels" }).click(); await C.waitForTimeout(200);
    ok("drills: search finds drills by what's in them", (await C.locator(".ac-drill").count()) >= 2);
    await C.getByLabel("Search drills").fill("");
    // send a drill to the players
    await C.locator(".ac-drill", { hasText: "Platform and freeze" }).locator(".ac-drill-hd").click();
    await C.getByRole("button", { name: "Send to your players" }).click(); await C.waitForTimeout(600);
    ok("drills: the coach sends a drill to their players", (await C.locator(".ac-drill", { hasText: "Platform and freeze" }).locator(".ac-sentchip").count()) === 1);
    if (process.env.SHOTS) await C.screenshot({ path: path.join(process.env.SHOTS, "library-coach.png"), fullPage: false });
    // a player joins the team with the code in Academy, and sees it
    const P = await newPage(browser, { phone: true });
    await P.goto(U + "academy/"); await P.waitForTimeout(500); await siteSignUp(P, "drill-player@e2e.test", "athlete", "Pia Player");
    await P.getByRole("button", { name: "Have a code from your coach or trainer?" }).click();
    await P.getByLabel("Code from your coach or trainer").fill(vcode); await P.getByRole("button", { name: "Join", exact: true }).click(); await P.waitForTimeout(800);
    ok("drills: a team code in Academy joins the team", (await P.locator(".cb-cov").innerText()).includes("Drill Prep"));
    await P.reload(); await P.waitForTimeout(900);
    ok("drills: the player sees what their coach sent on Academy's home page", (await P.locator(".ac-home-fc .ac-drill", { hasText: "Platform and freeze" }).count()) === 1);
    await P.goto(U + "academy/#/players/drills"); await P.waitForTimeout(700);
    ok("drills: and at the top of the library", (await P.locator(".ac-fromcoach .ac-drill", { hasText: "Platform and freeze" }).count()) === 1 && (await overflow(P)) <= 0);
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "library-player.png"), fullPage: true });
    ok("no errors in the drill library", !C.errors.length && !P.errors.length, [...C.errors, ...P.errors].slice(0, 3).join("; "));
    for (const x of [C, P]) await x.context().close();
  },
  async notes(browser) {
    // Notes: a coach writes to the team, to a position group and to one player; players read only what's theirs
    const C = await newPage(browser, { size: { width: 1366, height: 900 } });
    await go(C, "account/signup"); { const ca = C.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await C.getByLabel("Email").fill("note-coach@e2e.test"); await C.locator("#auth-pw").fill("secret-pass-1"); await C.locator("#auth-name").fill("Nora Coach"); await C.locator(".auth-agree input").first().check();
    await C.getByRole("button", { name: "Create account" }).click(); await C.waitForTimeout(800);
    await C.getByLabel("Team name").fill("Note Squad"); await C.getByRole("button", { name: "Create team" }).click(); await C.waitForTimeout(800);
    await go(C, "team"); await C.getByRole("button", { name: "Paste list" }).click(); await C.locator("textarea").first().fill("7 Maya Chen OH\n9 Riley Park OH\n12 Sofia Nguyen MB\n3 Lily Torres L"); await C.getByRole("button", { name: "Add players" }).click(); await C.waitForTimeout(300);
    { const sy = C.getByRole("button", { name: "Sync this team" }); if (await sy.count()) { await sy.click(); await C.waitForTimeout(1500); } }
    await C.getByRole("button", { name: "Invite view-only" }).click(); await C.waitForTimeout(400);
    const vcode = (await C.locator(".hint b").first().innerText()).trim();
    // two families join
    const join = async (email, name) => { const x = await newPage(browser, { phone: true }); await x.goto(U + "academy/"); await x.waitForTimeout(500); await siteSignUp(x, email, "athlete", name);
      await x.getByRole("button", { name: "Have a code from your coach or trainer?" }).click(); await x.getByLabel("Code from your coach or trainer").fill(vcode); await x.getByRole("button", { name: "Join", exact: true }).click(); await x.waitForTimeout(800); return x; };
    const M = await join("maya-note@e2e.test", "Maya Chen"), S = await join("sofia-note@e2e.test", "Sofia Nguyen");
    await go(C, "notes"); await C.waitForTimeout(800);
    ok("notes: a Notes tab for coaches", (await C.getByRole("heading", { name: "Notes", level: 1 }).count()) === 1 && (await C.locator(".nt-compose").count()) === 1);
    // who's who
    await C.locator(".nt-who").getByRole("button", { name: /Link 2/ }).click();
    await C.getByLabel("Player for maya-note@e2e.test").selectOption({ label: "#7 Maya Chen" }); await C.waitForTimeout(400);
    await C.getByLabel("Player for sofia-note@e2e.test").selectOption({ label: "#12 Sofia Nguyen" }); await C.waitForTimeout(400);
    ok("notes: the coach links each account to a player", /All 2 player and parent accounts are linked/.test(await C.locator(".nt-who").innerText()));
    // 1. a practice note to the team
    const comp = C.locator(".nt-compose");
    await comp.getByRole("radio", { name: "Practice" }).click().catch(async () => comp.getByRole("button", { name: "Practice" }).click());
    await comp.getByLabel(/^Label/).fill("Tuesday practice"); await comp.getByLabel(/^Title/).fill("Serve receive"); await comp.getByLabel("Note", { exact: true }).fill("Great energy. Passers: hips low, platform early.");
    await comp.getByRole("button", { name: "Send to the team" }).click(); await C.waitForTimeout(600);
    // 2. to the outsides (a position group)
    await comp.getByRole("radio", { name: "Film" }).click().catch(async () => comp.getByRole("button", { name: "Film" }).click());
    await comp.getByRole("radio", { name: "Players" }).click().catch(async () => comp.getByRole("button", { name: "Players" }).click());
    await comp.getByRole("group", { name: "Position groups" }).getByRole("button", { name: /Outsides/ }).click();
    ok("notes: a position group picks its players in one tap", (await comp.locator(".nt-players input:checked").count()) === 2);
    await comp.getByLabel("Note", { exact: true }).fill("Scouting Central: their middle doesn't close the block. Swing the seam.");
    await comp.getByRole("button", { name: "Send to Outsides" }).click(); await C.waitForTimeout(600);
    // 3. to one player, from her page
    await C.goto(U + "#/notes/" + encodeURIComponent(await C.evaluate(() => new Promise((r) => { const q = indexedDB.open("bench-stats"); q.onsuccess = () => { const tx = q.result.transaction("players"); const all = tx.objectStore("players").getAll(); all.onsuccess = () => r(all.result.find((p) => p.first === "Sofia").id); }; })))); await C.waitForTimeout(600);
    ok("notes: opening notes for a player starts a note to her", (await C.locator(".nt-players input:checked").count()) === 1);
    await C.locator(".nt-compose").getByLabel("Note", { exact: true }).fill("Close the block faster on the right side.");
    await C.locator(".nt-compose").getByRole("button", { name: "Send to Sofia" }).click(); await C.waitForTimeout(600);
    ok("notes: the coach sees all three, with who each went to", (await C.locator(".nt").count()) === 3 && /To Outsides/.test(await C.locator(".nt-list").innerText()) && /To the team/.test(await C.locator(".nt-list").innerText()));
    { const ax = await a11y(C); ok("notes: controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await C.screenshot({ path: path.join(process.env.SHOTS, "notes-coach.png"), fullPage: true });
    // the players
    await M.goto(U + "#/notes"); await M.waitForTimeout(1500);
    const mt = await M.locator(".nt-list").innerText().catch(() => "");
    ok("notes: Maya (an outside) reads the team note and the outsides' note", /Serve receive/.test(mt) && /Swing the seam/.test(mt), mt.slice(0, 200));
    ok("notes: but not a note for another player", !/Close the block/.test(mt));
    ok("notes: no way to reply or write", (await M.locator(".nt-compose").count()) === 0 && (await M.locator("textarea").count()) === 0);
    ok("notes: new notes are marked", (await M.locator(".nt.new").count()) === 2);
    if (process.env.SHOTS) await M.screenshot({ path: path.join(process.env.SHOTS, "notes-player.png"), fullPage: true });
    await S.goto(U + "#/notes"); await S.waitForTimeout(1500);
    const st = await S.locator(".nt-list").innerText().catch(() => "");
    ok("notes: Sofia reads her own note and the team note, not the outsides'", /Close the block/.test(st) && /Serve receive/.test(st) && !/seam/.test(st), st.slice(0, 200));
    ok("notes: a phone shows it without sideways scrolling", (await overflow(S)) <= 0);
    await C.reload(); await C.waitForTimeout(900);
    ok("notes: the coach sees who has read the team note", /Read by 2/.test(await C.locator(".nt", { hasText: "Serve receive" }).innerText()));
    ok("no errors in notes", !C.errors.length && !M.errors.length && !S.errors.length, [...C.errors, ...M.errors, ...S.errors].slice(0, 3).join("; "));
    for (const x of [C, M, S]) await x.context().close();
  },
  async account(browser) {
    // Account settings on every site: name, sign-in email, password, email news, sign out, delete
    const A = await newPage(browser, { phone: true });
    await A.goto(U + "academy/"); await A.waitForTimeout(500); await siteSignUp(A, "acct-kid@e2e.test", "athlete", "Ari Account");
    await A.getByRole("button", { name: "Account settings" }).click(); await A.waitForTimeout(200);
    const d = A.getByRole("dialog", { name: "Account" });
    ok("account: the header's account button opens Account settings", (await d.count()) === 1 && /acct-kid@e2e\.test/.test(await d.innerText()) && /Athlete account/.test(await d.innerText()));
    { const ax = await a11y(A); ok("account: controls all have names", !ax.length, ax.join(" | ")); }
    ok("account: the dialog fits a phone", (await overflow(A)) <= 0);
    await d.getByLabel("Your name").fill("Ari Accountant"); await d.getByRole("button", { name: "Save" }).click(); await A.waitForTimeout(300);
    ok("account: the name is saved", /Name saved/.test(await d.innerText()) && /Ari Accountant/.test(await d.locator(".ap-who").innerText()));
    await d.getByLabel("New password", { exact: true }).fill("short"); ok("account: a short password is caught before sending", /at least 8/.test(await d.innerText()));
    await d.getByLabel("New password", { exact: true }).fill("brand-new-pass"); await d.getByLabel("New password again").fill("brand-new-pass");
    await d.getByRole("button", { name: "Change password" }).click(); await A.waitForTimeout(300);
    ok("account: the password changes", /Password changed/.test(await d.innerText()));
    await d.getByLabel("New email").fill("ari-new@e2e.test"); await d.getByRole("button", { name: "Change email" }).click(); await A.waitForTimeout(300);
    ok("account: changing the email sends a confirmation link", /Check ari-new@e2e\.test/.test(await d.innerText()));
    if (process.env.SHOTS) await A.screenshot({ path: path.join(process.env.SHOTS, "account-dialog.png"), fullPage: true });
    await d.getByRole("button", { name: "Sign out of this site" }).click(); await A.waitForTimeout(800);
    ok("account: sign out returns to the sign-in", (await A.locator(".sg .ma").count()) === 1);
    // the new password works
    await A.locator(".ma").getByRole("button", { name: "Sign in" }).first().click(); await A.getByLabel("Email", { exact: true }).fill("acct-kid@e2e.test"); await A.getByLabel("Password", { exact: true }).fill("brand-new-pass");
    await A.locator(".ma").getByRole("button", { name: "Sign in" }).last().click(); await A.waitForTimeout(600); if (await A.getByLabel(/code/i).count()) await deviceCode(A, "acct-kid@e2e.test"); await A.waitForTimeout(800);
    ok("account: signs back in with the new password", (await A.locator(".sg .ma").count()) === 0, (await A.locator("body").innerText()).slice(0, 200));
    // the coaching app's Account page uses the same panel
    const C = await newPage(browser, { size: { width: 1280, height: 900 } });
    await go(C, "account/signup"); { const ca = C.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await C.getByLabel("Email").fill("acct-coach@e2e.test"); await C.locator("#auth-pw").fill("secret-pass-1"); await C.locator("#auth-name").fill("Cam Coach"); await C.locator(".auth-agree input").first().check();
    await C.getByRole("button", { name: "Create account" }).click(); await C.waitForTimeout(800);
    await C.getByLabel("Team name").fill("Acct Team"); await C.getByRole("button", { name: "Create team" }).click(); await C.waitForTimeout(600);
    await go(C, "account"); await C.waitForTimeout(300);
    ok("account: the app's Account page has the same settings", (await C.getByRole("button", { name: "Change password" }).count()) === 1 && (await C.getByText("Delete your account").count()) === 1);
    ok("no errors in account settings", !A.errors.length && !C.errors.length, [...A.errors, ...C.errors].slice(0, 3).join("; "));
    for (const x of [A, C]) await x.context().close();
  },
  async strength(browser) {
    // Academy → Strength and jumping: safety first, sample weeks, and lifts, jumps and prevention routines by level
    const p = await newPage(browser, { phone: true });
    await p.goto(U + "academy/#/players"); await p.waitForTimeout(500);
    if (await p.locator(".sg .ma").count()) await siteSignUp(p, "strength-kid@e2e.test", "athlete", "Sam Strong");
    await p.locator(".ac-strcard").click(); await p.waitForTimeout(400);
    ok("strength: Academy has a strength and jumping section", (await p.getByRole("heading", { name: "Strength and jumping", level: 1 }).count()) === 1);
    ok("strength: it opens with how to train safely", /doctor/.test(await p.locator(".ac-str-safe").innerText()));
    const n = await p.locator(".ac-str .ac-drill").count();
    ok("strength: dozens of exercises", n >= 40, String(n));
    await p.getByRole("group", { name: "What it's for" }).getByRole("button", { name: /Plyometrics/ }).click(); await p.waitForTimeout(200);
    const names = await p.locator(".ac-str .ac-drill-name b").allInnerTexts();
    ok("strength: filters to plyometrics", names.some((x) => /Box jump/.test(x)) && !names.some((x) => /Goblet squat/.test(x)), names.join(", "));
    await p.getByRole("group", { name: "Level" }).getByRole("button", { name: "Advanced" }).click(); await p.waitForTimeout(200);
    ok("strength: advanced jumps say to use a coach", /qualified coach|strength base/.test(await p.locator(".ac-str").innerText()));
    await p.getByRole("group", { name: "Plan" }).getByRole("button", { name: "Off-season" }).click();
    ok("strength: sample weeks by level", /Day 1/.test(await p.locator(".ac-str-week").innerText()));
    ok("strength fits a phone", (await overflow(p)) <= 0);
    { const ax = await a11y(p); ok("strength controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "strength.png"), fullPage: true });
    ok("no errors on strength", !p.errors.length, p.errors.slice(0, 3).join("; "));
    await p.context().close();
  },
  async contact(browser) {
    // the Contact page: FAQ, a form that reaches the admin inbox, the email address, and links from every site
    const p = await newPage(browser, { phone: true, cloud: true });
    await p.goto(U + "contact.html?from=academy&topic=bug"); await p.waitForTimeout(500);
    ok("contact page: the form, the email and answers", (await p.locator("#contact").count()) === 1 && (await p.locator('.ct-side a[href^="mailto:support@getfloorcall.com"]').count()) === 1 && (await p.locator(".faq details").count()) >= 6);
    ok("contact page: a Help link picks the topic", (await p.locator("select[name=topic]").inputValue()) === "bug");
    await p.getByRole("button", { name: "Send message" }).click(); await p.waitForTimeout(200);
    ok("contact page: asks for a reply address first", (await p.locator(".ct-err").innerText()).includes("email address"));
    await p.getByLabel("Your name").fill("Dana Coach"); await p.getByLabel("Email for our reply").fill("dana@e2e.test");
    await p.getByLabel("Message").fill("The score froze in set 2 on my iPad."); await p.getByRole("button", { name: "Send message" }).click(); await p.waitForTimeout(700);
    ok("contact page: sends", await p.locator(".ct-sent").isVisible() && !(await p.locator("#contact").isVisible()) && (await p.locator(".ct-to").innerText()) === "dana@e2e.test");
    ok("contact page fits a phone", (await overflow(p)) <= 0);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "contact.png"), fullPage: true });
    // every site links to it
    for (const [site, sel] of [["live/", ".lv-foot"], ["beach/", ".bv-foot"], ["academy/", ".ac-foot"], ["lessons/", ".ls-foot"], ["recruit/", ".rc-foot"], ["pricing.html", "footer"], ["about.html", "footer"]]) {
      await p.goto(U + site); await p.waitForTimeout(300);
      ok(`${site} links to Contact`, (await p.locator(`${sel} a[href*="contact.html"]`).count()) >= 1);
    }
    // the admin reads it, replies by email and marks it done
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("inbox@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Inbox"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(800);
    await A.getByLabel("Team name").fill("Inbox Team"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(600);
    await fetch(`http://localhost:${MOCK_PORT}/__mock/make-admin?email=inbox%40e2e.test`, { headers: { apikey: "anon" } });
    await A.reload(); await go(A, "admin"); await A.waitForTimeout(900);
    const box = A.locator(".admin-msgs li", { hasText: "The score froze" });
    ok("the admin console shows the message, where it came from, and a reply link", (await box.count()) === 1 && (await box.innerText()).includes("from academy") && (await box.locator('a[href^="mailto:dana@e2e.test"]').count()) === 1);
    await box.getByRole("button", { name: "Mark done" }).click(); await A.waitForTimeout(400);
    ok("and marks it done", (await A.locator(".admin-msgs li").count()) === 0);
    // Settings → Help opens the contact page with a problem report
    ok("the app's Help links to Contact", (await (async () => { await go(A, "settings"); await A.waitForTimeout(300); return A.locator('a[href*="contact.html?from=app"]').count(); })()) >= 1);
    for (const x of [p, A]) await x.context().close();
  },
  async lessons(browser) {
    // a trainer: athletes, a past private lesson with reps, an open group session, a public clinic
    const T = await newPage(browser, { size: { width: 1280, height: 900 } });
    await T.goto(U + "lessons/"); await T.waitForTimeout(500);
    await siteSignUp(T, "trainer@e2e.test", "coach", "Tess Trainer");
    ok("lessons opens on an empty schedule that starts with athletes", (await T.locator(".ls-start").count()) === 1 && (await T.locator(".site-switch a").count()) === 6);
    await T.getByRole("link", { name: "Add athletes" }).click(); await T.waitForTimeout(300);
    const addAthlete = async (name, grad) => { await T.getByLabel("Name", { exact: true }).fill(name); await T.getByLabel("Grad year").fill(grad); await T.getByRole("button", { name: "Add athlete" }).click(); await T.waitForTimeout(400); };
    await addAthlete("Mia Torres", "2028"); await addAthlete("Ava Kim", "2029");
    ok("athletes from anywhere are added", (await T.locator(".ls-athletes li").count()) === 2);
    await T.locator(".ls-athletes a", { hasText: "Mia Torres" }).click(); await T.waitForTimeout(300);
    await T.getByRole("button", { name: "Make an invite code" }).click(); await T.waitForTimeout(400);
    const code = (await T.locator(".ls-code-big").innerText()).trim();
    ok("each athlete gets a six-letter code", /^[A-Z2-9]{6}$/.test(code), code);
    // a lesson last week, with reps
    const d = new Date(Date.now() - 7 * 864e5), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await T.goto(U + "lessons/#/new"); await T.waitForTimeout(300);
    await T.getByLabel("Date").fill(ymd); await T.getByLabel("Where").fill("Northside gym");
    await T.getByRole("button", { name: "Passing" }).click(); await T.getByRole("button", { name: "Serving" }).click();
    await T.locator(".ls-pick-list label", { hasText: "Mia Torres" }).locator("input").check();
    await T.getByLabel("Note for athletes and parents").fill("Bring kneepads"); await T.getByLabel(/Private notes/).fill("watch her platform angle");
    await T.getByRole("button", { name: "Schedule", exact: true }).click(); await T.waitForTimeout(600);
    ok("a private lesson is scheduled", /#\/s\/ls_/.test(T.url()) && (await T.locator("h1").innerText()) === "Private lesson");
    await T.getByRole("link", { name: "Count reps" }).click(); await T.waitForTimeout(300);
    for (const k of ["3", "3", "3", "2"]) await T.getByRole("button", { name: "Passing: " + k, exact: true }).click();
    await T.getByRole("button", { name: "Serving: Ace" }).click(); await T.getByRole("button", { name: "Serving: Error" }).click();
    await T.getByRole("button", { name: "Undo" }).click(); await T.waitForTimeout(900);
    ok("counting reps shows the number as you go", (await T.locator(".ls-skill", { hasText: "Passing" }).locator(".ls-skill-hd b").innerText()) === "2.75" && (await T.locator(".ls-skill", { hasText: "Serving" }).locator(".ls-skill-hd b").innerText()) === "100%");
    ok("and saves", (await T.locator(".ls-stat-title small").innerText()) === "Saved");
    await T.getByRole("button", { name: "Done" }).click(); await T.waitForTimeout(600);
    ok("the session shows the reps and that she came", (await T.locator(".ls-reps").innerText()).includes("2.75") && await T.getByLabel("Mia Torres came").isChecked());
    await T.getByLabel("Mia Torres paid").check(); await T.waitForTimeout(500);
    ok("paid is tracked", await T.getByLabel("Mia Torres paid").isChecked());
    if (process.env.SHOTS) await T.screenshot({ path: path.join(process.env.SHOTS, "ls-session.png"), fullPage: true });
    // an open group session athletes can book, and a public clinic
    await T.goto(U + "lessons/#/new"); await T.waitForTimeout(300);
    await T.locator(".ls-kinds label", { hasText: "Small group" }).click(); await T.getByLabel("Spots").fill("4"); await T.getByLabel("Name (optional)").fill("Passing group");
    await T.locator(".ls-switches label", { hasText: "Athletes can book this" }).locator("input").check();
    await T.getByLabel("Repeat").selectOption("3"); await T.getByRole("button", { name: "Schedule 3 sessions" }).click(); await T.waitForTimeout(800);
    await T.goto(U + "lessons/#/new"); await T.waitForTimeout(300);
    await T.locator(".ls-kinds label", { hasText: "Clinic" }).click(); await T.getByLabel("Spots").fill("2"); await T.getByLabel("Name (optional)").fill("Serve clinic"); await T.getByLabel("Price (optional)").fill("$40");
    await T.locator(".ls-switches label", { hasText: "Public sign-up page" }).locator("input").check();
    if (process.env.SHOTS) await T.screenshot({ path: path.join(process.env.SHOTS, "ls-new.png"), fullPage: true });
    await T.getByRole("button", { name: "Schedule", exact: true }).click(); await T.waitForTimeout(600);
    const clinic = (await T.locator(".ls-link code").innerText()).trim();
    ok("a public clinic has a link to share", /#\/c\/[A-Z2-9]{6}$/.test(clinic), clinic);
    await T.goto(U + "lessons/"); await T.waitForTimeout(500);
    ok("the schedule lists what's coming and the past lesson", (await T.locator(".ls-day:not(.ls-past) .ls-row").count()) === 4 && (await T.locator(".ls-past .ls-row").count()) === 1);
    if (process.env.SHOTS) await T.screenshot({ path: path.join(process.env.SHOTS, "ls-schedule.png"), fullPage: true });
    await T.goto(U + "lessons/#/calendar"); await T.waitForTimeout(500);
    ok("lessons: the trainer's calendar shows sessions and opens them", (await T.locator(".cal-item").count()) >= 1 && /#\/s\//.test(await T.locator(".cal-item").first().getAttribute("href")));
    await T.getByRole("button", { name: "Week", exact: true }).click(); await T.waitForTimeout(200);
    if (process.env.SHOTS) await T.screenshot({ path: path.join(process.env.SHOTS, "ls-calendar.png"), fullPage: true });
    // the trainer also coaches a team: one tap adds a player from the coaching app
    await go(T, "team"); await T.waitForTimeout(800);
    if (await T.locator("#nt-name").count()) { await T.locator("#nt-name").fill("Trainer Club 16s"); await T.getByRole("button", { name: "Create team" }).click(); await T.waitForTimeout(800); }
    await go(T, "team"); await T.getByRole("button", { name: "Paste list" }).click(); await T.locator("textarea").first().fill("7 Maya Chen OH"); await T.getByRole("button", { name: "Add players" }).click(); await T.waitForTimeout(400);
    await T.getByRole("button", { name: "View", exact: true }).first().click(); await T.waitForTimeout(500);
    await T.getByRole("button", { name: "Add to FloorCall Lessons" }).click(); await T.waitForTimeout(700);
    ok("a coach adds a team player to FloorCall Lessons from the player's page", (await T.locator(".toast").innerText()).includes("Maya is in FloorCall Lessons"));
    await T.goto(U + "lessons/#/athletes"); await T.waitForTimeout(700);
    ok("and she's in the trainer's athletes, with her position and club", (await T.locator(".ls-athletes li", { hasText: "Maya Chen" }).innerText()).includes("Trainer Club 16s"));
    // a parent joins with Mia's code and sees only Mia's lessons
    const P = await newPage(browser, { phone: true });
    await P.goto(U + "lessons/#/join/" + code); await P.waitForTimeout(500);
    await siteSignUp(P, "mia.parent@e2e.test", "parent", "Dana Torres");
    ok("the join link fills in the code", (await P.getByLabel("Code from your trainer").inputValue()) === code && await P.getByLabel("I'm a parent").isChecked());
    await P.getByRole("button", { name: "Join", exact: true }).click(); await P.waitForTimeout(900);
    const pt = await P.locator(".ls-page").innerText();
    ok("the parent sees Mia's lessons", pt.includes("Mia's lessons") && pt.includes("Bring kneepads") && (await P.locator(".ls-prog-card").count()) === 2);
    ok("but not the trainer's private notes or other athletes", !/watch her platform|Ava Kim/.test(pt));
    ok("and can book the open group times", (await P.locator(".ls-open").count()) === 3);
    await P.locator(".ls-open").first().getByRole("button", { name: "Book" }).click(); await P.waitForTimeout(700);
    ok("the parent's calendar shows the booked session and open times", (await P.locator(".cal-item, .cal-day:has(.cal-item)").count()) >= 1);
    ok("booking puts it in Coming up", (await P.locator(".ls-card").count()) === 1 && (await P.locator(".ls-open").count()) === 2);
    ok("lessons fit a phone", (await overflow(P)) <= 0, await P.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth && !e.closest(".site-switch")).slice(0, 3).map((e) => { const cs = getComputedStyle(e.closest(".site-switch") || e); return e.tagName + "." + e.className + " right=" + e.getBoundingClientRect().right + " vw=" + innerWidth + " sw=" + document.documentElement.scrollWidth + " ox=" + cs.overflowX + " w=" + cs.width; }).join(" | ")));
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "ls-parent.png"), fullPage: true });
    // anyone with the clinic link signs up, no account
    const S = await newPage(browser, { phone: true, cloud: true });
    const signup = async (who) => { await S.goto(clinic.replace(/^.*lessons\//, U + "lessons/")); await S.reload(); await S.waitForTimeout(600);
      await S.getByLabel("Player's name").fill(who); await S.getByLabel("Parent's email or phone").fill(who.split(" ")[0].toLowerCase() + "@e2e.test"); await S.getByRole("button", { name: "Sign up" }).click(); await S.waitForTimeout(500); };
    await S.goto(clinic.replace(/^.*lessons\//, U + "lessons/")); await S.waitForTimeout(600);
    ok("the clinic page opens without an account", (await S.locator(".ls-clinic h1").innerText()) === "Serve clinic" && (await S.locator(".sg .ma").count()) === 0 && (await S.locator(".ls-clinic-facts").innerText()).includes("$40"));
    if (process.env.SHOTS) await S.screenshot({ path: path.join(process.env.SHOTS, "ls-clinic.png"), fullPage: true });
    await signup("Zoe Park"); ok("a player signs up", (await S.locator(".ls-clinic-form h2").innerText()) === "You're signed up");
    await signup("Lily Ng"); await S.reload(); await S.waitForTimeout(600);
    ok("a full clinic says so", (await S.locator(".ls-clinic-form h2").innerText()) === "This clinic is full");
    ok("the clinic page fits a phone", (await overflow(S)) <= 0);
    // the trainer takes a sign-up
    await T.goto(U + "lessons/#/signups"); await T.waitForTimeout(600);
    ok("sign-ups wait for the trainer", (await T.locator(".ls-badge").innerText()) === "2" && (await T.locator(".ls-reqs li").count()) === 2);
    await T.locator(".ls-reqs li", { hasText: "Zoe Park" }).getByRole("button", { name: "Accept" }).click(); await T.waitForTimeout(600);
    if (process.env.SHOTS) { await T.goto(U + "lessons/#/athletes"); await T.waitForTimeout(500); await T.locator(".ls-athletes a", { hasText: "Mia Torres" }).click(); await T.waitForTimeout(500); await T.screenshot({ path: path.join(process.env.SHOTS, "ls-athlete.png"), fullPage: true }); await T.goto(U + "lessons/#/signups"); await T.waitForTimeout(500); }
    ok("accepting adds the athlete and books her in", (await T.locator(".ls-reqs li").count()) === 1 && (await T.locator(".ls-tabs a", { hasText: "Athletes" }).innerText()).includes("4"));
    // the trainer's view on a phone, counting reps
    const Tp = await newPage(browser, { phone: true });
    await Tp.goto(U + "lessons/"); await Tp.waitForTimeout(300); await Tp.locator(".ma-tab, button", { hasText: /^Sign in$/ }).first().click().catch(() => {});
    await Tp.locator(".sg .ma").getByLabel("Email", { exact: true }).fill("trainer@e2e.test"); await Tp.locator(".sg .ma").getByLabel("Password", { exact: true }).fill("secret-pass-1");
    await Tp.locator(".sg .ma").getByRole("button", { name: /^Sign in$/ }).last().click(); await deviceCode(Tp, "trainer@e2e.test", { expect: false }) && null; await Tp.waitForTimeout(1500);
    if (await Tp.locator(".ma-code, #auth-code").count()) await deviceCode(Tp, "trainer@e2e.test");
    await Tp.goto(U + "lessons/"); await Tp.waitForTimeout(800);
    ok("the trainer's schedule fits a phone", (await Tp.locator(".ls-row").count()) >= 4 && (await overflow(Tp)) <= 0);
    await Tp.locator(".ls-past .ls-row a").first().click(); await Tp.waitForTimeout(300); await Tp.getByRole("link", { name: "Count reps" }).click(); await Tp.waitForTimeout(400);
    ok("counting reps fits a phone", (await overflow(Tp)) <= 0 && (await Tp.locator(".ls-pad").count()) === 7);
    if (process.env.SHOTS) await Tp.screenshot({ path: path.join(process.env.SHOTS, "ls-stat.png"), fullPage: true });
    // a stranger without a code sees nothing
    const X = await newPage(browser);
    await X.goto(U + "lessons/"); await X.waitForTimeout(400); await siteSignUp(X, "stranger@e2e.test", "athlete", "Sam Stranger"); await X.waitForTimeout(500);
    ok("lessons: an athlete no trainer has added is told so first", (await X.getByRole("alertdialog").count()) === 1); await X.getByRole("alertdialog").getByRole("button", { name: "OK" }).click();
    ok("an athlete without a code is asked for one", (await X.locator(".ls-join-first").count()) === 1 && !(await X.locator(".ls-page").innerText()).includes("Mia"));
    await X.getByLabel("Code from your trainer").fill("ZZZZZZ"); await X.getByRole("button", { name: "Join", exact: true }).click(); await X.waitForTimeout(500);
    ok("a wrong code says so", (await X.locator(".ls-err").innerText()).includes("doesn't match"));
    // the one code box on the player sites takes a Lessons code (or a team code)
    await X.goto(U + "academy/"); await X.waitForTimeout(600);
    await X.getByRole("button", { name: "Have a code from your coach or trainer?" }).click();
    await X.getByLabel("Code from your coach or trainer").fill("NOPE99"); await X.getByRole("button", { name: "Join", exact: true }).click(); await X.waitForTimeout(400);
    ok("the code box says when a code is wrong", (await X.locator(".cb-err").innerText()).includes("doesn't match"));
    await X.getByLabel("Code from your coach or trainer").fill(code); await X.getByRole("button", { name: "Join", exact: true }).click(); await X.waitForTimeout(600);
    ok("the code box joins lessons and says what covers you", (await X.locator(".cb-done").innerText()).includes("Mia Torres") && (await X.locator(".cb-cov").innerText()).includes("lessons with Tess Trainer"));
    // an unverified coach can look but not add athletes
    const V = await newPage(browser);
    await V.goto(U + "lessons/"); await V.waitForTimeout(400); await siteSignUp(V, "unverified-trainer@e2e.test", "coach", "New Trainer"); await V.waitForTimeout(800);
    ok("an unverified trainer is asked to verify first", (await V.locator(".ls-verify .cv").count()) === 1);
    ok("no errors on the lessons site", ![T, P, S, Tp, X, V].some((x) => x.errors.length), [T, P, S, Tp, X, V].flatMap((x) => x.errors).slice(0, 3).join("; "));
    for (const x of [T, P, S, Tp, X, V]) await x.context().close();
  },
  async academy(browser) {
    const p = await newPage(browser, { phone: true });
    await p.goto(U + "academy/"); await p.waitForTimeout(500);
    await siteSignUp(p, "academy-coach@e2e.test", "coach", "Coach Kim");
    ok("academy opens on the five skills, for players first", (await p.locator(".ac-skills li").count()) === 5 && (await p.getByRole("button", { name: "For players" }).getAttribute("aria-pressed")) === "true" && (await p.locator(".site-switch a").count()) === 6);
    ok("academy fits a phone", (await overflow(p)) <= 0);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "ac-home.png"), fullPage: true });
    await p.getByRole("link", { name: /^Serving/ }).click(); await p.waitForTimeout(300);
    ok("a skill opens at a link a team can share", p.url().endsWith("#/players/serving") && (await p.locator(".ac-band h1").innerText()) === "Serving" && (await p.locator(".ad svg").count()) === 1);
    ok("the player's version has steps and a checklist, not team concepts", (await p.locator("#ac-steps li").count()) > 2 && (await p.locator("#ac-check input[type=checkbox]").count()) > 5 && (await p.locator("#ac-concepts").count()) === 0);
    ok("a skill page fits a phone", (await overflow(p)) <= 0);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "ac-player.png"), fullPage: true });
    await p.locator("#ac-check input[type=checkbox]").first().check(); await p.locator("#ac-check input[type=checkbox]").nth(1).check();
    await p.reload(); await p.waitForTimeout(400);
    ok("checked-off skills stay checked after a reload", (await p.locator("#ac-check input:checked").count()) === 2);
    await p.getByRole("link", { name: "All skills" }).click(); await p.waitForTimeout(200);
    ok("progress shows on the skill list", (await p.locator(".ac-skills li").first().innerText()).includes("2 of "));
    await p.getByRole("button", { name: "For coaches" }).click(); await p.waitForTimeout(200);
    await p.getByRole("link", { name: /^Defense/ }).click(); await p.waitForTimeout(300);
    ok("the coach's version has what to watch, team concepts and progression", p.url().endsWith("#/coaches/defense") && (await p.locator("#ac-watch li").count()) > 2 && (await p.locator("#ac-concepts .ac-concept").count()) > 0 && (await p.locator("#ac-levels").count()) === 1 && (await p.locator("#ac-check").count()) === 0);
    await p.locator(".ac-drill-hd").first().click(); await p.waitForTimeout(150);
    const add = await p.locator(".ac-add").first().getAttribute("href"), drillName = await p.locator(".ac-drill-name b").first().innerText();
    ok("a coach drill links into the practice planner", /#\/practice\/drill:[\w-]+$/.test(add || ""), String(add));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "ac-coach.png"), fullPage: true });
    await p.reload(); await p.waitForTimeout(300);
    ok("the coach/player choice is remembered", (await p.getByRole("button", { name: "For coaches" }).getAttribute("aria-pressed")) === "true");
    await p.goto(U + "academy/#/players/nope"); await p.waitForTimeout(200);
    ok("an unknown skill shows a way back", (await p.getByRole("link", { name: "See every skill" }).count()) === 1);
    // the drill lands in the coach's library
    const A = await newPage(browser, { cloud: false });
    await go(A, "track"); await A.getByRole("button", { name: "Use without an account" }).click(); await A.getByLabel("Team name").fill("Academy Test"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(400);
    const hash = add.slice(add.indexOf("#"));
    await A.goto(U + hash); await A.waitForTimeout(500);
    const libText = await A.locator(".page").innerText();
    ok("opening the link adds the drill to the drill library", A.url().endsWith("#/practice") && (await A.locator(".toast").innerText()).includes("Added") && libText.includes(drillName));
    await A.goto(U + hash.replace("#/practice", "#/home")); await A.goto(U + hash); await A.waitForTimeout(700);
    ok("opening it again doesn't add it twice", (await A.locator(".toast").innerText()).includes("already"));
    if (process.env.SHOTS) { const d = await newPage(browser, { size: { width: 1280, height: 900 } }); await d.goto(U + "academy/#/coaches"); await d.waitForTimeout(400); await d.screenshot({ path: path.join(process.env.SHOTS, "ac-home-desk.png"), fullPage: true });
      await d.goto(U + "academy/#/players/hitting"); await d.waitForTimeout(400); await d.screenshot({ path: path.join(process.env.SHOTS, "ac-skill-desk.png"), fullPage: true }); await d.context().close(); }
    ok("no errors on the academy site", !p.errors.length && !A.errors.length, [...p.errors, ...A.errors].slice(0, 3).join("; "));
    await p.context().close(); await A.context().close();
  },
  async club(browser) {
    const A = await newPage(browser, { cloud: false });
    await go(A, "track"); await A.getByRole("button", { name: "Use without an account" }).click(); await A.getByLabel("Team name").fill("Clovis 16 Black"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(400);
    await go(A, "matchup"); await A.getByRole("button", { name: "Paste a whole schedule" }).click();
    await A.locator(".mu-ics input").setInputFiles({ name: "team.ics", mimeType: "text/calendar", buffer: Buffer.from("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20261205T100000\r\nSUMMARY:vs Central\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20261206T180000\r\nSUMMARY:@ Buchanan\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20261204T160000\r\nSUMMARY:Practice\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n") }); await A.waitForTimeout(200);
    ok("a calendar file fills the schedule, practices left out", /Found 2 matches/.test(await A.locator(".card", { hasText: "Schedule" }).first().innerText()));
    await A.getByRole("button", { name: /^Add 2 to schedule/ }).click(); await A.waitForTimeout(200);
    await go(A, "team/new"); await A.getByLabel("Team name").fill("Clovis 15 Blue"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(400);
    await go(A, "matchup"); await A.getByRole("button", { name: "Paste a whole schedule" }).click(); await A.locator("textarea").first().fill("12/5 vs Fresno 11:00 AM\n12/5 vs Clovis West 3:00 PM"); await A.getByRole("button", { name: /^Add 2 to schedule/ }).click(); await A.waitForTimeout(200);
    ok("the sidebar starts folded", await A.evaluate(() => document.body.classList.contains("nav-mini")));
    await A.getByRole("button", { name: "Expand the sidebar" }).click(); await A.waitForTimeout(250);
    { const btn = A.locator(".tm-btn:visible"), before = await btn.innerText();
      await btn.click(); await A.waitForTimeout(150);
      ok("with two teams the team menu lists both and offers the club view", (await A.locator(".tm-menu [role=menuitemradio]").count()) === 2 && (await A.getByRole("menuitem", { name: "All teams overview" }).count()) === 1 && (await A.getByRole("menuitem", { name: "Add a team" }).count()) === 1);
      ok("the team menu opens on the current team, checked", /Clovis 15 Blue/.test(await A.evaluate(() => document.activeElement?.textContent || "")) && (await A.locator(".tm-menu [aria-checked=true]").innerText()).includes("Clovis 15 Blue"));
      await A.keyboard.press("Escape"); ok("Esc closes it and returns focus to the button", (await A.locator(".tm-menu").count()) === 0 && await btn.evaluate((e) => e === document.activeElement));
      await btn.click(); await A.locator(".tm-menu [role=menuitemradio]", { hasText: "Clovis 16 Black" }).click(); await A.waitForTimeout(250);
      ok("picking a team switches to it", /Clovis 16 Black/.test(await btn.innerText()) && !/Clovis 16 Black/.test(before));
      await btn.click(); await A.locator(".tm-menu [role=menuitemradio]", { hasText: "Clovis 15 Blue" }).click(); await A.waitForTimeout(250);
      await A.getByRole("button", { name: "Collapse the sidebar" }).click(); await A.waitForTimeout(250);
      ok("the sidebar folds to icons", await A.evaluate(() => document.body.classList.contains("nav-mini")) && (await A.locator(".nav .tab span").first().isVisible()) === false);
      await A.reload(); await A.waitForTimeout(400); ok("…and opens folded next time", await A.evaluate(() => document.body.classList.contains("nav-mini")));
      await A.getByRole("button", { name: "Expand the sidebar" }).click(); await A.waitForTimeout(250); }
    await go(A, "club"); await A.waitForTimeout(500);
    ok("club shows every team", (await A.locator(".club-card").count()) === 2 && /2 teams/.test(await A.locator(".pagehead").innerText()));
    await A.getByRole("button", { name: "Calendar", exact: true }).click(); await A.waitForTimeout(200);
    ok("the club calendar puts every team's matches together", (await A.locator(".club-ev").count()) === 4 && /Clovis 16 Black/.test(await A.locator(".club-cal").innerText()) && /Clovis 15 Blue/.test(await A.locator(".club-cal").innerText()));
    ok("home matches that need the gym at the same time are flagged", (await A.locator(".club-clash li").count()) === 1 && /Clovis 16 Black Varsity and Clovis 15 Blue Varsity both need the gym within two hours/.test(await A.locator(".club-clash").innerText()) && (await A.locator(".club-ev.clash").count()) === 2);
    { const f = await download(A, () => A.getByRole("button", { name: "Download calendar" }).click()); const ics = f.text();
      ok("one calendar file holds every team's events", f.name === "Clovis calendar.ics" && (ics.match(/BEGIN:VEVENT/g) || []).length === 4 && /SUMMARY:Clovis 15 Blue Varsity: vs Fresno/.test(ics), f.name); }
    await A.getByLabel("Matches").uncheck(); await A.waitForTimeout(100);
    ok("event types can be hidden", (await A.locator(".club-ev").count()) === 0); await A.getByLabel("Matches").check();
    await A.getByRole("button", { name: "Leaders", exact: true }).click(); await A.waitForTimeout(200);
    ok("leaders explain what they need when nobody qualifies", /Not enough sets played yet/.test(await A.locator(".page").innerText()));
    await A.getByRole("button", { name: "Announce", exact: true }).click(); await A.waitForTimeout(200);
    ok("club announcements ask for an account", /Sign in to send an announcement to several teams/.test(await A.locator(".page").innerText()));
    await A.getByRole("button", { name: "Calendar", exact: true }).click();
    { const ax = await a11y(A); ok("club controls all have names", !ax.length, ax.join(" | ")); }
    await A.setViewportSize({ width: 390, height: 844 }); await A.waitForTimeout(200);
    ok("the club calendar fits a phone", (await overflow(A)) <= 0);
    if (process.env.QASHOT6) await A.screenshot({ path: process.env.QASHOT6, fullPage: true });
    ok("no errors on the club page", A.errors.length === 0, A.errors.join("; "));
  },
  async tryouts(browser) {
    const A = await newPage(browser, { cloud: false });
    await go(A, "track"); await A.getByRole("button", { name: "Use without an account" }).click(); await A.getByLabel("Team name").fill("Clovis 16 Black"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(400);
    await go(A, "home"); await A.waitForTimeout(300);
    ok("Home has no What's New card", (await A.locator(".news-card").count()) === 0);
    await go(A, "tryouts"); await A.getByLabel("Name").fill("16U tryouts"); await A.getByRole("button", { name: "Start" }).click(); await A.waitForTimeout(300);
    await A.getByLabel("Players trying out, one per line").fill("12 Maya Chen OH 10th\n13 Ava Ramirez S Jr\nLily Torres L\n15 Zoe Grant MB"); await A.getByRole("button", { name: "Add", exact: true }).click(); await A.waitForTimeout(200);
    ok("tryout players are added from a pasted list, numbered when they have no bib", (await A.locator("table tbody tr").count()) === 4 && (await A.getByLabel("Bib for Lily Torres").inputValue()) === "14");
    await A.getByLabel("Bib for Zoe Grant").fill("12"); await A.waitForTimeout(100);
    ok("two players with the same bib are flagged", /Two players share bib 12/.test(await A.locator("[role=alert]").innerText().catch(() => "")));
    await A.getByLabel("Bib for Zoe Grant").fill("15"); await A.waitForTimeout(100);
    { const [pop] = await Promise.all([A.waitForEvent("popup", { timeout: 5000 }), A.getByRole("button", { name: "Print rating sheet" }).click()]); await pop.waitForLoadState();
      ok("a paper rating sheet opens to print", /16U tryouts: rating sheet/.test(await pop.locator("h1").innerText()) && (await pop.locator("tbody tr").count()) === 4); await pop.close(); }
    await A.getByRole("button", { name: "Rate", exact: true }).click(); await A.getByLabel("Your name as an evaluator").fill("Coach Kim"); await A.getByRole("button", { name: "Start rating" }).click(); await A.waitForTimeout(200);
    const rate = async (who, n) => A.getByRole("group", { name: new RegExp(" for " + who) }).getByRole("button", { name: n + " of 5" }).click();
    await rate("Maya Chen", 5); await rate("Ava Ramirez", 3); await rate("Lily Torres", 2); await rate("Zoe Grant", 4);
    ok("rating counts progress on the skill", /4\/4 rated on Serve/.test(await A.locator(".page").innerText()));
    await A.getByLabel("Skill").selectOption("Pass"); await rate("Lily Torres", 5); await rate("Maya Chen", 4);
    await A.getByRole("button", { name: "Add a note on Maya Chen" }).click(); await A.getByLabel("Note on Maya Chen").fill("Big arm, late on footwork"); await A.locator(".ty-note").getByRole("button", { name: "Save" }).click();
    ok("an evaluator can note a player", (await A.getByRole("button", { name: "Edit note on Maya Chen" }).count()) === 1);
    { const ax = await a11y(A); ok("rating controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.QASHOT8) { await A.setViewportSize({ width: 390, height: 844 }); await A.screenshot({ path: process.env.QASHOT8, fullPage: true }); await A.setViewportSize({ width: 1360, height: 900 }); }
    await A.getByRole("button", { name: "Rankings", exact: true }).click(); await A.waitForTimeout(200);
    ok("rankings put the best first", (await A.locator(".ty-rank tbody tr td:nth-child(3) b").allInnerTexts()).join(",") === "Maya Chen,Zoe Grant,Lily Torres,Ava Ramirez", (await A.locator(".ty-rank tbody tr td:nth-child(3) b").allInnerTexts()).join(","));
    // a second evaluator's file merges in
    const mine = await download(A, () => A.getByRole("button", { name: "Share my ratings" }).click()); const j = JSON.parse(mine.text());
    ok("an evaluator shares their ratings as a file", j.floorcallTryout === 1 && Object.keys(j.tryout.ratings).join() === "Coach Kim");
    const ids = Object.fromEntries(j.tryout.candidates.map((c) => [c.name, c.id]));
    j.tryout.ratings = { "Coach Pat": { [ids["Ava Ramirez"]]: { Serve: 5, Pass: 5 }, [ids["Maya Chen"]]: { Serve: 1, Pass: 1 } } };
    await A.locator("input[type=file][aria-label='Ratings file']").setInputFiles({ name: "pat.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(j)) }); await A.waitForTimeout(300);
    ok("another evaluator's ratings merge in and change the order", /2 evaluators: Coach Kim, Coach Pat/.test(await A.locator(".page").innerText()) && (await A.locator(".ty-rank tbody tr td:nth-child(3) b").first().innerText()) === "Ava Ramirez");
    ok("evaluator notes show in the rankings", /Coach Kim: Big arm, late on footwork/.test(await A.locator(".ty-rank tr", { hasText: "Maya Chen" }).innerText()));
    ok("players the evaluators saw differently are flagged", (await A.locator(".ty-rank tr", { hasText: "Maya Chen" }).locator(".ty-split").count()) === 1);
    { const csv = await download(A, () => A.getByRole("button", { name: "Spreadsheet" }).click()); ok("rankings export to a spreadsheet", /^Rank,Bib,Name/.test(csv.text()) && /Ava Ramirez/.test(csv.text())); }
    await A.getByLabel("Decision for Ava Ramirez").selectOption("offer"); await A.getByLabel("Decision for Zoe Grant").selectOption("offer"); await A.waitForTimeout(150);
    await A.setViewportSize({ width: 390, height: 844 }); await A.waitForTimeout(200); ok("tryouts fit a phone", (await overflow(A)) <= 0);
    if (process.env.QASHOT8) await A.screenshot({ path: process.env.QASHOT8.replace(".png", "-rank.png"), fullPage: true });
    await A.setViewportSize({ width: 1360, height: 900 });
    await A.getByLabel("New team name").fill("Clovis 16 Blue"); await A.getByRole("button", { name: "Create team with 2 players" }).click(); await A.waitForTimeout(500);
    { const roster = (await A.locator(".page").innerText()) + " " + (await A.locator(".page input").evaluateAll((l) => l.map((x) => x.value).join(" "))); ok("offers become a new team's roster", /Clovis 16 Blue/.test(await A.locator(".tm-btn:visible").getAttribute("aria-label")) && /Zoe/.test(roster) && /Ava/.test(roster) && !/Maya/.test(roster), roster.slice(0, 300)); }
    await A.reload(); await A.waitForTimeout(800); await go(A, "tryouts"); await A.waitForTimeout(300);
    ok("tryouts are kept on the device", /16U tryouts[\s\S]*4 players · 2 evaluators/.test(await A.locator(".ty-list").innerText()));
    ok("no errors on tryouts", A.errors.length === 0, A.errors.join("; "));
  },
  async tryoutstaff(browser) {
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("tryout-head@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Head Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clovis 16 Black"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(600);
    await go(A, "tryouts"); await A.getByLabel("Name").fill("16U tryouts"); await A.getByRole("button", { name: "Start" }).click(); await A.waitForTimeout(300);
    await A.getByLabel("Players trying out, one per line").fill("12 Maya Chen OH\n13 Ava Ramirez S"); await A.getByRole("button", { name: "Add", exact: true }).click(); await A.waitForTimeout(200);
    await A.getByRole("button", { name: "Rankings", exact: true }).click(); await A.getByRole("button", { name: "Share with your staff" }).click(); await A.waitForTimeout(500);
    const code = (await A.locator(".ty-code").innerText()).trim();
    ok("the head coach gets a code for the staff", /^[A-Z0-9]{6}$/.test(code), code);
    // an assistant opens the link on her phone, signs in, and rates
    const B = await newPage(browser, { phone: true }); await B.goto(U + "#/tryout-join/" + code); await B.waitForTimeout(600);
    ok("opening the link asks the assistant to sign in", (await B.locator(".ma").count()) === 1);
    await B.getByLabel("Your name").fill("Coach Pat"); await B.getByLabel("Email", { exact: true }).fill("pat-tryout@e2e.test"); await B.getByLabel("Password", { exact: true }).fill("assist-pass");
    await B.locator(".ma-check input").first().check(); await B.locator(".ma").getByRole("button", { name: "Create free account" }).last().click(); await B.waitForTimeout(1500);
    ok("the assistant lands on the tryout to rate, with the players", /16U tryouts/.test(await B.locator("h1").innerText()) && (await B.locator(".ty-rate li").count()) === 2 && (await B.getByRole("button", { name: "Rankings" }).count()) === 0);
    await B.getByRole("button", { name: "Add a note on Ava Ramirez" }).click(); await B.getByLabel("Note on Ava Ramirez").fill("Great jump float"); await B.locator(".ty-note").getByRole("button", { name: "Save" }).click();
    await B.getByRole("group", { name: /Serve for Ava Ramirez/ }).getByRole("button", { name: "5 of 5" }).click(); await B.getByRole("group", { name: /Serve for Maya Chen/ }).getByRole("button", { name: "2 of 5" }).click(); await B.waitForTimeout(1200);
    ok("her ratings go to the head coach", /Sent to the head coach/.test(await B.locator(".ty-sync").innerText()));
    { const ax = await a11y(B); ok("the assistant's rating screen controls all have names", !ax.length, ax.join(" | ")); ok("and it fits a phone", (await overflow(B)) <= 0); }
    // the head coach adds a player; the assistant gets it when she reopens
    await A.getByRole("button", { name: /^Players/ }).click(); await A.getByLabel("Players trying out, one per line").fill("14 Lily Torres L"); await A.getByRole("button", { name: "Add", exact: true }).click(); await A.waitForTimeout(1500);
    await B.goto(U + "#/tryout-join/" + code); await B.waitForTimeout(1200);
    ok("new players reach the staff, and their ratings stay", (await B.locator(".ty-rate li").count()) === 3 && (await B.getByRole("group", { name: /Serve for Ava Ramirez/ }).getByRole("button", { name: "5 of 5" }).getAttribute("aria-pressed")) === "true");
    await A.getByRole("button", { name: "Rankings", exact: true }).click(); await A.getByRole("button", { name: "Get your staff's ratings" }).click(); await A.waitForTimeout(600);
    ok("the head coach pulls everyone's ratings into the rankings", /1 evaluator: Coach Pat/.test(await A.locator(".page").innerText()) && (await A.locator(".ty-rank tbody tr td:nth-child(3) b").first().innerText()) === "Ava Ramirez");
    ok("with the assistant's notes", /Coach Pat: Great jump float/.test(await A.locator(".ty-rank tr", { hasText: "Ava Ramirez" }).innerText()));
    ok("no errors", A.errors.length === 0 && B.errors.length === 0, A.errors.concat(B.errors).join("; "));
    await A.context().close(); await B.context().close();
  },
  async coachtools(browser) {
    const A = await newPage(browser);
    await go(A, "sample"); await A.waitForFunction(() => !location.hash.includes("sample"), null, { timeout: 8000 }).catch(() => {}); await A.waitForTimeout(800);
    // playbook: the 3D court as a board
    await go(A, "court"); await A.waitForTimeout(500);
    await A.getByRole("button", { name: "Playbook", exact: true }).click(); await A.waitForTimeout(300);
    ok("playbook lists defenses, blocking, serve receive and hitting plays", (await A.locator(".pb-group").count()) === 4 && (await A.locator(".pb-item").count()) > 20);
    ok("a defense shows six players and their routes", (await A.locator(".pb .c3d-grab").count()) === 6 && (await A.locator(".pb .c3d-route").count()) === 6);
    await A.getByRole("button", { name: "Slide", exact: true }).click(); await A.waitForTimeout(200);
    ok("a hitting play loads with its note", (await A.locator(".pb-note").inputValue()).includes("one foot") && (await A.locator(".pb .c3d-route").count()) === 3);
    await A.locator(".pb .c3d").scrollIntoViewIfNeeded();
    const lb = await A.locator('.c3d-grab[data-i="4"] rect').first().boundingBox();
    await A.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await A.mouse.down(); await A.mouse.move(lb.x + lb.width / 2 + 90, lb.y + lb.height / 2 - 30, { steps: 4 }); await A.mouse.up();
    await A.waitForTimeout(150); let lb2 = await A.locator('.c3d-grab[data-i="4"] rect').first().boundingBox();
    ok("dragging a player moves her", lb2.x - lb.x > 50);
    await A.getByRole("button", { name: "Draw routes" }).click(); await A.waitForTimeout(200);
    lb2 = await A.locator('.c3d-grab[data-i="4"] rect').first().boundingBox(); // the page may have scrolled to reach the button
    await A.mouse.move(lb2.x + lb2.width / 2, lb2.y + lb2.height / 2); await A.mouse.down(); await A.mouse.move(lb2.x + lb2.width / 2 - 120, lb2.y + lb2.height / 2 + 60, { steps: 4 }); await A.mouse.up(); await A.waitForTimeout(150);
    ok("dragging in route mode draws a route", (await A.locator(".pb .c3d-route").count()) === 4);
    { const n = await A.locator(".pb .c3d-route").count(), g = await A.locator('.c3d-grab[data-i="4"] rect').first().boundingBox();
      await A.mouse.click(g.x + g.width / 2, g.y + g.height / 2); await A.waitForTimeout(150);
      ok("tapping a player in route mode clears her route", (await A.locator(".pb .c3d-route").count()) === n - 1);
      await A.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await A.mouse.down(); await A.mouse.move(g.x + g.width / 2 - 120, g.y + g.height / 2 + 60, { steps: 4 }); await A.mouse.up(); await A.waitForTimeout(150); }
    ok("the slide comes with a curved run", (await A.locator(".pb .c3d-route polyline").evaluateAll((l) => l.filter((x) => x.points.numberOfItems > 6).length)) >= 1);
    { const f = await download(A, () => A.getByRole("button", { name: "Save picture" }).click(), 10000); ok("a play saves as a picture", /play\.png$/.test(f.name) && f.size > 30000, `${f.name} ${f.size}`);
      if (process.env.QASHOT9) fs.copyFileSync(f.path, process.env.QASHOT9); }
    await A.locator("input[aria-label='Play name']").fill("Slide vs Ridgeview"); await A.getByRole("button", { name: "Save to my plays" }).click(); await A.waitForTimeout(200);
    ok("a play saves under My plays", (await A.locator(".pb-group").first().innerText()).includes("Slide vs Ridgeview"));
    await A.getByRole("button", { name: "Run it" }).click(); await A.waitForTimeout(600);
    ok("Run it hides the arrows while players move", (await A.locator(".pb .c3d-route").count()) === 0);
    await A.waitForTimeout(2200);
    ok("and they come back after", (await A.locator(".pb .c3d-route").count()) === 4);
    await go(A, "stats"); await A.waitForTimeout(400); await A.getByRole("button", { name: "Rotations", exact: true }).click(); await A.waitForTimeout(300);
    ok("the rotation court is flat, from above", (await A.locator(".c2d .c2d-p").count()) === 6 && (await A.locator(".c3d").count()) === 0);
    await go(A, "track"); await A.waitForTimeout(500);
    // two liberos beside the court
    const lc = A.locator(".libcol");
    ok("track shows a libero box beside the court", (await lc.count()) === 1 && (await lc.locator(".pl.lib.on").count()) === 1);
    const first = (await lc.locator(".pl.lib.on .nm").innerText()).trim();
    await lc.locator("select[aria-label='Choose a second libero']").selectOption({ index: 1 }); await A.waitForTimeout(300);
    ok("a second libero can be added", (await lc.locator(".pl.lib.off").count()) === 1);
    const second = (await lc.locator(".pl.lib.off .nm").innerText()).trim();
    await lc.getByRole("button", { name: "Swap liberos" }).click(); await A.waitForTimeout(300);
    ok("swapping puts the second libero on the court", (await lc.locator(".pl.lib.on .nm").innerText()).trim() === second && (await lc.locator(".pl.lib.off .nm").innerText()).trim() === first);
    ok("a libero isn't listed on the bench too", (await A.locator(".players .pl.bench", { hasText: second }).count()) === 0);
    await A.reload(); await A.waitForTimeout(800);
    ok("the libero swap is saved", (await A.locator(".libcol .pl.lib.on .nm").innerText()).trim() === second);
    // where it landed, chosen per kind of play
    await go(A, "settings"); const passes = A.locator("select[aria-label='Where it landed: Our passes']");
    ok("where-it-landed has a choice for each kind of play", (await A.locator("select[aria-label^='Where it landed:']").count()) === 7);
    await passes.selectOption("bad"); await A.waitForTimeout(600); await A.reload(); await A.waitForTimeout(900);
    { const v = [await A.locator("select[aria-label='Where it landed: Our passes']").inputValue(), await A.locator("select[aria-label='Where it landed: Our digs']").inputValue()];
      ok("the choice is saved", v[0] === "bad" && v[1] === "off", v.join(",")); }
    // stats: errors, one stat from a dropdown, and your own table
    await go(A, "stats"); await A.getByRole("button", { name: "Errors", exact: true }).click(); await A.waitForTimeout(300);
    ok("Errors page totals our errors and lists players", /Our errors/.test(await A.locator(".kpis").first().innerText()) && (await A.locator(".card", { hasText: "By player" }).locator("tbody tr").count()) >= 3 && (await A.locator(".errbar").count()) >= 3);
    await A.getByRole("button", { name: "Pick stats", exact: true }).click(); await A.waitForTimeout(300);
    await A.locator("select[aria-label='Stat']").selectOption("D"); await A.waitForTimeout(200);
    ok("the stat dropdown ranks players on that stat", (await A.locator(".lookup-row").count()) >= 3 && /Digs/.test(await A.locator(".lookup-team").innerText()));
    await A.locator("select[aria-label='Start from']").selectOption("errors"); await A.waitForTimeout(200);
    const heads = await A.locator(".card", { hasText: "Choose your stats" }).locator("thead th").allInnerTexts();
    ok("a preset fills the table with those stats", heads.includes("Errors") && heads.includes("SE") && heads.length === 10, heads.join(","));
    await A.getByRole("button", { name: /^Stats \(/ }).click(); await A.locator(".picker-o", { hasText: "Kills" }).first().locator("input").check(); await A.waitForTimeout(200);
    ok("ticking a stat adds its column at the end", (await A.locator(".card", { hasText: "Choose your stats" }).locator("thead th").last().innerText()) === "K");
    await A.locator("select[aria-label='Stats for']").selectOption({ index: 1 }); await A.waitForTimeout(300);
    ok("one player's table has a row per match", (await A.locator(".card", { hasText: "Choose your stats" }).locator("tbody tr").count()) >= 2);
    const [pop] = await Promise.all([A.waitForEvent("popup"), A.getByRole("button", { name: "Print", exact: true }).click()]);
    await pop.waitForLoadState().catch(() => {}); ok("Print opens a clean printable table", (await pop.locator("table tbody tr").count()) >= 2 && /Errors/.test(await pop.locator("thead").innerText()));
    await pop.close().catch(() => {});
    // their roster: on the matchup page, and when starting a match
    await go(A, "matchup"); await A.locator("select[aria-label='Opponent']").selectOption({ label: "Ridgeview" }); await A.waitForTimeout(300);
    const rc = A.locator(".card", { hasText: "Ridgeview roster" });
    ok("matchup shows their roster with names", (await rc.locator("input[aria-label='Name for their #11']").inputValue()) === "Kayla Moore");
    await rc.getByRole("button", { name: "Paste a list" }).click(); await rc.locator("textarea").fill("21 Mia Lopez L, 4"); await rc.getByRole("button", { name: /^Add 2 players/ }).click(); await A.waitForTimeout(300);
    ok("a pasted list adds numbers, names and positions", (await rc.locator("input[aria-label='Name for their #21']").inputValue()) === "Mia Lopez" && (await rc.locator("select[aria-label='Position for their #21']").inputValue()) === "L" && (await rc.locator("input[aria-label='Name for their #4']").count()) === 1);
    await go(A, "track"); if (await A.locator("button.ctrl", { hasText: "End match" }).count()) { await A.locator("button.ctrl", { hasText: "End match" }).click(); await A.locator("button.ctrl", { hasText: "Tap again" }).click(); await A.waitForTimeout(400); }
    if (await A.getByPlaceholder("e.g. Buchanan").count()) {
      await A.getByPlaceholder("e.g. Buchanan").fill("Lakeside"); await A.getByRole("button", { name: /^Their roster \(optional\)/ }).click();
      await A.getByLabel("Their jersey number").fill("5"); await A.getByLabel("Their player's name").fill("Ana Ruiz"); await A.getByRole("button", { name: "Add player" }).click();
      await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(400);
      await go(A, "matchup"); await A.locator("select[aria-label='Opponent']").selectOption({ label: "Lakeside" }); await A.waitForTimeout(300);
      ok("a roster typed when starting the match is saved for that opponent", (await A.locator("input[aria-label='Name for their #5']").inputValue().catch(() => "")) === "Ana Ruiz");
    } else ok("start-match form reachable", false);
    ok("coach tools: no page errors", !A.errors.length, A.errors.slice(0, 3).join(" | "));
  },
  async demo(browser) {
    const P = await newPage(browser, { size: { width: 390, height: 844 } });
    await P.goto(U.replace(/\/?$/, "/") .replace(/\/\/$/, "/") + "live/#/demo"); await P.waitForTimeout(1500);
    ok("demo game opens live, no account needed", /LIVE/.test(await P.locator(".lv-sb, .lv-score, header").first().innerText().catch(() => "")) || (await P.locator(".lv-gc").count()) === 1);
    const before = await P.locator(".lv-espn tbody tr.pt").count();
    await P.getByRole("button", { name: "10×" }).click(); await P.waitForTimeout(4000);
    ok("the demo plays itself", (await P.locator(".lv-espn tbody tr.pt").count()) > before);
    await P.getByRole("button", { name: "Set 3" }).click(); await P.waitForTimeout(500);
    ok("jump to a set", /SET 3/i.test(await P.locator(".lv-gc-last").innerText().catch(() => "")));
    await P.getByRole("button", { name: "Leaders", exact: true }).click(); await P.waitForTimeout(300);
    ok("demo leaders show both teams, with their roster names", (await P.locator(".lv-ldr-cat").count()) >= 3 && /Kayla Moore|Tess Rivera|Jada Kim|Brooke Hale|Nina Cole/.test(await P.locator(".lv-ldr").innerText()));
    ok("demo fits a phone", (await P.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    ok("demo: no page errors", !P.errors.length, P.errors.slice(0, 3).join(" | "));
  },
  async voice(browser) {
    const p = await newPage(browser, { cloud: false });
    // a stand-in microphone: each start() "hears" the next phrase queued in window.__say
    await p.context().addInitScript(() => { window.__say = []; window.SpeechRecognition = class { start() { setTimeout(() => { const t = window.__say.shift(); if (t) this.onresult?.({ results: [[{ transcript: t }]] }); }, 100); } stop() { this.onend?.(); } }; });
    await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Voice High"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(300);
    await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill("7 Maya Chen OH\n12 Sofia Nguyen OPP\n4 Jordan Lee OH"); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(200);
    await go(p, "labs"); await p.getByLabel("Type-in stat codes").check({ force: true });
    await go(p, "track"); await p.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(300);
    const say = async (t) => { await p.evaluate((x) => window.__say.push(x), t); const b = p.locator(".quick").getByRole("button", { name: /^(Voice|● Listening)$/ }); if ((await b.getAttribute("aria-pressed")) === "true") await b.click(); await b.click(); await p.waitForTimeout(500); };
    await say("seven kill"); ok("voice: “seven kill” records a kill for #7", /Recorded: 7k/.test(await p.locator(".quick").innerText()) && /1/.test(await score(p)), await p.locator(".quick").innerText());
    await say("twelve ace their kill eleven"); ok("voice: two plays in one breath", /Recorded: 12ace ok11/.test(await p.locator(".quick").innerText()), await p.locator(".quick").innerText());
    await say("great job everybody"); ok("voice: chatter records nothing", /no stat in it/.test(await p.locator(".quick").innerText()));
    await say("scratch that"); ok("voice: “scratch that” undoes", /Recorded: undo/.test(await p.locator(".quick").innerText()));
    ok("voice: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },
  /** paused feature (college search and messages to coaches): flip COLLEGE_SEARCH in src/recruit/flags.ts, build, then run this scenario by name */
  async _college(browser) {
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("hs@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clovis North"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").first().setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(800);
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Central"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(300);
    for (let i = 0; i < 4; i++) { await A.locator(".pl", { hasText: "Nia" }).first().click(); await A.getByRole("button", { name: "Kill", exact: true }).first().click(); await skipIfAsked(A); await A.keyboard.press("Escape"); }
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    await A.locator(".consent-check input").first().check(); await A.waitForTimeout(150);
    const list = A.locator(".consent-check", { hasText: "college coach search" }).locator("input");
    ok("listing in college search is offered once the family agreed", (await list.count()) === 1); await list.check();
    await A.getByRole("button", { name: "Share profile link" }).click(); await A.waitForTimeout(1000);
    const rec = await A.locator("a", { hasText: "/recruit/#/p/" }).first().getAttribute("href"), base = rec.replace(/#.*$/, "");
    await fetch(`http://localhost:${MOCK_PORT}/__mock/make-admin?email=hs%40e2e.test`, { headers: { apikey: "anon" } });
    // a college coach
    const C = await newPage(browser);
    await C.goto(base); await C.waitForTimeout(600); await C.getByRole("link", { name: /Search players whose families chose/ }).click(); await C.waitForTimeout(300);
    await C.getByRole("button", { name: "Create account" }).first().click();
    await C.getByLabel("School email").fill("scout@gmail.com"); await C.getByLabel("Password").fill("secret123"); await C.locator(".rc-check input").check(); await C.getByRole("button", { name: "Create account" }).last().click(); await C.waitForTimeout(600);
    await C.getByLabel("Your name").fill("Sam Scout"); await C.getByLabel("College or university").fill("Nowhere"); await C.getByRole("button", { name: "Request access" }).click(); await C.waitForTimeout(400);
    ok("college access needs a school (.edu) email", /ending in \.edu/.test(await C.locator(".rc-err").innerText()));
    await C.getByRole("button", { name: "Sign out" }).click(); await C.waitForTimeout(800);
    await C.getByRole("button", { name: "Create account" }).first().click();
    await C.getByLabel("School email").fill("pat@state.edu"); await C.getByLabel("Password").fill("secret123"); await C.locator(".rc-check input").check(); await C.getByRole("button", { name: "Create account" }).last().click(); await C.waitForTimeout(600);
    await C.getByLabel("Your name").fill("Pat Coach"); await C.getByLabel("College or university").fill("State University"); await C.getByLabel("Title").fill("Assistant coach"); await C.getByRole("button", { name: "Request access" }).click(); await C.waitForTimeout(500);
    ok("the request waits for approval", /Your request for State University is in/.test(await C.locator("main").innerText()));
    { const ax = await a11y(C); ok("college sign-up controls all have names", !ax.length, ax.join(" | ")); }
    // FloorCall approves
    await go(A, "settings"); await A.waitForTimeout(800); await A.getByRole("button", { name: "Open admin" }).click(); await A.waitForTimeout(800);
    const row = A.locator("tr", { hasText: "pat@state.edu" }); ok("admin sees the college request", (await row.count()) === 1 && /Waiting/.test(await row.innerText()));
    await row.getByRole("button", { name: "Approve" }).click(); await A.waitForTimeout(300);
    await C.reload(); await C.waitForTimeout(1500);
    ok("approved staff see the search with the listed player", (await C.locator(".rc-hit", { hasText: "Nia Lopez" }).count()) === 1, (await C.locator("main").innerText()).slice(0, 300));
    await C.locator(".rc-chips button", { hasText: "2028" }).click(); await C.waitForTimeout(600); ok("class filter keeps her (2028)", (await C.locator(".rc-hit").count()) === 1);
    await C.locator(".rc-chips button", { hasText: "2028" }).click(); await C.locator(".rc-chips button", { hasText: "2027" }).click(); await C.waitForTimeout(600); ok("class filter drops her for 2027", (await C.locator(".rc-hit").count()) === 0);
    await C.locator(".rc-chips button", { hasText: "2027" }).click(); await C.getByLabel("Kills / set", { exact: true }).fill("50"); await C.waitForTimeout(600); ok("a stat minimum filters", (await C.locator(".rc-hit").count()) === 0);
    await C.getByLabel("Kills / set", { exact: true }).fill(""); await C.waitForTimeout(600);
    // the college coach writes to her coaches (never to the player)
    { const hit = C.locator(".rc-hit", { hasText: "Nia Lopez" });
      await hit.getByRole("button", { name: "Message Nia's coaches" }).click();
      await hit.getByLabel(/Message to Clovis North's coaches about Nia/).fill("We watched Nia's clips and would like her at our January clinic.");
      if (process.env.QASHOT3) await C.screenshot({ path: process.env.QASHOT3 });
      { const ax = await a11y(C); ok("college message form controls all have names", !ax.length, ax.join(" | ")); }
      await hit.getByRole("button", { name: "Send" }).click(); await C.waitForTimeout(500);
      ok("the college coach is told it went to the staff", /Sent to Clovis North's coaching staff/.test(await hit.innerText()));
      await C.reload(); await C.waitForTimeout(1500);
      await C.locator(".rc-hit", { hasText: "Nia Lopez" }).getByRole("button", { name: "Message Nia's coaches" }).click(); await C.locator(".rc-contact textarea").fill("Following up."); await C.locator(".rc-contact").getByRole("button", { name: "Send" }).click(); await C.waitForTimeout(400);
      ok("a second message the same week is refused", /this week/.test(await C.locator(".rc-contact .rc-err").innerText())); }
    await go(A, "team"); await A.waitForTimeout(900);
    { const card = A.locator(".card", { hasText: "College interest" });
      ok("the team's coach gets the message with who sent it and about whom", /Pat Coach, Assistant coach · State University about Nia Lopez/.test(await card.innerText()) && /January clinic/.test(await card.innerText()) && /1 new/.test(await card.innerText()), (await card.innerText().catch(() => "")).slice(0, 300));
      if (process.env.QASHOT3) await card.screenshot({ path: process.env.QASHOT3.replace(".png", "-inbox.png") });
      ok("with a reply-by-email link to the school address", ((await card.getByRole("link", { name: "Reply by email" }).getAttribute("href")) || "").startsWith("mailto:pat@state.edu")); }
    await C.getByRole("button", { name: /Add Nia Lopez to watchlist/ }).click(); await C.getByLabel(/Only my watchlist/).check(); await C.waitForTimeout(200);
    ok("watchlist keeps her", (await C.locator(".rc-hit").count()) === 1);
    if (process.env.SHOTS) await C.screenshot({ path: path.join(process.env.SHOTS, "college-search.png"), fullPage: true });
    { const ax = await a11y(C); ok("college search controls all have names", !ax.length, ax.join(" | ")); }
    await C.locator(".rc-hit-main").first().click(); await C.waitForTimeout(800); ok("a result opens the full profile", (await C.locator(".rc-id h1").innerText()).toLowerCase() === "nia lopez");
    // the team takes her out of search
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    await A.locator(".consent-check", { hasText: "college coach search" }).locator("input").uncheck(); await A.waitForTimeout(500);
    await C.goto(base + "#/college"); await C.waitForTimeout(1200); ok("unlisted players leave the search", (await C.locator(".rc-hit").count()) === 0);
    ok("college: no page errors", !A.errors.length && !C.errors.length, A.errors.concat(C.errors).slice(0, 3).join(" | "));
    await A.context().close(); await C.context().close();
  },
  async cloud(browser) {
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("head@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Cloud Club"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.getByRole("button", { name: "Invite a coach" }).click(); await A.waitForTimeout(300);
    const code = (await A.locator(".hint b").first().innerText()).trim(); ok("invite code made", /^[A-Z0-9]{6}$/.test(code), code);
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "Start · they serve first" }).click(); await A.waitForTimeout(200);
    await A.locator("button.ctrl", { hasText: /^Tracking/ }).click(); await A.getByRole("button", { name: /^Score only/ }).click(); await A.getByRole("button", { name: "Done", exact: true }).click();
    await A.waitForTimeout(2200);
    const B = await newPage(browser, { phone: true });
    await go(B, "join/" + code); await B.getByLabel("Email").fill("assistant@e2e.test"); await B.locator("#auth-pw").fill("secret123"); await B.locator("#auth-name").fill("Test Coach"); await B.locator(".auth-agree input").first().check(); await B.getByRole("button", { name: "Create account" }).click(); await B.waitForTimeout(500);
    await B.getByRole("button", { name: "Join team" }).click(); await B.waitForTimeout(1200);
    ok("a coach code waits for the head coach's approval", (await B.locator("body").innerText()).includes("Waiting for approval"));
    await approveCoach(A, B);
    await go(B, "track"); ok("assistant sees the live match", /CLOUD CLUB 0/.test(await score(B)));
    await B.locator("button.ctrl", { hasText: /^Tracking/ }).click(); await B.getByRole("button", { name: /^Stats only/ }).click(); await B.getByRole("button", { name: "Done", exact: true }).click();
    await B.locator(".pl", { hasText: "Nia" }).first().click(); await B.locator(".actsheet button", { hasText: /^3$/ }).click(); await skipIfAsked(B);
    ok("stats-only pass doesn't score", /CLOUD CLUB 0 .* 0 /.test(await score(B)), await score(B));
    await A.getByRole("button", { name: "Our point", exact: true }).click(); await A.waitForTimeout(2200);
    for (const P of [B, A]) { await go(P, "team"); await P.getByRole("button", { name: "Sync now" }).click(); await P.waitForTimeout(900); }
    await go(A, "track"); ok("head coach sees 1–0 and the assistant", /CLOUD CLUB 1/.test(await score(A)) && (await A.locator(".banner", { hasText: "Tracking with assistant" }).count()) === 1);
    // live link + parent
    await go(A, "live"); await A.getByRole("button", { name: "Share gamecast" }).click(); await A.waitForTimeout(1200);
    const live = (await A.locator("span.small.muted", { hasText: "/live/#/g/" }).first().innerText()).trim();
    const P = await newPage(browser, { phone: true }); await P.goto(live); await P.waitForTimeout(1200);
    const gcScore = async (pg) => (await pg.locator(".gs-big").allInnerTexts()).map((x) => x.trim()).join("–");
    ok("parent gamecast shows 1–0", (await gcScore(P)) === "1–0", await gcScore(P));
    ok("gamecast says it's live and in set 1", /Live · Set 1/i.test(await P.locator(".gs-status").innerText()));
    ok("parent gamecast fits a phone", (await overflow(P)) <= 1);
    // live: the coach keeps tracking (no "Sync now"), the parent's open page catches up on its own
    await go(A, "track"); for (let i = 0; i < 2; i++) { await A.getByRole("button", { name: "Our point", exact: true }).click(); await A.waitForTimeout(400); }
    { const t0 = Date.now(); let seen = ""; while (Date.now() - t0 < 15000) { seen = await gcScore(P); if (seen === "3–0") break; await P.waitForTimeout(500); }
      ok("gamecast updates live without reloading (within 15s)", seen === "3–0", `${seen.replace(/\s+/g, " ")} after ${Date.now() - t0}ms`); console.log(`    (gamecast caught up in ${Date.now() - t0}ms)`); }
    { const ax = await a11y(P); ok("gamecast controls all have names", !ax.length, ax.join(" | ")); }
    { const cx = await contrast(P); ok("gamecast text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    // season page + recruiting link
    await go(A, "team"); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1200);
    const season = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    await P.goto(season); await P.waitForTimeout(1200); ok("team page on FloorCall Live loads", (await P.locator(".lv-team", { hasText: "Cloud Club" }).count()) === 1);
    await P.goto(season + "/roster"); await P.waitForTimeout(800); ok("team roster shows first names", (await P.locator("body").innerText()).includes("Nia")); await P.goto(season); await P.waitForTimeout(800);
    ok("team page shows the live match with a link to the gamecast", (await P.locator(".lv-livecard .gs-big").first().innerText()).trim() === "3" && (await P.getByRole("link", { name: "Open the gamecast" }).count()) === 1);
    // the game from the team page: ESPN-style tabs
    await P.getByRole("link", { name: "Open the gamecast" }).click(); await P.waitForTimeout(500);
    await P.getByRole("button", { name: "Box score", exact: true }).click(); ok("box score lists Nia with her pass", (await P.locator(".lv-ebox tbody tr", { hasText: "Nia" }).count()) === 1);
    await P.getByRole("button", { name: "Leaders", exact: true }).click(); ok("leaders tab opens with game leaders", (await P.locator(".lv-ldr").count()) === 1 && ((await P.locator(".lv-ldr-cat").count()) === 0 || (await P.locator(".lv-ldr-p.them").count()) >= 1));
    await P.getByRole("button", { name: "Play-by-play", exact: true }).click(); { const n = [await P.locator(".lv-espn tbody tr.pt").count(), await P.locator(".lv-espn td.sc.on").count()], end = await P.locator(".lv-espn-end").innerText().catch(() => "");
      ok("play-by-play reads like a broadcast: scoring plays with both scores and the set line", n[0] >= 3 && n[1] >= 3 && /End of set|In progress/i.test(end), n.join(",") + " " + end); }
    await P.getByRole("button", { name: "Team stats", exact: true }).click(); ok("team stats compare both teams", (await P.locator(".lv-cmp-r").count()) >= 5);
    ok("Live site fits a phone", (await overflow(P)) <= 1);
    { const ax = await a11y(P); ok("Live game page controls all have names", !ax.length, ax.join(" | ")); }
    { const cx = await contrast(P); ok("Live game page text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    // families can type the code instead of opening the link
    await P.goto(season.replace(/#.*$/, "")); await P.getByLabel("Team or game code").fill(season.split("/").pop().toLowerCase()); await P.getByRole("button", { name: "Follow" }).click(); await P.waitForTimeout(800);
    ok("typing the team code opens the team page", (await P.locator(".lv-team", { hasText: "Cloud Club" }).count()) === 1);
    // a family that said no to team pages: Nia shows only as her number
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    await A.getByLabel("Keep off public pages").check(); await A.waitForTimeout(2500);
    await P.goto(season + "/roster"); await P.reload(); await P.waitForTimeout(1500);
    { const body = await P.locator("body").innerText(); ok("player kept off public pages shows only her number", !body.includes("Nia") && /22\s+Player/.test(body), body.slice(0, 400).replace(/\s+/g, " ")); }
    await A.getByLabel("Keep off public pages").uncheck(); await A.waitForTimeout(300);
    { const ax = await a11y(P); ok("team page controls all have names", !ax.length, ax.join(" | ")); }
    { const cx = await contrast(P); ok("team page text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    // clips: link the match video, line it up, watch the plays as clips and save one
    await go(A, "stats"); await A.getByRole("button", { name: "One match", exact: true }).click(); await A.getByRole("button", { name: "Film", exact: true }).click(); await A.waitForTimeout(200);
    await A.getByLabel("Video link").fill(U + "__fixtures/match.webm"); await A.getByLabel("Time of first serve in the video").fill("0:20"); await A.getByLabel("Time of first serve in the video").press("Tab"); await A.waitForTimeout(300);
    await A.getByRole("button", { name: /^Watch these \d+ plays as clips$/ }).click(); await A.waitForTimeout(2000);
    { const t = await A.locator(".clip-stage video").evaluate((v) => v.currentTime); ok("clips play from the match video at the play's time", t > 10 && t < 40, `at ${t}s`); }
    await A.getByRole("button", { name: "Next ›" }).click(); await A.waitForTimeout(400); ok("next clip moves through the list", (await A.locator(".clip-count").innerText()).startsWith("2 of"));
    { const sv = await download(A, () => A.getByRole("button", { name: "Save clip" }).click(), 30000); ok("a clip saves as a video file", sv.name.endsWith(".webm") && sv.size > 2000, `${sv.name} ${sv.size} bytes`); }
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    { const ax = await a11y(A); ok("player page controls all have names", !ax.length, ax.join(" | ")); }
    ok("recruiting card offers Nia's highlight clips", (await A.locator(".rc-clips", { hasText: /\d+ of Nia's best plays/ }).count()) === 1);
    ok("recruiting link needs family consent first", await A.getByRole("button", { name: "Share profile link" }).isDisabled());
    await A.locator(".consent-check input").check();
    await A.getByRole("button", { name: "Share profile link" }).click(); await A.waitForTimeout(1000);
    const rec = await A.locator("a", { hasText: "/recruit/#/p/" }).first().getAttribute("href");
    await P.goto(rec); await P.waitForTimeout(1200); ok("FloorCall Recruit shows the profile with her full name", (await P.locator(".rc-id h1").innerText()).toLowerCase() === "nia lopez");
    ok("profile says the stats are verified by the coaching staff", (await P.locator(".rc-verified").innerText()).includes("Cloud Club"));
    ok("profile plays her highlight clips", (await P.locator(".rc-card .clip-stage video").count()) === 1 && (await P.locator(".clip-list li").count()) >= 1);
    ok("Recruit profile fits a phone", (await overflow(P)) <= 1);
    { const ax = await a11y(P); ok("Recruit profile controls all have names", !ax.length, ax.join(" | ")); }
    { const cx = await contrast(P); ok("Recruit profile text has enough contrast", !cx.length, cx.slice(0, 3).join(" | ")); }
    // the team's recruiting board lists her
    await go(A, "team"); await A.getByRole("button", { name: "Share recruiting board" }).click(); await A.waitForTimeout(800);
    const board = await A.locator("a", { hasText: "/recruit/#/b/" }).first().getAttribute("href");
    await P.goto(board); await P.waitForTimeout(1000); ok("recruiting board lists players with shared profiles", (await P.locator(".rc-pc", { hasText: "Nia Lopez" }).count()) === 1);
    await P.locator(".rc-pc", { hasText: "Nia Lopez" }).click(); await P.waitForTimeout(800); ok("board opens the profile", (await P.locator(".rc-id h1").count()) === 1);
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Nia" }).first().click(); await A.waitForTimeout(300);
    await A.waitForTimeout(600); ok("the coach sees how often the profile was opened", /Opened 1 time\b/.test(await A.locator(".card", { hasText: "Recruiting profile" }).innerText()), (await A.locator(".card", { hasText: "Recruiting profile" }).innerText()).slice(-300));
    await A.getByRole("button", { name: "Stop sharing" }).click(); await A.getByRole("button", { name: "Take it down?" }).click(); await A.waitForTimeout(600);
    await P.goto(rec); await P.reload(); await P.waitForTimeout(1000); ok("taken-down profile no longer opens", (await P.getByText("isn't shared right now").count()) === 1);
    // AI through the server function, and the setup check
    const sent = []; A.on("request", (r) => { if (r.url().includes("/functions/v1/ai")) sent.push(r.postData() || ""); });
    await go(A, "stats"); ok("the open-ended Ask your stats chat is off", (await A.getByLabel("Question about your stats").count()) === 0);
    { const before = sent.length; await A.getByRole("button", { name: "Write the report" }).first().click(); await A.waitForTimeout(1200);
      ok("a match report goes through the server AI function", sent.length > before, String(sent.length)); }
    { const lasts = fs.readFileSync(path.join(__dirname, "roster.csv"), "utf8").split("\n").slice(1).map((l) => l.split(",")[2]).filter(Boolean);
      ok("AI requests carry first names only, never last names", sent.length > 0 && sent.join("").includes("Nia") && !lasts.some((n) => sent.join("").includes(n)), lasts.filter((n) => sent.join("").includes(n)).join(", ")); }
    await fetch(`http://localhost:${MOCK_PORT}/__mock/make-admin?email=head%40e2e.test`, { headers: { apikey: "anon" } }); await A.reload(); await A.waitForTimeout(800);
    await go(A, "settings"); await A.waitForTimeout(600); await A.getByRole("button", { name: "Run check" }).click(); await A.waitForTimeout(1000);
    const notOk = await A.locator(".check-list li:not(.sc-ok) b").allInnerTexts();
    ok("setup check: the cloud, account, sync and AI are all ✓", (await A.locator(".check-list li.sc-ok").count()) >= 5 && notOk.every((x) => ["Installed on this device", "Privacy contact", "Sign-up emails"].includes(x)) && notOk.includes("Sign-up emails"), notOk.join(", "));
    // player fees sync to the team's coaches, and only to them
    if (FEES_ON) { await go(A, "team"); const card = A.locator(".card", { has: A.getByRole("heading", { name: "Player fees" }) });
      await card.getByLabel("Fee per player").fill("300"); await card.getByRole("button", { name: "Start tracking fees" }).click(); await A.waitForTimeout(150);
      await card.locator(".fee-row", { hasText: "Maya" }).first().click(); await card.getByLabel("Amount Maya paid").fill("100"); await card.getByRole("button", { name: "Record payment" }).click(); await A.waitForTimeout(2500);
      await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(800);
      await go(B, "team"); await B.getByRole("button", { name: "Sync now" }).click(); await B.waitForTimeout(1000); await B.reload(); await B.waitForTimeout(800);
      ok("fees: the assistant coach sees the payments", /\$100 of/.test(await B.locator(".card", { has: B.getByRole("heading", { name: "Player fees" }) }).innerText().catch(() => "")));
      const recs = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/records`)).json();
      ok("fees: never inside the shared team record", recs.filter((r) => r.store === "teams").every((r) => !("fees" in (r.data || {}))) && recs.some((r) => r.store === "teams")); }
    // a view-only parent account can follow along but can't change the team's data
    await go(A, "team"); await A.getByRole("button", { name: "Invite view-only" }).click(); await A.waitForTimeout(300);
    const vcode = (await A.locator(".hint b").first().innerText()).trim();
    const V = await newPage(browser, { phone: true });
    await go(V, "join/" + vcode); await V.getByLabel("Email").fill("parent@e2e.test"); await V.locator("#auth-pw").fill("secret123"); await V.locator("#auth-name").fill("Test Coach"); await V.locator(".auth-agree input").first().check(); await V.getByRole("button", { name: "Create account" }).click(); await V.waitForTimeout(500);
    await V.getByRole("button", { name: "Join team" }).click(); await V.waitForTimeout(1500);
    await go(V, "team"); await V.getByRole("button", { name: "Sync now" }).click(); await V.waitForTimeout(800);
    await go(V, "track"); await V.waitForTimeout(300);
    ok("players and families get stats, not the coaching tools", (await V.locator(".hm-head, .home").count()) > 0 && (await V.locator(".nav a.tab[href='#/track'], .nav a.tab[href='#/matchup'], .nav a.tab[href='#/practice']").count()) === 0);
    await go(V, "matchup"); await V.waitForTimeout(300); ok("a view-only member who opens a coaching page lands on Home", (await V.locator("h1", { hasText: "Matchups" }).count()) === 0);
    if (FEES_ON) await go(V, "team"); if (FEES_ON) ok("fees: a view-only member never sees them", (await V.getByRole("heading", { name: "Player fees" }).count()) === 0 && !(await V.evaluate(() => JSON.stringify(localStorage) + document.body.innerText)).includes("Maya paid"));
    for (const [n, pg] of [["head coach", A], ["assistant", B], ["parent", P], ["viewer", V]]) ok(`cloud: no page errors (${n})`, !pg.errors.length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, B, P, V]) await pg.context().close();
  },
  /** New-user walkthroughs as a coach, a player and a parent, on a phone (SHOTS=dir node e2e/run.cjs _walk). Not in the regular run. */
  async _walk(browser) {
    const OUT = process.env.SHOTS || "/tmp/walk"; fs.mkdirSync(OUT, { recursive: true });
    const found = [];
    let n = 0;
    const look = async (p, who, label) => {
      await p.waitForTimeout(450);
      const ov = await overflow(p), ax = await a11y(p).catch(() => []);
      const text = await p.locator("body").innerText().catch(() => "");
      const bad = (text.match(/undefined|NaN|\[object|Infinity|null\b/g) || []).filter((x) => x !== "null" || /\bnull\b/.test(text));
      if (ov > 0) found.push(`${who} · ${label}: page scrolls sideways by ${ov}px`);
      if (ax.length) found.push(`${who} · ${label}: unlabeled controls: ${ax.slice(0, 4).join(", ")}`);
      if (bad.length) found.push(`${who} · ${label}: shows "${[...new Set(bad)].join(", ")}"`);
      if (p.errors.length) { found.push(`${who} · ${label}: page errors: ${p.errors.slice(0, 2).join(" | ")}`); p.errors.length = 0; }
      await p.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${who}-${label}.png`), fullPage: true });
    };
    const signUpApp = async (p, email, name) => {
      await go(p, "account/signup"); { const ca = p.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
      await p.getByLabel("Email").fill(email); await p.locator("#auth-pw").fill("secret-pass-1"); await p.locator("#auth-name").fill(name); await p.locator(".auth-agree input").first().check();
      await p.getByRole("button", { name: "Create account" }).click(); await p.waitForTimeout(800);
    };
    // ---------- 1. a new head coach ----------
    const C = await newPage(browser, { phone: true });
    await C.goto(U + "about.html"); await look(C, "coach", "product-page");
    await C.goto(U + "pricing.html"); await look(C, "coach", "pricing");
    await signUpApp(C, "walk-coach@e2e.test", "Jordan Rivera"); await look(C, "coach", "after-signup");
    await C.getByLabel("Team name").fill("Valley Prep Varsity"); await C.getByRole("button", { name: "Create team" }).click(); await C.waitForTimeout(900); await look(C, "coach", "new-team");
    await C.getByRole("button", { name: "Paste list" }).click(); await C.locator("textarea").first().fill(["1 Ava Ramirez S", "4 Jordan Lee OH", "7 Maya Chen OH", "9 Riley Brooks MB", "12 Zoe Grant OPP", "14 Kenzie Park MB", "3 Lily Torres L"].join("\n")); await C.getByRole("button", { name: "Add players", exact: true }).click(); await C.waitForTimeout(400);
    { const perm = C.getByRole("button", { name: "I have permission" }); if (await perm.count()) await perm.click(); }
    await look(C, "coach", "team-roster");
    await go(C, "home"); await look(C, "coach", "home");
    await go(C, "lineup"); await look(C, "coach", "lineup");
    await go(C, "track"); await look(C, "coach", "track-start");
    { const opp = C.getByPlaceholder("e.g. Buchanan"); if (await opp.count()) { await opp.fill("Central"); await C.getByRole("button", { name: /Start · we serve first/ }).click(); await C.waitForTimeout(400); } }
    await look(C, "coach", "track-match");
    for (const [pl, act] of [["Maya", /^Kill$/], ["Zoe", /^Ace$/], ["Jordan", /^Error$/], ["Lily", /^Dig$/]]) { const b = C.locator(".pl", { hasText: pl }).first(); if (await b.count()) { await b.click(); const sheet = C.locator(".actsheet button", { hasText: act }); const a = (await sheet.count()) ? sheet.first() : C.locator(".pad .act", { hasText: act }).first(); if (await a.count()) await a.click({ timeout: 3000 }).catch(() => found.push("coach · track: couldn't tap " + act)); await skipIfAsked(C); await C.waitForTimeout(150); } }
    await look(C, "coach", "track-after-plays");
    await go(C, "stats"); await look(C, "coach", "stats");
    await go(C, "matchup"); await look(C, "coach", "matchup");
    await go(C, "practice"); await look(C, "coach", "practice");
    await go(C, "court"); await look(C, "coach", "court");
    await go(C, "film"); await look(C, "coach", "film");
    await go(C, "live"); await look(C, "coach", "live-control");
    await go(C, "team"); await look(C, "coach", "team-full");
    await go(C, "settings"); await look(C, "coach", "settings");
    await C.goto(U + "academy/"); await look(C, "coach", "academy");
    await C.goto(U + "academy/#/coaches/passing"); await look(C, "coach", "academy-skill");
    await C.goto(U + "beach/"); await look(C, "coach", "beach");
    await C.goto(U + "recruit/"); await look(C, "coach", "recruit");
    await C.goto(U + "live/"); await look(C, "coach", "live-site");
    // invite codes for the player and the parent
    await go(C, "team"); { const sy = C.getByRole("button", { name: "Sync this team" }); if (await sy.count()) { await sy.click(); await C.waitForTimeout(1200); } }
    await look(C, "coach", "team-synced");
    let vcode = "";
    { const iv = C.getByRole("button", { name: "Invite view-only" }); if (await iv.count()) { await iv.click(); await C.waitForTimeout(400); vcode = (await C.locator(".hint b").first().innerText().catch(() => "")).trim(); } }
    if (!vcode) found.push("coach · team: couldn't make a view-only code for players");
    // ---------- 2. a new player ----------
    const P = await newPage(browser, { phone: true });
    await P.goto(U + "recruit/"); await look(P, "player", "recruit-gate");
    await siteSignUp(P, "walk-player@e2e.test", "athlete", "Maya Chen"); await look(P, "player", "recruit-in");
    await P.goto(U + "recruit/#/guide"); await look(P, "player", "recruit-guide");
    await P.goto(U + "academy/"); await look(P, "player", "academy");
    await P.goto(U + "academy/#/coaches/hitting"); await look(P, "player", "academy-coach-link");
    await P.goto(U + "beach/"); await look(P, "player", "beach");
    if (vcode) { await go(P, "join/" + vcode); await look(P, "player", "join-code"); const j = P.getByRole("button", { name: "Join team" }); if (await j.count()) { await j.click(); await P.waitForTimeout(1500); } }
    await go(P, "home"); await look(P, "player", "app-home");
    await go(P, "stats"); await look(P, "player", "app-stats");
    await go(P, "team"); await look(P, "player", "app-team");
    await go(P, "settings"); await look(P, "player", "app-settings");
    await go(P, "track"); await look(P, "player", "app-track-blocked");
    await P.goto(U + "live/"); await look(P, "player", "live");
    // ---------- 3. a new parent ----------
    const F = await newPage(browser, { phone: true });
    await F.goto(U + "live/"); await look(F, "parent", "live-first");
    await F.goto(U + "academy/"); await look(F, "parent", "academy-gate");
    await siteSignUp(F, "walk-parent@e2e.test", "parent", "Dana Chen"); await look(F, "parent", "academy-in");
    if (vcode) { await go(F, "join/" + vcode); const j = F.getByRole("button", { name: "Join team" }); if (await j.count()) { await j.click(); await F.waitForTimeout(1500); } }
    await go(F, "home"); await look(F, "parent", "app-home");
    await go(F, "team"); await look(F, "parent", "app-team");
    await F.goto(U + "beach/"); await look(F, "parent", "beach");
    // ---------- 4. FloorCall Lessons: the coach trains privately, the parent and player join ----------
    await C.goto(U + "lessons/"); await look(C, "coach", "lessons-empty");
    { const add = C.getByRole("link", { name: "Add athletes" }); if (await add.count()) await add.click(); await C.waitForTimeout(300);
      await C.getByLabel("Name", { exact: true }).fill("Maya Chen"); await C.getByRole("button", { name: "Add athlete" }).click(); await C.waitForTimeout(500); }
    await look(C, "coach", "lessons-athletes");
    let lcode = "";
    { await C.locator(".ls-athletes a", { hasText: "Maya Chen" }).click(); await C.waitForTimeout(300); const mk = C.getByRole("button", { name: "Make an invite code" }); if (await mk.count()) { await mk.click(); await C.waitForTimeout(500); } lcode = (await C.locator(".ls-code-big").innerText().catch(() => "")).trim(); }
    await look(C, "coach", "lessons-athlete");
    if (!lcode) found.push("coach · lessons: no invite code for an athlete");
    await C.goto(U + "lessons/#/new"); await C.waitForTimeout(300);
    await C.getByRole("button", { name: "Passing" }).click(); await C.locator(".ls-pick-list label", { hasText: "Maya Chen" }).locator("input").check().catch(() => {});
    await C.locator(".ls-switches label", { hasText: "Athletes can book" }).locator("input").check().catch(() => {}); await look(C, "coach", "lessons-new");
    await C.getByRole("button", { name: "Schedule", exact: true }).click(); await C.waitForTimeout(600); await look(C, "coach", "lessons-session");
    { const cr = C.getByRole("link", { name: "Count reps" }); if (await cr.count()) { await cr.click(); await C.waitForTimeout(300); await C.getByRole("button", { name: "Passing: 3", exact: true }).click(); await look(C, "coach", "lessons-count"); await C.getByRole("button", { name: "Done" }).click(); await C.waitForTimeout(600); } }
    await C.goto(U + "lessons/"); await look(C, "coach", "lessons-schedule");
    await P.goto(U + "lessons/"); await look(P, "player", "lessons-no-code");
    if (lcode) { await P.getByLabel("Code from your trainer").fill(lcode); await P.getByRole("button", { name: "Join", exact: true }).click(); await P.waitForTimeout(800); await look(P, "player", "lessons-joined"); }
    if (lcode) { await F.goto(U + "lessons/#/join/" + lcode); await F.waitForTimeout(500); await F.getByRole("button", { name: "Join", exact: true }).click(); await F.waitForTimeout(800); await look(F, "parent", "lessons-joined");
      if (!(await F.locator(".ls-page").innerText()).includes("Maya's lessons")) found.push("parent · lessons: the joined view doesn't name the athlete"); }
    // ---------- 5. a club director with four teams ----------
    const D = await newPage(browser, { size: { width: 1366, height: 900 } });
    await signUpApp(D, "walk-director@e2e.test", "Pat Director"); await look(D, "director", "after-signup");
    await D.getByLabel("Team name").fill("Valley Elite 16 Navy"); await D.getByLabel("Level").fill("16U Club"); await D.getByRole("button", { name: "Create team" }).click(); await D.waitForTimeout(800);
    for (const [nm, lv] of [["Valley Elite 15 Navy", "15U Club"], ["Valley Elite 17 Navy", "17U Club"], ["Valley Elite 18 Navy", "18U Club"]]) {
      await go(D, "team/new"); await D.waitForTimeout(300);
      if (!(await D.locator("#nt-name").count())) { await go(D, "home"); await D.locator(".tm-btn, .team-menu button").first().click().catch(() => {}); await D.getByRole("menuitem", { name: /New team|Add a team/ }).click().catch(() => {}); await D.waitForTimeout(300); }
      if (await D.locator("#nt-name").count()) { await D.locator("#nt-name").fill(nm); await D.locator("#nt-level").fill(lv); await D.getByRole("button", { name: "Create team" }).click(); await D.waitForTimeout(700); }
      else { found.push("director: couldn't find how to add a second team"); break; }
    }
    await go(D, "club"); await look(D, "director", "club");
    await go(D, "tryouts"); await look(D, "director", "tryouts");
    await go(D, "home"); await look(D, "director", "home");
    await D.goto(U + "pricing.html"); await look(D, "director", "pricing");
    await D.goto(U + "lessons/"); await look(D, "director", "lessons");
    // ---------- 6. a college coach ----------
    const K = await newPage(browser, { size: { width: 1366, height: 900 } });
    await signUpApp(K, "coach.k@state.edu", "Kim Alvarez"); await K.getByLabel("Team name").fill("State University"); await K.getByLabel("Level").fill("College");
    await look(K, "college", "new-team");
    if ((await K.locator("#nt-g").innerText()) !== "Women or men") found.push("college: new team still asks girls or boys");
    await K.getByRole("button", { name: "Create team" }).click(); await K.waitForTimeout(800);
    await go(K, "team"); await look(K, "college", "team");
    await go(K, "track"); { const opp = K.getByPlaceholder("e.g. Buchanan"); if (await opp.count()) { await opp.fill("Tech"); await K.getByRole("button", { name: /Start · we serve first/ }).click(); await K.waitForTimeout(400); } } await look(K, "college", "track");
    await go(K, "matchup"); await look(K, "college", "scouting");
    await go(K, "film"); await look(K, "college", "film");
    await K.goto(U + "recruit/"); await look(K, "college", "recruit");
    await K.goto(U + "lessons/"); await look(K, "college", "lessons");
    // ---------- 7. a professional men's team coach ----------
    const R = await newPage(browser, { size: { width: 1366, height: 900 } });
    await signUpApp(R, "walk-pro@e2e.test", "Luca Bianchi"); await R.getByLabel("Team name").fill("Bay Spikers"); await R.getByLabel("Level").fill("Professional");
    { const men = R.getByRole("button", { name: "Men", exact: true }); if (await men.count()) await men.click(); else found.push("pro: no Men option"); }
    await R.getByRole("button", { name: "Create team" }).click(); await R.waitForTimeout(800);
    await go(R, "team"); await R.getByRole("button", { name: "Paste list" }).click(); await R.locator("textarea").first().fill(["2 Marco Rossi S", "5 Theo Laurent OH", "8 Ken Ito OPP", "11 Dante Silva MB", "13 Jonas Berg MB", "17 Ari Cohen OH", "1 Leo Park L"].join("\n")); await R.getByRole("button", { name: "Add players" }).click(); await R.waitForTimeout(400);
    await look(R, "pro", "team");
    if ((await R.getByRole("group", { name: "Women or men" }).count()) !== 1) found.push("pro: team settings still say girls or boys");
    await go(R, "practice"); await look(R, "pro", "practice");
    await go(R, "track"); { const opp = R.getByPlaceholder("e.g. Buchanan"); if (await opp.count()) { await opp.fill("Harbor City"); await R.getByRole("button", { name: /Start · we serve first/ }).click(); await R.waitForTimeout(400); } } await look(R, "pro", "track");
    await go(R, "stats"); await look(R, "pro", "stats");
    await R.goto(U + "academy/"); await look(R, "pro", "academy");
    console.log("\n  FOUND:\n" + (found.length ? found.map((x) => "   - " + x).join("\n") : "   nothing automatic"));
    for (const pg of [C, P, F, D, K, R]) await pg.context().close();
  },
  /** A walk through everything with screenshots (node e2e/run.cjs _explore). Not part of the regular run. */
  async _explore(browser) {
    const OUT = process.env.SHOTS || path.join(require("os").tmpdir(), "bb-explore"); fs.mkdirSync(OUT, { recursive: true });
    let n = 0; const shot = async (pg, name, full = false) => { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full }); };
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("coach@explore.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(600);
    await A.getByLabel("Team name").fill("Clovis North"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await go(A, "team"); await A.getByRole("button", { name: "Paste a roster" }).click();
    await A.locator("textarea").first().fill(["1 Ava Ramirez S Sr 5'8\"", "3 Lily Torres L Jr", "4 Jordan Lee OH So 5'10\"", "7 Maya Chen OH Sr 5'11\"", "8 Zoe Grant MB Jr 6'1\"", "9 Riley Brooks MB So", "10 Emma Diaz DS Fr", "12 Sofia Nguyen OPP Jr 5'11\"", "14 Kenzie Park OH Sr", "15 Harper Kim S So"].join("\n"));
    await A.getByRole("button", { name: "Add players" }).click(); await A.waitForTimeout(300);
    const perm = A.getByRole("button", { name: "I have permission" }); if (await perm.count()) await perm.click();
    const syncBtn = A.getByRole("button", { name: /Sync this team/ }); if (await syncBtn.count()) { await syncBtn.click(); await A.waitForTimeout(1500); }
    await shot(A, "team-desktop", true);
    await go(A, "lineup"); await shot(A, "lineup-desktop", true);
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await shot(A, "track-prematch");
    await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(400);
    await shot(A, "track-start");
    // share the live link and open it on a parent's phone before play starts
    await go(A, "live"); await A.getByRole("button", { name: "Share gamecast" }).click(); await A.waitForTimeout(1200);
    const live = (await A.locator("span.small.muted", { hasText: "/live/#/g/" }).first().innerText()).trim();
    const P = await newPage(browser, { phone: true }); await P.goto(live); await P.waitForTimeout(1500); await shot(P, "gamecast-parent-start", true);
    // a realistic match by keyboard: serve, pass, set, attack, dig
    await go(A, "track");
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const hitters = ["4", "7", "8", "9", "12", "14"], passers = ["3", "10", "4", "7"], servers = ["1", "4", "7", "8", "12", "14", "3"];
    const key = async (k) => { await A.keyboard.press(k); };
    const num = async (x) => { for (const ch of x.padStart(2, "0") === x ? x : x) await A.keyboard.type(ch); await A.waitForTimeout(x.length === 1 ? 850 : 50); };
    const play = async () => {
      const r = rnd();
      if (r < 0.06) { await num(pick(servers)); await key("s"); }
      else if (r < 0.12) { await num(pick(servers)); await key(pick(["n", "o"])); }
      else if (r < 0.2) { await key("A"); }
      else if (r < 0.32) { await key("E"); }
      else if (r < 0.45) { await key("K"); }
      else { await num(pick(passers)); await key("p"); await key(pick(["3", "2", "2", "1"])); await num("1"); await key("h"); await num(pick(hitters)); await key(pick(["k", "k", "w", "e", "r", "k"])); }
      await A.keyboard.press("Escape"); await A.waitForTimeout(60);
    };
    for (let i = 0; i < 40; i++) await play();
    await shot(A, "track-midset");
    await P.waitForTimeout(6000); await shot(P, "gamecast-parent-mid", true);
    await P.getByLabel("Follow a player").selectOption({ label: "#7 Maya C." }).catch(() => {}); await P.waitForTimeout(300); await shot(P, "gamecast-follow", true);
    for (let i = 0; i < 80; i++) { if (await A.locator(".banner", { hasText: /Match over/ }).count()) break; await play(); const nx = A.getByRole("button", { name: /serve$/ }); if (await nx.count() && await A.locator(".banner", { hasText: /^Set \d to/ }).count()) { await shot(A, `set-banner-${i}`); await nx.first().click(); } }
    await shot(A, "track-later");
    await go(A, "live"); await shot(A, "live-desktop", true);
    await go(A, "stats"); await shot(A, "stats-overview", true);
    for (const t of ["Players", "Offense", "Serve & pass", "Rotations", "Situations", "Opponent", "Film", "Fix plays"]) { const b = A.getByRole("button", { name: t, exact: true }); if (await b.count()) { await b.first().click(); await shot(A, "stats-" + t.replace(/\W+/g, "-").toLowerCase(), true); } }
    for (const r of ["matchup", "practice", "court", "labs", "settings", "club"]) { await go(A, r); await shot(A, r, true); }
    // the same coach on a phone
    const Ph = await newPage(browser, { phone: true });
    await go(Ph, "account"); await Ph.getByLabel("Email").fill("coach@explore.test"); await Ph.locator("#auth-pw").fill("secret123"); await Ph.getByRole("button", { name: "Sign in" }).click(); await deviceCode(Ph, "coach@explore.test"); await Ph.waitForTimeout(2500);
    for (const r of ["track", "lineup", "matchup", "practice", "stats", "court", "team", "settings", "live"]) { await go(Ph, r); await shot(Ph, "phone-" + r, true); }
    await P.waitForTimeout(5500); await shot(P, "gamecast-parent-late", true);
    await go(A, "team"); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1200);
    const season = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    await P.goto(season); await P.waitForTimeout(1500); await shot(P, "season-page", true);
    for (const [nm, pg] of [["coach", A], ["parent", P], ["phone", Ph]]) if (pg.errors.length) console.log(`    ${nm} errors: ${pg.errors.slice(0, 5).join(" | ")}`);
    console.log("    screenshots: " + OUT);
  },
  /** A first-time tester with no cloud (like the test link): first run, tournament day and imports on a phone. (node e2e/run.cjs _explore4) */
  async _explore4(browser) {
    const OUT = process.env.SHOTS || path.join(require("os").tmpdir(), "bb-explore4"); fs.mkdirSync(OUT, { recursive: true });
    let n = 0; const shot = async (pg, name, full = true) => { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full }); };
    for (const phone of [true, false]) {
      const tag = phone ? "ph" : "dt";
      const p = await newPage(browser, { phone, cloud: false });
      const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`    ${tag} step "${name}" failed: ${String(e.message || e).split("\n")[0]}`); await shot(p, tag + "-FAIL-" + name.replace(/\W+/g, "-")); } };
      await step("first run", async () => { await p.goto(U); await p.waitForTimeout(600); await shot(p, tag + "-first-run", false); });
      await step("no account", async () => { await p.getByRole("button", { name: "Use without an account" }).click(); await p.waitForTimeout(300); await shot(p, tag + "-create-team", false); await p.getByLabel("Team name").fill("Clovis North"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(500); await shot(p, tag + "-after-create"); });
      await step("roster", async () => { await go(p, "team"); await p.getByRole("button", { name: "Paste list" }).click(); await p.locator("textarea").first().fill(["1 Ava Ramirez S", "3 Lily Torres L", "4 Jordan Lee OH", "7 Maya Chen OH", "8 Zoe Grant MB", "9 Riley Brooks MB", "10 Emma Diaz DS", "12 Sofia Nguyen OPP"].join("\n")); await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(300); await shot(p, tag + "-team"); });
      await step("import", async () => { await p.locator("input[type=file][multiple]").setInputFiles([path.join(__dirname, "fixtures/Buchanan.txt"), path.join(__dirname, "fixtures/game-log.csv")]); await p.waitForTimeout(800); await shot(p, tag + "-import-review"); await p.getByRole("button", { name: /^Import \d+ match/ }).click(); await p.waitForTimeout(600); await shot(p, tag + "-after-import"); });
      await step("tournament", async () => { await go(p, "matchup"); await shot(p, tag + "-matchup"); await p.getByRole("button", { name: "New tournament" }).click(); await shot(p, tag + "-tn-new", false);
        await p.getByLabel("Name", { exact: true }).fill("Fall Classic"); await p.getByLabel("Where").fill("Fresno Convention Center"); await p.getByRole("button", { name: "Create tournament" }).click(); await p.waitForTimeout(300); await shot(p, tag + "-tn-empty");
        for (const [stage, opp, time, court, round] of [["Pool", "Buchanan", "09:00", "3"], ["Pool", "Central", "10:00", "3"], ["Work (ref)", "Buchanan vs Central", "11:00", "3"], ["Bracket", "Fresno Elite", "13:00", "1", "Semifinal"]]) {
          if (await p.getByRole("button", { name: "Add a game" }).count()) await p.getByRole("button", { name: "Add a game" }).click();
          await p.getByRole("button", { name: stage, exact: true }).click(); await p.locator(".tn-add input[list=tn-teams]").fill(opp); await p.getByLabel("Time").fill(time); await p.getByLabel("Court").fill(court); if (round) await p.getByLabel("Round").fill(round);
          await p.getByRole("button", { name: "Add game" }).click(); await p.waitForTimeout(150); }
        await shot(p, tag + "-tn-full"); });
      await step("home", async () => { await go(p, "track"); await shot(p, tag + "-home-tournament"); });
      await step("stats", async () => { await go(p, "stats"); await shot(p, tag + "-stats-with-imports"); });
      await step("settings", async () => { await go(p, "settings"); await shot(p, tag + "-settings"); });
      if (p.errors.length) console.log(`    ${tag} errors: ${p.errors.slice(0, 4).join(" | ")}`);
      await p.context().close();
    }
    console.log("    screenshots: " + OUT);
  },
  /** Phone coach, taps only: lineup, subs, timeout, tags, a full match, player page, practice. (node e2e/run.cjs _explore2) */
  async _explore2(browser) {
    const OUT = process.env.SHOTS || path.join(require("os").tmpdir(), "bb-explore2"); fs.mkdirSync(OUT, { recursive: true });
    let n = 0; const shot = async (pg, name, full = true) => { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full }); };
    const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`    step "${name}" failed: ${String(e.message || e).split("\n")[0]}`); await shot(p, "FAIL-" + name.replace(/\W+/g, "-")); } };
    const p = await newPage(browser, { phone: true, cloud: false });
    await step("setup", async () => {
      await go(p, "track"); await p.getByRole("button", { name: "Use without an account" }).click(); await p.getByLabel("Team name").fill("Clovis North Broncos"); await p.getByRole("button", { name: "Create team" }).click(); await p.waitForTimeout(500);
      await go(p, "team"); await p.getByRole("button", { name: "Paste a roster" }).click();
      await p.locator("textarea").first().fill(["1 Ava Ramirez S Sr", "3 Lily Torres L Jr", "4 Jordan Lee OH So", "7 Maya Chen OH Sr", "8 Zoe Grant MB Jr", "9 Riley Brooks MB So", "10 Emma Diaz DS Fr", "12 Sofia Nguyen OPP Jr", "14 Kenzie Park OH Sr"].join("\n"));
      await p.getByRole("button", { name: "Add players" }).click(); await p.waitForTimeout(300);
    });
    await step("lineup", async () => { await go(p, "lineup"); await shot(p, "lineup-default"); await p.getByRole("button", { name: "Save as starting lineup" }).click(); });
    await step("start", async () => { await go(p, "track"); await shot(p, "track-prematch"); await p.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await p.getByRole("button", { name: "Start · we serve first" }).click(); await p.waitForTimeout(300); await shot(p, "track-start", false); });
    await step("kill with follow-up", async () => { await p.locator(".pl", { hasText: "Maya" }).first().click(); await shot(p, "action-sheet", false); await p.locator(".actsheet").getByRole("button", { name: "Kill", exact: true }).click(); await p.waitForTimeout(200); await shot(p, "after-kill", false); await skipIfAsked(p); });
    await step("pass then attack error", async () => { await p.locator(".pl", { hasText: "Lily" }).first().click(); await p.locator(".actsheet button", { hasText: /^2$/ }).first().click(); await skipIfAsked(p); await p.locator(".pl", { hasText: "Jordan" }).first().click(); await p.locator(".actsheet").getByRole("button", { name: "Error", exact: true }).first().click(); await skipIfAsked(p); await shot(p, "after-error", false); });
    await step("timeout", async () => { await p.getByRole("button", { name: /^Timeout · Clovis/ }).click(); await p.waitForTimeout(900); await shot(p, "timeout-panel", false); await p.keyboard.press("Escape"); });
    await step("sub", async () => { await go(p, "track"); await p.locator("button.ctrl", { hasText: /^Sub/ }).click(); await p.waitForTimeout(200); await shot(p, "sub-panel"); });
    await step("film tag", async () => { await go(p, "track"); await p.locator("button.ctrl", { hasText: /^Film tag/ }).click(); await p.waitForTimeout(200); await shot(p, "tag-panel"); });
    await step("play the match", async () => {
      await go(p, "track");
      for (let set = 0; set < 3; set++) {
        for (let i = 0; i < 60; i++) { if (await p.locator(".banner", { hasText: /to Clovis|Match over/ }).count()) break; await p.getByRole("button", { name: i % 3 ? "Their error" : "Their kill", exact: true }).click(); await skipIfAsked(p); }
        if (set === 0) { await p.waitForTimeout(900); await shot(p, "set-over", false); }
        if (await p.locator(".banner", { hasText: "Match over" }).count()) break;
        await p.getByRole("button", { name: /Clovis North Broncos serve|Clovis North serve/ }).first().click();
      }
      await shot(p, "match-over");
      await p.getByRole("button", { name: "Finish" }).click(); await p.waitForTimeout(300); await shot(p, "after-finish");
    });
    await step("player page", async () => { await go(p, "stats"); await shot(p, "stats-after"); await p.getByRole("button", { name: "Players", exact: true }).click(); await p.locator("tr.click", { hasText: "Maya" }).first().click(); await p.waitForTimeout(300); await shot(p, "player-page"); });
    await step("practice plan", async () => { await go(p, "practice"); await shot(p, "practice"); await p.getByRole("button", { name: "Build plan" }).click(); await p.waitForTimeout(300); await shot(p, "plan-built"); await p.getByRole("button", { name: "Run practice" }).click(); await p.waitForTimeout(300); await shot(p, "run-practice", false); });
    await step("scrimmage", async () => { await go(p, "practice"); await p.getByRole("button", { name: "Scrimmage", exact: true }).click(); await shot(p, "scrimmage"); });
    await step("other tabs", async () => { for (const r of ["matchup", "court", "labs", "settings"]) { await go(p, r); await shot(p, r); } });
    if (p.errors.length) console.log(`    errors: ${p.errors.slice(0, 5).join(" | ")}`);
    console.log("    screenshots: " + OUT);
  },
  /** FloorCall Live and Recruit with screenshots (node e2e/run.cjs _explore3). */
  async _explore3(browser) {
    const OUT = process.env.SHOTS || path.join(require("os").tmpdir(), "bb-explore3"); fs.mkdirSync(OUT, { recursive: true });
    let n = 0; const shot = async (pg, name, full = true) => { await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full }); };
    const A = await newPage(browser);
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("coach3@explore.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(600);
    await A.getByLabel("Team name").fill("Clovis North"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await go(A, "team"); await A.getByRole("button", { name: "Paste a roster" }).click();
    await A.locator("textarea").first().fill(["1 Ava Ramirez S Sr 5'8\"", "3 Lily Torres L Jr", "4 Jordan Lee OH So 5'10\"", "7 Maya Chen OH Sr 5'11\"", "8 Zoe Grant MB Jr 6'1\"", "9 Riley Brooks MB So", "10 Emma Diaz DS Fr", "12 Sofia Nguyen OPP Jr 5'11\""].join("\n"));
    await A.getByRole("button", { name: "Add players" }).click(); await A.waitForTimeout(300);
    const perm = A.getByRole("button", { name: "I have permission" }); if (await perm.count()) await perm.click();
    const syncBtn = A.getByRole("button", { name: /Sync this team/ }); if (await syncBtn.count()) { await syncBtn.click(); await A.waitForTimeout(1500); }
    await go(A, "lineup"); await A.getByRole("button", { name: "Save as starting lineup" }).click();
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(400);
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; const pick = (a) => a[Math.floor(rnd() * a.length)];
    const num = async (x) => { await A.keyboard.type(x); await A.waitForTimeout(x.length === 1 ? 850 : 50); };
    const play = async () => { const r = rnd();
      if (r < 0.08) { await num(pick(["1", "4", "7", "8", "12"])); await A.keyboard.press("s"); }
      else if (r < 0.14) { await num(pick(["4", "12"])); await A.keyboard.press("n"); }
      else if (r < 0.22) await A.keyboard.press("A"); else if (r < 0.34) await A.keyboard.press("E"); else if (r < 0.46) await A.keyboard.press("K");
      else { await num(pick(["3", "10", "4", "7"])); await A.keyboard.press("p"); await A.keyboard.press(pick(["3", "2", "2", "1"])); await num("1"); await A.keyboard.press("h"); await num(pick(["4", "7", "7", "8", "12"])); await A.keyboard.press(pick(["k", "k", "w", "e", "k"])); }
      await A.keyboard.press("Escape"); await A.waitForTimeout(40); };
    for (let set = 0; set < 2; set++) { for (let i = 0; i < 70; i++) { if (await A.locator(".banner", { hasText: /to Clovis|to Buchanan|Match over/ }).count()) break; await play(); } const nx = A.getByRole("button", { name: "Clovis North serve" }); if (await nx.count()) await nx.click(); }
    for (let i = 0; i < 18; i++) await play();
    // video + clips
    await go(A, "stats"); await A.getByRole("button", { name: "One match", exact: true }).click(); await A.getByRole("button", { name: "Film", exact: true }).click();
    await A.getByLabel("Video link").fill(U + "__fixtures/match.webm"); await A.getByLabel("Time of first serve in the video").fill("0:00"); await A.getByLabel("Time of first serve in the video").press("Tab");
    await A.getByLabel("Player").selectOption({ label: "#7 Maya" }); await A.getByLabel("Plays").selectOption("kills"); await A.waitForTimeout(200);
    const w = A.getByRole("button", { name: /^Watch / }); if (await w.count()) { await w.click(); await A.waitForTimeout(1500); } await shot(A, "coach-film-clips");
    // recruiting profile for Maya
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click", { hasText: "Maya" }).first().click(); await A.waitForTimeout(300);
    await A.getByRole("button", { name: "Fill in" }).click();
    for (const [l, v] of [["Club team", "Central Valley 17 Elite"], ["GPA", "3.9"], ["Dominant hand", "Right"], ["Standing reach", "7'7\""], ["Approach jump", "9'10\""], ["Player email", "maya.chen@example.com"], ["Coach contact", "Coach Rivera · rivera@example.com"]]) { await A.getByLabel(l).fill(v); await A.getByLabel(l).press("Tab"); }
    await A.getByLabel("About").fill("Six-rotation outside hitter and team captain. Strong in serve receive, aggressive from the back row, and looking for a program that values a fast tempo offense."); await A.getByLabel("About").press("Tab");
    await A.locator(".consent-check input").check(); await A.getByRole("button", { name: "Share profile link" }).click(); await A.waitForTimeout(1000);
    await shot(A, "coach-recruiting-card");
    const rec = await A.locator("a", { hasText: "/recruit/#/p/" }).first().getAttribute("href");
    await go(A, "live"); await A.getByRole("button", { name: "Share gamecast" }).click(); await A.waitForTimeout(1000);
    const game = (await A.locator("span.small.muted", { hasText: "/live/#/g/" }).first().innerText()).trim();
    await go(A, "team"); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1000);
    const teamUrl = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    await A.getByRole("button", { name: "Share recruiting board" }).click(); await A.waitForTimeout(800);
    const board = await A.locator("a", { hasText: "/recruit/#/b/" }).first().getAttribute("href");
    await shot(A, "coach-team-sharing");
    for (const [tag, opts] of [["phone", { phone: true }], ["desktop", {}], ["phone-dark", { phone: true, dark: true }]]) {
      const P = await newPage(browser, opts);
      await P.goto(teamUrl.replace(/#.*$/, "")); await shot(P, tag + "-live-landing", false);
      await P.goto(teamUrl); await shot(P, tag + "-live-team-home");
      if (tag === "phone-dark") { await P.context().close(); continue; }
      for (const t of ["schedule", "stats", "roster"]) { await P.goto(teamUrl + "/" + t); await shot(P, tag + "-live-team-" + t); }
      await P.goto(game); await shot(P, tag + "-live-gamecast");
      for (const t of ["Box score", "Play-by-play", "Team stats"]) { await P.getByRole("button", { name: t, exact: true }).click(); await shot(P, tag + "-live-" + t.replace(/\W+/g, "-").toLowerCase()); }
      await P.goto(rec); await P.waitForTimeout(1500); await shot(P, tag + "-recruit-profile");
      await P.goto(board); await shot(P, tag + "-recruit-board");
      if (P.errors.length) console.log(`    ${tag} errors: ${P.errors.slice(0, 4).join(" | ")}`);
      await P.context().close();
    }
    if (A.errors.length) console.log(`    coach errors: ${A.errors.slice(0, 4).join(" | ")}`);
    console.log("    screenshots: " + OUT);
  }
};

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("Build first: npm run build"); process.exit(1); }
  const app = await serveDist(), mock = await startMock(MOCK_PORT), browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only ? name !== only : name.startsWith("_")) continue; // "_" scenarios run only when named
    const t0 = Date.now(), f0 = failures; console.log(`• ${name}`);
    try { await fn(browser); } catch (e) {
      failures++; console.log(`  ✗ ${name} crashed: ${String(e.message || e).split("\n")[0]}`); if (process.env.STACK) console.log(String(e.stack || e).split("\n").filter((l) => /run\.cjs/.test(l)).slice(0, 3).join("\n"));
      let i = 0; for (const pg of OPEN) { const f = path.join(require("os").tmpdir(), `e2e-${name}-${i++}.png`); await pg.screenshot({ path: f }).catch(() => {}); console.log("    screenshot: " + f); }
    }
    for (const pg of OPEN) await pg.context().close().catch(() => {});
    console.log(`  ${failures === f0 ? "✓" : "✗"} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  await browser.close(); app.close(); mock.close();
  console.log(`\n${passes} checks passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();

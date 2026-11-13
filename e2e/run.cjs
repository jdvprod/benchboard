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
  if (out["Content-Security-Policy"]) out["Content-Security-Policy"] = out["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://localhost:* http://127.0.0.1:*").replace("img-src 'self'", "img-src 'self' http://localhost:* http://127.0.0.1:*").replace("media-src 'self'", "media-src 'self' http://localhost:* http://127.0.0.1:*");
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
    const mp = await download(p, () => p.getByRole("button", { name: "MaxPreps sheet" }).click());
    { const h = mp.text(); ok("MaxPreps sheet has every category and Bea's tool kill counts as a kill", ["SP", "PTS", "ATT", "RE", "BHA", "DE"].every((c) => h.includes(`>${c}</th>`)) && /Bea Outside<\/td><td>\d+<\/td>/.test(h), mp.name); }
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
    await go(A, "track"); { const ca = A.getByRole("button", { name: "Create an account" }); if (await ca.count()) await ca.click(); }
    await A.getByLabel("Email").fill("clock@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator("#auth-name").fill("Test Coach"); await A.locator(".auth-agree input").first().check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Clock High"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await A.getByRole("button", { name: "Invite a coach" }).click(); await A.waitForTimeout(300);
    const code = (await A.locator(".hint b").first().innerText()).trim();
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Skew Prep"); await A.getByRole("button", { name: "Start · they serve first" }).click(); await A.waitForTimeout(200);
    await A.locator("button.ctrl", { hasText: "My job" }).click(); await A.getByRole("button", { name: /^Score only/ }).click(); await A.getByRole("button", { name: "Done", exact: true }).click();
    await A.waitForTimeout(2200);
    const B = await newPage(browser, { phone: true, skew: 90000 });
    await go(B, "join/" + code); await B.getByLabel("Email").fill("fast@e2e.test"); await B.locator("#auth-pw").fill("secret123"); await B.locator("#auth-name").fill("Test Coach"); await B.locator(".auth-agree input").first().check(); await B.getByRole("button", { name: "Create account" }).click(); await B.waitForTimeout(500);
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
    await go(p, "track"); ok("record counts the imported results", (await p.locator("h1 + p", { hasText: "3–0 this season" }).count()) === 1 || (await p.getByText("3–0 this season").count()) > 0);
    // importing the same file again skips it
    await go(p, "team"); await card.locator("input[type=file]").setInputFiles([path.join(__dirname, "fixtures", "Buchanan.txt")]); await p.waitForTimeout(300);
    await card.locator(".imp-file").first().getByLabel("Set scores (optional)").fill("25-20, 22-25, 15-12");
    ok("a file already imported is skipped", (await card.getByRole("button", { name: "Import 0 matches" }).isDisabled()) && (await card.getByText("already imported").count()) === 1);
    // Floorcall's own spreadsheet comes back in as season totals
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
    await go(p, "track"); ok("imports don't tick off 'Track your first match'", (await p.locator(".setup-list li.ok", { hasText: "Track your first match" }).count()) === 0 && (await p.locator(".setup-list li", { hasText: "Track your first match" }).count()) === 1);
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
    // families see it on Floorcall Live
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
    let M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("the phone is subscribed to the team for starts and finals, following Nia", M.subs.length === 1 && M.subs[0].starts && M.subs[0].finals && !!M.subs[0].player, JSON.stringify(M.subs));
    { const ax = await a11y(P); ok("notification card controls all have names", !ax.length, ax.join(" | ")); }
    await P.reload(); await P.waitForTimeout(1200);
    if (process.env.SHOTS) await P.screenshot({ path: path.join(process.env.SHOTS, "notify-on.png"), fullPage: true });
    ok("notifications stay on after a reload", (await P.locator(".lv-notify h2", { hasText: "Notifications on" }).count()) === 1);
    // the coach starts a match: one "starting" notification
    await go(A, "track"); await A.getByPlaceholder("e.g. Buchanan").fill("Buchanan"); await A.getByRole("button", { name: "2 sets (pool)" }).click();
    await A.getByLabel("Scoring").selectOption("21c23"); await A.getByRole("button", { name: "Start · we serve first" }).click(); await A.waitForTimeout(300);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1200);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("families are told the match is starting", M.pushes.length === 1 && M.pushes[0].kind === "start" && M.pushes[0].title === "Ping Club vs Buchanan is starting" && M.pushes[0].to === 1 && /\/live\/$/.test(M.pushes[0].base), JSON.stringify(M.pushes));
    await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(900);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1")); ok("the start is announced only once", M.pushes.length === 1, JSON.stringify(M.pushes.map((x) => x.kind)));
    // ...and the final
    await go(A, "track");
    await A.locator(".pl", { hasText: "Nia" }).first().click(); await A.getByRole("button", { name: "Kill", exact: true }).first().click(); await skipIfAsked(A); await A.keyboard.press("Escape");
    for (let set = 0; set < 2; set++) { for (let i = 0; i < (set ? 21 : 20); i++) { await A.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(A); } await A.waitForTimeout(200); const nx = A.getByRole("button", { name: /serve$/ }); if (set === 0 && await nx.count()) await nx.first().click(); }
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1500);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("families get the final score", M.pushes.length === 2 && M.pushes[1].kind === "final" && M.pushes[1].title === "Final: Ping Club beat Buchanan 2–0" && M.pushes[1].body.startsWith("21-0, 21-0"), JSON.stringify(M.pushes));
    ok("the family following Nia gets her line first", (M.pushes[1].bodies || [])[0]?.startsWith("Nia L.: 1 kill · 21-0"), JSON.stringify(M.pushes[1].bodies));
    // turning off
    await P.getByRole("button", { name: "Change" }).click(); await P.getByRole("button", { name: "Turn off" }).click(); await P.waitForTimeout(800);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("turning off removes the subscription", M.subs.length === 0 && (await P.getByRole("button", { name: "Turn on notifications" }).count()) === 1);
    // setup check: the notify function answers
    await go(A, "settings"); await A.getByRole("button", { name: "Run check" }).click(); await A.waitForTimeout(1500);
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
    // the people who run Floorcall review uploads and take one down
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
    await P.goto(teamUrl.replace(/#.*$/, "")); await P.waitForTimeout(600);
    ok("Live home lists the teams this phone follows", (await P.locator(".lv-mine a", { hasText: "Clovis North" }).count()) === 1);
    // the coach finishes and texts a recap
    await go(A, "track"); for (let set = 0; set < 3; set++) { for (let i = 0; i < 30; i++) { if (await A.locator(".banner", { hasText: /to Clovis|Match over/ }).count()) break; await A.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(A); } if (await A.locator(".banner", { hasText: "Match over" }).count()) break; const nx = A.getByRole("button", { name: /serve$/ }); if (await nx.count()) await nx.first().click(); }
    await A.getByRole("button", { name: "Finish" }).click(); await A.waitForTimeout(300);
    await go(A, "track"); await A.getByRole("button", { name: "Text recap" }).click(); await A.waitForTimeout(400);
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
    { const ax = await a11y(p); ok("film room controls all have names", !ax.length, ax.join(" | ")); }
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, "film-room.png"), fullPage: true });
    await go(p, "track");
    ok("film room: a film game never becomes the live match", (await p.locator(".fr-stage").count()) === 0 && !(await p.getByRole("button", { name: "End match" }).count()));
    await go(p, "film");
    ok("film room: the game is listed under Your film", /vs Central/.test(await p.locator(".fr-list").first().innerText()) && /2 rallies/.test(await p.locator(".fr-list").first().innerText()));
    ok("film: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },
  async athletes(browser) {
    const p = await newPage(browser);
    await p.goto(U + "recruit/"); await p.waitForTimeout(500);
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
    // athletes on Floorcall Recruit
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
    await go(A, "track"); await shot(A, "app-track");
    await go(A, "stats"); await A.waitForTimeout(800); await shot(A, "app-stats");
    await go(A, "matchup"); await A.waitForTimeout(800); await shot(A, "app-matchup");
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
      const gc = P.getByRole("link", { name: "Open the gamecast" }); if (await gc.count()) { await gc.click(); await P.waitForTimeout(1500); await shot(P, "live-game");
        { const ch = P.getByRole("button", { name: /chart$/i }).first(); if (await ch.count()) { await ch.click(); await P.waitForTimeout(400); await P.locator(".lv-gc").screenshot({ path: path.join(out, "live-chart.png") }); await P.getByRole("button", { name: "Last play", exact: true }).click(); }
          const url = P.url(), Dk = await newPage(browser, { size: { width: 1280, height: 900 }, scale: 2 }); await Dk.goto(url); await Dk.waitForTimeout(2500); await Dk.locator(".lv-gc").screenshot({ path: path.join(out, "live-desk.png") }); await Dk.context().close(); }
        const box = P.getByRole("button", { name: "Box score", exact: true }); if (await box.count()) { await box.click(); await shot(P, "live-box"); }
        const pbp = P.getByRole("button", { name: "Play-by-play", exact: true }); if (await pbp.count()) { await pbp.click(); await shot(P, "live-pbp"); } }
    }
    // athletes: a recruiting profile
    await go(A, "stats"); await A.getByRole("button", { name: "Players", exact: true }).click(); await A.locator("tr.click").first().click(); await A.waitForTimeout(600);
    await shot(A, "app-player");
    const consent = A.locator(".consent-check input").first(); if (await consent.count()) { await consent.check(); await A.getByRole("button", { name: "Share profile link" }).click(); await A.waitForTimeout(1500); }
    const rec = await A.locator("a", { hasText: "/recruit/#/p/" }).first().getAttribute("href").catch(() => null);
    console.log("    profile: " + rec);
    if (rec) { await P.goto(rec); await P.waitForTimeout(2000); await shot(P, "recruit-profile"); }
    await P.goto(U + "recruit/#/guide"); await P.waitForTimeout(1200); await shot(P, "recruit-guide");
    await A.context().close(); await M.context().close(); await P.context().close();
  },
  async coachtools(browser) {
    const A = await newPage(browser);
    await go(A, "sample"); await A.waitForTimeout(1500); await go(A, "track"); await A.waitForTimeout(500);
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
    ok("coach tools: no page errors", !A.errors.length, A.errors.slice(0, 3).join(" | "));
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
  /** paused feature: run with COLLEGE=1 after flipping src/recruit/flags.ts */
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
    // Floorcall approves
    await go(A, "settings"); await A.waitForTimeout(800); await A.getByRole("button", { name: "Open admin" }).click(); await A.waitForTimeout(800);
    const row = A.locator("tr", { hasText: "pat@state.edu" }); ok("admin sees the college request", (await row.count()) === 1 && /Waiting/.test(await row.innerText()));
    await row.getByRole("button", { name: "Approve" }).click(); await A.waitForTimeout(300);
    await C.reload(); await C.waitForTimeout(1500);
    ok("approved staff see the search with the listed player", (await C.locator(".rc-hit", { hasText: "Nia Lopez" }).count()) === 1, (await C.locator("main").innerText()).slice(0, 300));
    await C.locator(".rc-chips button", { hasText: "2028" }).click(); await C.waitForTimeout(600); ok("class filter keeps her (2028)", (await C.locator(".rc-hit").count()) === 1);
    await C.locator(".rc-chips button", { hasText: "2028" }).click(); await C.locator(".rc-chips button", { hasText: "2027" }).click(); await C.waitForTimeout(600); ok("class filter drops her for 2027", (await C.locator(".rc-hit").count()) === 0);
    await C.locator(".rc-chips button", { hasText: "2027" }).click(); await C.getByLabel("Kills / set", { exact: true }).fill("50"); await C.waitForTimeout(600); ok("a stat minimum filters", (await C.locator(".rc-hit").count()) === 0);
    await C.getByLabel("Kills / set", { exact: true }).fill(""); await C.waitForTimeout(600);
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
    await A.locator("button.ctrl", { hasText: "My job" }).click(); await A.getByRole("button", { name: /^Score only/ }).click(); await A.getByRole("button", { name: "Done", exact: true }).click();
    await A.waitForTimeout(2200);
    const B = await newPage(browser, { phone: true });
    await go(B, "join/" + code); await B.getByLabel("Email").fill("assistant@e2e.test"); await B.locator("#auth-pw").fill("secret123"); await B.locator("#auth-name").fill("Test Coach"); await B.locator(".auth-agree input").first().check(); await B.getByRole("button", { name: "Create account" }).click(); await B.waitForTimeout(500);
    await B.getByRole("button", { name: "Join team" }).click(); await B.waitForTimeout(1200);
    await go(B, "track"); ok("assistant sees the live match", /CLOUD CLUB 0/.test(await score(B)));
    await B.locator("button.ctrl", { hasText: "My job" }).click(); await B.getByRole("button", { name: /^Stats only/ }).click(); await B.getByRole("button", { name: "Done", exact: true }).click();
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
    await P.goto(season); await P.waitForTimeout(1200); ok("team page on Floorcall Live loads", (await P.locator(".lv-team", { hasText: "Cloud Club" }).count()) === 1);
    await P.goto(season + "/roster"); await P.waitForTimeout(800); ok("team roster shows first names", (await P.locator("body").innerText()).includes("Nia")); await P.goto(season); await P.waitForTimeout(800);
    ok("team page shows the live match with a link to the gamecast", (await P.locator(".lv-livecard .gs-big").first().innerText()).trim() === "3" && (await P.getByRole("link", { name: "Open the gamecast" }).count()) === 1);
    // the game from the team page: ESPN-style tabs
    await P.getByRole("link", { name: "Open the gamecast" }).click(); await P.waitForTimeout(500);
    await P.getByRole("button", { name: "Box score", exact: true }).click(); ok("box score lists Nia with her pass", (await P.locator(".lv-box tbody tr", { hasText: "Nia" }).count()) === 1);
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
    await P.goto(rec); await P.waitForTimeout(1200); ok("Floorcall Recruit shows the profile with her full name", (await P.locator(".rc-id h1").innerText()).toLowerCase() === "nia lopez");
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
    await go(A, "stats"); await A.getByRole("button", { name: "Who should pass in rotation 2?" }).click(); await A.waitForTimeout(800);
    ok("ask your stats answers", (await A.locator(".ask-turn").count()) === 1);
    { const lasts = fs.readFileSync(path.join(__dirname, "roster.csv"), "utf8").split("\n").slice(1).map((l) => l.split(",")[2]).filter(Boolean);
      ok("AI requests carry first names only, never last names", sent.length > 0 && sent.join("").includes("Nia") && !lasts.some((n) => sent.join("").includes(n)), lasts.filter((n) => sent.join("").includes(n)).join(", ")); }
    await go(A, "settings"); await A.getByRole("button", { name: "Run check" }).click(); await A.waitForTimeout(1000);
    const notOk = await A.locator(".check-list li:not(.sc-ok) b").allInnerTexts();
    ok("setup check: the cloud, account, sync and AI are all ✓", (await A.locator(".check-list li.sc-ok").count()) >= 5 && notOk.every((x) => ["Installed on this device", "Privacy contact", "Sign-up emails"].includes(x)) && notOk.includes("Sign-up emails"), notOk.join(", "));
    // a view-only parent account can follow along but can't change the team's data
    await go(A, "team"); await A.getByRole("button", { name: "Invite view-only" }).click(); await A.waitForTimeout(300);
    const vcode = (await A.locator(".hint b").first().innerText()).trim();
    const V = await newPage(browser, { phone: true });
    await go(V, "join/" + vcode); await V.getByLabel("Email").fill("parent@e2e.test"); await V.locator("#auth-pw").fill("secret123"); await V.locator("#auth-name").fill("Test Coach"); await V.locator(".auth-agree input").first().check(); await V.getByRole("button", { name: "Create account" }).click(); await V.waitForTimeout(500);
    await V.getByRole("button", { name: "Join team" }).click(); await V.waitForTimeout(1500);
    await go(V, "team"); await V.getByRole("button", { name: "Sync now" }).click(); await V.waitForTimeout(800);
    await go(V, "track"); ok("viewer sees the view-only note", (await V.locator(".banner", { hasText: "View-only." }).count()) === 1);
    await V.locator(".pl", { hasText: "Maya" }).first().click(); await V.locator(".actsheet button", { hasText: /^Kill$/ }).click(); await skipIfAsked(V); await V.waitForTimeout(2500);
    await go(V, "team"); await V.getByRole("button", { name: "Sync now" }).click(); await V.waitForTimeout(800);
    ok("viewer's sync says it's view-only instead of failing forever", (await V.getByText("view-only access").count()) > 0);
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(800); await go(A, "track");
    ok("viewer's entry never reaches the team", /CLOUD CLUB 3 /.test(await score(A)), await score(A));
    for (const [n, pg] of [["head coach", A], ["assistant", B], ["parent", P], ["viewer", V]]) ok(`cloud: no page errors (${n})`, !pg.errors.length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, B, P, V]) await pg.context().close();
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
  /** Floorcall Live and Recruit with screenshots (node e2e/run.cjs _explore3). */
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

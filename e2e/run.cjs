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
    await A.goto(SW + "track"); await A.waitForTimeout(300); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("gym@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
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
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
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
    for (const f of ["privacy", "terms", "schools", "accessibility", "consent-form"]) {
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
    // Benchboard's own spreadsheet comes back in as season totals
    await card.getByRole("button", { name: "Cancel" }).click();
    await go(p, "stats"); const xl = await download(p, () => p.getByRole("button", { name: "Download spreadsheet" }).click());
    ok("own spreadsheet export downloads", xl.size > 3000);
    await go(p, "team"); await card.locator("input[type=file]").setInputFiles({ name: "Import High season.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fs.readFileSync(xl.path) }); await p.waitForTimeout(800);
    { const txt = await card.locator(".imp-file").first().innerText(); ok("an Excel file picks its player sheet and reads as season totals", txt.includes("Excel spreadsheet") && /sheet "/.test(txt) && (await card.locator(".imp-file").first().getByRole("button", { name: "Season totals" }).getAttribute("aria-pressed")) === "true", txt.slice(0, 160)); }
    await card.getByRole("button", { name: "Cancel" }).click();
    ok("imports: no page errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  },

  async tournament(browser) {
    const A = await newPage(browser);
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("tn@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
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
    // families see it on Benchboard Live
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
    for (const [n, pg] of [["coach", A], ["parent", P]]) ok(`tournament: no page errors (${n})`, !pg.errors.length, pg.errors.slice(0, 3).join(" | "));
    for (const pg of [A, P]) await pg.context().close();
  },

  async notify(browser) {
    const A = await newPage(browser);
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("notify@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Ping Club"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
    await go(A, "team"); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1200);
    const season = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    // a parent on the team page: browsers' push services aren't reachable from the test, so the subscription is stubbed
    const P = await newPage(browser, { phone: true });
    await P.context().grantPermissions(["notifications"], { origin: new URL(season).origin });
    await P.context().addInitScript(() => {
      const fake = { endpoint: "https://push.example.test/sub-1", toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } }; }, unsubscribe: async () => { localStorage.removeItem("__sub"); return true; } };
      if (self.Notification) { Object.defineProperty(Notification, "permission", { get: () => "granted" }); Notification.requestPermission = async () => "granted"; } // headless Chromium reports "denied" even when granted
      if (self.PushManager) { PushManager.prototype.subscribe = async function () { localStorage.setItem("__sub", "1"); return fake; }; PushManager.prototype.getSubscription = async function () { return localStorage.getItem("__sub") ? fake : null; }; }
    });
    await P.goto(season); await P.waitForTimeout(1200);
    ok("team page offers notifications", (await P.getByRole("button", { name: "Turn on notifications" }).count()) === 1);
    if (process.env.SHOTS) await P.locator(".lv-notify").screenshot({ path: path.join(process.env.SHOTS, "notify-off.png") });
    await P.getByRole("button", { name: "Turn on notifications" }).click(); await P.waitForTimeout(1500);
    ok("notifications turn on", (await P.locator(".lv-notify h2", { hasText: "Notifications on" }).count()) === 1, await P.locator(".lv-notify").innerText().catch(() => ""));
    ok("the live site's service worker is registered", await P.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("./"))));
    let M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("the phone is subscribed to the team for starts and finals", M.subs.length === 1 && M.subs[0].starts && M.subs[0].finals, JSON.stringify(M.subs));
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
    for (let set = 0; set < 2; set++) { for (let i = 0; i < 21; i++) { await A.getByRole("button", { name: "Their error", exact: true }).click(); await skipIfAsked(A); } await A.waitForTimeout(200); const nx = A.getByRole("button", { name: /serve$/ }); if (set === 0 && await nx.count()) await nx.first().click(); }
    await go(A, "team"); await A.getByRole("button", { name: "Sync now" }).click(); await A.waitForTimeout(1500);
    M = await (await fetch(`http://localhost:${MOCK_PORT}/__mock/pushes`)).json(); M.pushes = M.pushes.filter((x) => x.title.includes("Ping Club")); M.subs = M.subs.filter((x) => x.endpoint.includes("sub-1"));
    ok("families get the final score", M.pushes.length === 2 && M.pushes[1].kind === "final" && M.pushes[1].title === "Final: Ping Club beat Buchanan 2–0" && M.pushes[1].body.startsWith("21-0, 21-0"), JSON.stringify(M.pushes));
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
  async cloud(browser) {
    const A = await newPage(browser);
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("head@e2e.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(500);
    await A.getByLabel("Team name").fill("Cloud Club"); await A.getByRole("button", { name: "Create team" }).click(); await A.waitForTimeout(900);
    await A.locator("input[type=file][accept^='.csv']").setInputFiles(path.join(__dirname, "roster.csv")); await A.waitForTimeout(1200);
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
    await P.goto(season); await P.waitForTimeout(1200); ok("team page on Benchboard Live loads", (await P.locator(".lv-team", { hasText: "Cloud Club" }).count()) === 1);
    await P.goto(season + "/roster"); await P.waitForTimeout(800); ok("team roster shows first names", (await P.locator("body").innerText()).includes("Nia")); await P.goto(season); await P.waitForTimeout(800);
    ok("team page shows the live match with a link to the gamecast", (await P.locator(".lv-livecard .gs-big").first().innerText()).trim() === "3" && (await P.getByRole("link", { name: "Open the gamecast" }).count()) === 1);
    // the game from the team page: ESPN-style tabs
    await P.getByRole("link", { name: "Open the gamecast" }).click(); await P.waitForTimeout(500);
    await P.getByRole("button", { name: "Box score", exact: true }).click(); ok("box score lists Nia with her pass", (await P.locator(".lv-box tbody tr", { hasText: "Nia" }).count()) === 1);
    await P.getByRole("button", { name: "Play-by-play", exact: true }).click(); ok("play-by-play groups by set", (await P.locator(".lv-set h3", { hasText: "Set 1" }).count()) === 1 && (await P.locator(".lv-pbp li").count()) >= 3);
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
    await P.goto(rec); await P.waitForTimeout(1200); ok("Benchboard Recruit shows the profile with her full name", (await P.locator(".rc-id h1").innerText()).toLowerCase() === "nia lopez");
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
    await go(V, "join/" + vcode); await V.getByLabel("Email").fill("parent@e2e.test"); await V.locator("#auth-pw").fill("secret123"); await V.locator(".auth-agree input").check(); await V.getByRole("button", { name: "Create account" }).click(); await V.waitForTimeout(500);
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
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("coach@explore.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(600);
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
    await go(Ph, "account"); await Ph.getByLabel("Email").fill("coach@explore.test"); await Ph.locator("#auth-pw").fill("secret123"); await Ph.getByRole("button", { name: "Sign in" }).click(); await Ph.waitForTimeout(2500);
    for (const r of ["track", "lineup", "matchup", "practice", "stats", "court", "team", "settings", "live"]) { await go(Ph, r); await shot(Ph, "phone-" + r, true); }
    await P.waitForTimeout(5500); await shot(P, "gamecast-parent-late", true);
    await go(A, "team"); await A.getByRole("button", { name: "Share team page" }).click(); await A.waitForTimeout(1200);
    const season = await A.locator("a", { hasText: "/live/#/t/" }).first().getAttribute("href");
    await P.goto(season); await P.waitForTimeout(1500); await shot(P, "season-page", true);
    for (const [nm, pg] of [["coach", A], ["parent", P], ["phone", Ph]]) if (pg.errors.length) console.log(`    ${nm} errors: ${pg.errors.slice(0, 5).join(" | ")}`);
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
  /** Benchboard Live and Recruit with screenshots (node e2e/run.cjs _explore3). */
  async _explore3(browser) {
    const OUT = process.env.SHOTS || path.join(require("os").tmpdir(), "bb-explore3"); fs.mkdirSync(OUT, { recursive: true });
    let n = 0; const shot = async (pg, name, full = true) => { await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full }); };
    const A = await newPage(browser);
    await go(A, "track"); await A.getByRole("button", { name: "Create an account" }).click();
    await A.getByLabel("Email").fill("coach3@explore.test"); await A.locator("#auth-pw").fill("secret123"); await A.locator(".auth-agree input").check(); await A.getByRole("button", { name: "Create account" }).click(); await A.waitForTimeout(600);
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

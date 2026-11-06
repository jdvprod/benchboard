// Makes the link-preview images (1200×630) shown when someone shares a Jumpset link in a text, Slack or social post.
// Run: node scripts/og-cards.cjs   (writes public/og.png, public/live/og.png, public/recruit/og.png)
const { chromium } = require("playwright"), path = require("path");
const card = (kicker, title, sub, right) => `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#000;color:#fff;font-family:"Inter Display","Inter",sans-serif;display:flex;overflow:hidden;position:relative}
  .l{padding:84px 0 0 84px;width:690px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:16px;font-weight:800;font-size:30px;letter-spacing:.08em}
  .brand i{width:46px;height:46px;border-radius:11px;background:#9BD3F2;display:grid;place-items:center}
  .brand i b{width:6px;background:#000;border-radius:2px;display:inline-block;margin:0 2px;vertical-align:bottom}
  .k{margin-top:92px;color:#9BD3F2;font-weight:700;font-size:26px;letter-spacing:.14em;text-transform:uppercase}
  h1{margin-top:14px;font-weight:800;font-size:68px;line-height:1.02;letter-spacing:-.01em}
  p{margin-top:22px;color:#A7ADB6;font-size:28px;line-height:1.35;max-width:560px}
  .bar{position:absolute;left:0;right:0;bottom:0;height:16px;background:#9BD3F2}
  .r{position:absolute;right:70px;top:120px;width:400px}
  .sb{background:#111317;border:1px solid #26282D;border-radius:18px;padding:26px 28px}
  .st{display:flex;justify-content:space-between;color:#C7CCD3;font-size:18px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
  .st span:first-child::before{content:"";display:inline-block;width:10px;height:10px;border-radius:50%;background:#E5484D;margin-right:10px;vertical-align:1px}
  .row{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-top:1px solid #26282D;font-weight:800;font-size:28px;letter-spacing:.03em}
  .row:first-of-type{margin-top:16px}
  .row em{font-style:normal;font-size:54px;font-variant-numeric:tabular-nums}.row.us em{color:#9BD3F2}
  .row .n{display:flex;align-items:center;gap:14px}.row .n::before{content:"";width:6px;height:34px;border-radius:3px;background:#9BD3F2}.row.them .n::before{background:#6A707A}
  .pl{margin-top:16px;color:#C7CCD3;font-size:20px;display:flex;justify-content:space-between}.pl b{color:#9BD3F2}
  .prof{background:#111317;border:1px solid #26282D;border-radius:18px;padding:28px}
  .prof .ph{width:96px;height:96px;border-radius:50%;background:linear-gradient(160deg,#2C4A63,#1A2A38)}
  .prof h2{margin-top:18px;font-size:34px;font-weight:800}.prof small{color:#A7ADB6;font-size:19px}
  .tiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:22px}.tiles div{background:#1A1C20;border-radius:10px;padding:12px 14px;border-left:4px solid #9BD3F2}
  .tiles b{display:block;font-size:30px}.tiles span{color:#8A9099;font-size:14px;letter-spacing:.1em;text-transform:uppercase}
  .ok{margin-top:18px;color:#9BD3F2;font-size:18px;font-weight:700}
</style></head><body><div class="l"><div class="brand"><i><span><b style="height:12px"></b><b style="height:20px"></b><b style="height:16px"></b></span></i>JUMPSET</div>
<div class="k">${kicker}</div><h1>${title}</h1><p>${sub}</p></div><div class="r">${right}</div><div class="bar"></div></body></html>`;
const scoreboard = `<div class="sb"><div class="st"><span>Live · Set 3</span><span>Sets 1–1</span></div>
  <div class="row us"><span class="n">CLOVIS NORTH</span><em>23</em></div><div class="row them"><span class="n">BUCHANAN</span><em>21</em></div>
  <div class="pl"><span>#7 Maya · Kill</span><b>23–21</b></div></div>`;
const profile = `<div class="prof"><div class="ph"></div><h2>Maya Chen</h2><small>Class of 2027 · OH · 5'11"</small>
  <div class="tiles"><div><b>4.1</b><span>Kills/set</span></div><div><b>.312</b><span>Hitting</span></div><div><b>2.3</b><span>Pass avg</span></div></div><div class="ok">✓ Verified by her coaching staff</div></div>`;
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const out = (f) => path.join(__dirname, "..", "public", f);
  for (const [f, html] of [
    ["og.png", card("Volleyball stats", "Every point, tracked from the bench.", "Live stats, lineups, practice plans and scouting for coaches. Gamecasts for families.", scoreboard)],
    ["live/og.png", card("Jumpset Live", "Follow the game, point by point.", "Live scores, box scores and player stats, straight from the team's bench.", scoreboard)],
    ["recruit/og.png", card("Jumpset Recruit", "Verified stats for college coaches.", "Numbers recorded live by the player's own coaching staff, with highlight clips.", profile)],
  ]) { await p.setContent(html); await p.waitForTimeout(150); await p.screenshot({ path: out(f) }); console.log("wrote", f); }
  await b.close();
})();

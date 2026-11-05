/** "Follow us live" flyer for families: a printable page for the gym wall and a 1080×1350 image for team group chats.
 * The QR code opens the team on Benchboard Live; the steps explain notifications (and the iPhone Home Screen step). */
import { qrSvg } from "../../lib/qr";
import { canvasImage, drawLogo } from "../../lib/image";
import { Team } from "../../data/model";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const codeOf = (url: string) => url.split("/").pop() || "";

/** A one-page flyer to print (letter or A4). */
export function flyerHtml(t: Team, url: string, season = "") {
  const code = codeOf(url);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(t.name)} on Benchboard Live</title>
<style>@page{size:letter;margin:0}*{box-sizing:border-box}body{margin:0;display:flex;justify-content:center;background:#E9EBEE;font-family:"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p{width:8.5in;height:11in;background:#fff;display:flex;flex-direction:column;align-items:center;padding:.7in .7in .5in;text-align:center}
.top{width:100%;background:#000;color:#fff;border-radius:22px;padding:34px 28px 30px;border-bottom:10px solid #9BD3F2}
.top img{width:96px;height:96px;object-fit:contain;background:#fff;border-radius:20px;padding:8px;margin-bottom:14px}
.k{font-size:20px;letter-spacing:.22em;text-transform:uppercase;color:#9BD3F2;font-weight:700}h1{font-size:58px;line-height:1;margin:10px 0 4px;text-transform:uppercase}.s{color:#A7ADB6;font-size:22px}
.qr{margin-top:34px;width:3.6in;height:3.6in}.qr svg{width:100%;height:100%}
.code{margin-top:14px;font-size:22px}.code b{display:block;font-size:56px;letter-spacing:.2em;margin-top:2px}
ol{margin:24px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;width:100%;text-align:left;font-family:system-ui,sans-serif}
li{border:2px solid #000;border-radius:14px;padding:14px 16px;font-size:16px;line-height:1.35}li b{display:block;font-size:20px;margin-bottom:4px;font-family:"Barlow Semi Condensed","Arial Narrow",sans-serif}
.f{margin-top:auto;font:14px system-ui,sans-serif;color:#555}.btn{position:fixed;top:12px;right:12px;font:600 15px system-ui;padding:10px 16px;border-radius:10px;border:0;background:#000;color:#fff;cursor:pointer}@media print{.btn{display:none}body{background:none}}</style></head>
<body><button class="btn" onclick="print()">Print</button><div class="p"><div class="top">${t.logo && /^(https:|data:)/.test(t.logo) ? `<img src="${esc(t.logo)}" alt="">` : ""}<div class="k">Follow us live</div><h1>${esc(t.name)}</h1><div class="s">${esc([t.level, season].filter(Boolean).join(" · "))}</div></div>
<div class="qr">${qrSvg(url)}</div><div class="code">Or go to Benchboard Live and enter<b>${esc(code)}</b></div>
<ol><li><b>1. Scan</b>Point your phone's camera at the code and open the link.</li><li><b>2. Follow every point</b>Live scores, box scores and player stats from our bench.</li><li><b>3. Get notified</b>Tap <i>Turn on notifications</i> for match starts and finals. iPhone: Share → Add to Home Screen first.</li></ol>
<div class="f">${esc(url)} · Stats recorded by our coaches with Benchboard</div></div></body></html>`;
}

/** The same flyer as an image for group chats and social posts. */
export async function flyerImage(t: Team, url: string, season = ""): Promise<Blob | null> {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); if (!g) return null;
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const disp = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui", body = "'Source Sans 3', system-ui, sans-serif", BLUE = "#9BD3F2";
  const text = (s: string, x: number, y: number, size: number, color: string, o: { font?: string; weight?: number; spacing?: number } = {}) => { g.font = `${o.weight || 700} ${size}px ${o.font || disp}`; g.fillStyle = color; g.textAlign = "center"; try { (g as any).letterSpacing = (o.spacing || 0) + "px"; } catch { /* older browsers */ } g.fillText(s, x, y); };
  const fit = (s: string, max: number, size: number) => { let z = size; g.font = `700 ${z}px ${disp}`; while (z > 40 && g.measureText(s).width > max) { z -= 2; g.font = `700 ${z}px ${disp}`; } return z; };
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.fillStyle = BLUE; g.fillRect(0, H - 18, W, 18);
  const logo = await canvasImage(t.logo);
  let y = 110; if (logo) { drawLogo(g, logo, W / 2 - 60, 70, 120); y = 250; }
  text("FOLLOW US LIVE", W / 2, y + 10, 34, BLUE, { spacing: 8 });
  const nm = t.name.toUpperCase(); text(nm, W / 2, y + 100, fit(nm, W - 140, 96), "#fff");
  text([t.level, season].filter(Boolean).join("  ·  "), W / 2, y + 150, 32, "#A7ADB6", { font: body, weight: 600 });
  // QR on a white card
  const qy = y + 200, qs = 470;
  g.fillStyle = "#fff"; g.beginPath(); (g as any).roundRect ? (g as any).roundRect(W / 2 - qs / 2 - 30, qy, qs + 60, qs + 60, 28) : g.rect(W / 2 - qs / 2 - 30, qy, qs + 60, qs + 60); g.fill();
  const svg = new Blob([qrSvg(url)], { type: "image/svg+xml" }), su = URL.createObjectURL(svg);
  await new Promise<void>((ok) => { const i = new Image(); i.onload = () => { g.drawImage(i, W / 2 - qs / 2, qy + 30, qs, qs); ok(); }; i.onerror = () => ok(); i.src = su; });
  URL.revokeObjectURL(su);
  text("Scan, or enter this code at Benchboard Live", W / 2, qy + qs + 130, 32, "#C7CCD3", { font: body, weight: 600 });
  text(codeOf(url), W / 2, qy + qs + 225, 88, BLUE, { spacing: 18 });
  text("Live scores · box scores · notifications for match starts and finals", W / 2, H - 70, 28, "#8A9099", { font: body, weight: 600 });
  return new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

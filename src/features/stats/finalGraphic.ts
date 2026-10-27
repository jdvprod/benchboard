/** A 1080×1350 "final score" graphic for social posts: result, set scores, top performers. Drawn on a canvas, saved as PNG. */
import { player, team, toast } from "../../data/store";
import { download } from "../../ui/kit";
import { Match } from "../../data/model";
import { aggregate, Replay, Stat } from "../../sports/volleyball/engine";
import { blocks } from "../../sports/volleyball/metrics";

export async function finalGraphic(m: Match, R: Replay): Promise<Blob | null> {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); if (!g) return null;
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const disp = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui";
  const body = "'Source Sans 3', system-ui, sans-serif";
  const t = team()!, A = aggregate(R.sets), won = R.wonUs > R.wonThem, final = R.matchOver;
  const BLUE = "#9BD3F2", GREY = "#8A9099";
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.fillStyle = BLUE; g.fillRect(0, H - 18, W, 18);
  // diagonal court lines as texture
  g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 3; for (let x = -H; x < W; x += 90) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
  const text = (s: string, x: number, y: number, size: number, color: string, opts: { font?: string; weight?: number; align?: CanvasTextAlign; spacing?: number } = {}) => {
    g.font = `${opts.weight || 700} ${size}px ${opts.font || disp}`; g.fillStyle = color; g.textAlign = opts.align || "left";
    try { (g as any).letterSpacing = (opts.spacing || 0) + "px"; } catch { /* older browsers */ }
    g.fillText(s, x, y);
  };
  const fit = (s: string, max: number, size: number, font = disp, weight = 700) => { let z = size; g.font = `${weight} ${z}px ${font}`; while (z > 24 && g.measureText(s).width > max) { z -= 2; g.font = `${weight} ${z}px ${font}`; } return z; };
  text(final ? (won ? "WIN" : "FINAL") : "IN PROGRESS", 80, 150, 44, BLUE, { spacing: 6 });
  const dt = new Date(m.date + "T12:00:00"), ds = isNaN(+dt) ? m.date : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  text(ds + (m.event ? "  ·  " + m.event : ""), 80, 200, 30, GREY, { font: body, weight: 600 });
  const nameUs = t.name.toUpperCase(), nameThem = (m.opp || "Opponent").toUpperCase();
  text(nameUs, 80, 340, fit(nameUs, 700, 76), "#fff");
  text(String(R.wonUs), W - 80, 350, 150, won ? BLUE : "#fff", { align: "right" });
  text(nameThem, 80, 500, fit(nameThem, 700, 76), GREY);
  text(String(R.wonThem), W - 80, 510, 150, !won ? "#fff" : GREY, { align: "right" });
  // set scores
  const sets = R.sets.filter((s) => s.us + s.them > 0), cw = (W - 160) / Math.max(1, sets.length);
  g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(80, 570, W - 160, 150);
  sets.forEach((s, i) => {
    const x = 80 + cw * i + cw / 2;
    text("SET " + s.n, x, 610, 22, GREY, { align: "center", spacing: 3 });
    text(`${s.us}–${s.them}`, x, 680, 48, s.winner === "us" ? BLUE : "#fff", { align: "center" });
  });
  // leaders (players whose families asked to stay off public pages are left out of this image)
  const lead = (f: (s: Stat) => number, label: string) => { const e = Object.entries(A.ps).filter(([id]) => player(id) && !player(id)!.hidePublic).map(([id, s]) => [id, f(s)] as [string, number]).sort((a, b) => b[1] - a[1])[0]; return e && e[1] > 0 ? { id: e[0], v: e[1], label } : null; };
  const L = [lead((s) => s.K, "KILLS"), lead((s) => s.SA, "ACES"), lead((s) => s.D, "DIGS"), lead((s) => blocks(s), "BLOCKS"), lead((s) => s.AST, "ASSISTS")].filter(Boolean).slice(0, 4) as { id: string; v: number; label: string }[];
  text("TOP PERFORMERS", 80, 810, 28, BLUE, { spacing: 5 });
  L.forEach((l, i) => {
    const y = 880 + i * 105, p = player(l.id)!;
    g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(80, y + 22, W - 160, 2);
    text(`#${p.num} ${p.first} ${p.last}`.trim(), 80, y, fit(`#${p.num} ${p.first} ${p.last}`, 640, 44, body, 700), "#fff", { font: body });
    text(String(+l.v.toFixed(1)), W - 230, y, 54, "#fff", { align: "right" });
    text(l.label, W - 80, y, 24, GREY, { align: "right", spacing: 3 });
  });
  text("BENCHBOARD", W - 80, H - 50, 22, GREY, { align: "right", spacing: 6 });
  return new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

/** Draw the graphic, then open the phone's share sheet (or save the PNG on desktop). */
export async function shareFinalGraphic(m: Match, R: Replay) {
  const b = await finalGraphic(m, R); if (!b) { toast("Couldn't draw the graphic here."); return; }
  const name = `${team()!.name} vs ${m.opp} ${m.date}.png`.replace(/[^\w\- .]+/g, "");
  const file = new File([b], name, { type: "image/png" }), nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return; } catch { /* cancelled: fall through to save */ } }
  download(name, b, "image/png"); toast("Graphic saved. Post it or send it to the team.");
}

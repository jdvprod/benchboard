/** A 1080×1350 "season so far" graphic: record, sets, streak, season leaders and the biggest win. Shared like the final-score graphic. */
import { player, team, toast } from "../../data/store";
import { download } from "../../ui/kit";
import { Match } from "../../data/model";
import { aggregate, Replay, Stat } from "../../sports/volleyball/engine";
import { blocks } from "../../sports/volleyball/metrics";
import { seasonSummary } from "../../sports/volleyball/seasonSummary";
import { canvasImage, drawLogo } from "../../lib/image";

export async function seasonGraphic(items: { m: Match; R: Replay }[], seasonName: string): Promise<Blob | null> {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); if (!g) return null;
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const disp = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui", body = "'Source Sans 3', system-ui, sans-serif";
  const BLUE = "#9BD3F2", GREY = "#8A9099", t = team()!;
  const text = (s: string, x: number, y: number, size: number, color: string, o: { font?: string; weight?: number; align?: CanvasTextAlign; spacing?: number } = {}) => { g.font = `${o.weight || 700} ${size}px ${o.font || disp}`; g.fillStyle = color; g.textAlign = o.align || "left"; try { (g as any).letterSpacing = (o.spacing || 0) + "px"; } catch { /* older browsers */ } g.fillText(s, x, y); };
  const fit = (s: string, max: number, size: number) => { let z = size; g.font = `700 ${z}px ${disp}`; while (z > 30 && g.measureText(s).width > max) { z -= 2; g.font = `700 ${z}px ${disp}`; } return z; };
  const ok = (id: string) => { const p = player(id); return p && !p.hidePublic ? p : null; };
  const S = seasonSummary(items.map(({ m, R }) => ({ id: m.id, opp: m.opp, date: m.date, R })), (id) => !!ok(id));
  const A = aggregate(items.flatMap((x) => x.R.sets));
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.fillStyle = BLUE; g.fillRect(0, H - 18, W, 18);
  g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 3; for (let x = -H; x < W; x += 90) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
  const logo = await canvasImage(t.logo); if (logo) drawLogo(g, logo, W - 80 - 120, 80, 120);
  text((seasonName || "Season").toUpperCase(), 80, 140, 40, BLUE, { spacing: 6 });
  const nm = t.name.toUpperCase(); text(nm, 80, 235, fit(nm, logo ? 740 : 920, 84), "#fff");
  // record
  text(`${S.w}–${S.l}${S.t ? "–" + S.t : ""}`, 80, 420, 190, "#fff");
  text("RECORD", 86, 470, 26, GREY, { spacing: 4 });
  text(`${S.setsW}–${S.setsL}`, W - 80, 360, 72, "#fff", { align: "right" }); text("SETS", W - 80, 400, 24, GREY, { align: "right", spacing: 4 });
  if (S.bestStreak >= 2) { text(String(S.bestStreak), W - 80, 480, 72, BLUE, { align: "right" }); text("LONGEST WIN STREAK", W - 80, 520, 24, GREY, { align: "right", spacing: 4 }); }
  // leaders
  const lead = (f: (s: Stat) => number, label: string) => { const e = Object.entries(A.ps).filter(([id]) => ok(id)).map(([id, s]) => [id, +f(s).toFixed(1)] as [string, number]).sort((a, b) => b[1] - a[1])[0]; return e && e[1] > 0 ? { id: e[0], v: e[1], label } : null; };
  const L = [lead((s) => s.K, "KILLS"), lead((s) => s.AST, "ASSISTS"), lead((s) => s.D, "DIGS"), lead((s) => s.SA, "ACES"), lead((s) => blocks(s), "BLOCKS")].filter(Boolean).slice(0, 4) as { id: string; v: number; label: string }[];
  text("SEASON LEADERS", 80, 640, 28, BLUE, { spacing: 5 });
  L.forEach((l, i) => { const y = 715 + i * 100, p = ok(l.id)!; g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(80, y + 24, W - 160, 2);
    const nmP = `#${p.num} ${p.first} ${p.last}`.trim(); g.font = `700 44px ${body}`; let z = 44; while (z > 26 && g.measureText(nmP).width > 600) { z -= 2; g.font = `700 ${z}px ${body}`; }
    text(nmP, 80, y, z, "#fff", { font: body }); text(String(l.v), W - 250, y, 54, "#fff", { align: "right" }); text(l.label, W - 80, y, 24, GREY, { align: "right", spacing: 3 }); });
  if (S.biggestWin) { const y = 715 + L.length * 100 + 60; text("BIGGEST WIN", 80, y, 24, GREY, { spacing: 4 }); text(`vs ${S.biggestWin.opp}  ·  ${S.biggestWin.sets}`, 80, y + 50, fit(`vs ${S.biggestWin.opp}  ·  ${S.biggestWin.sets}`, W - 160, 38), "#fff"); }
  text("BENCHBOARD", W - 80, H - 50, 22, GREY, { align: "right", spacing: 6 });
  return new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

export async function shareSeasonGraphic(items: { m: Match; R: Replay }[], seasonName: string) {
  const b = await seasonGraphic(items, seasonName); if (!b) { toast("Couldn't draw the graphic here."); return; }
  const name = `${team()!.name} ${seasonName || "season"}.png`.replace(/[^\w\- .]+/g, ""), file = new File([b], name, { type: "image/png" }), nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return; } catch { /* cancelled: save instead */ } }
  download(name, b, "image/png"); toast("Season graphic saved. Post it or send it to the team.");
}

/** A 1080×1350 player stat card for social posts: one match or the season so far. Drawn on a canvas, shared as a PNG. */
import { team, toast } from "../../data/store";
import { download } from "../../ui/kit";
import { Match, Player } from "../../data/model";
import { Replay, Stat } from "../../sports/volleyball/engine";
import { blocks, fmtAvg, fmtHit, hitting, passAvg } from "../../sports/volleyball/metrics";
import { canvasImage, drawCover, drawLogo } from "../../lib/image";

export interface Tile { label: string; value: string }
/** The numbers worth posting, best first: up to six that this player actually has. */
export function playerTiles(s: Stat): Tile[] {
  const out: Tile[] = [];
  if (s.K) out.push({ label: "Kills", value: String(s.K) });
  if (s.TA >= 5) out.push({ label: "Hitting", value: fmtHit(hitting(s)) });
  if (s.SA) out.push({ label: "Aces", value: String(s.SA) });
  if (s.AST) out.push({ label: "Assists", value: String(s.AST) });
  if (s.D) out.push({ label: "Digs", value: String(s.D) });
  const b = blocks(s); if (b) out.push({ label: "Blocks", value: String(+b.toFixed(1)) });
  if (s.R >= 5) out.push({ label: "Pass avg", value: fmtAvg(passAvg(s)) });
  return out.slice(0, 6);
}

export async function playerGraphic(p: Player, s: Stat, head: string, sub: string): Promise<Blob | null> {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); if (!g) return null;
  try { await (document as any).fonts?.ready; } catch { /* fine */ }
  const disp = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui", body = "'Source Sans 3', system-ui, sans-serif";
  const BLUE = "#9BD3F2", GREY = "#8A9099", t = team()!;
  const text = (str: string, x: number, y: number, size: number, color: string, o: { font?: string; weight?: number; align?: CanvasTextAlign; spacing?: number } = {}) => {
    g.font = `${o.weight || 700} ${size}px ${o.font || disp}`; g.fillStyle = color; g.textAlign = o.align || "left";
    try { (g as any).letterSpacing = (o.spacing || 0) + "px"; } catch { /* older browsers */ }
    g.fillText(str, x, y);
  };
  const fit = (str: string, max: number, size: number) => { let z = size; g.font = `700 ${z}px ${disp}`; while (z > 30 && g.measureText(str).width > max) { z -= 2; g.font = `700 ${z}px ${disp}`; } return z; };
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  // the jersey number, huge and faint, as the backdrop
  if (!p.photo) text(p.num, W + 40, 640, 620, "rgba(155,211,242,.10)", { align: "right" });
  g.fillStyle = BLUE; g.fillRect(0, H - 18, W, 18);
  text(head.toUpperCase(), 80, 150, 40, BLUE, { spacing: 6 });
  text(sub, 80, 200, 30, GREY, { font: body, weight: 600 });
  const photo = await canvasImage(p.photo), nameW = photo ? W - 160 - 330 : W - 160;
  if (photo) { drawCover(g, photo, W - 80 - 300, 250, 300, 340, 28); g.fillStyle = BLUE; g.fillRect(W - 80 - 300, 590, 300, 8); }
  text("#" + p.num, 80, 330, 64, BLUE);
  const first = (p.first || "").toUpperCase(), last = (p.last || "").toUpperCase();
  text(first || last || "#" + p.num, 80, 440, fit(first || last, nameW, 112), "#fff");
  if (first && last) text(last, 80, 550, fit(last, nameW, 112), "#fff");
  const tiles = playerTiles(s), cols = tiles.length > 4 ? 3 : 2, tw = (W - 160 - (cols - 1) * 24) / cols, th = 190;
  tiles.forEach((tl, i) => {
    const x = 80 + (i % cols) * (tw + 24), y = 640 + Math.floor(i / cols) * (th + 24);
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x, y, tw, th);
    g.fillStyle = BLUE; g.fillRect(x, y, 6, th);
    text(tl.value, x + 34, y + 120, 92, "#fff");
    text(tl.label.toUpperCase(), x + 36, y + 165, 24, GREY, { spacing: 3 });
  });
  const logo = await canvasImage(t.logo);
  if (logo) drawLogo(g, logo, 80, H - 104, 64);
  text(t.name.toUpperCase(), logo ? 164 : 80, H - 56, 26, "#fff", { spacing: 3 });
  text("JUMPSET", W - 80, H - 56, 22, GREY, { align: "right", spacing: 6 });
  return new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

export const matchHead = (m: Match, R: Replay) => {
  const d = new Date(m.date + "T12:00:00"), ds = isNaN(+d) ? m.date : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const res = R.wonUs > R.wonThem ? `W ${R.wonUs}–${R.wonThem}` : R.wonThem > R.wonUs ? `L ${R.wonUs}–${R.wonThem}` : R.wonUs ? `${R.wonUs}–${R.wonThem}` : "";
  return [`vs ${m.opp}`, ds, res, m.event || ""].filter(Boolean).join("  ·  ");
};

export async function sharePlayerGraphic(p: Player, s: Stat, head: string, sub: string) {
  const b = await playerGraphic(p, s, head, sub); if (!b) { toast("Couldn't draw the graphic here."); return; }
  const name = `${p.first || "#" + p.num} ${p.last} ${head}.png`.replace(/[^\w\- .#]+/g, "").trim();
  const file = new File([b], name, { type: "image/png" }), nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return; } catch { /* cancelled: save instead */ } }
  download(name, b, "image/png"); toast("Graphic saved. Send it to the family or post it.");
}

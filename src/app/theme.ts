/** Applies the device theme and the team's color to the whole app. */
const hex = (h: string) => { const m = h.replace("#", ""); const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r: number[]) => "#" + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
const lum = (h: string) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** Make sure the color is dark enough to read on white, light enough on black. */
function forLight(c: string) { let x = c; for (let i = 0; i < 8 && lum(x) > 0.2; i++) x = mix(x, "#000000", 0.15); return x; }
function forDark(c: string) { let x = c; for (let i = 0; i < 10 && lum(x) < 0.35; i++) x = mix(x, "#FFFFFF", 0.15); return x; }

export const TEAM_COLORS: [string, string][] = [
  ["#2A78AE", "Columbia blue"], ["#1D3D8F", "Royal blue"], ["#14284B", "Navy"], ["#B3202A", "Red"], ["#7A1F2B", "Maroon"],
  ["#1E7A46", "Green"], ["#5B2A86", "Purple"], ["#C8962E", "Gold"], ["#D9661F", "Orange"], ["#0E7C7B", "Teal"], ["#4B5563", "Gray"],
];

export function applyTheme(color: string, theme: "system" | "light" | "dark", size: "normal" | "large", hostTheme: string | null) {
  const r = document.documentElement;
  if (theme === "system") { if (hostTheme) r.setAttribute("data-theme", hostTheme); else r.removeAttribute("data-theme"); }
  else r.setAttribute("data-theme", theme);
  document.body.classList.toggle("big", size === "large");
  // The app always uses the Jumpset palette (white, black, grey, Columbia blue); team colors no longer recolor it.
  void color; const css = "";
  let el = document.getElementById("team-theme");
  if (!el) { el = document.createElement("style"); el.id = "team-theme"; document.head.appendChild(el); }
  el.textContent = css;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0A0A0B");
}

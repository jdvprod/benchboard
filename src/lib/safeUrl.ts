/** Only web links go into links people tap, never javascript: or data: URLs (names and links come from other people). */
export function safeUrl(u?: string): string {
  const v = (u || "").trim(); if (!v) return "";
  try { const x = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : "https://" + v); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; }
}

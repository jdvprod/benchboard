/** Print a ready-made HTML page (a practice plan, a season wrap-up) without leaving the app: it loads in a hidden
 * frame and opens the browser's print dialog, where "Save as PDF" is one of the choices. */
export function printHtml(html: string) {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  f.onload = () => { try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { /* blocked: the download button still works */ } setTimeout(() => f.remove(), 60_000); };
  f.srcdoc = html;
  document.body.appendChild(f);
}
export const esc = (x: unknown) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** The look shared by printed sheets: plain, black on white, team name on top. */
export const PRINT_CSS = `*{box-sizing:border-box}body{margin:0;font:13.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#000;background:#fff}
main{max-width:760px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0}h2{font-size:17px;margin:18px 0 6px}.mut{color:#555}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:6px 6px;text-align:left;vertical-align:top}th{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:#555}
.box{border:1px solid #bbb;border-radius:8px;padding:10px 12px;margin:8px 0}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.tiles div{border:1px solid #ccc;border-radius:8px;padding:6px 8px}.tiles b{display:block;font-size:20px}.tiles span{font-size:11px;color:#555}
.page{page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}footer{margin-top:18px;color:#666;font-size:11px}
@page{margin:14mm}`;

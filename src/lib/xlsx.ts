/** Minimal Excel (.xlsx) writer: several sheets of plain values, bold header row. */

type Cell = string | number | null | undefined;
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const col = (i: number) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function sheetXml(rows: Cell[][]) {
  const widths = (rows[0] || []).map((_, ci) => Math.min(40, Math.max(8, ...rows.map((r) => String(r[ci] ?? "").length + 2))));
  const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = col(ci) + (ri + 1), style = ri === 0 ? ' s="1"' : "";
    if (v == null || v === "") return `<c r="${ref}"${style}/>`;
    if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  }).join("") + "</row>").join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
}

export async function buildXlsx(sheets: [string, Cell[][]][]): Promise<Blob> {
  const { default: JSZip } = await import("jszip"); // loaded only when someone exports
  const zip = new JSZip();
  const names = sheets.map(([n], i) => (n.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet" + (i + 1)));
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach(([, rows], i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows)));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Reads every worksheet of an .xlsx file into rows of text (shared strings, inline strings and numbers). */
export async function readXlsx(data: ArrayBuffer): Promise<{ name: string; rows: string[][] }[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const xml = async (p: string) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null; };
  const shared: string[] = [];
  const ss = await xml("xl/sharedStrings.xml");
  if (ss) for (const si of Array.from(ss.getElementsByTagName("si"))) shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent || "").join(""));
  const wb = await xml("xl/workbook.xml"), rels = await xml("xl/_rels/workbook.xml.rels");
  const target = (rid: string | null) => { if (rid && rels) for (const r of Array.from(rels.getElementsByTagName("Relationship"))) if (r.getAttribute("Id") === rid) { const tg = r.getAttribute("Target") || ""; return tg.startsWith("/") ? tg.slice(1) : "xl/" + tg.replace(/^\.\//, ""); } return null; };
  const colIdx = (ref: string) => { const m = ref.match(/^[A-Z]+/); let n = 0; for (const ch of m ? m[0] : "A") n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const sheets = Array.from(wb?.getElementsByTagName("sheet") || []);
  const list = sheets.length ? sheets.map((sh, i) => ({ name: sh.getAttribute("name") || "Sheet" + (i + 1), path: target(sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) || `xl/worksheets/sheet${i + 1}.xml` })) : [{ name: "Sheet1", path: "xl/worksheets/sheet1.xml" }];
  const out: { name: string; rows: string[][] }[] = [];
  for (const { name, path } of list) {
    const sheet = await xml(path); if (!sheet) continue;
    const rows: string[][] = [];
    for (const row of Array.from(sheet.getElementsByTagName("row"))) {
      const cells: string[] = [];
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        cells[colIdx(c.getAttribute("r") || "A1")] = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? Array.from(c.getElementsByTagName("t")).map((x) => x.textContent || "").join("") : v;
      }
      rows.push(Array.from(cells, (x) => x ?? ""));
    }
    out.push({ name, rows });
  }
  return out;
}

/** Turn an on-screen SVG into a PNG: copies the computed look of every element inline (the page's stylesheet doesn't
 * travel with the image), draws it on a canvas at `scale`, and returns the PNG. */
const PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "letter-spacing", "text-anchor", "dominant-baseline", "filter", "display", "visibility"];

export async function svgToPng(svg: SVGSVGElement, scale = 2, background = "#0B1117", caption?: { title: string; sub?: string }): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement, src = svg.querySelectorAll("*"), dst = clone.querySelectorAll("*");
  src.forEach((el, i) => { const cs = getComputedStyle(el), d = dst[i] as SVGElement; d.setAttribute("style", PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";")); });
  const vb = svg.viewBox.baseVal, w = Math.round((vb?.width || svg.clientWidth) * scale), h = Math.round((vb?.height || svg.clientHeight) * scale);
  clone.setAttribute("width", String(w)); clone.setAttribute("height", String(h)); clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image(); img.decoding = "async"; img.src = url; await img.decode();
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d")!;
    g.fillStyle = background; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    if (caption) { // a title band across the top: the play's name, and where it came from
      const pad = 18 * scale, font = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui";
      const grad = g.createLinearGradient(0, 0, 0, 90 * scale); grad.addColorStop(0, "rgba(0,0,0,.75)"); grad.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grad; g.fillRect(0, 0, w, 90 * scale);
      g.fillStyle = "#fff"; g.font = `700 ${26 * scale}px ${font}`; g.textBaseline = "top"; g.fillText(caption.title, pad, pad);
      if (caption.sub) { g.fillStyle = "#9BD3F2"; g.font = `600 ${13 * scale}px ${font}`; g.fillText(caption.sub, pad, pad + 32 * scale); }
    }
    return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

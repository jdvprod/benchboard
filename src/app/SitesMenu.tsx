/** The other Floorcall sites, from the sidebar: one button that opens a short list (Live, Recruit, Beach and Academy). */
import { useEffect, useRef, useState } from "react";
import { placeUrl, PLACES } from "../cloud/links";

export function SitesMenu({ mini }: { mini?: boolean }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const items = () => [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") || [])];
    items()[0]?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === "Tab") setOpen(false);
    };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div className="sm-wrap wide-only" ref={root}>
    <button ref={btn} className="tab sm-btn" aria-haspopup="menu" aria-expanded={open} title={mini ? "Floorcall sites" : undefined} onClick={() => setOpen(!open)}>
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></svg>
      <span>Floorcall sites</span>
    </button>
    {open && <div className="tm-menu sm-menu" role="menu" aria-label="Floorcall sites">
      {PLACES.filter(([p]) => p !== "app" && p !== "home").map(([p, name, what]) => <a key={p} role="menuitem" className="tm-item sm-item" href={placeUrl(p)} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
        <span className="tm-name"><b>Floorcall {name}</b><small>{what}</small></span>
        <svg className="sm-out" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3 5.5 10.5M11 9.5V13H3V5h3.5" /></svg>
      </a>)}
    </div>}
  </div>;
}

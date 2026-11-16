/** The team switcher: a button showing the current team, opening a menu of every team, the club overview and Add a team.
 * Used at the top of the sidebar and in the phone's top bar. Keyboard: Enter/Space/↓ opens, ↑↓ move, Esc closes. */
import { useEffect, useRef, useState } from "react";
import { all, setPrefs, team } from "../data/store";
import type { Team } from "../data/model";

const initials = (name: string) => name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "T";
export function TeamMark({ t, size = 28 }: { t: Team; size?: number }) {
  return <span className="tm-mark" style={{ width: size, height: size, background: t.color || "#2A78AE", fontSize: size * 0.4 }} aria-hidden="true">{initials(t.name)}</span>;
}

export function TeamMenu({ compact }: { compact?: boolean }) {
  const t = team()!, [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  const teams = all("teams").sort((a, b) => a.createdAt - b.createdAt), real = teams.filter((x) => !x.sample);
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };
  const pick = (fn: () => void) => { fn(); close(); };
  useEffect(() => {
    if (!open) return;
    const items = () => [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitemradio],[role=menuitem]") || [])];
    (items().find((x) => x.getAttribute("aria-checked") === "true") || items()[0])?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    const key = (e: KeyboardEvent) => {
      const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === "Tab") close(false);
    };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div className={"tm" + (compact ? " compact" : "") + (open ? " open" : "")} ref={root}>
    <button ref={btn} className="tm-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Team: ${t.name}. Switch team`} title={compact ? t.name : undefined}
      onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
      <TeamMark t={t} />
      <span className="tm-name"><b>{t.name}</b>{t.level || t.sample ? <small>{t.sample ? "Sample team" : t.level}</small> : null}</span>
      <svg className="tm-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" /></svg>
    </button>
    {open && <div className="tm-menu" role="menu" aria-label="Teams">
      <div className="tm-head">Your teams</div>
      {teams.map((x) => <button key={x.id} role="menuitemradio" aria-checked={x.id === t.id} className="tm-item" onClick={() => pick(() => setPrefs({ teamId: x.id }))}>
        <TeamMark t={x} size={24} /><span className="tm-name"><b>{x.name}</b><small>{x.sample ? "Sample team" : x.level || "Team"}</small></span>
        {x.id === t.id && <svg className="tm-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>}
      </button>)}
      <div className="tm-sep" role="separator" />
      {real.length > 1 && <button role="menuitem" className="tm-item plain" onClick={() => pick(() => { location.hash = "#/club"; })}><span className="tm-ico" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg></span>All teams overview</button>}
      <button role="menuitem" className="tm-item plain" onClick={() => pick(() => { location.hash = "#/team/new"; })}><span className="tm-ico" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg></span>Add a team</button>
    </div>}
  </div>;
}

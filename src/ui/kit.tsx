/** Shared building blocks used on every screen. */
import { ReactNode, useEffect, useRef, useState } from "react";
import { state, useVersion } from "../data/store";

export function Card({ title, actions, children, className = "", id }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={"card " + className} id={id}>
      {(title || actions) && <div className="hd"><h3>{title}</h3>{actions && <div className="row">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <label className="switch"><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><i /></label>;
}

export function SetRow({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return <div className="setrow"><div className="t"><b>{title}</b>{sub && <span>{sub}</span>}</div>{children}</div>;
}

export function Kpi({ label, value, sub, color, delta }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; delta?: { text: string; better: boolean | null } | null }) {
  return <div className="kpi"><div className="label">{label}</div><div className="v" style={color ? { color } : undefined}>{value}</div>
    {delta && <div className={"dl " + (delta.better === true ? "up" : delta.better === false ? "down" : "")}>{delta.text}</div>}
    {sub && <div className="s">{sub}</div>}</div>;
}

/** A button that asks for a second tap before doing something destructive. */
export function ConfirmButton({ children, confirmText = "Tap again to confirm", onConfirm, className = "btn sm" }: { children: ReactNode; confirmText?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button type="button" className={className + (armed ? " danger" : "")} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmText : children}</button>;
}

export function Toast() {
  useVersion();
  const [shown, setShown] = useState<typeof state.toast>(null);
  const last = useRef(0);
  const t = state.toast;
  useEffect(() => {
    if (t && t.at !== last.current) {
      // time left is measured from when the toast was raised, so changing pages doesn't bring an old one back
      last.current = t.at; const left = t.at + (t.action ? 6000 : 1800) - Date.now();
      if (left <= 0) { setShown(null); return; }
      setShown(t); const h = setTimeout(() => setShown(null), left); return () => clearTimeout(h);
    }
  }, [t]);
  return shown ? <div className="toast" role="status">{shown.msg}{shown.action && <button className="toast-act" onClick={() => { shown.action!.fn(); setShown(null); }}>{shown.action.label}</button>}</div> : null;
}

/** Renders simple AI text: "Title:" lines become headings, "- " lines become bullets. */
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = []; let list: string[] = [];
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/).map((x, i) => (x.startsWith("**") ? <strong key={i}>{x.slice(2, -2)}</strong> : x));
  const flushList = () => { if (list.length) out.push(<ul key={"u" + out.length}>{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>); list = []; };
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (m) { list.push(m[1]); continue; }
    flushList();
    const t = raw.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim(); if (!t) continue;
    if (/^[^.!?]{2,44}:$/.test(t)) out.push(<p key={out.length} className="sec"><strong>{t.slice(0, -1)}</strong></p>);
    else { const mm = t.match(/^([A-Z][A-Za-z' ]{1,14}):\s*(.*)$/); out.push(<p key={out.length}>{mm ? <><strong>{mm[1]}:</strong> {mm[2]}</> : t}</p>); }
  }
  flushList();
  return <div className="aitext">{out}</div>;
}

export function fmtDate(s: string) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  try { return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return s; }
}

export function download(filename: string, data: BlobPart, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function copyText(text: string): Promise<boolean> {
  try { return navigator.clipboard.writeText(text).then(() => true, () => false); } catch { return Promise.resolve(false); }
}

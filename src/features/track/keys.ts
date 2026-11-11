/** Keyboard entry for a stat keeper on a laptop: type a jersey number, then a letter for the action. */
import { useEffect, useRef } from "react";
import { ActionCode } from "../../sports/volleyball/actions";

export const KEYMAP: [string, ActionCode, string][] = [
  ["k", "K", "Kill"], ["w", "KT", "Kill off the block (tool)"], ["t", "TA", "Attack attempt"], ["e", "AE", "Attack error"], ["r", "AB", "Attack blocked"],
  ["s", "SA", "Ace"], ["i", "SI", "Serve in"], ["n", "SEN", "Serve error, net"], ["o", "SEO", "Serve error, out"],
  ["d", "D", "Dig"], ["x", "DE", "Dig error"],
  ["h", "AST", "Assist"], ["g", "SATT", "Set attempt"], ["l", "BHE", "Setting error"],
  ["b", "BS", "Solo block"], ["v", "BA", "Block assist"], ["u", "BT", "Block touch"], ["m", "BE", "Block / net error"],
  ["f", "FBR", "Free ball to us"],
  ["E", "OE", "Their error"], ["K", "OK", "Their kill"], ["A", "OA", "Their ace"], ["P", "TP", "Their point"],
];
const BY_KEY = new Map(KEYMAP.map(([k, c]) => [k, c]));
const PASS: Record<string, ActionCode> = { "3": "P3", "2": "P2", "1": "P1", "0": "P0" };

export interface KeyHandlers {
  record: (code: ActionCode) => void;
  selectNum: (num: string) => boolean;
  clear: () => void;
  undo: () => void;
  help: () => void;
}

/** Digits pick a player by jersey (two digits within ~0.8s make one number). "p" then 0–3 grades a pass. */
export function useStatKeys(enabled: boolean, h: KeyHandlers) {
  const ref = useRef(h); ref.current = h;
  useEffect(() => {
    if (!enabled) return;
    let buf = "", timer: any = null, passMode = false;
    const flush = () => { if (buf) { if (!ref.current.selectNum(buf)) ref.current.selectNum(buf.slice(-1)); } buf = ""; };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.altKey || (e.ctrlKey && e.key.toLowerCase() !== "z")) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); ref.current.undo(); return; }
      const k = e.key;
      if (passMode && PASS[k]) { e.preventDefault(); passMode = false; clearTimeout(timer); flush(); ref.current.record(PASS[k]); return; }
      passMode = false;
      if (/^[0-9]$/.test(k)) {
        e.preventDefault(); buf += k; clearTimeout(timer);
        if (buf.length >= 2) { flush(); } else timer = setTimeout(flush, 800);
        return;
      }
      if (k === "Escape") { buf = ""; clearTimeout(timer); ref.current.clear(); return; }
      if (k === "?") { e.preventDefault(); ref.current.help(); return; }
      if (k === "Backspace") { e.preventDefault(); ref.current.undo(); return; }
      if (k === "p") { e.preventDefault(); clearTimeout(timer); flush(); passMode = true; return; }
      const code = BY_KEY.get(k);
      if (code) { e.preventDefault(); clearTimeout(timer); flush(); ref.current.record(code); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [enabled]);
}

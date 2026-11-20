/** A card that runs an AI task, shows the answer, and lets the coach copy or save it. */
import { ReactNode, useRef, useState } from "react";
import { aiAvailable, AiError, AI_ERRORS, ask, Tier } from "../ai/client";
import { copyText, download, RichText } from "./kit";
import { toast } from "../data/store";
import { AI_MODE } from "../app/flags";

export function AiCard(props: {
  title: string; desc: string; button: string; prompt: () => string; tier?: Tier;
  saved?: string; savedAt?: number | null; onSave?: (text: string) => void; filename?: string; extra?: ReactNode; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false), [text, setText] = useState(""), [err, setErr] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const shown = text || props.saved || "";
  const run = async () => {
    if (!aiAvailable()) { setErr(AI_ERRORS.no_key); return; }
    setBusy(true); setErr(""); setText(""); ctl.current = new AbortController();
    try { const r = await ask(props.prompt(), { tier: props.tier, signal: ctl.current.signal }); setText(r.text); props.onSave?.(r.text); }
    catch (e) { setErr(e instanceof AiError ? e.message : AI_ERRORS.upstream); }
    setBusy(false);
  };
  return (
    <section className="card">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="grow" style={{ flexBasis: 220, minWidth: 0 }}><h2>{props.title}</h2><p className="muted small" style={{ marginTop: 2 }}>{props.desc}</p></div>
        {busy ? <button className="btn danger" onClick={() => ctl.current?.abort()}>Stop</button>
          : <button className="btn primary" disabled={props.disabled} onClick={run}>{shown ? "Write it again" : props.button}</button>}
      </div>
      {props.extra}
      {busy && <p className="empty" style={{ marginTop: 10 }}>Thinking… this can take up to a minute.</p>}
      {err && <p className="hint warn" style={{ marginTop: 10 }}>{err}</p>}
      {!busy && shown && <div style={{ marginTop: 12 }}><RichText text={shown} />
        {props.savedAt && !text && <p className="small muted">Written {new Date(props.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => copyText(shown).then((ok) => toast(ok ? "Copied" : "Couldn't copy here. Select the text instead."))}>Copy</button>
          <button className="btn sm" onClick={() => download((props.filename || props.title) + ".txt", shown, "text/plain")}>Download</button>
        </div></div>}
      {!aiAvailable() && !shown && <p className="small muted" style={{ marginTop: 8 }}>{AI_MODE === "included" ? "Sign in on the Team tab to use AI features, or add your own Anthropic key in Settings." : "Add your own Anthropic key in Settings → AI features to use this."}</p>}
    </section>
  );
}

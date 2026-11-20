/** Tryouts with the staff on their own phones: the head coach shares a code; each evaluator opens it, rates, and the
 * ratings come back to the head coach with one tap. Evaluators never see each other's ratings. */
import { useEffect, useRef, useState } from "react";
import { cloudAvailable, currentUser, rpc, userMeta } from "../../cloud/client";
import { MiniAuth } from "../../cloud/MiniAuth";
import { get, save, toast } from "../../data/store";
import { go } from "../../app/router";
import { Card, copyText } from "../../ui/kit";
import { Tryout } from "./tryouts";

const KEY = "tryouts";
const loadAll = (): Tryout[] => (get("kv", KEY)?.value as Tryout[]) || [];
/** What evaluators get: the players and skills, never notes or decisions. */
const shared = (t: Tryout) => ({ name: t.name, date: t.date, skills: t.skills, candidates: t.candidates.map((c) => ({ id: c.id, bib: c.bib, name: c.name, pos: c.pos, grade: c.grade })) });
export const joinUrl = (code: string) => location.href.split("#")[0] + "#/tryout-join/" + code;

/** The head coach's card: share, the code, pull ratings. Keeps the shared copy current as players are added. */
export function StaffCard({ t, onChange, ev }: { t: Tryout; onChange: (t: Tryout) => void; ev: string }) {
  const [busy, setBusy] = useState(false), sent = useRef("");
  const ok = cloudAvailable() && !!currentUser();
  if (!cloudAvailable() || t.role === "evaluator") return null;
  if (!ok) return <Card title="Rate with your staff"><p className="small muted" style={{ margin: 0 }}>Sign in to give your assistants a code so they rate on their own phones. Or share ratings as files below.</p></Card>;
  const start = async () => { setBusy(true); try { const code: string = await rpc("tryout_publish", { c: null, d: shared(t) }); sent.current = JSON.stringify(shared(t)); onChange({ ...t, code }); } catch (e: any) { toast(e?.message || "Couldn't share. Check your connection."); } setBusy(false); };
  const pull = async () => {
    setBusy(true);
    try { const list: { name: string; ratings: Tryout["ratings"][string] }[] = (await rpc("tryout_all", { c: t.code })) || []; const ratings = { ...t.ratings };
      const evNotes = { ...(t.evNotes || {}) };
      for (const r of list) { const nm = r.name === ev ? r.name + " (phone)" : r.name, x = unpackRatings(r.ratings); ratings[nm] = x.r; if (Object.keys(x.n).length) evNotes[nm] = x.n; }
      onChange({ ...t, ratings, evNotes }); toast(list.length ? `Ratings from ${list.length} ${list.length === 1 ? "evaluator" : "evaluators"}: ${list.map((r) => r.name).join(", ")}.` : "No ratings from your staff yet.");
    } catch (e: any) { toast(e?.message || "Couldn't get the ratings. Check your connection."); }
    setBusy(false);
  };
  const stop = async () => { try { await rpc("tryout_unshare", { c: t.code }); } catch { /* fine */ } onChange({ ...t, code: undefined }); };
  if (!t.code) return <Card title="Rate with your staff" actions={<button className="btn sm primary" disabled={busy || !t.candidates.length} onClick={start}>Share with your staff</button>}>
    <p className="small muted" style={{ margin: 0 }}>Each assistant opens a code on their phone and rates. Their ratings come back here; they never see each other's.</p></Card>;
  return <Card title="Rate with your staff" actions={<button className="btn sm ghost" onClick={stop}>Stop sharing</button>}>
    <p style={{ margin: 0 }}>Code <b className="ty-code">{t.code}</b> · <button className="btn sm" onClick={async () => { if (await copyText(joinUrl(t.code!))) toast("Link copied. Send it to your staff."); }}>Copy link</button></p>
    <p className="small muted">Your staff open the link (or Team → Tryouts → Join with a code) and sign in. New players you add reach them automatically.</p>
    <button className="btn primary" disabled={busy} onClick={pull}>{busy ? "Getting ratings…" : "Get your staff's ratings"}</button>
  </Card>;
}

/** An evaluator's upload is { r: ratings, n: notes } (older uploads were the ratings alone). */
function unpackRatings(x: any): { r: Tryout["ratings"][string]; n: Record<string, string> } {
  if (x && typeof x === "object" && x.r && typeof x.r === "object") return { r: x.r, n: x.n && typeof x.n === "object" ? x.n : {} };
  return { r: x && typeof x === "object" ? x : {}, n: {} };
}

/** Keeps the staff's copy current (players, skills, name) while the head coach edits, whichever tab is open. */
export function useStaffPublish(t: Tryout) {
  const sent = useRef(""), ok = cloudAvailable() && !!currentUser();
  useEffect(() => {
    if (!t.code || t.role === "evaluator" || !ok) return; const d = JSON.stringify(shared(t)); if (!sent.current) { sent.current = d; return; } if (d === sent.current) return;
    const h = setTimeout(() => rpc("tryout_publish", { c: t.code, d: shared(t) }).then(() => { sent.current = d; }).catch(() => {}), 800); return () => clearTimeout(h);
  }, [t.candidates, t.skills, t.name, t.code, ok]);
}

/** An evaluator opening a code: sign in if needed, then the tryout is saved on this phone for rating. */
export function JoinTryout({ code }: { code: string }) {
  const [, bump] = useState(0), [msg, setMsg] = useState(""), signed = !!currentUser();
  useEffect(() => {
    if (!signed || !code) return;
    rpc("tryout_open", { c: code }).then((r) => {
      if (!r) { setMsg("That tryout isn't shared anymore, or the code is mistyped."); return; }
      const all = loadAll(), id = "tj-" + r.code, prev = all.find((x) => x.id === id), d = r.data || {};
      const ev = (prev && Object.keys(prev.ratings)[0]) || userMeta().name || "Evaluator";
      const t: Tryout = { id, name: d.name || "Tryouts", date: d.date || "", skills: d.skills || [], weights: {}, candidates: (d.candidates || []).map((c: any) => ({ ...c, note: "", decision: "" })), ratings: { [ev]: r.mine ? unpackRatings(r.mine).r : prev?.ratings[ev] || {} }, evNotes: { [ev]: r.mine ? unpackRatings(r.mine).n : prev?.evNotes?.[ev] || {} }, createdAt: prev?.createdAt || Date.now(), code: r.code, role: r.owner ? undefined : "evaluator" };
      save("kv", { id: KEY, value: [t, ...all.filter((x) => x.id !== id)] });
      try { localStorage.setItem("fc-evaluator", ev); } catch { /* fine */ }
      go("tryouts", id);
    }).catch((e) => setMsg(e?.message || "Couldn't open that tryout. Check your connection."));
  }, [code, signed]);
  if (!cloudAvailable()) return <div className="page"><p className="empty">This copy of FloorCall isn't connected, so it can't open a shared tryout.</p></div>;
  return <div className="page"><div className="pagehead"><h1>Join a tryout</h1></div>
    {msg ? <p className="empty">{msg}</p> : signed ? <p className="empty">Opening tryout {code.toUpperCase()}…</p>
      : <div style={{ maxWidth: 460 }}><MiniAuth kind="coach" title="Sign in to rate at this tryout" sub="Your ratings go to the head coach only." onIn={() => bump((x) => x + 1)} legalBase="legal/" /></div>}
  </div>;
}

/** The evaluator's ratings go up a moment after each tap. */
export function useEvaluatorSync(t: Tryout | undefined, ev: string) {
  const [state, setState] = useState<"" | "saving" | "saved" | "offline">(""), last = useRef("");
  useEffect(() => {
    if (!t || t.role !== "evaluator" || !t.code || !ev || !currentUser()) return;
    const r = { r: t.ratings[ev] || {}, n: t.evNotes?.[ev] || {} }, s = JSON.stringify(r); if (s === last.current) return;
    setState("saving");
    const h = setTimeout(() => rpc("tryout_rate", { c: t.code, nm: ev, r }).then(() => { last.current = s; setState("saved"); }).catch(() => setState("offline")), 600);
    return () => clearTimeout(h);
  }, [t?.ratings, t?.evNotes, ev, t?.code]);
  return state;
}

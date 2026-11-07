/** Floorcall Recruit for college coaches: sign in with a school (.edu) email, get approved by Floorcall, then search
 * players whose teams listed them (families agreed to share). Results are summaries; each opens the full profile. */
import { useEffect, useMemo, useState } from "react";
import { acceptTerms, cloudAvailable, currentUser, needsTermsAgreement, rpc, signIn, signOut, signUp } from "../cloud/client";
import { fmtAvg, fmtHit, fmtNum } from "../sports/volleyball/metrics";
import type { RecruitData } from "../features/player/recruitData";

interface Hit { code: string; updated: string; player: RecruitData["player"]; team: RecruitData["team"]; ranks: { label: string; rank: number; of: number }[]; clips: number; season: Partial<RecruitData["season"]> }
type Status = { status: "none" | "pending" | "approved" | "denied"; name?: string; school?: string };
const POS = ["OH", "OPP", "MB", "S", "L", "DS"];
const MINS: [keyof Hit["season"], string, number][] = [["kps", "Kills / set", 0.1], ["hitting", "Hitting %", 0.01], ["dps", "Digs / set", 0.1], ["passAvg", "Pass avg", 0.05], ["aps", "Assists / set", 0.1], ["bps", "Blocks / set", 0.1]];
const SORTS: [string, string][] = [["updated", "Recently updated"], ["kps", "Kills / set"], ["hitting", "Hitting %"], ["dps", "Digs / set"], ["passAvg", "Pass average"], ["aps", "Assists / set"], ["bps", "Blocks / set"]];
const ord = (n: number) => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
const wlKey = () => "rc-watch-" + (currentUser()?.id || "");
const readWatch = (): string[] => { try { return JSON.parse(localStorage.getItem(wlKey()) || "[]"); } catch { return []; } };

function Auth({ onIn }: { onIn: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in"), [email, setEmail] = useState(""), [pw, setPw] = useState(""), [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const go = async () => {
    if (!agree) { setMsg("Agree to the Terms and Privacy Policy first."); return; }
    setBusy(true); setMsg("");
    try {
      if (mode === "up") { const r = await signUp(email.trim(), pw); if (r === "confirm-email") { setMsg("Check your school email for a link to confirm the account, then sign in."); setBusy(false); return; } }
      else await signIn(email.trim(), pw);
      if (needsTermsAgreement()) await acceptTerms();
      onIn();
    } catch (e: any) { setMsg(e?.message || "Couldn't sign in."); }
    setBusy(false);
  };
  return <form className="rc-auth" onSubmit={(e) => { e.preventDefault(); go(); }}>
    <div className="rc-seg" role="group" aria-label="Account"><button type="button" aria-pressed={mode === "in"} onClick={() => setMode("in")}>Sign in</button><button type="button" aria-pressed={mode === "up"} onClick={() => setMode("up")}>Create account</button></div>
    <label>School email<input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" required /></label>
    <label>Password<input className="input" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required /></label>
    <label className="rc-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to the <a href="../legal/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="../legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, and I'll use what I find only for recruiting.</label>
    <button className="btn primary" disabled={busy}>{busy ? "One moment…" : mode === "up" ? "Create account" : "Sign in"}</button>
    {msg && <p className="rc-err" role="alert">{msg}</p>}
  </form>;
}

function Request({ onDone }: { onDone: (s: Status) => void }) {
  const [name, setName] = useState(""), [school, setSchool] = useState(""), [title, setTitle] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  return <form className="rc-auth" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMsg(""); try { const st = await rpc("college_request", { name, school, title }); onDone({ status: st, name, school }); } catch (x: any) { setMsg(x?.message || "Couldn't send the request."); } setBusy(false); }}>
    <p style={{ margin: 0 }}>Signed in as <b>{currentUser()?.email}</b>. Tell us who you are; Floorcall checks every request by hand.</p>
    <label>Your name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
    <label>College or university<input className="input" value={school} onChange={(e) => setSchool(e.target.value)} required autoComplete="organization" /></label>
    <label>Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Head coach, assistant coach, recruiting coordinator…" autoComplete="organization-title" /></label>
    <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Request access"}</button>
    {msg && <p className="rc-err" role="alert">{msg}</p>}
  </form>;
}

function Search({ me }: { me: Status }) {
  const [grad, setGrad] = useState<number[]>([]), [pos, setPos] = useState<string[]>([]), [q, setQ] = useState(""), [region, setRegion] = useState(""), [min, setMin] = useState<Record<string, string>>({});
  const [sort, setSort] = useState("updated"), [hits, setHits] = useState<Hit[] | null>(null), [err, setErr] = useState(""), [watch, setWatch] = useState<string[]>(readWatch), [onlyWatch, setOnlyWatch] = useState(false);
  const year = new Date().getFullYear(), classes = [year, year + 1, year + 2, year + 3, year + 4];
  const run = async () => {
    setErr("");
    const m: Record<string, number> = {}; for (const [k, v] of Object.entries(min)) if (v.trim() !== "" && !isNaN(+v)) m[k] = +v;
    try { setHits(await rpc("recruit_search", { f: { grad, pos, q: q.trim(), region: region.trim(), min: m } })); } catch (e: any) { setErr(e?.message || "Search didn't work. Try again."); }
  };
  useEffect(() => { const t = setTimeout(run, 250); return () => clearTimeout(t); }, [grad.join(), pos.join(), q, region, JSON.stringify(min)]);
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : xs.concat(x));
  const star = (code: string) => { const n = toggle(watch, code); setWatch(n); try { localStorage.setItem(wlKey(), JSON.stringify(n)); } catch { /* private window */ } };
  const rows = useMemo(() => (hits || []).filter((h) => !onlyWatch || watch.includes(h.code)).slice().sort((a, b) => sort === "updated" ? b.updated.localeCompare(a.updated) : ((b.season as any)[sort] ?? -1) - ((a.season as any)[sort] ?? -1)), [hits, sort, onlyWatch, watch]);
  const line = (h: Hit): [string, string][] => { const s = h.season, out: [string, string][] = [];
    if (s.kps) out.push(["Kills/set", fmtNum(s.kps, 2)]); if (s.TA) out.push(["Hit%", fmtHit(s.hitting ?? null)]); if (s.aps) out.push(["Ast/set", fmtNum(s.aps, 2)]);
    if (s.dps) out.push(["Digs/set", fmtNum(s.dps, 2)]); if (s.R) out.push(["Pass", fmtAvg(s.passAvg ?? null)]); if (s.bps) out.push(["Blk/set", fmtNum(s.bps, 2)]); return out.slice(0, 3); };
  return <>
    <section className="rc-boardhead"><h1>Player search</h1><p>{me.name} · {me.school} · <button className="rc-link" onClick={() => { signOut(); location.reload(); }}>Sign out</button></p></section>
    <div className="rc-search">
      <aside className="rc-filters rc-col" aria-label="Filters">
        <label>Name, team or club<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Clovis" /></label>
        <fieldset><legend>Class</legend><div className="rc-chips">{classes.map((c) => <button key={c} type="button" aria-pressed={grad.includes(c)} onClick={() => setGrad(toggle(grad, c))}>{c}</button>)}</div></fieldset>
        <fieldset><legend>Position</legend><div className="rc-chips">{POS.map((p) => <button key={p} type="button" aria-pressed={pos.includes(p)} onClick={() => setPos(toggle(pos, p))}>{p}</button>)}</div></fieldset>
        <label>State<input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. California" /></label>
        <fieldset><legend>At least</legend><div className="rc-mins">{MINS.map(([k, l, step]) => <label key={k}>{l}<input className="input" type="number" inputMode="decimal" step={step} min={0} value={min[k] || ""} onChange={(e) => setMin({ ...min, [k]: e.target.value })} /></label>)}</div></fieldset>
        <label className="rc-check"><input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} /> Only my watchlist ({watch.length})</label>
      </aside>
      <section aria-label="Results">
        <div className="rc-resbar"><span role="status">{hits ? `${rows.length} ${rows.length === 1 ? "player" : "players"}` : "Searching…"}</span>
          <label>Sort <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
        {err && <p className="rc-err" role="alert">{err}</p>}
        {hits && !rows.length && <p className="rc-empty">No listed players match. Loosen a filter.</p>}
        <div className="rc-grid">{rows.map((h) => <div key={h.code} className="rc-pc rc-hit">
          <a className="rc-hit-main" href={`#/p/${h.code}`}>
            {h.player.photo ? <img className="rc-hit-photo" src={h.player.photo} alt="" loading="lazy" /> : <span className="rc-num sm">{h.player.num}</span>}
            <span className="rc-pc-id"><b>{h.player.first} {h.player.last}</b><small>{[h.player.grad ? "Class of " + h.player.grad : "", h.player.pos, h.player.height].filter(Boolean).join(" · ")}</small><small>{[h.team?.name, h.team?.level, h.team?.region].filter(Boolean).join(" · ")}</small></span>
            <span className="rc-pc-k">{line(h).map(([l, v]) => <span key={l}><b>{v}</b><small>{l}</small></span>)}</span>
            {h.ranks?.[0] && <span className="rc-pc-f">{ord(h.ranks[0].rank)} on the team in {h.ranks[0].label}{h.clips ? ` · ▶ ${h.clips} clips` : ""}</span>}
          </a>
          <button className="rc-star" aria-pressed={watch.includes(h.code)} aria-label={(watch.includes(h.code) ? "Remove " : "Add ") + h.player.first + " " + h.player.last + (watch.includes(h.code) ? " from" : " to") + " watchlist"} onClick={() => star(h.code)}>{watch.includes(h.code) ? "★" : "☆"}</button>
        </div>)}</div>
      </section>
    </div>
  </>;
}

export function College({ Shell }: { Shell: (p: { children: any; crumb?: string }) => any }) {
  const [me, setMe] = useState<Status | null>(null), [signed, setSigned] = useState(!!currentUser());
  useEffect(() => { document.title = "College coaches · Floorcall Recruit"; }, []);
  useEffect(() => { if (signed) rpc("college_status", {}).then(setMe).catch(() => setMe({ status: "none" })); }, [signed]);
  if (!cloudAvailable()) return <Shell><p className="rc-empty">This site isn't connected yet.</p></Shell>;
  return <Shell crumb="College coaches">
    {!signed ? <section className="rc-landing"><h1>Search verified players.</h1>
      <p>Floorcall Recruit lists players whose families chose to be found, with stats recorded live by their own coaching staff and clips of the plays. Search is for college coaching staff: sign in with your school email (.edu), and Floorcall approves each account by hand.</p>
      <Auth onIn={() => setSigned(true)} /></section>
      : !me ? <p className="rc-empty">Loading…</p>
      : me.status === "approved" ? <Search me={me} />
      : <section className="rc-landing">
        {me.status === "none" && <><h1>Request access</h1><Request onDone={setMe} /></>}
        {me.status === "pending" && <><h1>Thanks, {me.name?.split(" ")[0] || "coach"}.</h1><p>Your request for {me.school} is in. Floorcall checks it by hand, usually within a day; you'll see the search here once it's approved.</p></>}
        {me.status === "denied" && <><h1>Access wasn't approved.</h1><p>If you coach at a college, reply to Floorcall from your school email and we'll take another look.</p></>}
        <p><button className="rc-link" onClick={() => { signOut(); location.reload(); }}>Sign out</button></p>
      </section>}
  </Shell>;
}

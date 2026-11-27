/** Tournament game day for families: when to arrive, which jersey, where to park, who's working which job,
 *  and one tap to send the latest schedule to everyone following the team. */
import { useState } from "react";
import { cloudAvailable, currentUser, fn, rpc, userMeta } from "../../cloud/client";
import { isLinked, roleOn } from "../../cloud/sync";
import { siteUrl } from "../../cloud/links";
import { playerName, team, teamPlayers, toast } from "../../data/store";
import { Card, copyText } from "../../ui/kit";
import { dutyCounts, fairCrew, mapUrl, TGame, TInfo, Tournament, updateText, WORK_JOBS } from "../../tournament/model";

const INFO: [keyof TInfo, string, string, boolean?][] = [
  ["arrive", "Arrive by", "e.g. 7:15 AM, an hour before the first serve"],
  ["jersey", "Jersey", "e.g. Saturday white, Sunday navy"],
  ["address", "Address", "e.g. 700 M St, Fresno, CA"],
  ["meet", "Meet at", "e.g. Main entrance, by the banner"],
  ["bring", "Bring", "Both jerseys, knee pads, lunch, water, cash for parking", true],
  ["note", "Anything else", "Parking, admission, team dinner…", true],
];

export function GameDayCard({ t, set, done, clock }: { t: Tournament; set: (p: Partial<Tournament>) => void; done: (mid: string) => boolean; clock: (x?: string) => string }) {
  const tm = team()!, info = t.info || {};
  const [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const can = cloudAvailable() && !!currentUser() && isLinked(tm.id) && ["owner", "coach"].includes(roleOn(tm.id) || "") && !tm.sample;
  const put = (k: keyof TInfo, v: string) => { const next = { ...info, [k]: v.trim() || undefined }; set({ info: Object.values(next).some(Boolean) ? next : undefined }); };
  const send = async () => {
    const body = (draft || "").trim(); if (!body) return;
    setBusy(true);
    try {
      const p: any = await rpc("post_send", { t: tm.id, b: body, pin: false });
      const r = await fn("notify", { action: "send", team_id: tm.id, match_id: p.id, kind: "post", title: `${tm.name}: ${t.name}`, body: body.slice(0, 200), base: siteUrl("live") }).catch(() => null);
      toast(r && r.sent ? `Sent. ${r.sent} ${r.sent === 1 ? "device" : "devices"} notified.` : "Posted to your team page."); setDraft(null);
    } catch (e: any) { toast(e?.message || "Couldn't send. Check your connection."); }
    setBusy(false);
  };
  return <Card title="Game day for families">
    <p className="small muted" style={{ marginTop: 0 }}>Shown on your team page on FloorCall Live from the day before.</p>
    <div className="gd-grid">{INFO.map(([k, l, ph, long]) => <label key={k} className={"field" + (long ? " wide" : "")}><span className="label">{l}</span>
      {long ? <textarea rows={2} defaultValue={info[k]} placeholder={ph} maxLength={400} onBlur={(e) => put(k, e.target.value)} /> : <input defaultValue={info[k]} placeholder={ph} maxLength={120} onBlur={(e) => put(k, e.target.value)} />}</label>)}</div>
    {info.address && <a className="small" href={mapUrl(info.address)} target="_blank" rel="noopener">Check the address on a map</a>}
    <div className="gd-send">
      {draft == null ? <button className="btn sm primary" onClick={() => setDraft(updateText(t, done, (id) => playerName(id), clock))}>Send an update to families</button>
        : <div className="stack">
          <label className="field"><span className="label">Update (edit before sending)</span><textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1500} /></label>
          <div className="row">
            {can ? <button className="btn sm primary" disabled={busy || !draft.trim()} onClick={send}>{busy ? "Sending…" : "Send to everyone following the team"}</button>
              : <span className="small muted">{tm.sample ? "Make your own team to send updates." : "Sync this team to send it to families' phones. You can copy it for now."}</span>}
            <button className="btn sm" onClick={() => copyText(draft).then((ok) => toast(ok ? "Copied" : "Couldn't copy"))}>Copy</button>
            <button className="btn sm ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>}
    </div>
  </Card>;
}

/** Who works which job on a work game, filled fairly across the season with one tap. */
export function CrewEditor({ t, g, set }: { t: Tournament; g: TGame; set: (p: Partial<Tournament>) => void }) {
  const [open, setOpen] = useState(false);
  const ps = teamPlayers().filter((p) => p.active), ids = ps.map((p) => p.id);
  const crew = g.crew || {}, filled = Object.values(crew).flat().length;
  const save = (c: Record<string, string[]>) => set({ games: t.games.map((x) => (x.id === g.id ? { ...x, crew: Object.keys(c).length ? c : undefined } : x)) });
  const fill = () => save(fairCrew({ ...g, crew }, ids, dutyCounts(team()!.tournaments || []), Date.now() % 997));
  const pick = (job: string, i: number, id: string) => { const cur = (crew[job] || []).slice(); if (id) cur[i] = id; else cur.splice(i, 1); const next = { ...crew, [job]: cur.filter(Boolean) }; if (!next[job].length) delete next[job]; save(next); };
  return <div className="crew">
    {filled > 0 && <span className="small crew-line">{Object.entries(crew).map(([j, xs]) => `${j}: ${xs.map((id) => playerName(id)).join(", ")}`).join(" · ")}</span>}
    <div className="row"><button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>{filled ? "Edit crew" : "Assign crew"}</button>
      {ids.length > 0 && <button className="btn sm ghost" onClick={fill}>{filled ? "Fill the rest fairly" : "Fill fairly"}</button>}</div>
    {open && <div className="crew-jobs">{WORK_JOBS.map(([job, n]) => <div key={job} className="crew-job"><span className="label">{job}</span>
      {Array.from({ length: n }, (_, i) => <select key={i} className="input" aria-label={`${job} ${n > 1 ? i + 1 : ""}`.trim()} value={crew[job]?.[i] || ""} onChange={(e) => pick(job, i, e.target.value)}>
        <option value="">—</option>{ps.map((p) => <option key={p.id} value={p.id}>{playerName(p.id)}</option>)}</select>)}</div>)}
      <p className="keys">"Fill fairly" picks the players who've worked least this season, so the same kids aren't always on the line.</p></div>}
  </div>;
}

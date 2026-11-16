/** Film Room home → Search all your film: one question across every match ("Maya's kills vs Buchanan",
 * "aces in the last 3 matches"), with the clips back to back and a highlight video for one player. */
import { useMemo, useState } from "react";
import { eventsOf, matchesOf, opponentsOf, player, replayOf, teamPlayers, todayISO } from "../../data/store";
import { Card, fmtDate, plural } from "../../ui/kit";
import { ClipPlayer } from "../../ui/ClipPlayer";
import { ReelMaker } from "../../film/ReelMaker";
import { go } from "../../app/router";
import { Clip, clipsFrom, clock, filmTiming, videoTime } from "../../film/clips";
import { aiQueryPrompt, cleanAiQuery, ClipQuery, parseQuery, QueryPlayer } from "../../film/query";
import { inScope, parseScope, Scope, searchSeason } from "../../film/library";
import { aiAvailable, askJson } from "../../ai/client";
import { describe, label, resolve } from "./words";

export function SeasonFind() {
  const all = matchesOf().filter((m) => m.kind === "match");
  const roster: QueryPlayer[] = teamPlayers().map((p) => ({ id: p.id, first: p.first, last: p.last, num: String(p.num) }));
  const opps = [...new Set([...opponentsOf().map((o) => o.name), ...all.map((m) => m.opp)])];
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [miss, setMiss] = useState("");
  const [hit, setHit] = useState<{ q: ClipQuery; scope: Scope; chips: string[]; by?: "ai"; title: string } | null>(null);
  const [play, setPlay] = useState(false), [reelFor, setReelFor] = useState<string | null>(null), [open, setOpen] = useState<string | null>(null);
  const withVideo = all.filter((m) => m.video).length;
  const recentOpp = all.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.opp;
  const examples = [roster[0] ? `${roster[0].first}'s kills this season` : "Kills this season", "Aces in the last 3 matches", recentOpp ? `Their kills vs ${recentOpp}` : "Their kills", "Shanked passes this month", "Blocks at 20+"];

  const run = async (s: string) => {
    setText(s); setPlay(false); setMiss(""); setOpen(null);
    const { scope, rest } = parseScope(s, opps, todayISO());
    const title = s.trim() ? s.trim()[0].toUpperCase() + s.trim().slice(1) : "Clips";
    const p = parseQuery(rest, roster);
    if (!p.empty) { setHit({ q: p.q, scope, chips: [...p.chips, ...scope.chips], title }); return; }
    if (!rest && scope.chips.length) { setHit({ q: { codes: null, players: [], opp: [], zones: [], sets: [], rots: [], pointsOnly: true }, scope, chips: ["Every point", ...scope.chips], title }); return; }
    if (!aiAvailable()) { setHit(null); setMiss("Try naming a play (kills, aces, blocks, digs, passes, errors), a player, an opponent (“vs Buchanan”) or “last 3 matches”."); return; }
    setBusy(true);
    try { const x = await askJson<any>(aiQueryPrompt(rest, roster), { tier: "quick" }); const cq = cleanAiQuery(x, roster); setHit({ q: cq, scope, chips: [...describe(cq, roster), ...scope.chips], by: "ai", title }); }
    catch { setHit(null); setMiss("Couldn't work that out. Try naming a play, a player or an opponent."); }
    setBusy(false);
  };

  const groups = useMemo(() => {
    if (!hit) return [];
    const ms = all.map((m) => { const R = replayOf(m); return R ? { m, R, id: m.id, date: m.date, opp: m.opp, log: R.log } : null; }).filter(Boolean) as any[];
    return searchSeason(ms, hit.q, hit.scope).map((g: any) => {
      const m = g.m.m, R = g.m.R, T = filmTiming(m, R, eventsOf(m.id));
      const clips: Clip[] = m.video ? clipsFrom(m, T, g.rows, () => true, label, m.film ? 5 : 8, 2) : [];
      return { m, T, rows: g.rows, clips };
    });
  }, [hit]);
  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  const clips = groups.flatMap((g) => g.clips), playable = clips.filter((c) => resolve(c));
  const needFile = clips.length - playable.length, noVideo = groups.filter((g) => !g.m.video).reduce((a, g) => a + g.rows.length, 0);
  const onePlayer = hit && hit.q.players.length === 1 ? hit.q.players[0] : null;

  if (!all.some((m) => replayOf(m)?.log.length)) return null;
  return <Card title="Search all your film" className="fr-season">
    <p className="small muted">One question across every match{withVideo ? `, with ${plural(withVideo, "match", "matches")} of video` : ""}. Name plays, players, opponents and when.</p>
    <form className="fr-ask" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(text.trim()); }}>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="“Maya's kills vs Buchanan”, “aces in the last 3 matches”" aria-label="Search all your film" />
      <button className="btn primary" disabled={busy || !text.trim()}>{busy ? "Thinking…" : "Search"}</button>
    </form>
    <div className="fr-examples">{examples.map((x) => <button key={x} className="fr-ex" onClick={() => run(x)}>{x}</button>)}</div>
    {miss && <p className="small muted">{miss}</p>}
    {hit && <div className="stack" style={{ marginTop: 10 }}>
      <div className="fr-understood"><span className="small muted">{hit.by === "ai" ? "Read as" : "Looking for"}</span>{hit.chips.map((c) => <span key={c} className="fr-chip">{c}</span>)}</div>
      <b>{total ? `${plural(total, "play")} in ${plural(groups.length, "match", "matches")}` : hit.scope.opps.length && !inScope(all, hit.scope).length ? `No matches against ${hit.scope.opps.join(" or ")} yet` : "No plays match"}</b>
      {total > 0 && <div className="row">
        {playable.length > 0 && <button className={"btn" + (play ? "" : " primary")} onClick={() => setPlay(!play)}>{play ? "Hide clips" : `Watch ${plural(playable.length, "clip")} back to back`}</button>}
        {onePlayer && playable.length > 0 && player(onePlayer) && <button className="btn" onClick={() => setReelFor(onePlayer)}>Make {player(onePlayer)!.first}'s highlight video</button>}
      </div>}
      {(needFile > 0 || noVideo > 0) && total > 0 && <p className="small muted">{[needFile ? `${plural(needFile, "clip")} need${needFile === 1 ? "s" : ""} the game video picked again (videos stay on the device they were chosen on)` : "", noVideo ? `${plural(noVideo, "play")} from matches with no video` : ""].filter(Boolean).join(". ")}.</p>}
      {play && <ClipPlayer key={hit.title} clips={playable} resolve={resolve} allowSave title={hit.title} fileName={(c) => `${hit.title}${c ? " " + c.label + " vs " + c.opp : ""}`.replace(/[^\w\- .#]+/g, "")} />}
      {reelFor && <ReelMaker id={reelFor} pool={playable} onClose={() => setReelFor(null)} />}
      <ul className="fr-groups">{groups.map((g) => { const on = open === g.m.id; return <li key={g.m.id}>
        <div className="fr-group-hd">
          <button className="fr-group-t" aria-expanded={on} onClick={() => setOpen(on ? null : g.m.id)}><b>vs {g.m.opp}</b><span className="small muted">{fmtDate(g.m.date)} · {plural(g.rows.length, "play")}{!g.m.video ? " · no video" : ""}</span></button>
          <button className="btn sm" onClick={() => go("film", g.m.id)}>Open in Film Room</button>
        </div>
        {on && <ul className="log film fr-rows">{g.rows.slice(0, 200).map((l) => { const s = l as any; return <li key={l.id}><span className="num fr-time">{g.m.video ? clock(Math.max(0, videoTime(g.T, l.id) - (g.m.film ? 5 : 8))) : "S" + l.set}</span><span>{label(l)}</span><span className={"small " + (s.w ? "pt-" + s.w : "muted")}>{s.w ? `${s.us}–${s.them}` : "S" + l.set}</span></li>; })}</ul>}
      </li>; })}</ul>
    </div>}
  </Card>;
}

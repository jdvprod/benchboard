/** A coach's or player's own corner of the Academy: favorite drills (kept with the account, so they follow you to
 * every device) and drills you write yourself, for any section. Signed out, both are kept on this device. */
import { useEffect, useState } from "react";
import { cloudAvailable, currentUser, rpc, updateMeta, userMeta } from "../cloud/client";
import type { Drill, LibDrill } from "./content";
import { AREAS } from "./content";

const FAV_KEY = "fc-academy-favs", OWN_KEY = "fc-academy-own";
const signedIn = () => cloudAvailable() && !!currentUser();
const readLocal = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const writeLocal = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

/* tiny shared store so a star on one drill updates every list */
let favs: string[] = signedIn() ? userMeta().fav_drills || [] : readLocal<string[]>(FAV_KEY, []);
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function useFavs() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const toggle = async (id: string) => {
    favs = favs.includes(id) ? favs.filter((x) => x !== id) : [id, ...favs].slice(0, 300); emit();
    if (signedIn()) { try { await updateMeta({ fav_drills: favs }); } catch { /* kept locally until next save */ writeLocal(FAV_KEY, favs); } } else writeLocal(FAV_KEY, favs);
  };
  return { favs, isFav: (id: string) => favs.includes(id), toggle };
}

export interface OwnDrill extends Drill { area: string; group?: string; topic?: string; mine?: boolean }
interface Row { id: string; area: string; data: Omit<OwnDrill, "id" | "area"> }
const toOwn = (r: Row, mine: boolean): OwnDrill => ({ ...(r.data as any), id: "c:" + r.id, area: r.area, mine });
let own: OwnDrill[] | null = null, picked: OwnDrill[] = [];
const ownSubs = new Set<() => void>();
const ownEmit = () => ownSubs.forEach((f) => f());
async function loadOwn() {
  if (signedIn()) {
    try { own = ((await rpc("my_custom_drills", {})) as Row[]).map((r) => toOwn(r, true)); } catch { own = own || []; }
    try { picked = ((await rpc("picked_custom_drills", {})) as Row[]).map((r) => toOwn(r, false)).filter((x) => !own!.some((o) => o.id === x.id)); } catch { picked = []; }
  } else own = readLocal<OwnDrill[]>(OWN_KEY, []).map((x) => ({ ...x, mine: true }));
  ownEmit();
}
/** Your own drills (and custom drills your coach sent you), with save and delete. */
export function useOwn() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((x) => x + 1); ownSubs.add(f); if (own == null) loadOwn(); return () => { ownSubs.delete(f); }; }, []);
  const save = async (d: OwnDrill) => {
    const { id, area, mine, ...data } = d;
    if (signedIn()) { await rpc("custom_drill_save", { did: id?.startsWith("c:") ? id.slice(2) : null, ar: area, dat: data }); await loadOwn(); }
    else { const list = (own || []).filter((x) => x.id !== id); const nid = id?.startsWith("c:") ? id : "c:" + Math.random().toString(36).slice(2, 10); own = [{ ...d, id: nid, mine: true }, ...list]; writeLocal(OWN_KEY, own); ownEmit(); }
  };
  const remove = async (id: string) => {
    if (signedIn()) { await rpc("custom_drill_delete", { did: id.slice(2) }); await loadOwn(); }
    else { own = (own || []).filter((x) => x.id !== id); writeLocal(OWN_KEY, own); ownEmit(); }
  };
  const lib: LibDrill[] = [...(own || []), ...picked].map((x) => { const a = AREAS.find((y) => y.id === x.area); return { ...x, area: x.area, areaName: a?.name || "", category: a?.category || "Skill work" } as LibDrill; });
  return { own: own || [], picked, lib, save, remove, ready: own != null };
}

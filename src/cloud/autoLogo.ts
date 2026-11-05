/** A new opponent gets its school's logo by itself when there's exactly one clear match (see autoPick); once per opponent. */
import { Opponent } from "../data/model";
import { all, get, patch, setOpponentLogo } from "../data/store";
import { autoPick, findLogos } from "../lib/logoSearch";
import { canvasImage, cleanLogo } from "../lib/image";
import { storePicture } from "./media";
import { isLinked, roleOn } from "./sync";

const trying = new Set<string>();
export async function autoLogo(o: Opponent) {
  if (o.logo || o.logoTried || trying.has(o.id) || !navigator.onLine || /^opponent$|\(sample\)/i.test(o.name)) return;
  trying.add(o.id);
  try {
    const region = all("teams").find((t) => t.id === o.teamId)?.region;
    const hit = autoPick(o.name, await findLogos(o.name, { region }), region);
    const now = get("opponents", o.id); if (!now || now.logo) return;
    if (!hit) { patch("opponents", o.id, { logoTried: Date.now() }); return; }
    // trimmed and saved as the team's own copy when the logo's site allows it, so it looks like every other logo
    const img = await canvasImage(hit.url), role = roleOn(o.teamId), canUpload = isLinked(o.teamId) && (role === "owner" || role === "coach");
    setOpponentLogo(o.id, img ? await storePicture(o.teamId, "opp", o.id, await cleanLogo(img), canUpload).catch(() => hit.url) : hit.url);
  } finally { trying.delete(o.id); }
}

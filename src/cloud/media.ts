/** Player photos and team logos. Synced teams upload them (Supabase Storage, bucket "media") so every coach's device
 * and the public sites can show them; otherwise a small copy stays in the record on this device until the team syncs. */
import { all, patch } from "../data/store";
import { blobFromDataUrl, dataUrl } from "../lib/image";
import { cloudAvailable, currentUser, publicFileUrl, uploadFile } from "./client";

export type PicKind = "player" | "team" | "opp";
const ext = (b: Blob) => (b.type === "image/png" ? "png" : b.type === "image/webp" ? "webp" : "jpg");

/** Store a picture: uploaded when the team syncs and this coach can edit it, kept on the device otherwise. */
export async function storePicture(teamId: string, kind: PicKind, id: string, blob: Blob, canUpload: boolean): Promise<string> {
  if (canUpload && cloudAvailable() && currentUser()) {
    try {
      const path = `media/${teamId}/${kind}-${id}.${ext(blob)}`;
      await uploadFile(path, blob);
      return publicFileUrl(path) + "?v=" + Date.now().toString(36);
    } catch { /* offline or Storage not set up: keep it on the device and upload after the next sync */ }
  }
  return dataUrl(blob);
}

const isData = (u?: string) => !!u && u.startsWith("data:");
let busy = false;
/** After a sync: upload pictures that were added while offline or before the team synced. */
export async function uploadPending(teams: string[], canEdit: (teamId: string) => boolean) {
  if (busy || !cloudAvailable() || !currentUser()) return; busy = true;
  try {
    for (const tid of teams) {
      if (!canEdit(tid)) continue;
      const up = async (kind: PicKind, id: string, u: string) => storePicture(tid, kind, id, await blobFromDataUrl(u), true);
      const t = all("teams").find((x) => x.id === tid);
      if (t && isData(t.logo)) { const u = await up("team", t.id, t.logo!); if (!isData(u)) patch("teams", t.id, { logo: u }); }
      for (const p of all("players").filter((x) => x.teamId === tid && isData(x.photo))) { const u = await up("player", p.id, p.photo!); if (isData(u)) return; patch("players", p.id, { photo: u }); }
      for (const o of all("opponents").filter((x) => x.teamId === tid && isData(x.logo))) {
        const u = await up("opp", o.id, o.logo!); if (isData(u)) return; patch("opponents", o.id, { logo: u });
        for (const m of all("matches").filter((x) => x.teamId === tid && isData(x.oppLogo) && x.oppLogo === o.logo)) patch("matches", m.id, { oppLogo: u });
      }
    }
  } finally { busy = false; }
}

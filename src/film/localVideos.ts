/** Video files picked on this device for clips. Kept only while the app is open; nothing is uploaded. */
const files = new Map<string, string>(), raw = new Map<string, File>();
export const localVideo = (matchId: string) => files.get(matchId) || null;
/** The picked file itself (Film Room reads its sound to find rallies). */
export const localFile = (matchId: string) => raw.get(matchId) || null;
export function setLocalVideo(matchId: string, file: File): string { const old = files.get(matchId); if (old) URL.revokeObjectURL(old); const u = URL.createObjectURL(file); files.set(matchId, u); raw.set(matchId, file); return u; }

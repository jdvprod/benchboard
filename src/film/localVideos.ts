/** Video files picked on this device for clips. Kept only while the app is open; nothing is uploaded. */
const files = new Map<string, string>();
export const localVideo = (matchId: string) => files.get(matchId) || null;
export function setLocalVideo(matchId: string, file: File): string { const old = files.get(matchId); if (old) URL.revokeObjectURL(old); const u = URL.createObjectURL(file); files.set(matchId, u); return u; }

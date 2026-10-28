/** Keeps the screen on while `active` (live tracking, the practice timer). Re-acquired when the app comes back to the front. */
import { useEffect } from "react";

export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as any).wakeLock; if (!active || !wl) return;
    let lock: any = null, gone = false;
    const get = async () => { try { if (!gone && document.visibilityState === "visible") lock = await wl.request("screen"); } catch { /* battery saver or unsupported: ignore */ } };
    const onVis = () => { if (document.visibilityState === "visible") get(); };
    get(); document.addEventListener("visibilitychange", onVis);
    return () => { gone = true; document.removeEventListener("visibilitychange", onVis); try { lock?.release(); } catch { /* ignore */ } };
  }, [active]);
}

/** How player photos and team logos show (no app state: also used by the public sites).
 * Logos always sit on a white rounded tile and photos in a circle, so every picture looks the same size and style;
 * a picture that fails to load falls back to initials or the jersey number. */
import { useState } from "react";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** A player's photo, or their jersey number when there isn't one. */
export function Avatar({ photo, num, size = 40, className = "" }: { photo?: string | null; num: string; size?: number; className?: string }) {
  const [bad, setBad] = useState("");
  return photo && bad !== photo ? <img className={"avatar " + className} src={photo} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" onError={() => setBad(photo)} />
    : <span className={"avatar none " + className} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">{num}</span>;
}
/** A team's logo, or its initials. */
export function TeamLogo({ src, name, size = 28, className = "" }: { src?: string | null; name: string; size?: number; className?: string }) {
  const [bad, setBad] = useState("");
  return src && bad !== src ? <span className={"tlogo " + className} style={{ width: size, height: size }}><img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(src)} /></span>
    : <span className={"tlogo none " + className} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">{initials(name)}</span>;
}

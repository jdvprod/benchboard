/** How player photos and team logos show (no app state: also used by the public sites). */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** A player's photo, or their jersey number when there isn't one. */
export function Avatar({ photo, num, size = 40, className = "" }: { photo?: string | null; num: string; size?: number; className?: string }) {
  return photo ? <img className={"avatar " + className} src={photo} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" />
    : <span className={"avatar none " + className} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">{num}</span>;
}
/** A team's logo, or its initials. */
export function TeamLogo({ src, name, size = 28, className = "" }: { src?: string | null; name: string; size?: number; className?: string }) {
  return src ? <img className={"tlogo " + className} src={src} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" referrerPolicy="no-referrer" />
    : <span className={"tlogo none " + className} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(name)}</span>;
}


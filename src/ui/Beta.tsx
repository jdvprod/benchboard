/** "Beta" on features that are still learning (finding rallies by sound, picking highlights), and the line that says so. */
import type { ReactNode } from "react";
import "./beta.css";
export const Beta = () => <span className="beta-chip" title="Still learning: check its work">Beta</span>;
export const BetaNote = ({ children }: { children?: ReactNode }) => <p className="beta-note"><Beta /> {children || "This is still learning and won't always be right. Check its work before you share or rely on it."}</p>;

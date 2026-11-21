/** Age screen at sign-up: birth month and year, asked neutrally (every year is listed, nothing hints at a cutoff).
 * Only the result is kept with the account (13 to 17, or 18 and over), never the birth date. Someone under 13 is told
 * they can't make an account, and this browser remembers that for a day so the answer can't simply be changed. */
export type AgeBand = "under13" | "13-17" | "18+";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BLOCK = "fc-age-block";

/** Which band a birth month (1–12) and year fall in on `now`. Pure. */
export function ageBand(month: number, year: number, now = new Date()): AgeBand | null {
  if (!month || !year) return null;
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month) age -= 1; // birthday month not reached yet (the month itself counts as reached)
  return age < 13 ? "under13" : age < 18 ? "13-17" : "18+";
}
export const ageBlocked = () => { try { const t = +(localStorage.getItem(BLOCK) || 0); return t > Date.now() - 86400e3; } catch { return false; } };
export const blockAge = () => { try { localStorage.setItem(BLOCK, String(Date.now())); } catch { /* private window */ } };
/** Tests fill this in so every sign-up flow doesn't have to. */
export const testBirth = (): { m: string; y: string } => { const v = (globalThis as any).__FC_TEST_BIRTH as string | undefined; return v ? { m: v.split("-")[1], y: v.split("-")[0] } : { m: "", y: "" }; };

export function BirthFields({ m, y, onChange, cls = "" }: { m: string; y: string; onChange: (m: string, y: string) => void; cls?: string }) {
  const now = new Date().getFullYear(), years = Array.from({ length: 100 }, (_, i) => String(now - i));
  return <fieldset className={"age-fields " + cls}><legend>Birth month and year</legend>
    <div className="age-row">
      <select value={m} onChange={(e) => onChange(e.target.value, y)} aria-label="Birth month"><option value="">Month</option>{MONTHS.map((x, i) => <option key={x} value={String(i + 1)}>{x}</option>)}</select>
      <select value={y} onChange={(e) => onChange(m, e.target.value)} aria-label="Birth year"><option value="">Year</option>{years.map((x) => <option key={x} value={x}>{x}</option>)}</select>
    </div></fieldset>;
}
export const UNDER13 = "Sorry, you can't create a FloorCall account. Ask a parent or guardian to make one: they can follow your team and your lessons for you.";

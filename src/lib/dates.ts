/** A date as YYYY-MM-DD in the viewer's own time zone (toISOString would give tomorrow's date on a US evening). */
export const localISO = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
export const todayISO = () => localISO(new Date());

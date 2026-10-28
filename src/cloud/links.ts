/** Public sites live beside the coaching app: /live/ for families and fans, /recruit/ for college coaches. */
export type Site = "live" | "recruit";
export function siteUrl(site: Site, hashPath = ""): string {
  const base = new URL(site + "/", location.href.split("#")[0].replace(/\/(live|recruit)\/.*$/, "/")).href;
  return base + (hashPath ? "#/" + hashPath : "");
}

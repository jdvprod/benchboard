/* Fills the team name into the permission form and shows this site's privacy policy address. */
  const t = document.getElementById("team"), out = document.getElementById("teamOut");
  const fromHash = decodeURIComponent((location.hash.match(/team=([^&]+)/) || [])[1] || "");
  const set = (v) => { out.textContent = v || " ".repeat(40); };
  t.value = fromHash; set(fromHash); t.addEventListener("input", () => set(t.value));
  if (location.protocol.startsWith("http")) document.getElementById("privacyUrl").textContent = new URL("privacy.html", location.href).href.replace(/^https?:\/\//, "");
document.getElementById("print").addEventListener("click", () => print());

/** The contact form on getfloorcall.com/contact.html: sends to support_send (schema v32), read in Admin console → Messages.
 * Falls back to the email address when Floorcall can't be reached. */
import { CloudError, cloudAvailable, rpc } from "../cloud/client";

const form = document.getElementById("contact") as HTMLFormElement | null;
const sent = document.querySelector(".ct-sent") as HTMLElement | null;
const err = document.querySelector(".ct-err") as HTMLElement | null;
const topic = new URLSearchParams(location.search).get("topic");
if (form && topic) { const s = form.elements.namedItem("topic") as HTMLSelectElement; if ([...s.options].some((o) => o.value === topic)) s.value = topic; }
const from = new URLSearchParams(location.search).get("from") || "home";
const details = new URLSearchParams(location.search).get("d") || "";

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = (k: string) => ((form.elements.namedItem(k) as HTMLInputElement).value || "").trim();
  const show = (m: string) => { if (err) { err.textContent = m; err.hidden = !m; } };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email"))) return show("Add an email address we can reply to.");
  if (v("msg").length < 5) return show("Add a message.");
  show("");
  const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    if (!cloudAvailable()) throw new CloudError(0, "offline");
    await rpc("support_send", { who: v("who"), email: v("email"), topic: v("topic"), msg: v("msg") + `\n\n— sent from ${from}` + (details ? "\n" + details : `, ${navigator.userAgent}`), site: from, trap: v("trap") }, true);
    form.hidden = true;
    if (sent) { sent.hidden = false; (sent.querySelector(".ct-to") as HTMLElement).textContent = v("email"); }
  } catch (x) {
    const email = (document.querySelector('.ct-side a[href^="mailto:"]') as HTMLAnchorElement)?.textContent || "";
    show(x instanceof CloudError && x.status >= 400 && x.status < 500 ? x.message : `Couldn't send just now. Email us at ${email} instead.`);
  }
  btn.disabled = false; btn.textContent = "Send message";
});
document.getElementById("another")?.addEventListener("click", () => {
  if (!form || !sent) return;
  (form.elements.namedItem("msg") as HTMLTextAreaElement).value = "";
  sent.hidden = true; form.hidden = false;
});

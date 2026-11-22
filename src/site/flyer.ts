/** The convention flyer (getfloorcall.com/flyer.html): draws its QR codes. */
import { qrSvg } from "../lib/qr";
document.querySelectorAll<HTMLElement>("[data-qr]").forEach((el) => { el.innerHTML = qrSvg(el.dataset.qr || location.origin, "#0B0C0E", "#ffffff"); });
document.querySelector(".print")?.addEventListener("click", () => print());

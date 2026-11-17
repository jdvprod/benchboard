import { initInstall } from "./app/install";
import { watchErrors } from "./app/errors";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./app/App";
import { init, toast } from "./data/store";
import { restoreTeams, startSync } from "./cloud/sync";
import { consumeAuthRedirect, currentUser } from "./cloud/client";
initInstall();
watchErrors();

consumeAuthRedirect().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
  init().then(() => { startSync(); if (currentUser()) restoreTeams().catch(() => {}); });
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http") && location.hostname !== "localhost") {
  window.addEventListener("load", () => {
    const hadController = !!navigator.serviceWorker.controller;
    const reg = navigator.serviceWorker.register("sw.js").catch(() => null);
    // An installed app can stay open for days, so look for a new version whenever it comes back to the screen.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.then((r) => r?.update()).catch(() => {}); });
    // A new version took over. Switch to it the next time the coach comes back to the app (never mid-tap or mid-typing),
    // or right away if nothing's on screen yet. Everything is saved as it's entered, so reloading loses nothing.
    let ready = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || ready) return; ready = true;
      if (document.visibilityState === "hidden") { location.reload(); return; }
      toast("A new version of Floorcall is ready. It switches over the next time you come back to the app.");
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") location.reload(); });
    });
  });
}

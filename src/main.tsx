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
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // a new version took over: say so once (pages already load network-first, so it's in use after this reload)
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) toast("Floorcall updated to the latest version"); });
  });
}

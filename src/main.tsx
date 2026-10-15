import React from "react";
import { createRoot } from "react-dom/client";
import PolicyApp from "./policy-app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><PolicyApp /></React.StrictMode>);

if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
  let registration: ServiceWorkerRegistration | undefined;
  let updating = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) window.location.reload();
  });
  window.addEventListener("policy-tree:apply-update", () => {
    if (registration?.waiting) {
      updating = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  });
  const announce = () => window.dispatchEvent(new Event("policy-tree:update-available"));
  const announceReady = () => window.dispatchEvent(new Event("policy-tree:offline-ready"));
  window.addEventListener("policy-tree:check-update", () => {
    if (registration?.waiting) announce();
    if (registration?.active) announceReady();
  });
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      if (reg.waiting) announce();
      void navigator.serviceWorker.ready.then(announceReady);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) announce();
        });
      });
      void reg.update().catch(() => undefined);
    }).catch(() => {
      // Online browser use remains available if offline preparation fails.
    });
}

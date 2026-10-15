import React from "react";
import { createRoot } from "react-dom/client";
import PolicyApp from "./policy-app";
import "./styles.css";
import { observePolicyRegistration } from "./pwa-registration";

createRoot(document.getElementById("root")!).render(<React.StrictMode><PolicyApp /></React.StrictMode>);

if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
  let registration: ServiceWorkerRegistration | undefined;
  let checkRegistration: (() => void) | undefined;
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
    checkRegistration?.();
  });
  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker.register(base + "sw.js", { scope: base, updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      checkRegistration = observePolicyRegistration(reg, announceReady, announce);
      void reg.update().catch(() => undefined);
    }).catch(() => {
      // Online browser use remains available if offline preparation fails.
    });
}

/** Register TeamVault PWA service worker (secure context only). */
(function (global) {
  if (!global.navigator?.serviceWorker || !global.isSecureContext) return;
  const base = String(global.__TV_BASE__ || "").replace(/\/$/, "");
  global.addEventListener("load", () => {
    global.navigator.serviceWorker
      .register((base || "") + "/sw.js", { scope: (base || "") + "/" })
      .catch(() => {});
  });
})(typeof window !== "undefined" ? window : globalThis);

/** Register TeamVault PWA service worker (secure context only). */
(function (global) {
  if (!global.navigator?.serviceWorker || !global.isSecureContext) return;
  function resolveBase() {
    if (typeof global.__TV_BASE__ === "string") {
      const v = String(global.__TV_BASE__).replace(/\/$/, "");
      if (v) return v;
    }
    try {
      const meta = (global.document?.querySelector?.('meta[name="tv-base"]')?.content || "").replace(/\/$/, "");
      if (meta) return meta;
    } catch (_) {}
    return "";
  }
  const base = resolveBase();
  global.addEventListener("load", () => {
    global.navigator.serviceWorker
      .register((base || "") + "/sw.js", { scope: (base || "") + "/" })
      .catch(() => {});
  });
})(typeof window !== "undefined" ? window : globalThis);

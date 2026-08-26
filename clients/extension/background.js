// Service worker — no vault keys here (Zero-Knowledge: SK only in popup memory).
// Chrome/Edge: MV3 service_worker (this file). Firefox: same MV3 background;
// load via about:debugging → Temporary Add-on → manifest.json.
const api = typeof browser !== "undefined" ? browser : chrome;
api.runtime.onInstalled.addListener(() => {
  /* installed */
});

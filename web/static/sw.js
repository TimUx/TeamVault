/* TeamVault PWA service worker — app shell only; never caches /api or /downloads. */
const TV_SW_BASE = (() => {
  const p = self.location.pathname;
  const marker = "/sw.js";
  const i = p.lastIndexOf(marker);
  return i >= 0 ? p.slice(0, i) : "";
})();

const CACHE = "teamvault-shell-v40";
const NETWORK_FIRST = ["/styles.css", "/app.js", "/offline-store.js", "/offline-hardware.js"].map((path) => TV_SW_BASE + path);
const PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/cryptocore.js",
  "/import-parse.js",
  "/vault-io.js",
  "/offline-store.js",
  "/offline-hardware.js",
  "/qrcode.js",
  "/sw-register.js",
  "/manifest.webmanifest",
  "/vendor/nacl-fast.min.js",
  "/vendor/argon2.umd.min.js",
  "/vendor/secrets.min.js",
  "/icons/icon.svg",
].map((path) => TV_SW_BASE + path);

function isPrecachePath(pathname) {
  return PRECACHE.includes(pathname);
}

// Browsers reject redirected responses for navigations (e.g. cached
// /index.html → 301 /), so serve a fresh, non-redirected copy.
function navigationSafe(res) {
  if (!res || !res.redirected) return res;
  return res.blob().then((body) => new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(TV_SW_BASE + "/api/")) return;
  if (TV_SW_BASE === "" && url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith(TV_SW_BASE + "/downloads/")) return;
  if (TV_SW_BASE === "" && url.pathname.startsWith("/downloads/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(() => {
        const index = TV_SW_BASE + "/index.html";
        return caches
          .match(TV_SW_BASE + "/")
          .then((cached) => cached || caches.match(index))
          .then(navigationSafe);
      })
    );
    return;
  }

  if (!isPrecachePath(url.pathname)) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (NETWORK_FIRST.includes(url.pathname)) {
        return fetch(req, { cache: "no-store" })
          .then((res) => {
            if (res && res.status === 200 && url.pathname === TV_SW_BASE + "/styles.css") {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
      }
      if (cached) return cached;
      return fetch(req, { cache: "no-store" }).then((res) => {
        if (!res || res.status !== 200) return res;
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});

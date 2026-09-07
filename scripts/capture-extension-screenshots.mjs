#!/usr/bin/env node
/**
 * Capture store screenshots of the TeamVault browser extension popup.
 *
 * The popup is rendered with its real HTML/CSS/JS; only the browser
 * extension APIs, the server API and the crypto layer are stubbed so the
 * popup shows purely synthetic demo data (no real vault, no real keys,
 * no network access). Each popup shot is composed onto a neutral
 * 1280x800 canvas, the size accepted by both the Chrome Web Store and
 * Firefox AMO.
 *
 * Usage: node scripts/capture-extension-screenshots.mjs [outDir]
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "extension");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist", "extension-store-screenshots"));

const CANVAS = { width: 1280, height: 800 };

const { chromium } = await import("playwright").catch(() =>
  import(pathToFileURL(path.join(__dirname, "node_modules", "playwright", "index.mjs")).href)
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

const DEMO_PAGE = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Demo Login</title><style>
body{margin:0;font:15px/1.5 "Segoe UI",system-ui,sans-serif;background:#eef2f7;color:#1a1d21;
display:flex;align-items:center;justify-content:center;height:100vh}
.card{background:#fff;border:1px solid #e1e8ed;border-radius:10px;padding:2rem;width:340px;
box-shadow:0 8px 30px rgba(20,30,50,.08)}
h1{font-size:1.15rem;margin:0 0 1.2rem}label{display:block;font-weight:600;margin:.8rem 0 .3rem}
input{width:100%;box-sizing:border-box;padding:.5rem .6rem;border:1px solid #d1d9e0;border-radius:6px}
button{margin-top:1.2rem;width:100%;border:0;border-radius:6px;padding:.6rem;background:#1f66d1;color:#fff;font-weight:600}
</style></head><body><div class="card"><h1>demo-app.example — Anmelden</h1>
<label>Benutzername</label><input id="username" name="username" value="demo-user">
<label>Passwort</label><input id="password" name="password" type="password" value="demo-password">
<button type="button">Anmelden</button></div></body></html>`;

function serveExtension() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/demo-login.html") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(DEMO_PAGE);
      return;
    }
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const file = path.join(EXT, rel);
    if (!file.startsWith(EXT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** Stub of the WebExtension API, the TeamVault server API and TVCrypto. */
function installStubs(stage) {
  const demoSecrets = [
    { id: "s1", title: "Demo Email", url: "https://mail.demo-app.example/login", visibility: "private" },
    { id: "s2", title: "Demo GitLab", url: "https://git.demo-app.example", visibility: "shared" },
    { id: "s3", title: "Demo VPN", url: "https://vpn.demo-app.example", visibility: "shared" },
    { id: "s4", title: "Demo Wi-Fi", url: "", visibility: "private" },
    { id: "s5", title: "Demo Jira", url: "https://jira.demo-app.example", visibility: "shared" },
  ];
  const store = {
    base: "https://vault.example.com",
    tenant: "demo",
    user: "demo-user",
    accent: "blue",
  };
  const api = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => Object.assign(store, obj),
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://mail.demo-app.example/login" }],
      sendMessage: async () => ({ ok: true }),
    },
    scripting: { executeScript: async () => [] },
    permissions: { request: async () => true },
    runtime: { getManifest: () => ({ version: "0.0.0" }) },
  };
  window.chrome = api;
  window.browser = undefined;

  const me = {
    username: "demo-user",
    tenant_id: "demo",
    tenant_slug: "demo",
    preferences: { accent: "blue" },
  };
  const json = (body, ok = true) =>
    Promise.resolve({ ok, status: ok ? 200 : 401, statusText: "", json: async () => body });

  window.fetch = (input) => {
    const url = String(input);
    if (url.includes("/api/version")) return json({ version: "0.0.0" });
    if (url.includes("/api/client-downloads")) return json({ extension: {} });
    if (url.includes("/api/me")) {
      return stage === "login" ? json({ error: "unauthorized" }, false) : json(me);
    }
    if (url.includes("/api/vault/keys")) {
      return json({ salt_b64: "", encrypted_private_key_nonce_b64: "", encrypted_private_key_b64: "" });
    }
    if (url.includes("/api/vault/crypto-params")) return json({});
    if (url.match(/\/api\/secrets\?/)) {
      return json({
        items: demoSecrets.map((s) => ({
          id: s.id,
          has_access: true,
          visibility: s.visibility,
          envelope: { key_version: 1 },
          title_ciphertext_b64: "",
          title_nonce_b64: "",
        })),
        total: demoSecrets.length,
      });
    }
    const detail = demoSecrets.find((s) => url.endsWith("/api/secrets/" + s.id));
    if (detail) return json({ id: detail.id, envelope: {}, ciphertext_b64: "", nonce_b64: "", key_version: 1 });
    return json({}, false);
  };

  // Replace the crypto layer with a demo stub: nothing real is decrypted,
  // the popup simply renders the synthetic demo payloads.
  let titleIdx = 0;
  let lastDetailId = "";
  window.__tvDemoStub = () => {
    window.TVCrypto = {
      b64dec: () => new Uint8Array(0),
      openDataKeyEnvelope: () => new Uint8Array(32),
      unlockPrivateKey: async () => new Uint8Array(32),
      decryptTitle: async () => demoSecrets[titleIdx++ % demoSecrets.length].title,
      decryptPayload: async () => {
        const s = demoSecrets.find((x) => x.id === lastDetailId) || demoSecrets[0];
        return new TextEncoder().encode(
          JSON.stringify({
            username: "demo-user",
            password: "demo-password",
            urls: s.url ? [s.url] : [],
          })
        );
      },
    };
    const origFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = String(input);
      const detail = demoSecrets.find((s) => url.endsWith("/api/secrets/" + s.id));
      if (detail) lastDetailId = detail.id;
      return origFetch(input, init);
    };
  };
}

async function popupShot(browser, baseUrl, { stage, prepare }) {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, locale: "de-DE" });
  await page.addInitScript(installStubs, stage);
  await page.goto(`${baseUrl}/popup.html`);
  await page.waitForTimeout(300);
  if (prepare) await prepare(page);
  await page.waitForTimeout(300);
  const buf = await page.screenshot({ fullPage: true });
  await page.close();
  return buf;
}

async function compose(browser, imageBuffer, caption, file) {
  const page = await browser.newPage({ viewport: CANVAS });
  const dataUrl = "data:image/png;base64," + imageBuffer.toString("base64");
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6rem;
      background:linear-gradient(135deg,#eef3fb,#dbe6f6);font:600 26px/1.3 "Segoe UI",system-ui,sans-serif;color:#1a2533}
    p{margin:0;max-width:900px;text-align:center}
    img{max-height:560px;border-radius:10px;box-shadow:0 18px 50px rgba(20,35,60,.22);background:#fff}
  </style></head><body><p>${caption}</p><img src="${dataUrl}" alt=""></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log("→", file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serveExtension();
  const baseUrl = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true };
  if (process.env.TV_BROWSER_EXECUTABLE) launchOpts.executablePath = process.env.TV_BROWSER_EXECUTABLE;
  const browser = await chromium.launch(launchOpts);
  try {
    const login = await popupShot(browser, baseUrl, {
      stage: "login",
      prepare: async (page) => {
        await page.fill("#user", "demo-user");
        await page.fill("#lpw", "demo-password");
      },
    });
    await compose(browser, login, "Mit dem eigenen TeamVault-Server verbinden", "01-login.png");

    const unlock = await popupShot(browser, baseUrl, {
      stage: "unlock",
      prepare: async (page) => {
        await page.waitForSelector("#unlock:not([hidden])");
        await page.fill("#mpw", "demo-master-password");
      },
    });
    await compose(browser, unlock, "Zero-Knowledge: Entsperren nur lokal im Browser", "02-unlock.png");

    const vaultPrepare = async (page) => {
      await page.waitForSelector("#unlock:not([hidden])");
      await page.evaluate(() => window.__tvDemoStub());
      await page.fill("#mpw", "demo-master-password");
      await page.click("#doUnlock");
      await page.waitForSelector("#vault:not([hidden])");
      await page.waitForFunction(() => document.querySelectorAll("#slist .row-item").length > 0);
    };

    const vault = await popupShot(browser, baseUrl, {
      stage: "vault",
      prepare: async (page) => {
        await vaultPrepare(page);
        await page.uncheck("#matchHost");
      },
    });
    await compose(browser, vault, "Alle Zugangsdaten — privat und im Team geteilt", "03-vault.png");

    const matched = await popupShot(browser, baseUrl, {
      stage: "vault",
      prepare: async (page) => {
        await vaultPrepare(page);
        await page.check("#matchHost");
      },
    });
    await compose(browser, matched, "Nur Einträge, die zur geöffneten Seite passen", "04-domain-match.png");

    const settings = await popupShot(browser, baseUrl, {
      stage: "login",
      prepare: async (page) => {
        await page.fill("#base", "https://vault.example.com");
        await page.selectOption("#accent", "teal");
      },
    });
    await compose(browser, settings, "Eigener Server und Farbdesign frei wählbar", "05-settings.png");

    const demo = await browser.newPage({ viewport: { width: 1000, height: 620 }, locale: "de-DE" });
    await demo.goto(`${baseUrl}/demo-login.html`);
    const fill = await demo.screenshot();
    await demo.close();
    await compose(browser, fill, "Autofill trägt Benutzername, Passwort und TOTP ein", "06-autofill.png");
  } finally {
    await browser.close();
    server.close();
  }
  console.log("Screenshots:", OUT);
}

await main();

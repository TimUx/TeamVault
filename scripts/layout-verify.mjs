#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = process.env.TV_LAYOUT_SHOT || path.join(ROOT, "docs", "images", "layout-verify.png");
const BASE = process.env.TV_URL || "http://127.0.0.1:8099";
const DATA = process.env.TV_CAPTURE_DATA || path.join(process.env.TEMP || "/tmp", "tv-layout-test-data");

const LOGIN_USER = "admin";
const LOGIN_PW = "password1234";
const MASTER_PW = "admin-master-pw!";
const TENANT_SLUG = "demo";
const TENANT_NAME = "Demo GmbH";

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${pathname} → ${res.status}: ${text}`);
  return body;
}

async function setupInstance() {
  const st = await api("/api/setup/status");
  if (st.initialized) return;
  fs.mkdirSync(DATA, { recursive: true });
  const dsn = path.join(DATA, "vault-layout.db");
  await api("/api/setup/commit", {
    method: "POST",
    body: JSON.stringify({
      storage: { backend: "sqlite", dsn },
      tenant: { name: TENANT_NAME, slug: TENANT_SLUG, recovery_mode: "user_kit", escrow_allowed: false },
      admin: { username: LOGIN_USER, password: LOGIN_PW, display_name: "Admin", email: "admin@demo.local" },
      argon2: { Time: 1, Memory: 8192, Threads: 1, KeyLen: 32 },
    }),
  });
}

async function loginCookie(context) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ tenant_slug: TENANT_SLUG, username: LOGIN_USER, password: LOGIN_PW }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const raw of setCookie) {
    const m = raw.match(/^([^=]+)=([^;]+)/);
    if (m) await context.addCookies([{ name: m[1], value: m[2], url: BASE }]);
  }
  if (!res.ok) throw new Error("login failed");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1360, height: 900 },
  locale: "de-DE",
  serviceWorkers: "block",
});
const page = await context.newPage();

await setupInstance();
await loginCookie(context);

await page.goto(`${BASE}/onboard`);
if (await page.locator("#doOnboard").isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.fill("#mpw", MASTER_PW);
  await page.fill("#mpw2", MASTER_PW);
  await page.click("#doOnboard");
  await page.waitForSelector("#goApp, #unlock #mpw, #vaultui", { timeout: 180000 });
  if (await page.locator("#goApp").isVisible().catch(() => false)) {
    if (await page.locator("#kitSaved").isVisible().catch(() => false)) await page.check("#kitSaved");
    await page.click("#goApp");
    await page.waitForURL("**/app**");
  }
}

await page.goto(`${BASE}/app`);
if (await page.locator("#unlock").isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.fill("#unlock #mpw", MASTER_PW);
  await page.click("#ulock");
}
await page.waitForSelector("#vaultui", { state: "visible", timeout: 60000 });
await page.click('[data-nav="vault:mine"]').catch(() => {});
await page.waitForTimeout(500);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT, fullPage: false });
console.log("screenshot:", OUT);

const layout = await page.evaluate(() => {
  const sidebar = document.querySelector(".app-sidebar");
  const main = document.querySelector(".app-main");
  const footer = document.querySelector(".app-footer");
  const topbar = document.querySelector(".app-topbar");
  const brand = document.querySelector(".app-sidebar-brand");
  const sb = sidebar?.getBoundingClientRect();
  const mb = main?.getBoundingClientRect();
  const fb = footer?.getBoundingClientRect();
  const tb = topbar?.getBoundingClientRect();
  const bb = brand?.getBoundingClientRect();
  return {
    sidebar: sb ? { top: sb.top, bottom: sb.bottom, left: sb.left, right: sb.right, height: sb.height } : null,
    main: mb ? { top: mb.top, bottom: mb.bottom, left: mb.left, right: mb.right, height: mb.height } : null,
    footer: fb ? { top: fb.top, bottom: fb.bottom, left: fb.left, right: fb.right } : null,
    topbar: tb ? { top: tb.top, bottom: tb.bottom, height: tb.height } : null,
    brand: bb ? { top: bb.top, bottom: bb.bottom, height: bb.height } : null,
    footerBelowSidebar: fb && sb ? fb.top >= sb.bottom - 2 : null,
    footerInMainColumn: fb && mb ? fb.left >= mb.left - 2 && fb.right <= mb.right + 2 : null,
    headersAligned: tb && bb ? Math.abs(tb.top - bb.top) < 2 && Math.abs(tb.height - bb.height) < 2 : null,
  };
});
console.log("layout-check:", JSON.stringify(layout, null, 2));

await browser.close();

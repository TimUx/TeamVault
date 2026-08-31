#!/usr/bin/env node
/**
 * Capture documentation screenshots (Playwright + Chromium).
 * Requires: running TeamVault at TV_URL (see capture-docs-screenshots.sh).
 */
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "images");
const BASE = process.env.TV_URL || "http://127.0.0.1:8099";
const VIEWPORT = { width: 1360, height: 900 };

const LOGIN_USER = "admin";
const LOGIN_PW = "password1234";
const MASTER_PW = "admin-master-pw!";
const TENANT_SLUG = "demo";
const TENANT_NAME = "Demo GmbH";

fs.mkdirSync(OUT, { recursive: true });

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${pathname} → ${res.status}: ${text}`);
  return body;
}

async function setupInstance() {
  const st = await api("/api/setup/status");
  if (st.initialized) return;
  const dataDir = process.env.TV_CAPTURE_DATA
    ?? (process.platform === "win32" ? path.join(os.tmpdir(), "tv-screenshot-data") : "/data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dsn = path.join(dataDir, "vault-screenshots.db");
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
    body: JSON.stringify({
      tenant_slug: TENANT_SLUG,
      username: LOGIN_USER,
      password: LOGIN_PW,
    }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const raw of setCookie) {
    const m = raw.match(/^([^=]+)=([^;]+)/);
    if (m) {
      await context.addCookies([{
        name: m[1],
        value: m[2],
        url: BASE,
      }]);
    }
  }
  if (!res.ok) throw new Error("login failed");
}

async function shot(page, file, opts = {}) {
  const target = path.join(OUT, file);
  await page.screenshot({
    path: target,
    fullPage: opts.fullPage ?? false,
    clip: opts.clip,
  });
  console.log("  →", file);
}

async function waitAppReady(page) {
  await page.waitForSelector("#vaultui", { state: "visible", timeout: 60000 });
}

async function unlockVault(page) {
  await page.goto(`${BASE}/app`);
  const unlock = page.locator("#unlock");
  if (await unlock.isVisible()) {
    await shot(page, "vault-unlock.png");
    await page.fill("#unlock #mpw", MASTER_PW);
    await page.click("#ulock");
    await waitAppReady(page);
  }
}

async function onboardIfNeeded(page) {
  await page.goto(`${BASE}/onboard`);
  if (!(await page.locator("#doOnboard").isVisible({ timeout: 5000 }).catch(() => false))) {
    return;
  }
  await page.fill("#mpw", MASTER_PW);
  await page.fill("#mpw2", MASTER_PW);
  await shot(page, "onboard.png");
  await page.click("#doOnboard");
  await page.waitForSelector("#kit, button:has-text('Weiter zur App')", { timeout: 120000 });
  if (await page.locator("#kit").isVisible()) {
    await shot(page, "onboard-recovery-kit.png");
  }
  await page.click("button:has-text('Weiter zur App')");
  await page.waitForURL("**/app**");
}

async function seedSecrets(page) {
  await page.click('[data-nav="vault:create"]');
  await page.waitForSelector("#stitle");
  await page.fill("#stitle", "GitHub");
  await page.fill("#stagsIn", "dev, github");
  await page.fill("#suser", "octocat");
  await page.fill("#spw", "demo-secret-pw!");
  await shot(page, "vault-create.png", { fullPage: true });
  await page.click("#screate");
  await page.waitForSelector(".secrets-table tbody tr", { timeout: 30000 });
  await page.waitForSelector(".secrets-table .tag", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);

  await page.click('[data-nav="vault:create"]');
  await page.waitForSelector("#stitle");
  await page.fill("#stitle", "Pure Storage");
  await page.fill("#stagsIn", "storage, infra");
  await page.fill("#suser", "pureuser");
  await page.fill("#spw", "demo-storage-pw!");
  await page.click("#screate");
  await page.waitForSelector(".secrets-table tbody tr", { timeout: 30000 });
  await page.waitForTimeout(800);

  await page.click('[data-nav="vault:mine"]');
  await page.waitForSelector(".secrets-table tbody tr", { timeout: 30000 });
}

async function captureSetup(page) {
  await page.goto(`${BASE}/setup`);
  await page.waitForSelector("h1");
  await page.click('button.btn-accent:has-text("Weiter")');
  await page.waitForSelector("#backend");
  await shot(page, "setup-storage.png");

  await page.click('button[data-n]');
  await page.waitForSelector("#tname");
  await shot(page, "setup-tenant.png");

  await page.fill("#tname", TENANT_NAME);
  await page.fill("#tslug", TENANT_SLUG);
  await page.fill("#user", LOGIN_USER);
  await page.fill("#pw", LOGIN_PW);
  await page.fill("#pw2", LOGIN_PW);
  await page.click('button[data-n]');
  await page.waitForSelector("#mem");
  await shot(page, "setup-crypto.png");

  await page.click('button[data-n]');
  await page.waitForSelector("#mode");
  await shot(page, "setup-recovery.png");

  await page.click('button[data-n]');
  await page.waitForSelector("button:has-text('Einrichten')");
  await shot(page, "setup-commit.png");
}

async function main() {
  const st0 = await api("/api/setup/status");
  const launchOpts = { headless: process.env.TV_BROWSER_HEADED !== "1" };
  if (process.env.TV_BROWSER_CHANNEL) {
    launchOpts.channel = process.env.TV_BROWSER_CHANNEL;
  } else if (process.env.TV_BROWSER_EXECUTABLE) {
    launchOpts.executablePath = process.env.TV_BROWSER_EXECUTABLE;
  }
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: "de-DE",
    colorScheme: "light",
  });
  const page = await context.newPage();

  if (!st0.initialized) {
    console.log("Setup wizard screenshots…");
    await captureSetup(page);
    await setupInstance();
  } else {
    console.log("Instance already initialized — skipping setup wizard shots");
  }

  console.log("Login…");
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#slug option[value="demo"]', { state: "attached", timeout: 60000 });
  await page.selectOption("#slug", TENANT_SLUG);
  await shot(page, "login.png");

  await loginCookie(context);
  await onboardIfNeeded(page);
  await unlockVault(page);

  console.log("Vault UI…");
  await page.click('[data-nav="vault:mine"]');
  await waitAppReady(page);
  await seedSecrets(page);
  await page.waitForSelector(".secrets-table .tag", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, "vault-secrets-table.png", { fullPage: true });
  await shot(page, "nav-sidebar.png");

  await page.click('[data-view="list"]');
  await page.waitForTimeout(600);
  await shot(page, "vault-secrets.png", { fullPage: true });

  await page.click('[data-view="tiles"]');
  await page.waitForTimeout(600);
  await shot(page, "vault-secrets-tiles.png", { fullPage: true });

  await page.click('[data-view="table"]');
  await page.waitForTimeout(400);
  await page.selectOption("#stag", { label: "dev" }).catch(async () => {
    const opts = await page.locator("#stag option").count();
    if (opts > 1) await page.locator("#stag").selectOption({ index: 1 });
  });
  await page.waitForTimeout(800);
  await shot(page, "vault-tag-filter.png", { fullPage: true });
  await page.selectOption("#stag", { label: "" }).catch(() => page.locator("#stag").selectOption({ index: 0 }));

  await page.click('[data-nav="vault:import"]');
  await shot(page, "vault-import.png", { fullPage: true });
  await page.click('[data-nav="vault:mine"]');
  await shot(page, "vault-export.png", { fullPage: true });

  await unlockVault(page);
  await page.click('[data-nav="account"]');
  await page.waitForSelector("#passkey", { timeout: 15000 });
  await shot(page, "account.png", { fullPage: true });

  console.log("Admin…");
  await page.waitForSelector("#navAdminSection:not([hidden])", { timeout: 15000 });
  await page.click('[data-nav="admin:users"]');
  await page.waitForSelector("#ulist .list-row");
  await page.waitForTimeout(500);
  await shot(page, "admin-users.png", { fullPage: true });

  const editBtn = page.locator("[data-edit-user]").first();
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForSelector("#userEditModal:not([hidden])");
    await shot(page, "admin-user-edit.png");
    await page.click("#userEditClose");
  }

  await page.click('[data-nav="admin:groups"]');
  await page.waitForSelector("#glist .group-card, #glist .hint");
  await page.fill("#gname", "Ops");
  await page.click("#gcreate");
  await page.waitForSelector(".group-card", { timeout: 15000 });
  await page.click('[data-nav="admin:users"]');
  await page.fill("#nuser", "alice");
  await page.fill("#ndisplay", "Alice");
  await page.fill("#npw", "password1234!");
  await page.click("#ucreate");
  await page.waitForTimeout(800);
  await page.click('[data-nav="admin:groups"]');
  await page.waitForTimeout(500);
  await shot(page, "admin-groups.png", { fullPage: true });

  await page.click('[data-nav="admin:trust"]');
  await page.waitForSelector('[data-admin-section="trust"] #trust_ca_pem');
  await page.fill(
    "#trust_ca_pem",
    "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKExampleDemoCA0MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkRFOQwwCgYDVQQIDAxIZXNzZW4xDDAKBgNVBAcMA0RybQ0YDVQQKDA1EZW1v\nIENvcnAgQ0ExGDAWBgNVBAMMD2xkYXAuZGVtby5sb2NhbDAeFw0yNDAxMDEwMDAw\nMDBaFw0zNDAxMDEwMDAwMDBaMEUxCzAJBgNVBAYTAkRFOQwwCgYDVQQIDAxIZXNz\nZW4xDDAKBgNVBAcMA0RybQ0YDVQQKDA1EZW1vIENvcnAgQ0ExGDAWBgNVBAMMD2xk\nYXAuZGVtby5sb2NhbDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALdemo\n-----END CERTIFICATE-----"
  );
  await page.waitForTimeout(400);
  await shot(page, "admin-trust.png", { fullPage: true });
  await page.fill("#trust_ca_pem", "");

  await page.click('[data-nav="admin:ldap"]');
  await page.waitForSelector('[data-admin-section="ldap"] #ldap_host');
  await page.check("#ldap_en");
  await page.fill("#ldap_host", "ldap.demo.local");
  await page.fill("#ldap_port", "636");
  await page.check("#ldap_tls");
  await page.fill("#ldap_base", "dc=demo,dc=local");
  await page.fill("#ldap_bind", "cn=teamvault,ou=svc,dc=demo,dc=local");
  await page.fill("#ldap_filter", "(uid=%s)");
  await page.waitForTimeout(400);
  await shot(page, "admin-ldap.png", { fullPage: true });

  await page.click('[data-nav="admin:smtp"]');
  await page.waitForSelector('[data-admin-section="smtp"] #mail_host');
  await page.check("#mail_en");
  await page.fill("#mail_host", "smtp.demo.local");
  await page.fill("#mail_port", "587");
  await page.fill("#mail_from", "teamvault@demo.local");
  await page.fill("#mail_user", "teamvault");
  await page.waitForTimeout(400);
  await shot(page, "admin-smtp.png", { fullPage: true });

  await page.click('[data-nav="vault:mine"]');
  await page.waitForSelector("button:has-text('Öffnen')", { timeout: 20000 });
  const storageRow = page.locator(".secrets-table tbody tr").filter({ hasText: "Pure Storage" }).first();
  if (await storageRow.count()) {
    await storageRow.locator("button:has-text('Öffnen')").click();
  } else {
    await page.locator("button:has-text('Öffnen')").first().click();
  }
  await page.waitForSelector("#sdetail:not([hidden])", { timeout: 15000 });
  await page.waitForSelector("#groupShareBlock:not([hidden])", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "vault-secret-detail.png");
  await page.click("#sdetailClose");

  await page.click('[data-nav="admin:recovery"]');
  await shot(page, "admin-recovery.png", { fullPage: true });
  await page.click('[data-nav="admin:apikeys"]');
  await shot(page, "admin-apikeys.png", { fullPage: true });

  console.log("Help & theme…");
  await page.goto(`${BASE}/help`);
  await shot(page, "help.png", { fullPage: true });
  await page.goto(`${BASE}/help/extension`);
  await shot(page, "help-extension.png", { fullPage: true });
  await page.goto(`${BASE}/help/cli`);
  await shot(page, "help-cli.png", { fullPage: true });

  await page.goto(`${BASE}/app`);
  await unlockVault(page);
  await page.click('[data-nav="vault:mine"]');
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    try { localStorage.setItem("tv-theme", "dark"); } catch (_) {}
  });
  await page.waitForTimeout(300);
  await shot(page, "theme-dark.png", { fullPage: true });

  await browser.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

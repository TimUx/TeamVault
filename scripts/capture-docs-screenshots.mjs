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
const LOGIN_PW = "Password1234!!!!";
const MASTER_PW = "Password1234!!!!";
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
  const tokenPath = path.join(dataDir, "setup.token");
  let token = "";
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(tokenPath)) {
      token = fs.readFileSync(tokenPath, "utf8").trim();
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!token) throw new Error(`setup.token missing in ${dataDir}`);
  await api("/api/setup/commit", {
    method: "POST",
    headers: { "X-TeamVault-Setup-Token": token },
    body: JSON.stringify({
      storage: { backend: "sqlite", dsn },
      tenant: { name: TENANT_NAME, slug: TENANT_SLUG, recovery_mode: "user_kit", escrow_allowed: false },
      admin: { username: LOGIN_USER, password: LOGIN_PW, display_name: "Admin", email: "admin@demo.local" },
      argon2: { Time: 1, Memory: 8192, Threads: 1, KeyLen: 32 },
    }),
  });
}

async function loginCookie(context, totpSecret = "") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      tenant_slug: TENANT_SLUG,
      username: LOGIN_USER,
      password: LOGIN_PW,
    }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (body?.needs_totp) {
    if (!totpSecret) throw new Error("login needs TOTP but no secret available");
    for (let attempt = 0; attempt < 3; attempt++) {
      const res2 = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: JSON.stringify({
          tenant_slug: TENANT_SLUG,
          username: LOGIN_USER,
          password: LOGIN_PW,
          login_token: body.login_token,
          totp_code: await totpNow(totpSecret),
        }),
      });
      if (res2.ok) {
        await applySetCookies(context, res2);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("totp login failed");
  }
  if (!res.ok) throw new Error("login failed");
  await applySetCookies(context, res);
}

async function applySetCookies(context, res) {
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

async function shotElement(page, selector, file, opts = {}) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: opts.timeout ?? 20000 });
  await el.scrollIntoViewIfNeeded();
  if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
  const target = path.join(OUT, file);
  await el.screenshot({ path: target });
  console.log("  →", file, `(element ${selector})`);
}

async function totpNow(seed) {
  let secret = String(seed || "").trim();
  if (secret.startsWith("otpauth://")) {
    try { secret = new URL(secret).searchParams.get("secret") || ""; } catch { return ""; }
  }
  const cleaned = secret.replace(/\s+/g, "").toUpperCase().replace(/=+$/, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of cleaned) {
    const v = alphabet.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = await crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[sig.length - 1] & 0xf;
  const code = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(code % 1e6).padStart(6, "0");
}

async function enableDemoPolicies(page) {
  await page.evaluate(async (base) => {
    const res = await fetch(`${base}/api/admin/policy`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totp_required: false,
        session_hours: 8,
        unlock_idle_minutes: 15,
        escrow_shamir_k: 3,
        escrow_shamir_n: 5,
        ldap_sync_hours: 24,
        offline_cache_allowed: true,
        cli_integration_enabled: true,
        browser_integration_enabled: true,
        desktop_integration_enabled: true,
      }),
    });
    if (!res.ok) throw new Error(`policy update failed: ${res.status}`);
  }, BASE);
}

async function readTotpSecretFromPage(page) {
  let secret = "";
  const urlText = await page.locator("#otpurl").textContent().catch(() => "");
  if (urlText && urlText.includes("secret=")) {
    try { secret = new URL(urlText.trim()).searchParams.get("secret") || ""; } catch (_) {}
  }
  if (!secret) {
    const secEl = page.locator("#otpSecret");
    if (await secEl.isVisible().catch(() => false)) {
      secret = (await secEl.textContent()).replace(/^Secret:\s*/i, "").trim();
    }
  }
  if (!secret) throw new Error("TOTP secret not visible after setup");
  return secret;
}

async function confirmTotpEnable(page, secret, context) {
  const code = await totpNow(secret);
  await page.evaluate((c) => {
    const box = document.querySelector("#totpbox");
    if (box) box.hidden = false;
    const input = document.querySelector("#code");
    if (input) {
      input.value = c;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    document.querySelector("#en")?.click();
  }, code);
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  const waitForNextTotpWindow = 30000 - (Date.now() % 30000) + 1000;
  await new Promise((resolve) => setTimeout(resolve, waitForNextTotpWindow));
  await loginCookie(context, secret);
  await unlockVault(page);
}

async function showAccountTab(page, tabId) {
  const route = tabId === "offline" ? "account:offline"
    : tabId === "clients" ? "account:clients"
      : tabId === "profile" ? "account:profile" : "account:security";
  await page.click(`[data-nav="${route}"]`);
  await page.waitForTimeout(300);
  await page.waitForSelector(`.app-tab[data-pane="account"].active`, { state: "attached", timeout: 15000 });
  const pane = tabId === "security" ? "totp" : tabId;
  await page.waitForSelector(`[data-panel-pane="${pane}"]:not([hidden])`, { state: "attached", timeout: 15000 });
}

async function captureLoginTotpStep(page) {
  await page.click("#out");
  await page.waitForURL("**/login**", { timeout: 15000 });
  await page.waitForSelector("#slug", { timeout: 15000 });
  await page.selectOption("#slug", TENANT_SLUG);
  await page.fill("#user", LOGIN_USER);
  await page.fill("#pw", LOGIN_PW);
  await page.click("#doLogin");
  await page.waitForSelector("#loginStep2:not([hidden])", { timeout: 15000 });
  await shot(page, "login-totp.png");
}

async function waitAppReady(page) {
  await page.waitForSelector("#vaultui:not([hidden])", { timeout: 120000 });
  await page.waitForSelector('[data-nav="vault:create"]', { state: "visible", timeout: 30000 });
}

async function unlockVault(page, { captureShot = false } = {}) {
  await page.goto(`${BASE}/app`).catch((error) => {
    if (!/ERR_ABORTED/.test(String(error))) throw error;
  });
  const unlock = page.locator("#unlock");
  if (await unlock.isVisible({ timeout: 5000 }).catch(() => false)) {
    if (captureShot) await shot(page, "vault-unlock.png");
    await page.fill("#unlock #mpw", MASTER_PW);
    await page.click("#ulock");
  }
  await waitAppReady(page);
}

async function openCreateForm(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => {
      document.querySelectorAll('.sidebar-section[data-nav-section="vault"]').forEach((el) => {
        el.classList.remove("collapsed");
        const btn = el.querySelector(".sidebar-section-toggle");
        if (btn) btn.setAttribute("aria-expanded", "true");
      });
      document.querySelectorAll(".app-tab").forEach((pane) => {
        pane.classList.toggle("active", pane.dataset.pane === "vault");
      });
      const sec = document.querySelector('.vault-section[data-vault="create"]');
      if (sec) {
        sec.classList.add("active");
        document.querySelectorAll(".vault-section").forEach((el) => {
          el.classList.toggle("active", el === sec);
        });
      }
      const link = document.querySelector('[data-nav="vault:create"]');
      if (link) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
        link.click();
      }
    });
    const title = page.locator('.vault-section[data-vault="create"] #stitle');
    try {
      await title.waitFor({ state: "visible", timeout: 20000 });
      return title;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  throw new Error("create form not available");
}

function createField(page, id) {
  return page.locator(`.vault-section[data-vault="create"] #${id}`);
}

async function clickCreateSave(page) {
  await page.evaluate(() => {
    const sec = document.querySelector('.vault-section[data-vault="create"]');
    const btn = document.querySelector("#screate");
    if (!sec || !btn) throw new Error("create save button missing");
    sec.classList.add("active");
    document.querySelectorAll(".vault-section").forEach((el) => {
      if (el !== sec) el.classList.remove("active");
    });
    btn.click();
  });
}

async function seedSecrets(page) {
  let title = await openCreateForm(page);
  await page.locator('#svisTabs [data-svis="private"]').click({ timeout: 3000 }).catch(() => {});
  await title.fill("GitHub");
  await createField(page, "stagsIn").fill("dev, github");
  await createField(page, "suser").fill("octocat");
  await createField(page, "spw").fill("demo-secret-pw!");
  await shot(page, "vault-create.png", { fullPage: true });
  await clickCreateSave(page);
  await page.waitForSelector(".secrets-table tbody tr, .secrets-list .list-row, .secret-tile", { timeout: 30000 });
  await page.waitForTimeout(800);

  title = await openCreateForm(page);
  await page.locator('#svisTabs [data-svis="private"]').click({ timeout: 3000 }).catch(() => {});
  await title.fill("Pure Storage");
  await createField(page, "stagsIn").fill("storage, infra");
  await createField(page, "suser").fill("pureuser");
  await createField(page, "spw").fill("demo-storage-pw!");
  await createField(page, "sextraAdd").selectOption("url");
  await createField(page, "sextraAddBtn").click();
  await page.locator('.vault-section[data-vault="create"] #sextraSlots [data-slot-type="url"] .slot-val').fill("https://pure.demo.local");
  await createField(page, "sextraAdd").selectOption("notes");
  await createField(page, "sextraAddBtn").click();
  await page.locator('.vault-section[data-vault="create"] #sextraSlots [data-slot-type="notes"] .slot-val').fill("Array-Login für Backup-Jobs");
  await clickCreateSave(page);
  await page.waitForSelector(".secrets-table tbody tr, .secrets-list .list-row, .secret-tile", { timeout: 30000 });
  await page.waitForTimeout(800);

  await page.click('[data-nav="vault:mine"]');
  await page.waitForSelector(".secrets-table tbody tr, .secrets-list .list-row, .secret-tile", { timeout: 30000 });
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
  try {
    await page.waitForFunction(() => {
      const go = document.querySelector("#goApp");
      const unlock = document.querySelector("#unlock #mpw");
      const vault = document.querySelector("#vaultui");
      const err = document.querySelector("#err");
      if (go || unlock || vault) return true;
      if (err && !err.hidden && err.textContent) {
        const msg = err.textContent.trim();
        if (/already onboarded|bereits/i.test(msg)) return true;
        throw new Error(msg);
      }
      return false;
    }, null, { timeout: 180000 });
  } catch (e) {
    await shot(page, "onboard-error.png", { fullPage: true });
    if (/already onboarded|bereits/i.test(String(e.message || e))) {
      await page.goto(`${BASE}/app`);
      return;
    }
    throw e;
  }
  if (await page.locator("#goApp").isVisible().catch(() => false)) {
    if (await page.locator("#kitSaved").isVisible().catch(() => false)) {
      await shot(page, "onboard-recovery-kit.png");
      await page.check("#kitSaved");
    }
    await page.click("#goApp");
    await page.waitForURL("**/app**");
  }
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
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  let totpSecret = "";

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
  await enableDemoPolicies(page);
  await onboardIfNeeded(page);
  await unlockVault(page, { captureShot: true });
  await page.waitForTimeout(1500);

  console.log("Vault UI…");
  await page.click('[data-nav="vault:mine"]');
  await page.waitForSelector('.vault-section[data-vault="secrets"].active', { timeout: 30000 });
  await waitAppReady(page);
  await seedSecrets(page);
  await page.waitForSelector(".secrets-table .tag", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, "vault-secrets-table.png", { fullPage: true });
  const favBtn = page.locator("[data-fav-toggle]").first();
  if (await favBtn.count()) {
    await favBtn.click();
    await page.waitForTimeout(400);
  }
  await page.click('[data-nav="vault:favorites"]');
  await page.waitForTimeout(600);
  await shot(page, "vault-favorites.png", { fullPage: true });
  await page.click('[data-nav="vault:mine"]');
  await page.waitForTimeout(400);
  await shot(page, "nav-sidebar.png");

  await page.click('[data-view="list"]');
  await page.waitForTimeout(600);
  await shot(page, "vault-secrets.png", { fullPage: true });

  await page.click('[data-view="tiles"]');
  await page.waitForTimeout(600);
  await shot(page, "vault-secrets-tiles.png", { fullPage: true });

  await page.click('[data-view="table"]');
  await page.waitForTimeout(400);
  await page.click("#stagToggle").catch(() => {});
  await page.waitForSelector("#stagMenu:not([hidden])", { timeout: 5000 }).catch(() => {});
  const tagDev = page.locator('#stagOptions input[value="dev"]');
  if (await tagDev.count()) {
    await tagDev.check();
  } else {
    const firstTag = page.locator("#stagOptions input[type=checkbox]").first();
    if (await firstTag.count()) await firstTag.check();
  }
  await page.waitForTimeout(800);
  await shot(page, "vault-tag-filter.png", { fullPage: true });
  await page.click("#stagClear").catch(() => {});
  await page.waitForTimeout(300);

  await page.click('[data-nav="vault:import"]');
  await shot(page, "vault-import.png", { fullPage: true });
  await page.click('[data-nav="vault:mine"]');
  await page.waitForSelector("#sActionsToggle", { timeout: 10000 });
  await page.click("#sActionsToggle");
  await page.waitForSelector("#sActionsMenu:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(400);
  await shot(page, "vault-export.png", { fullPage: true });
  await page.click("#sActionsToggle").catch(() => {});

  await unlockVault(page);
  await showAccountTab(page, "totp");
  await shot(page, "account.png", { fullPage: true });
  await page.click('[data-nav="account:profile"]');
  await page.waitForSelector('[data-panel-pane="profile"]:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(400);
  await shot(page, "account-settings.png", { fullPage: true });
  const needsTotpSetup = await page.evaluate(() => {
    const btn = document.querySelector("#totpSetup");
    return !!(btn && !btn.disabled && !btn.hidden);
  });
  if (needsTotpSetup) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/totp/setup") && r.ok(), { timeout: 30000 }),
      page.evaluate(() => document.querySelector("#totpSetup")?.click()),
    ]).catch(async () => {
      await page.waitForFunction(() => {
        const url = document.querySelector("#otpurl")?.textContent?.trim() || "";
        return url.includes("otpauth");
      }, null, { timeout: 30000 });
    });
    await page.waitForTimeout(400);
    await shot(page, "account-totp.png", { fullPage: true });
    totpSecret = await readTotpSecretFromPage(page);
    await confirmTotpEnable(page, totpSecret, context);
  } else {
    console.warn("TOTP already enabled — account-totp/login-totp screenshots skipped");
  }
  await showAccountTab(page, "offline");
  await page.evaluate(() => {
    const opt = document.querySelector("#offline_optin");
    if (opt && !opt.disabled) opt.checked = true;
  });
  await page.waitForTimeout(300);
  await shot(page, "account-offline.png", { fullPage: true });

  try {
    await enableDemoPolicies(page);
    await showAccountTab(page, "clients");
    await page.evaluate(async (base) => {
      const res = await fetch(`${base}/api/client-downloads`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      const root = document.querySelector("#clientDownloadsApp");
      if (!root) return;
      const cli = data.cli?.[0];
      const crx = data.extension?.crx;
      const desktop = data.desktop?.[0];
      root.innerHTML = [
        `<div class="client-dl-card"><h4>CLI (tvcli)</h4>`,
        cli ? `<a class="btn-accent" href="${base}${cli.url}">tvcli herunterladen</a>` : `<p class="hint">CLI-Binaries noch nicht bereitgestellt.</p>`,
        `</div>`,
        `<div class="client-dl-card"><h4>Browser-Extension</h4>`,
        crx ? `<a class="btn-accent" href="${base}${crx.url}">Extension installieren</a>` : `<p class="hint">Extension noch nicht bereitgestellt.</p>`,
        `</div>`,
        `<div class="client-dl-card"><h4>Desktop-App</h4>`,
        desktop ? `<a class="btn-accent" href="${base}${desktop.url}">Desktop-App herunterladen</a>` : `<p class="hint">Desktop-Binaries noch nicht bereitgestellt.</p>`,
        `</div>`,
      ].join("");
    }, BASE);
    await page.waitForSelector("#clientDownloadsApp .client-dl-card", { timeout: 20000 });
    await page.locator("#clientDownloadsApp").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shotElement(page, "#clientDownloadsApp", "account-clients.png", { waitMs: 200 });
  } catch (e) {
    console.warn("account-clients screenshot skipped:", e.message);
  }

  console.log("Admin…");
  await page.waitForSelector("#navAdminSection:not([hidden])", { timeout: 15000 });
  await page.evaluate(() => {
    document.querySelectorAll('.sidebar-section[data-nav-section="admin"], .sidebar-subsection').forEach((el) => {
      el.classList.remove("collapsed");
      const btn = el.querySelector(".sidebar-section-toggle, .sidebar-subsection-toggle");
      if (btn) btn.setAttribute("aria-expanded", "true");
    });
  });
  await page.click('[data-nav="admin:users"]');
  await page.waitForSelector("#ulist .users-table tbody tr, #ulist .list-row", { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, "admin-users.png", { fullPage: true });

  await page.click('[data-nav="admin:clients"]');
  await page.waitForSelector('[data-admin-section="clients"] #admin_cli_integration');
  await page.check("#admin_cli_integration");
  await page.check("#admin_browser_integration");
  await page.waitForTimeout(300);
  await shot(page, "admin-clients.png", { fullPage: true });

  const editBtn = page.locator("[data-edit-user]:visible").first();
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

  await page.click('[data-nav="admin:ldap"]');
  await page.waitForSelector('[data-admin-section="ldap"] #ldap_host');
  await page.check("#ldap_en");
  await page.fill("#ldap_host", "ldap.demo.local");
  await page.fill("#ldap_port", "636");
  await page.check("#ldap_tls");
  await page.fill("#ldap_base", "dc=demo,dc=local");
  await page.fill("#ldap_bind", "cn=teamvault,ou=svc,dc=demo,dc=local");
  await page.fill("#ldap_filter", "(uid=%s)");
  await page.check("#ldap_skip_tls");
  await page.click("#ldap_save");
  await page.waitForTimeout(600);
  await shot(page, "admin-ldap.png", { fullPage: true });

  await page.click('[data-nav="admin:users"]');
  await page.waitForSelector("#ldapUserImport:not([hidden])", { timeout: 10000 });
  await page.fill("#ldap_user_q", "demo");
  await shot(page, "admin-ldap-import.png", { fullPage: true });

  await page.click("#uopenCreate");
  await page.waitForSelector("#userCreateModal:not([hidden])");
  await page.fill("#nuser", "alice");
  await page.fill("#ndisplay", "Alice");
  await page.fill("#npw", "Password1234!!!!");
  await page.click("#ucreate");
  await page.waitForTimeout(800);
  await page.click("#userCreateClose").catch(() => {});

  await page.click('[data-nav="admin:groups"]');
  await page.waitForTimeout(500);
  await shot(page, "admin-groups.png", { fullPage: true });

  await page.click('[data-nav="admin:trust"]');
  await page.waitForSelector('[data-admin-section="trust"] #trust_ca_pem');
  await page.fill("#trust_ca_pem", "");
  await page.waitForTimeout(400);
  await shot(page, "admin-trust.png", { fullPage: true });

  await page.click('[data-nav="admin:smtp"]');
  await page.waitForSelector('[data-admin-section="smtp"] #mail_host');
  await page.check("#mail_en");
  await page.fill("#mail_host", "smtp.demo.local");
  await page.fill("#mail_port", "587");
  await page.fill("#mail_from", "teamvault@demo.local");
  await page.fill("#mail_user", "teamvault");
  await page.waitForTimeout(400);
  await shot(page, "admin-smtp.png", { fullPage: true });

  await page.click('[data-nav="admin:crypto"]');
  await page.waitForSelector('[data-admin-section="crypto"]');
  await page.click('[data-panel-tab="kdf"]').catch(() => {});
  await page.waitForSelector('[data-panel-pane="kdf"]:not([hidden]) #arg_mem', { timeout: 10000 });
  await page.waitForTimeout(400);
  await shot(page, "admin-crypto.png", { fullPage: true });

  await page.click('[data-nav="admin:access"]');
  await page.waitForSelector('[data-admin-section="access"] #pa_base');
  await page.fill("#pa_base", "/vault");
  await page.fill("#pa_url", "https://storage.demo.local/vault");
  await page.check("#pa_trust");
  await page.waitForTimeout(400);
  await shot(page, "admin-access.png", { fullPage: true });
  await page.fill("#pa_base", "");
  await page.fill("#pa_url", "");
  await page.uncheck("#pa_trust");

  await page.click('[data-nav="vault:mine"]');
  await page.waitForSelector("button:has-text('Öffnen')", { timeout: 20000 });
  const storageRow = page.locator(".secrets-table tbody tr").filter({ hasText: "Pure Storage" }).first();
  if (await storageRow.count()) {
    await storageRow.locator("button:has-text('Öffnen')").click();
  } else {
    await page.locator("button:has-text('Öffnen')").first().click();
  }
  await page.waitForSelector("#sdetail:not([hidden])", { timeout: 15000 });
  await page.waitForSelector("#accessPanel, #accessCurrent", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "vault-secret-detail.png");
  await page.click("#dedit");
  await page.waitForSelector("#deditForm:not([hidden])", { timeout: 10000 });
  await page.waitForSelector("#eextraSlots .extra-slot", { timeout: 10000 });
  await page.waitForTimeout(400);
  await shot(page, "vault-secret-edit.png");
  await page.click("#dcancel");
  await page.waitForSelector("#dview:not([hidden])", { timeout: 5000 });
  await page.click("#sdetailClose");

  await page.click('[data-nav="admin:recovery"]');
  await page.waitForSelector('[data-panel-tab="mode"], #rec_mode', { timeout: 10000 });
  await page.click('[data-panel-tab="mode"]').catch(() => {});
  await shot(page, "admin-recovery.png", { fullPage: true });
  await page.click('[data-nav="admin:apikeys"]');
  await shot(page, "admin-apikeys.png", { fullPage: true });

  await page.click('[data-nav="admin:system"]');
  await page.waitForSelector("#sysOverview", { timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, "admin-system.png", { fullPage: true });

  // Shared secret for vault-shared.png (Ops group exists from admin steps)
  await page.click('[data-nav="vault:create"]');
  await page.waitForSelector("#stitle");
  await page.click('#svisTabs [data-svis="shared"]');
  await page.waitForSelector("#sshareWrap:not([hidden])");
  await page.fill("#stitle", "Team Wiki");
  await page.fill("#stagsIn", "team, shared");
  await page.fill("#suser", "wiki");
  await page.fill("#spw", "shared-demo-pw!");
  await page.waitForTimeout(400);
  const opsOpt = page.locator("#screateGroups option").filter({ hasText: "Ops" }).first();
  if (await opsOpt.count()) {
    await page.selectOption("#screateGroups", { label: "Ops" }).catch(async () => {
      await opsOpt.evaluate((el) => { el.selected = true; });
    });
  } else {
    const anyGroup = page.locator("#screateGroups option").first();
    if (await anyGroup.count()) await page.selectOption("#screateGroups", { index: 0 });
  }
  await page.click("#screate");
  await page.waitForTimeout(1500);
  await page.click('[data-nav="vault:shared"]');
  await page.waitForTimeout(800);
  await page.click('[data-view="table"]').catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "vault-shared.png", { fullPage: true });

  console.log("Help & theme…");
  await page.goto(`${BASE}/help`);
  await page.waitForSelector("#clientDlCli .help-actions, #clientDlCli .help-note", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "help.png", { fullPage: true });
  await page.goto(`${BASE}/help/vault`);
  await shot(page, "help-vault.png", { fullPage: true });
  await page.goto(`${BASE}/help/account`);
  await page.waitForSelector("#demoQr svg, #demoQr .hint", { timeout: 10000 }).catch(() => {});
  await shot(page, "help-account.png", { fullPage: true });
  await page.goto(`${BASE}/help/extension`);
  await page.waitForSelector("#clientDlExt .help-install-steps, #clientDlExt .help-note", { timeout: 15000 }).catch(() => {});
  await shotElement(page, "#clientDlExt", "help-extension.png", { waitMs: 400 });
  await page.goto(`${BASE}/help/cli`);
  await page.waitForSelector("#clientDlCli .help-actions, #clientDlCli .help-note", { timeout: 15000 }).catch(() => {});
  await shotElement(page, "#clientDlCli", "help-cli.png", { waitMs: 400 });
  await page.goto(`${BASE}/help/desktop`);
  await page.waitForSelector("#clientDlDesktop .help-actions, #clientDlDesktop .help-note", { timeout: 15000 }).catch(() => {});
  await shotElement(page, "#clientDlDesktop", "help-desktop-download.png", { waitMs: 400 });

  await page.goto(`${BASE}/app`);
  await unlockVault(page);
  await page.click('[data-nav="vault:mine"]');
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    try { localStorage.setItem("tv-theme", "dark"); } catch (_) {}
  });
  await page.waitForTimeout(300);
  await shot(page, "theme-dark.png", { fullPage: true });

  if (totpSecret) {
    console.log("TOTP login step…");
    await captureLoginTotpStep(page);
  }

  // Mirror docs images used by /help into web/static/help/img
  const HELP_IMG = path.join(ROOT, "web", "static", "help", "img");
  fs.mkdirSync(HELP_IMG, { recursive: true });
  for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith(".png"))) {
    fs.copyFileSync(path.join(OUT, f), path.join(HELP_IMG, f));
  }
  console.log("Copied screenshots to web/static/help/img/");

  await browser.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

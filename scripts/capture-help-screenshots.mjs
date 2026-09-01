import { chromium } from "./node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASE = process.env.TV_URL || "http://127.0.0.1:8097";
const OUT = path.join(ROOT, "docs", "images");
const HELP = path.join(ROOT, "web", "static", "help", "img");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(HELP, { recursive: true });

const launchOpts = { headless: true };
if (process.env.TV_BROWSER_EXECUTABLE) launchOpts.executablePath = process.env.TV_BROWSER_EXECUTABLE;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, locale: "de-DE" });

async function shot(file, opts = {}) {
  const p = path.join(OUT, file);
  await page.screenshot({ path: p, fullPage: opts.fullPage ?? true });
  console.log("→", file);
}

async function shotElement(selector, file) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 20000 });
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const p = path.join(OUT, file);
  await el.screenshot({ path: p });
  console.log("→", file, `(element ${selector})`);
}

await page.goto(`${BASE}/help`);
await page.waitForSelector(".help-sidebar");
await shot("help.png");

await page.goto(`${BASE}/help/vault`);
await page.waitForSelector("#anlegen");
await shot("help-vault.png");

await page.goto(`${BASE}/help/account`);
await page.waitForSelector("#demoQr svg", { timeout: 15000 });
await shot("help-account.png");

await page.goto(`${BASE}/help/cli`);
await page.waitForSelector("#clientDlCli .help-actions, #clientDlCli .help-note", { timeout: 15000 }).catch(() => {});
await shotElement("#clientDlCli", "help-cli.png");

await page.goto(`${BASE}/help/extension`);
await page.waitForSelector("#clientDlExt .help-install-steps, #clientDlExt .help-note", { timeout: 15000 }).catch(() => {});
await shotElement("#clientDlExt", "help-extension.png");

for (const f of ["help.png", "help-vault.png", "help-account.png", "help-cli.png", "help-extension.png"]) {
  fs.copyFileSync(path.join(OUT, f), path.join(HELP, f));
}

await browser.close();
console.log("done");

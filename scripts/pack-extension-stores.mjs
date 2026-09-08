#!/usr/bin/env node
/**
 * Build store-ready browser extension packages:
 * - dist/teamvault-extension-chrome-<version>.zip  → Chrome Web Store / Edge Add-ons upload
 * - dist/teamvault-extension-firefox-<version>.zip → Firefox AMO upload
 * - dist/teamvault-extension-store-assets-<version>.zip → listing assets
 *   (screenshots, listing texts, privacy policy) for the store dashboards
 *
 * The upload packages contain the extension only: no private key, no
 * "key" manifest field (the stores assign their own extension ID) and no
 * screenshots — store listings show screenshots that are uploaded
 * separately in the dashboard, files inside the package are ignored (and
 * flagged as unused by AMO). The store-assets ZIP carries those files.
 *
 * Usage: node scripts/pack-extension-stores.mjs [--screenshots <dir>] [--version <version>]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "extension");
const OUT = path.join(ROOT, "dist");
const STORE_DOCS = path.join(ROOT, "docs", "extension-store");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : "";
}

function packageVersion(manifest) {
  const override = arg("--version");
  if (!override) return manifest.version;
  if (!/^\d+(?:\.\d+){0,3}$/.test(override)) {
    throw new Error(`invalid extension version: ${override}`);
  }
  return override;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name.endsWith(".pem") || name.endsWith(".key")) continue;
    if (name === "tests") continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function zipDir(srcDir, destZip) {
  if (fs.existsSync(destZip)) fs.unlinkSync(destZip);
  if (process.platform === "win32") {
    const ps = `Compress-Archive -Path '${srcDir.replace(/'/g, "''")}\\*' -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`;
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
    return;
  }
  execFileSync("zip", ["-qr", destZip, ".", "-x", "*.pem", "-x", "*.key"], { cwd: srcDir, stdio: "inherit" });
}

/**
 * Chrome/Edge use the MV3 service worker; the Firefox MV3 background
 * fallback ("scripts") and the Gecko-specific settings are dropped so the
 * store review does not flag unknown manifest keys. The "key" field is
 * removed because the store assigns the extension ID on upload.
 */
function chromeManifest(manifest) {
  const m = structuredClone(manifest);
  delete m.key;
  delete m.browser_specific_settings;
  m.background = { service_worker: manifest.background.service_worker };
  return m;
}

/**
 * Firefox uses the classic background scripts entry (MV3 service workers
 * are not supported on all supported Firefox versions) and keeps the
 * stable Gecko add-on ID. The Chrome-only "key" field is removed.
 */
function firefoxManifest(manifest) {
  const m = structuredClone(manifest);
  delete m.key;
  m.background = { scripts: manifest.background.scripts };
  return m;
}

function buildPackage(target, manifest, version) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `tv-ext-${target}-`));
  try {
    copyTree(EXT, staging);
    fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const zip = path.join(OUT, `teamvault-extension-${target}-${version}.zip`);
    zipDir(staging, zip);
    console.log("→", path.basename(zip));
    return zip;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function buildStoreAssets(version, screenshotsDir) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "tv-ext-assets-"));
  try {
    const shots = path.join(staging, "screenshots");
    fs.mkdirSync(shots, { recursive: true });
    let count = 0;
    if (screenshotsDir && fs.existsSync(screenshotsDir)) {
      for (const name of fs.readdirSync(screenshotsDir)) {
        if (!name.toLowerCase().endsWith(".png")) continue;
        fs.copyFileSync(path.join(screenshotsDir, name), path.join(shots, name));
        count++;
      }
    }
    if (!count) {
      console.warn("warning: no screenshots found in", screenshotsDir || "(none given)");
    }
    const listing = path.join(staging, "listing");
    fs.mkdirSync(listing, { recursive: true });
    for (const doc of ["chrome-store.md", "firefox-amo.md", "privacy-policy.md", "licenses.md", "screenshots.md"]) {
      const from = path.join(STORE_DOCS, doc);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(listing, doc));
    }
    for (const size of ["128"]) {
      const icon = path.join(EXT, "icons", `icon-${size}.png`);
      if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(staging, `icon-${size}.png`));
    }
    fs.writeFileSync(
      path.join(staging, "README.txt"),
      [
        `TeamVault browser extension — store listing assets (${version})`,
        "",
        "screenshots/  Ready-to-upload listing screenshots (1280x800, synthetic demo data only).",
        "listing/      Listing texts, permission justifications, privacy policy.",
        "icon-128.png  Store icon.",
        "",
        "Upload the browser package (teamvault-extension-chrome-<version>.zip or",
        "teamvault-extension-firefox-<version>.zip) in the developer dashboard and add",
        "the screenshots from this archive in the listing/store-presence section.",
        "Screenshots are never read from inside the extension package itself.",
        "",
      ].join("\n")
    );
    const zip = path.join(OUT, `teamvault-extension-store-assets-${version}.zip`);
    zipDir(staging, zip);
    console.log("→", path.basename(zip));
    return zip;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  const version = packageVersion(sourceManifest);
  const manifest = { ...sourceManifest, version };
  fs.mkdirSync(OUT, { recursive: true });

  buildPackage("chrome", chromeManifest(manifest), version);
  buildPackage("firefox", firefoxManifest(manifest), version);
  buildStoreAssets(version, arg("--screenshots"));

  console.log("Extension version:", version);
  console.log("Outputs:", OUT);
}

main();

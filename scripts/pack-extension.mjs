#!/usr/bin/env node
/**
 * Pack TeamVault browser extension for normal installation:
 * - teamvault-extension.zip (unpacked fallback)
 * - teamvault-extension.crx (Chrome/Edge CRX3)
 * - teamvault-extension.xpi (Firefox; enterprise policy or signed AMO)
 * - extension/updates.xml (auto-update manifest)
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "extension");
const OUT = path.join(ROOT, "dist");
const KEY = path.join(ROOT, "clients", "teamvault.pem");
const LEGACY_KEY = path.join(EXT, "teamvault.pem");
const MANIFEST = path.join(EXT, "manifest.json");

function chromeExtensionId(pubKeyDer) {
  const hash = crypto.createHash("sha256").update(pubKeyDer).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    const b = hash[i];
    id += String.fromCharCode(97 + (b >> 4));
    id += String.fromCharCode(97 + (b & 0xf));
  }
  return id;
}

function requireSigningKey() {
  const v = (process.env.TV_EXTENSION_REQUIRE_KEY || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function keyPath() {
  if (process.env.TV_EXTENSION_PEM) return KEY;
  if (fs.existsSync(KEY) && fs.statSync(KEY).size > 0) return KEY;
  if (fs.existsSync(LEGACY_KEY) && fs.statSync(LEGACY_KEY).size > 0) return LEGACY_KEY;
  return KEY;
}

function ensureKey() {
  const fromEnv = (process.env.TV_EXTENSION_PEM || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  const dest = keyPath();
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest, "utf8");
  if (requireSigningKey()) {
    console.error(
      "extension signing key required: set TV_EXTENSION_PEM or provide",
      KEY,
      "(do not generate for release)"
    );
    process.exit(1);
  }
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, pem, { mode: 0o600 });
  console.log("Generated new extension key:", dest, "— keep it local (not git)");
  return pem;
}

function publicKeyBase64(pem) {
  const key = crypto.createPrivateKey(pem);
  const pubDer = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
  return { b64: pubDer.toString("base64"), der: pubDer };
}

function syncManifestKey(pem) {
  const { b64 } = publicKeyBase64(pem);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (manifest.key === b64) return manifest;
  if (requireSigningKey()) {
    console.error("signing key does not match manifest.json key — refusing official CRX pack");
    process.exit(1);
  }
  manifest.key = b64;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Updated manifest.json key field (public only; commit that, never the .pem)");
  return manifest;
}

function copyExtensionWithoutSecrets(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name.endsWith(".pem") || name.endsWith(".key")) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyExtensionWithoutSecrets(from, to);
    else fs.copyFileSync(from, to);
  }
}

function zipDir(src, destZip) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "tv-ext-"));
  try {
    copyExtensionWithoutSecrets(src, staging);
    if (process.platform === "win32") {
      if (fs.existsSync(destZip)) fs.unlinkSync(destZip);
      const ps = `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`;
      execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
      return;
    }
    execFileSync("zip", ["-qr", destZip, ".", "-x", "*.pem", "-x", "*.key"], { cwd: staging, stdio: "inherit" });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function packCrx(crxPath, pem) {
  let crx3;
  try {
    crx3 = (await import("crx3")).default;
  } catch {
    console.error("Install crx3: npm install --prefix scripts crx3");
    process.exit(1);
  }
  const keyFile = path.join(os.tmpdir(), "tv-ext-" + process.pid + ".pem");
  fs.writeFileSync(keyFile, pem, { mode: 0o600 });
  try {
    await crx3([EXT], { keyPath: keyFile, crxPath });
  } finally {
    try { fs.unlinkSync(keyFile); } catch {}
  }
}

function writeUpdatesXml(dir, manifest, extId, publicBase) {
  const sub = path.join(dir, "extension");
  fs.mkdirSync(sub, { recursive: true });
  const codebase = `${publicBase}/downloads/teamvault-extension.crx`;
  const xml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extId}'>
    <updatecheck codebase='${codebase}' version='${manifest.version}' />
  </app>
</gupdate>
`;
  fs.writeFileSync(path.join(sub, "updates.xml"), xml);
  fs.writeFileSync(
    path.join(sub, "extension-id.txt"),
    `${extId}\nversion=${manifest.version}\n`
  );
}

function writePolicyTemplate(dir, extId, publicBase) {
  const updateUrl = `${publicBase}/downloads/extension/updates.xml`;
  const policy = {
    [extId]: {
      installation_mode: "normal_installed",
      update_url: updateUrl,
    },
  };
  fs.writeFileSync(
    path.join(dir, "extension", "chrome-policy.json"),
    JSON.stringify(policy, null, 2) + "\n"
  );
  const sources = [`${publicBase}/*`];
  fs.writeFileSync(
    path.join(dir, "extension", "chrome-install-sources.json"),
    JSON.stringify(sources, null, 2) + "\n"
  );
}

async function main() {
  const pem = ensureKey();
  const manifest = syncManifestKey(pem);
  const { der, b64 } = publicKeyBase64(pem);
  const extId = chromeExtensionId(der);
  fs.mkdirSync(OUT, { recursive: true });

  const zipPath = path.join(OUT, "teamvault-extension.zip");
  const crxPath = path.join(OUT, "teamvault-extension.crx");
  const xpiPath = path.join(OUT, "teamvault-extension.xpi");

  console.log("Packing zip…");
  zipDir(EXT, zipPath);
  console.log("Packing crx…");
  await packCrx(crxPath, pem);
  console.log("Packing xpi…");
  fs.copyFileSync(zipPath, xpiPath);

  const publicBase = process.env.TV_EXTENSION_UPDATE_BASE || "https://IHRE-VAULT-URL";
  writeUpdatesXml(OUT, manifest, extId, publicBase);
  writePolicyTemplate(OUT, extId, publicBase);

  console.log("");
  console.log("Extension ID:", extId);
  console.log("Public key (manifest):", b64.slice(0, 24) + "…");
  console.log("Outputs:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

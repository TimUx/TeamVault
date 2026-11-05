import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const stylesheet = await readFile(new URL("../web/static/styles.css", import.meta.url), "utf8");
const scripts = new Map([
  ["/offline-store.js", await readFile(new URL("../web/static/offline-store.js", import.meta.url))],
  ["/offline-hardware.js", await readFile(new URL("../web/static/offline-hardware.js", import.meta.url))],
]);
const pageHTML = `<!doctype html><meta charset="utf-8">
<script src="/offline-store.js"></script><script src="/offline-hardware.js"></script>`;

test("offline factor labels honor their hidden state", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>${stylesheet}</style>
      <div class="app-unlock-panel">
        <label id="software" hidden>Software key<input></label>
        <label id="hardware" hidden>Hardware key<select></select></label>
      </div>
      <div class="lock-overlay">
        <label id="lock-software" hidden>Software key<input></label>
        <label id="lock-hardware" hidden>Hardware key<select></select></label>
      </div>`);
    const software = ["#software", "#lock-software"];
    const hardware = ["#hardware", "#lock-hardware"];
    for (const selector of [...software, ...hardware]) {
      assert.equal(await page.locator(selector).isHidden(), true);
    }
    for (const selector of hardware) {
      await page.locator(selector).evaluate((element) => { element.hidden = false; });
      assert.equal(await page.locator(selector).isVisible(), true);
    }
    for (const selector of software) {
      assert.equal(await page.locator(selector).isHidden(), true);
      await page.locator(selector).evaluate((element) => { element.hidden = false; });
      assert.equal(await page.locator(selector).isVisible(), true);
    }
    for (const selector of hardware) {
      await page.locator(selector).evaluate((element) => { element.hidden = true; });
      assert.equal(await page.locator(selector).isHidden(), true);
    }
  } finally {
    await browser.close();
  }
});

test("FIDO2 PRF, key rotation and concurrent IndexedDB writes in Chromium", { timeout: 90000 }, async () => {
  const server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(pageHTML);
    } else if (scripts.has(req.url)) {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(scripts.get(req.url));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const options = {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      hasHmacSecret: true,
      automaticPresenceSimulation: true,
    };
    const first = (await cdp.send("WebAuthn.addVirtualAuthenticator", { options })).authenticatorId;
    await page.goto(`http://localhost:${server.address().port}/`);
    const initial = await page.evaluate(async () => {
      const me = {
        tenant_id: "tenant-1", tenant_slug: "demo", tenant_name: "Demo",
        user_id: "user-1", username: "alice",
      };
      const snapshot = TVOfflineStore.buildSnapshot({
        me,
        keys: {
          salt_b64: "c2FsdA==",
          encrypted_private_key_nonce_b64: "bm9uY2U=",
          encrypted_private_key_b64: "Y2lwaGVydGV4dA==",
        },
        params: { time: 1, memory: 8192, threads: 1, key_len: 32 },
        secrets: [{ id: "secret-1", ciphertext_b64: "secret-ciphertext" }],
      });
      const { keyset, root } = TVOfflineHardware.createKeyset(me, location.origin, "HARDWARE");
      keyset.keyslots.push(await TVOfflineHardware.registerKey(keyset, root, "Primary"));
      const envelope = await TVOfflineHardware.sealSnapshot(keyset, root, snapshot, "HARDWARE");
      const cache = await TVOfflineStore.putSnapshot(envelope, null);
      const unlocked = await TVOfflineHardware.unlockRoot(cache, cache.keyslots[0].id, null, location.origin);
      const opened = await TVOfflineHardware.openSnapshot(cache, unlocked, location.origin);
      unlocked.fill(0);
      window.tvTest = { me, snapshot, root, cache };
      return opened.secrets[0].id;
    });
    assert.equal(initial, "secret-1");
    const firstCredentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId: first });
    assert.equal(firstCredentials.credentials.length, 1);

    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: false });
    const second = (await cdp.send("WebAuthn.addVirtualAuthenticator", { options })).authenticatorId;
    const backup = await page.evaluate(async () => {
      const state = window.tvTest;
      const slot = await TVOfflineHardware.registerKey(state.cache, state.root, "Backup");
      const updated = { ...state.cache, keyslots: [...state.cache.keyslots, slot] };
      const snapshot = await TVOfflineHardware.openSnapshot(state.cache, state.root, location.origin);
      const sealed = await TVOfflineHardware.sealSnapshot(updated, state.root, snapshot, "HARDWARE");
      state.cache = await TVOfflineStore.putSnapshot(sealed, state.cache);
      const unlocked = await TVOfflineHardware.unlockRoot(state.cache, slot.id, null, location.origin);
      const opened = await TVOfflineHardware.openSnapshot(state.cache, unlocked, location.origin);
      unlocked.fill(0);
      return { slots: state.cache.keyslots.length, username: opened.username };
    });
    assert.deepEqual(backup, { slots: 2, username: "alice" });

    const rotation = await page.evaluate(async () => {
      const state = window.tvTest;
      const oldCache = state.cache;
      const oldRoot = state.root.slice();
      const rotated = await TVOfflineHardware.rotateKeyset(oldCache, [oldCache.keyslots[1].id], null);
      const snapshot = await TVOfflineHardware.openSnapshot(oldCache, rotated.previousRoot, location.origin);
      rotated.previousRoot.fill(0);
      const envelope = await TVOfflineHardware.sealSnapshot(rotated.keyset, rotated.root, snapshot, "HARDWARE");
      state.cache = await TVOfflineStore.putSnapshot(envelope, oldCache);
      state.root.fill(0);
      state.root = rotated.root;
      state.oldRoot = oldRoot;
      const unlocked = await TVOfflineHardware.unlockRoot(state.cache, state.cache.keyslots[0].id, null, location.origin);
      const opened = await TVOfflineHardware.openSnapshot(state.cache, unlocked, location.origin);
      unlocked.fill(0);
      let oldRootRejected = false;
      try { await TVOfflineHardware.openSnapshot(state.cache, oldRoot, location.origin); } catch { oldRootRejected = true; }
      let staleWriteRejected = false;
      try { await TVOfflineStore.putSnapshot(oldCache, oldCache); } catch { staleWriteRejected = true; }
      return { username: opened.username, oldRootRejected, staleWriteRejected };
    });
    assert.deepEqual(rotation, { username: "alice", oldRootRejected: true, staleWriteRejected: true });

    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: second });
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: first });
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options });

    const combined = await page.evaluate(async () => {
      const state = window.tvTest;
      const software = TVOfflineStore.generateSoftwareKey();
      const wrong = TVOfflineStore.generateSoftwareKey();
      const { keyset, root } = TVOfflineHardware.createKeyset(state.me, location.origin, "COMBINED");
      keyset.keyslots.push(await TVOfflineHardware.registerKey(keyset, root, "Combined", software));
      const cache = await TVOfflineHardware.sealSnapshot(keyset, root, state.snapshot, "COMBINED");
      let missingRejected = false;
      let wrongRejected = false;
      try { await TVOfflineHardware.unlockRoot(cache, keyset.keyslots[0].id, null, location.origin); } catch { missingRejected = true; }
      try { await TVOfflineHardware.unlockRoot(cache, keyset.keyslots[0].id, wrong, location.origin); } catch { wrongRejected = true; }
      const unlocked = await TVOfflineHardware.unlockRoot(cache, keyset.keyslots[0].id, software, location.origin);
      const opened = await TVOfflineHardware.openSnapshot(cache, unlocked, location.origin);
      unlocked.fill(0);
      root.fill(0);
      software.fill(0);
      wrong.fill(0);
      return { missingRejected, wrongRejected, username: opened.username };
    });
    assert.deepEqual(combined, { missingRejected: true, wrongRejected: true, username: "alice" });

    const writes = await page.evaluate(async () => {
      const state = window.tvTest;
      const previous = await TVOfflineStore.getSnapshotRaw(state.me.tenant_id, state.me.user_id);
      const results = await Promise.allSettled([
        TVOfflineStore.putSnapshot({ ...previous }, previous),
        TVOfflineStore.putSnapshot({ ...previous }, previous),
      ]);
      state.root.fill(0);
      state.oldRoot.fill(0);
      return results.map((result) => result.status).sort();
    });
    assert.deepEqual(writes, ["fulfilled", "rejected"]);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

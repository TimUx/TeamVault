import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

const source = fs.readFileSync(new URL("../static/offline-store.js", import.meta.url), "utf8");
const win = { crypto: webcrypto, atob, btoa };
const context = { window: win, crypto: webcrypto, Uint8Array, TextDecoder, TextEncoder };
vm.createContext(context);
vm.runInContext(source, context);
const store = win.TVOfflineStore;

function makeSnapshot() {
  return store.buildSnapshot({
    me: {
      tenant_id: "tenant-1",
      tenant_slug: "acme",
      tenant_name: "Acme",
      user_id: "user-1",
      username: "alice",
    },
    keys: {
      salt_b64: "c2FsdA==",
      encrypted_private_key_nonce_b64: "bm9uY2U=",
      encrypted_private_key_b64: "Y2lwaGVydGV4dA==",
    },
    params: { time: 3, memory: 65536, threads: 2, key_len: 32 },
    secrets: [{ id: "secret-1", ciphertext_b64: "ciphertext-only" }],
  });
}

test("offline snapshot requires the independent software key and preserves authenticated scope", async () => {
  const key = store.generateSoftwareKey();
  const snapshot = makeSnapshot();
  const cache = await store.sealSnapshot(snapshot, key, "https://vault.example.test", "SOFTWARE");

  assert.equal(cache.profile, "STANDARD");
  assert.equal(cache.server_requirement, "SOFTWARE");
  assert.equal(cache.policy_version, 2);
  assert.deepEqual(Array.from(cache.required_factors), ["master_password", "software_key"]);
  assert.equal(cache.version, 2);
  assert.equal(cache.ciphertext_b64.includes("ciphertext-only"), false);
  assert.equal(cache.salt_b64.length > 0, true);

  const opened = await store.openSnapshot(cache, key, "https://vault.example.test");
  assert.equal(opened.username, "alice");
  assert.equal(opened.secrets[0].id, "secret-1");

  const wrongKey = key.slice();
  wrongKey[0] ^= 0xff;
  await assert.rejects(store.openSnapshot(cache, wrongKey, "https://vault.example.test"));
  await assert.rejects(store.openSnapshot(cache, key, "https://other.example.test"));

  const tampered = { ...cache, secret_count: cache.secret_count + 1 };
  await assert.rejects(store.openSnapshot(tampered, key, "https://vault.example.test"));
  for (const requirement of ["ANY", "", "HARDWARE"]) {
    await assert.rejects(store.openSnapshot({ ...cache, server_requirement: requirement }, key, cache.origin));
  }
  const downgraded = { ...cache, policy_version: 1 };
  delete downgraded.server_requirement;
  await assert.rejects(store.openSnapshot(downgraded, key, cache.origin));
  await assert.rejects(store.sealSnapshot(snapshot, key, cache.origin, "HARDWARE"));
  await assert.rejects(store.sealSnapshot(snapshot, key, cache.origin));
  key.fill(0);
  wrongKey.fill(0);
});

test("software-key files are versioned and reject non-256-bit material", () => {
  const key = store.generateSoftwareKey();
  const file = store.softwareKeyFile(key);
  const decoded = store.parseSoftwareKeyFile(file);
  assert.deepEqual(Array.from(decoded), Array.from(key));
  assert.throws(() => store.parseSoftwareKey("AQID"));
  assert.throws(() => store.parseSoftwareKeyFile(JSON.stringify({ format: "teamvault-offline-key", version: 2, key_b64: "AA==" })));
  key.fill(0);
  decoded.fill(0);
});

test("legacy master-only snapshots are never accepted as protected caches", () => {
  assert.equal(store.isExpired({ version: 1, synced_at: new Date().toISOString() }), true);
});

test("previously protected software caches remain readable and can be upgraded", async () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/offline-legacy-policy.json", import.meta.url))).standard;
  const clock = class extends Date {
    static now() { return Date.parse(fixture.cache.created_at) + 1000; }
  };
  const oldWindow = { crypto: webcrypto, atob, btoa };
  const oldContext = { window: oldWindow, crypto: webcrypto, Uint8Array, TextDecoder, TextEncoder, Date: clock };
  vm.createContext(oldContext);
  vm.runInContext(source, oldContext);
  const oldStore = oldWindow.TVOfflineStore;
  const key = Uint8Array.from(Buffer.from(fixture.key_b64, "base64"));
  const snapshot = await oldStore.openSnapshot(fixture.cache, key, fixture.cache.origin);
  assert.equal(snapshot.secrets[0].id, "secret-1");
  const upgraded = await oldStore.sealSnapshot(snapshot, key, fixture.cache.origin, "SOFTWARE");
  assert.equal(upgraded.server_requirement, "SOFTWARE");
  assert.equal((await oldStore.openSnapshot(upgraded, key, fixture.cache.origin)).username, "alice");
  key.fill(0);
});

test("snapshot revisions distinguish concurrent updates and deletions", () => {
  const legacy = { format: "teamvault-offline", version: 2, ciphertext_b64: "a" };
  assert.equal(store.sameSnapshot(null, null), true);
  assert.equal(store.sameSnapshot(null, legacy), false);
  assert.equal(store.sameSnapshot(legacy, { ...legacy, key: "t:u", expired: false }), true);
  assert.equal(store.sameSnapshot(legacy, { ...legacy, ciphertext_b64: "b" }), false);
  const saved = { ...legacy, storage_revision: "revision-1" };
  assert.equal(store.sameSnapshot(saved, { ...saved }), true);
  assert.equal(store.sameSnapshot(saved, { ...saved, storage_revision: "revision-2" }), false);
  assert.equal(store.sameSnapshot(saved, legacy), false);
});

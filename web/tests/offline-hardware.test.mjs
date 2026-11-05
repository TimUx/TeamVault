import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, createHmac, randomBytes, webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

const offlineSource = fs.readFileSync(new URL("../static/offline-store.js", import.meta.url), "utf8");
const hardwareSource = fs.readFileSync(new URL("../static/offline-hardware.js", import.meta.url), "utf8");

function environment(now) {
  const keys = new Map();
  const control = { flags: 5, prf: true, attachment: "cross-platform", wrongSecret: false, unavailable: new Set() };
  const location = { origin: "https://vault.example.test", hostname: "vault.example.test" };
  function authData() {
    const data = new Uint8Array(37);
    data.set(createHash("sha256").update(location.hostname).digest());
    data[32] = control.flags;
    return data.buffer;
  }
  const credentials = {
    async create({ publicKey }) {
      assert.equal(publicKey.authenticatorSelection.authenticatorAttachment, "cross-platform");
      assert.equal(publicKey.authenticatorSelection.userVerification, "required");
      const id = randomBytes(32);
      keys.set(Buffer.from(id).toString("base64"), randomBytes(32));
      return {
        rawId: id,
        authenticatorAttachment: control.attachment,
        response: { getAuthenticatorData: authData },
        getClientExtensionResults: () => ({ prf: { enabled: control.prf } }),
      };
    },
    async get({ publicKey }) {
      assert.equal(publicKey.userVerification, "required");
      const id = publicKey.allowCredentials[0].id;
      const encodedID = Buffer.from(id).toString("base64");
      const key = control.unavailable.has(encodedID) ? null : keys.get(encodedID);
      if (!key) throw new Error("Hardware key unavailable");
      const secret = control.wrongSecret ? Buffer.alloc(32, 99) : key;
      const result = createHmac("sha256", secret).update(publicKey.extensions.prf.eval.first).digest();
      return {
        rawId: id,
        authenticatorAttachment: control.attachment,
        response: { authenticatorData: authData() },
        getClientExtensionResults: () => control.prf ? { prf: { results: { first: result } } } : {},
      };
    },
  };
  const win = {
    crypto: webcrypto, atob, btoa, location, isSecureContext: true,
    navigator: { credentials },
  };
  const clock = now === undefined ? Date : class extends Date {
    static now() { return now; }
  };
  const context = {
    window: win, crypto: webcrypto, Uint8Array, TextDecoder, TextEncoder,
    ArrayBuffer, Set, Date: clock,
  };
  vm.createContext(context);
  vm.runInContext(offlineSource, context);
  vm.runInContext(hardwareSource, context);
  return { store: win.TVOfflineStore, hardware: win.TVOfflineHardware, control, win, keys };
}

function account() {
  return {
    tenant_id: "tenant-1", tenant_slug: "acme", tenant_name: "Acme",
    user_id: "user-1", username: "alice",
  };
}

function snapshot(store) {
  return store.buildSnapshot({
    me: account(),
    keys: {
      salt_b64: "c2FsdA==",
      encrypted_private_key_nonce_b64: "bm9uY2U=",
      encrypted_private_key_b64: "Y2lwaGVydGV4dA==",
    },
    params: { time: 3, memory: 65536, threads: 2, key_len: 32 },
    secrets: [{ id: "secret-1", ciphertext_b64: "ciphertext-only" }],
  });
}

test("several FIDO2 keys independently unlock a hardware-only snapshot", async () => {
  const { hardware, store, control } = environment();
  const { keyset, root } = hardware.createKeyset(account(), "https://vault.example.test", "HARDWARE");
  keyset.keyslots.push(await hardware.registerKey(keyset, root, "Hauptschlüssel"));
  keyset.keyslots.push(await hardware.registerKey(keyset, root, "Backup"));
  const cache = await hardware.sealSnapshot(keyset, root, snapshot(store), "HARDWARE");
  assert.equal(cache.profile, "HARDWARE");
  assert.equal(cache.version, 3);
  assert.equal(cache.server_requirement, "HARDWARE");
  assert.equal(cache.keyslots.length, 2);
  assert.equal(JSON.stringify(cache).includes("ciphertext-only"), false);
  assert.equal(JSON.stringify(cache).includes(Buffer.from(root).toString("base64")), false);
  for (const slot of cache.keyslots) {
    const unlocked = await hardware.unlockRoot(cache, slot.id, null, cache.origin);
    assert.deepEqual(Array.from(unlocked), Array.from(root));
    const opened = await hardware.openSnapshot(cache, unlocked, cache.origin);
    assert.equal(opened.secrets[0].id, "secret-1");
    unlocked.fill(0);
  }
  const removed = { ...cache, keyslots: [cache.keyslots[1]] };
  await assert.rejects(hardware.unlockRoot(removed, cache.keyslots[0].id, null, cache.origin));
  const backup = await hardware.unlockRoot(removed, cache.keyslots[1].id, null, cache.origin);
  await assert.rejects(hardware.openSnapshot(removed, backup, cache.origin));
  assert.equal((await hardware.openSnapshot(cache, backup, cache.origin)).username, "alice");
  backup.fill(0);
  control.wrongSecret = true;
  await assert.rejects(hardware.unlockRoot(cache, cache.keyslots[0].id, null, cache.origin));
  root.fill(0);
});

test("combined keyslots require both independently generated factors", async () => {
  const { hardware, store, control } = environment();
  const software = store.generateSoftwareKey();
  const wrongSoftware = store.generateSoftwareKey();
  const { keyset, root } = hardware.createKeyset(account(), "https://vault.example.test", "COMBINED");
  await assert.rejects(hardware.registerKey(keyset, root, "Key", null), /Software-Key/);
  keyset.keyslots.push(await hardware.registerKey(keyset, root, "Key", software));
  const cache = await hardware.sealSnapshot(keyset, root, snapshot(store), "COMBINED");
  const slot = cache.keyslots[0];
  assert.equal(cache.snapshot_policy_version, 2);
  await assert.rejects(hardware.unlockRoot(cache, slot.id, null, cache.origin), /Software-Key/);
  await assert.rejects(hardware.unlockRoot(cache, slot.id, wrongSoftware, cache.origin));
  control.wrongSecret = true;
  await assert.rejects(hardware.unlockRoot(cache, slot.id, software, cache.origin));
  control.wrongSecret = false;
  const unlocked = await hardware.unlockRoot(cache, slot.id, software, cache.origin);
  assert.equal((await hardware.openSnapshot(cache, unlocked, cache.origin)).username, "alice");
  assert.equal(JSON.stringify(cache).includes(Buffer.from(software).toString("base64")), false);
  unlocked.fill(0);
  root.fill(0);
  software.fill(0);
  wrongSoftware.fill(0);
});

test("removing a key rotates the root and requires every remaining key", async () => {
  const { hardware, store, control } = environment();
  const software = store.generateSoftwareKey();
  const { keyset, root } = hardware.createKeyset(account(), "https://vault.example.test", "COMBINED");
  for (const label of ["Removed", "Backup A", "Backup B"]) {
    keyset.keyslots.push(await hardware.registerKey(keyset, root, label, software));
  }
  const cache = await hardware.sealSnapshot(keyset, root, snapshot(store), "COMBINED");
  const [removed, backupA, backupB] = cache.keyslots;
  const keepIDs = [backupA.id, backupB.id];
  const original = JSON.stringify(cache);

  control.unavailable.add(backupB.credential_id_b64);
  await assert.rejects(hardware.rotateKeyset(cache, keepIDs, software), /unavailable/);
  assert.equal(JSON.stringify(cache), original);
  control.unavailable.delete(backupB.credential_id_b64);

  const requested = [];
  const rotated = await hardware.rotateKeyset(cache, keepIDs, software, (label) => requested.push(label));
  assert.deepEqual(requested, ["Backup A", "Backup B"]);
  assert.deepEqual(Array.from(rotated.previousRoot), Array.from(root));
  assert.notDeepEqual(Array.from(rotated.root), Array.from(root));
  assert.notEqual(rotated.keyset.keyset_id, cache.keyset_id);
  const oldSnapshot = await hardware.openSnapshot(cache, rotated.previousRoot, cache.origin);
  const updated = await hardware.sealSnapshot(rotated.keyset, rotated.root, oldSnapshot, "COMBINED");
  assert.equal(updated.created_at, cache.created_at);
  assert.equal(updated.expires_at, cache.expires_at);
  await assert.rejects(hardware.openSnapshot(updated, root, cache.origin));
  const grafted = { ...updated, keyslots: [...updated.keyslots, removed] };
  await assert.rejects(hardware.unlockRoot(grafted, removed.id, software, cache.origin));
  for (const slot of updated.keyslots) {
    const unlocked = await hardware.unlockRoot(updated, slot.id, software, cache.origin);
    assert.equal((await hardware.openSnapshot(updated, unlocked, cache.origin)).username, "alice");
    unlocked.fill(0);
  }
  await assert.rejects(hardware.rotateKeyset(cache, [], software));
  rotated.root.fill(0);
  rotated.previousRoot.fill(0);
  root.fill(0);
  software.fill(0);
});

test("metadata, policy, account, origin and ciphertext are authenticated", async () => {
  const { hardware, store } = environment();
  const { keyset, root } = hardware.createKeyset(account(), "https://vault.example.test", "HARDWARE");
  keyset.keyslots.push(await hardware.registerKey(keyset, root, "Key"));
  const cache = await hardware.sealSnapshot(keyset, root, snapshot(store), "HARDWARE");
  const slot = cache.keyslots[0];
  for (const change of [
    { profile: "COMBINED" }, { tenant_id: "other" }, { origin: "https://other.example.test" },
    { effective_policy: "offline_cache_allowed=true" },
    { required_factors: ["master_password", "software_key"] },
    { keyslots: [{ ...slot, label: "Changed" }] },
    { keyslots: [{ ...slot, kind: "software" }] },
  ]) {
    await assert.rejects(hardware.unlockRoot({ ...cache, ...change }, slot.id, null, cache.origin));
  }
  await assert.rejects(hardware.unlockRoot(cache, slot.id, null, "https://other.example.test"));
  await assert.rejects(hardware.openSnapshot({ ...cache, secret_count: 7 }, root, cache.origin));
  for (const requirement of ["ANY", "", "SOFTWARE"]) {
    await assert.rejects(hardware.openSnapshot({ ...cache, server_requirement: requirement }, root, cache.origin));
    await assert.rejects(hardware.verifyRoot({ ...cache, server_requirement: requirement }, root, cache.origin));
  }
  const downgraded = { ...cache };
  delete downgraded.server_requirement;
  delete downgraded.snapshot_policy_version;
  await assert.rejects(hardware.openSnapshot(downgraded, root, cache.origin));
  const removedSlot = { ...cache, keyslots: [] };
  await assert.rejects(hardware.openSnapshot(removedSlot, root, cache.origin));
  await assert.rejects(hardware.sealSnapshot(keyset, root, snapshot(store), "SOFTWARE"));
  await assert.rejects(hardware.sealSnapshot(keyset, root, snapshot(store)));
  const changedCiphertext = Buffer.from(cache.ciphertext_b64, "base64");
  changedCiphertext[0] ^= 0xff;
  await assert.rejects(hardware.openSnapshot({ ...cache, ciphertext_b64: changedCiphertext.toString("base64") }, root, cache.origin));
  root.fill(0);
});

test("previously protected hardware caches remain readable and can be upgraded", async () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/offline-legacy-policy.json", import.meta.url))).hardware;
  const { hardware, keys } = environment(Date.parse(fixture.cache.created_at) + 1000);
  keys.set(fixture.cache.keyslots[0].credential_id_b64, Buffer.alloc(32, 9));
  const root = await hardware.unlockRoot(fixture.cache, fixture.cache.keyslots[0].id, null, fixture.cache.origin);
  assert.deepEqual(Array.from(root), Array.from(Buffer.from(fixture.root_b64, "base64")));
  const snapshot = await hardware.openSnapshot(fixture.cache, root, fixture.cache.origin);
  assert.equal(snapshot.secrets[0].id, "secret-1");
  const upgraded = await hardware.sealSnapshot(fixture.cache, root, snapshot, "HARDWARE");
  assert.equal(upgraded.server_requirement, "HARDWARE");
  const reopenedRoot = await hardware.unlockRoot(upgraded, upgraded.keyslots[0].id, null, upgraded.origin);
  assert.equal((await hardware.openSnapshot(upgraded, reopenedRoot, upgraded.origin)).username, "alice");
  root.fill(0);
  reopenedRoot.fill(0);
});

test("missing PRF, user verification and external non-synced keys fail closed", async () => {
  const { hardware, control, win } = environment();
  const { keyset, root } = hardware.createKeyset(account(), "https://vault.example.test", "HARDWARE");
  control.prf = false;
  await assert.rejects(hardware.registerKey(keyset, root, "No PRF"), /PRF/);
  control.prf = true;
  control.flags = 1;
  await assert.rejects(hardware.registerKey(keyset, root, "No UV"), /Benutzerverifikation/);
  control.flags = 13;
  await assert.rejects(hardware.registerKey(keyset, root, "Synced"), /Passkeys/);
  control.flags = 5;
  control.attachment = "platform";
  await assert.rejects(hardware.registerKey(keyset, root, "Platform"), /extern/);
  control.attachment = "cross-platform";
  const slot = await hardware.registerKey(keyset, root, "Valid");
  keyset.keyslots.push(slot);
  control.prf = false;
  await assert.rejects(hardware.unlockRoot(keyset, slot.id, null, keyset.origin), /PRF/);
  control.prf = true;
  win.isSecureContext = false;
  await assert.rejects(hardware.unlockRoot(keyset, slot.id, null, keyset.origin), /sicheren Browser-Kontext/);
  root.fill(0);
});

#!/usr/bin/env node
/** Unit tests for offline-store.js pure helpers (no IndexedDB). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../web/static/offline-store.js"), "utf8");
const ctx = { window: {}, globalThis: {}, indexedDB: null };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const TV = ctx.TVOfflineStore;
if (!TV) throw new Error("TVOfflineStore missing");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = Date.now();
const fresh = { synced_at: new Date(now - 1000).toISOString() };
const stale = { synced_at: new Date(now - TV.TTL_MS - 1000).toISOString() };
assert(!TV.isExpired(fresh), "fresh not expired");
assert(TV.isExpired(stale), "stale expired");
assert(TV.isExpired(null), "null expired");

const listItem = {
  id: "s1",
  has_access: true,
  key_version: 2,
  title_ciphertext_b64: "AAA",
  title_nonce_b64: "BBB",
  envelope: { key_version: 2, ephemeral_pub_b64: "E", nonce_b64: "N", wrapped_dk_b64: "W" },
};
const cached = {
  ...listItem,
  ciphertext_b64: "CT",
  nonce_b64: "NV",
};
assert(!TV.needsDetailFetch(listItem, cached), "reuse when revision matches");
assert(TV.needsDetailFetch({ ...listItem, key_version: 3 }, cached), "fetch on version change");
assert(TV.needsDetailFetch(listItem, { ...cached, ciphertext_b64: "" }), "fetch when no payload");

const plan = TV.planSync([listItem, { id: "s2", has_access: false }], [cached]);
assert(plan.toFetch.length === 0 && plan.reuse.length === 1, "plan delta reuse");
assert(plan.expectedCount === 1, "plan expected count");

const det = {
  title_ciphertext_b64: "AAA",
  title_nonce_b64: "BBB",
  ciphertext_b64: "CT2",
  nonce_b64: "NV2",
  key_version: 2,
  envelope: listItem.envelope,
  recipients: ["u1"],
};
const entry = TV.buildSecretEntry(listItem, det);
assert(entry.id === "s1" && entry.ciphertext_b64 === "CT2", "build entry");

const assembled = TV.assembleSecrets([cached], [entry], ["s1"]);
assert(assembled && assembled.length === 1, "assemble ok");
assert(TV.assembleSecrets([], [], ["missing"]) === null, "assemble incomplete");

const snap = TV.buildSnapshot({
  me: { tenant_id: "t1", user_id: "u1", username: "alice" },
  keys: { salt_b64: "s", encrypted_private_key_nonce_b64: "n", encrypted_private_key_b64: "k" },
  params: { Time: 3 },
  secrets: [cached],
});
assert(snap.version === 1 && snap.secrets.length === 1 && snap.expires_at, "build snapshot");

console.log("offline-store.js ok");

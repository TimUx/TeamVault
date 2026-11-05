import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/app.js", import.meta.url), "utf8");

function between(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error("Offline policy functions not found");
  return source.slice(first, last);
}

const policyFunctions = between("function isOfflineKeyRequirement(", "\nfunction cliIntegrationEnabled() {");
const sessionFunctions = between("  function assertOfflineSession(", "\n  function renderHardwareSetup() {");
const syncFunction = between("  async function syncOfflineSnapshot(", "\n  async function maybePromptOfflineOptIn() {");

function harness({ policyResponses = [] } = {}) {
  const profile = { value: "STANDARD", dataset: {} };
  const session = new Uint8Array([1]);
  const softwareKey = new Uint8Array(32).fill(2);
  const vault = {
    sk: session, offlineKey: softwareKey, offlineMode: false,
    policy: { offline_cache_allowed: true, offline_key_requirement: "ANY" },
    me: { tenant_id: "t1", user_id: "u1" }, params: {},
    secretsCache: [], offlineSyncRunning: false,
  };
  let written = 0;
  let policyCalls = 0;
  const store = {
    isAvailable: () => true,
    getOptIn: () => true,
    getSnapshotRaw: async () => null,
    planSync: () => ({ reuse: [], toFetch: [], expectedCount: 0, expectedIds: [] }),
    assembleSecrets: () => [],
    buildSnapshot: () => ({}),
    sealSnapshot: async () => ({ profile: "STANDARD" }),
    putSnapshot: async () => { written++; },
  };
  const context = {
    vault, window: { TVOfflineStore: store }, TVOfflineStore: store,
    n: { querySelector: () => profile },
    location: { origin: "https://vault.example.test" },
    requireOfflineStore() {},
    async ensureAllSecretsLoaded() {},
    setOfflineSyncProgress() {},
    updateOfflineAccountUI() {},
    async api(path) {
      if (path === "/api/policy/client") {
        const result = policyResponses[policyCalls++];
        if (result instanceof Error) throw result;
        return result;
      }
      if (path === "/api/vault/keys") return {};
      throw new Error(`unexpected API call ${path}`);
    },
  };
  vm.createContext(context);
  vm.runInContext(`${policyFunctions}\n${sessionFunctions}\n${syncFunction}
    this.allowed = offlineProfileAllowed;
    this.refresh = refreshOfflinePolicy;
    this.sync = syncOfflineSnapshot;`, context);
  return { context, vault, session, profile, written: () => written, policyCalls: () => policyCalls };
}

test("offline profile requirements admit only the required key combinations", () => {
  const h = harness();
  const matrix = {
    ANY: [true, true, true],
    SOFTWARE: [true, false, true],
    HARDWARE: [false, true, true],
    COMBINED: [false, false, true],
  };
  const profiles = ["STANDARD", "HARDWARE", "COMBINED"];
  for (const [requirement, expected] of Object.entries(matrix)) {
    h.vault.policy = { offline_cache_allowed: true, offline_key_requirement: requirement };
    assert.deepEqual(profiles.map((profile) => h.context.allowed(profile)), expected);
    assert.equal(h.context.allowed("UNKNOWN"), false);
  }
  for (const policy of [
    null, {}, { offline_cache_allowed: false, offline_key_requirement: "ANY" },
    { offline_cache_allowed: true }, { offline_cache_allowed: true, offline_key_requirement: "unknown" },
  ]) {
    h.vault.policy = policy;
    assert.equal(h.context.allowed("STANDARD"), false);
    assert.equal(h.context.allowed("COMBINED"), false);
  }
});

test("a policy change during sync cannot replace the existing cache", async () => {
  const h = harness({ policyResponses: [
    { offline_cache_allowed: true, offline_key_requirement: "ANY" },
    { offline_cache_allowed: true, offline_key_requirement: "HARDWARE" },
  ] });
  await assert.rejects(h.context.sync({ silent: true }), /Administratorrichtlinie/);
  assert.equal(h.policyCalls(), 2);
  assert.equal(h.written(), 0);
  assert.equal(h.vault.offlineSyncRunning, false);
});

test("a policy change that still permits the profile cannot be saved with stale policy metadata", async () => {
  const h = harness({ policyResponses: [
    { offline_cache_allowed: true, offline_key_requirement: "ANY" },
    { offline_cache_allowed: true, offline_key_requirement: "SOFTWARE" },
  ] });
  await assert.rejects(h.context.sync({ silent: true }), /Administratorrichtlinie wurde geändert/);
  assert.equal(h.policyCalls(), 2);
  assert.equal(h.written(), 0);
});

test("a failed policy refresh clears stale permission and aborts sync", async () => {
  const h = harness({ policyResponses: [new Error("network unavailable")] });
  await assert.rejects(h.context.sync({ silent: true }), /Richtlinie konnte nicht geprüft/);
  assert.equal(h.vault.policy, null);
  assert.equal(h.written(), 0);
  assert.equal(h.vault.offlineSyncRunning, false);
});

test("a policy response cannot restore access after the vault locks", async () => {
  const h = harness();
  let resolvePolicy;
  h.context.api = () => new Promise((resolve) => { resolvePolicy = resolve; });
  const operation = h.context.refresh(h.session);
  h.vault.sk = null;
  resolvePolicy({ offline_cache_allowed: true, offline_key_requirement: "HARDWARE" });
  await assert.rejects(operation, /gesperrt/);
  assert.equal(h.vault.policy.offline_key_requirement, "ANY");
});

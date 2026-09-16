import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/app.js", import.meta.url), "utf8");

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Unable to extract function source");
  return source.slice(start, end).trimEnd();
}

const autoRefreshSource = extractBetween(
  "async function autoRefreshSecrets(reason, opts = {}) {",
  "\n\n  function bindSecretAutoRefresh() {"
);

function buildHarness({ refreshImpl, now, visibilityState = "visible" } = {}) {
  let callCount = 0;
  let lastArgs = null;
  const context = {
    vault: {
      sk: new Uint8Array([1]),
      me: { user_id: "u1" },
      offlineMode: false,
      offlinePicker: false,
      pageLimit: 50,
      secretsRefreshPromise: null,
      secretsLastRefreshAt: 0,
    },
    document: { visibilityState },
    SECRET_AUTO_REFRESH_COOLDOWN_MS: 15000,
    SECRET_AUTO_REFRESH_MAX_ITEMS: 100,
    console: { warn() {} },
    refreshSecrets: (...args) => {
      callCount += 1;
      lastArgs = args;
      return refreshImpl ? refreshImpl(...args) : Promise.resolve();
    },
    Date: { now: () => now ?? 0 },
  };
  vm.createContext(context);
  vm.runInContext(`${autoRefreshSource}\nthis.autoRefreshSecrets = autoRefreshSecrets;`, context);
  return {
    context,
    autoRefreshSecrets: context.autoRefreshSecrets,
    getCallCount: () => callCount,
    getLastArgs: () => lastArgs,
  };
}

test("autoRefreshSecrets throttles focus refreshes within cooldown", async () => {
  const h = buildHarness({ now: 10_000 });
  h.context.vault.secretsLastRefreshAt = 2_000;
  await h.autoRefreshSecrets("focus");
  assert.equal(h.getCallCount(), 0);
});

test("autoRefreshSecrets reuses an in-flight refresh promise", async () => {
  let resolveRefresh;
  const refreshPromise = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const h = buildHarness({ now: 20_000, refreshImpl: () => refreshPromise });
  const first = h.autoRefreshSecrets("focus");
  const inFlight = h.context.vault.secretsRefreshPromise;
  const second = h.autoRefreshSecrets("focus");
  assert.equal(h.getCallCount(), 1);
  assert.ok(inFlight);
  assert.strictEqual(h.context.vault.secretsRefreshPromise, inFlight);
  resolveRefresh();
  await Promise.all([first, second]);
  assert.equal(h.context.vault.secretsRefreshPromise, null);
});

test("autoRefreshSecrets bypasses cooldown when forced", async () => {
  const h = buildHarness({ now: 30_000 });
  h.context.vault.secretsLastRefreshAt = 29_000;
  await h.autoRefreshSecrets("unlock", { force: true });
  assert.equal(h.getCallCount(), 1);
});

test("autoRefreshSecrets propagates auth failures when requested", async () => {
  const authErr = Object.assign(new Error("not authenticated"), { status: 401 });
  const h = buildHarness({
    now: 40_000,
    refreshImpl: () => Promise.reject(authErr),
  });
  await assert.rejects(
    h.autoRefreshSecrets("unlock", { force: true, propagateAuth: true }),
    authErr
  );
});

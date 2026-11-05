import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/sw.js", import.meta.url), "utf8");

test("network-first security scripts do not replace the matching offline shell", async () => {
  const handlers = new Map();
  const cached = new Map([
    ["/app.js", "old app"],
    ["/offline-store.js", "old store"],
    ["/offline-hardware.js", "old hardware"],
  ]);
  let online = true;
  const self = {
    location: { pathname: "/sw.js", origin: "http://localhost" },
    addEventListener(type, handler) { handlers.set(type, handler); },
  };
  const caches = {
    async match(req) {
      const path = new URL(req.url || req, "http://localhost").pathname;
      return cached.has(path) ? new Response(cached.get(path)) : undefined;
    },
    async open() {
      return {
        async put(req, response) {
          cached.set(new URL(req.url).pathname, await response.text());
        },
      };
    },
  };
  vm.runInNewContext(source, {
    self, caches, URL, Response,
    fetch: async (req, options) => {
      assert.equal(options.cache, "no-store");
      if (!online) throw new Error("offline");
      return new Response(`new ${new URL(req.url).pathname}`);
    },
  });
  async function fetchThroughWorker(path) {
    let response;
    handlers.get("fetch")({
      request: { url: `http://localhost${path}`, method: "GET", mode: "cors" },
      respondWith(promise) { response = promise; },
    });
    return (await response).text();
  }
  for (const [path, oldValue] of cached) {
    assert.equal(await fetchThroughWorker(path), `new ${path}`);
    assert.equal(cached.get(path), oldValue);
  }
  online = false;
  for (const [path, oldValue] of cached) assert.equal(await fetchThroughWorker(path), oldValue);
});

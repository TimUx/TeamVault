// Unit tests for the pure origin/host matching helpers used to gate
// autofill/copy (clients/extension/lib/tv-url-match.js).
//
// Run with: node --test clients/extension/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TVMatch = require("../lib/tv-url-match.js");

test("originFromUrl extracts scheme+host+port", () => {
  assert.equal(TVMatch.originFromUrl("https://example.com/login"), "https://example.com");
  assert.equal(TVMatch.originFromUrl("https://example.com:8443/x"), "https://example.com:8443");
  assert.equal(TVMatch.originFromUrl("http://example.com"), "http://example.com");
  assert.equal(TVMatch.originFromUrl("not a url"), "");
});

test("originsMatch requires exact scheme+host+port equality", () => {
  const cases = [
    ["https://example.com", "https://example.com", true],
    ["https://example.com", "https://example.com:443", true], // 443 is the default HTTPS port
    ["https://example.com", "https://example.com:8443", false],
    ["https://example.com", "http://example.com", false],
    ["https://example.com", "https://evil-example.com", false],
    ["https://example.com", "https://sub.example.com", false],
    ["https://sub.example.com", "https://example.com", false],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(
      TVMatch.originsMatch(TVMatch.originFromUrl(a), TVMatch.originFromUrl(b)),
      expected,
      `${a} vs ${b}`
    );
  }
});

test("originsMatch rejects empty/undefined origins", () => {
  assert.equal(TVMatch.originsMatch("", "https://example.com"), false);
  assert.equal(TVMatch.originsMatch("https://example.com", ""), false);
  assert.equal(TVMatch.originsMatch(null, null), false);
});

test("hostsMatch is subdomain-aware but never conflates unrelated hosts", () => {
  assert.equal(TVMatch.hostsMatch("example.com", "example.com"), true);
  assert.equal(TVMatch.hostsMatch("www.example.com", "example.com"), true);
  assert.equal(TVMatch.hostsMatch("sub.example.com", "example.com"), true);
  assert.equal(TVMatch.hostsMatch("example.com", "evil-example.com"), false);
  assert.equal(TVMatch.hostsMatch("evilexample.com", "example.com"), false);
});

test("parseVersion / newerVersion basic semver-ish compare", () => {
  assert.deepEqual(TVMatch.parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(TVMatch.parseVersion("1.2"), [1, 2, 0]);
  assert.equal(TVMatch.parseVersion("not-a-version"), null);
  assert.equal(TVMatch.newerVersion("0.10.0", "0.11.0"), true);
  assert.equal(TVMatch.newerVersion("0.10.0", "0.10.0"), false);
  assert.equal(TVMatch.newerVersion("0.10.1", "0.10.0"), false);
});

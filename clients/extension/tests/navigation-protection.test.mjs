// Navigation-protection test: content.js must refuse to fill credentials
// if the page's current origin no longer matches the origin that was
// active when Fill was triggered (e.g. the tab navigated away between
// clicking "Fill" and the content script executing).
//
// content.js is a plain (non-module) script that relies on browser
// globals (document, location, chrome/browser runtime). We load it in a
// vm sandbox with minimal stubs so the real fillLogin() message handler
// runs unmodified — no logic is duplicated/reimplemented here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentJsPath = path.join(__dirname, "..", "content.js");
const source = fs.readFileSync(contentJsPath, "utf8");

function loadContentScript(locationHref) {
  const location = new URL(locationHref);
  let registeredListener = null;
  const sandbox = {
    location: { origin: location.origin, hostname: location.hostname, href: location.href },
    document: {
      querySelectorAll: () => [],
    },
    getComputedStyle: () => ({ display: "", visibility: "", opacity: "1" }),
    HTMLTextAreaElement: function () {},
    HTMLInputElement: function () {},
    InputEvent: function (type, init) {
      this.type = type;
      Object.assign(this, init);
    },
    Event: function (type, init) {
      this.type = type;
      Object.assign(this, init);
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener: (fn) => {
            registeredListener = fn;
          },
        },
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "content.js" });
  return (msg) => {
    let response;
    registeredListener(msg, {}, (r) => {
      response = r;
    });
    return response;
  };
}

test("fill is blocked when the tab navigated to a different origin", () => {
  const dispatch = loadContentScript("https://example.com/login");
  const res = dispatch({
    type: "tv-fill",
    username: "alice",
    password: "s3cret",
    totp: "",
    expectedOrigin: "https://attacker.example", // stale origin captured before navigation
  });
  assert.equal(res.blocked, true);
  assert.equal(res.filledUser, false);
  assert.equal(res.filledPass, false);
});

test("fill proceeds when the current origin matches expectedOrigin", () => {
  const dispatch = loadContentScript("https://example.com/login");
  const res = dispatch({
    type: "tv-fill",
    username: "alice",
    password: "s3cret",
    totp: "",
    expectedOrigin: "https://example.com",
  });
  assert.equal(res.blocked, undefined);
});

test("fill is blocked for scheme-only differences (https vs http)", () => {
  const dispatch = loadContentScript("http://example.com/login");
  const res = dispatch({
    type: "tv-fill",
    username: "alice",
    password: "s3cret",
    totp: "",
    expectedOrigin: "https://example.com",
  });
  assert.equal(res.blocked, true);
});

test("fill is blocked for port-only differences", () => {
  const dispatch = loadContentScript("https://example.com:8443/login");
  const res = dispatch({
    type: "tv-fill",
    username: "alice",
    password: "s3cret",
    totp: "",
    expectedOrigin: "https://example.com",
  });
  assert.equal(res.blocked, true);
});

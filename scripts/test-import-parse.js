#!/usr/bin/env node
/** Smoke tests for import-parse.js (no DOM / KeePass). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../web/static/import-parse.js"), "utf8");
const ctx = { window: {}, globalThis: {} };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const TVImport = ctx.TVImport;
if (!TVImport) throw new Error("TVImport missing");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const bw = TVImport.detectAndParse("export.json", JSON.stringify({
  encrypted: false,
  folders: [{ id: "f1", name: "Infra" }],
  items: [{
    type: 1,
    name: "Mail",
    folderId: "f1",
    login: { username: "a", password: "p", totp: "otpauth://x", uris: [{ uri: "https://mail.example" }] },
    notes: "n",
  }],
}));
assert(bw.format === "bitwarden-json", "bw format " + bw.format);
assert(bw.items.length === 1 && bw.items[0].username === "a", "bw item");
assert(bw.items[0].collection_id === "Infra", "bw folder");

const chrome = TVImport.detectAndParse("Chrome Passwords.csv",
  "name,url,username,password\nGitHub,https://github.com,octo,secret\n");
assert(chrome.format === "chrome-csv", "chrome " + chrome.format);
assert(chrome.items[0].title === "GitHub" && chrome.items[0].password === "secret", "chrome item");

const ff = TVImport.detectAndParse("logins.csv",
  "url,username,password,httpRealm,formActionOrigin\nhttps://ex.test,u,pw,,\n");
assert(ff.format === "firefox-csv", "firefox " + ff.format);
assert(ff.items[0].title === "ex.test", "firefox title from host");

const lp = TVImport.detectAndParse("lastpass.csv",
  "url,username,password,totp,extra,name,grouping,fav\nhttps://a.test,u,p,,note,Title,Folder,1\n");
assert(lp.format === "lastpass-csv", "lastpass " + lp.format);
assert(lp.items[0].collection_id === "Folder" && lp.items[0].favorite === true, "lastpass folder/fav");

const tv = TVImport.detectAndParse("tv.json", JSON.stringify({
  kind: "teamvault-export",
  version: 1,
  items: [{ title: "X", username: "u", password: "p", extra: [{ type: "text", label: "k", value: "v" }] }],
}));
assert(tv.format === "teamvault-export" && tv.items[0].extra.length === 1, "tv export");

const bak = TVImport.detectAndParse("x.tvbak", JSON.stringify({
  kind: "teamvault-backup", version: 1, ciphertext_b64: "YQ==",
}));
assert(bak.encrypted === true && bak.format === "teamvault-backup", "backup detect");

const proton = TVImport.detectAndParse("proton.json", JSON.stringify({
  vaults: { v1: { name: "Personal", items: [{ data: { metadata: { name: "Box" }, content: { itemUsername: "u", password: "p", urls: ["https://p.test"] } } }] } },
}));
assert(proton.format === "proton-pass" && proton.items[0].title === "Box", "proton");

console.log("import-parse.js ok");

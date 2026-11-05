import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const start = source.indexOf("  function renderList() {");
const end = source.indexOf("\n  function escapeHtml(", start);
assert.ok(start >= 0 && end > start, "renderList source not found");

function renderRows(filter, { search = "", tagFilters = [] } = {}) {
  const list = {
    children: [],
    innerHTML: "",
    appendChild(row) { this.children.push(row); },
  };
  const secrets = [
    { id: "own", title: "Private", has_access: true, is_owner: true, visibility: "private" },
    { id: "own-shared", title: "Own shared", has_access: true, is_owner: true, visibility: "shared" },
    { id: "received", title: "Received", has_access: true, is_owner: false, visibility: "shared" },
    { id: "inventory-private", title: "(kein Zugriff)", has_access: false, visibility: "private" },
    { id: "inventory-shared", title: "(kein Zugriff)", has_access: false, visibility: "shared" },
    { id: "missing-access", title: "(kein Zugriff)", visibility: "private" },
  ].map((s) => ({ favorite: true, tags: ["test"], ...s }));
  const context = {
    state: { secrets, filter, search, tagFilters, selectedId: null },
    $: () => list,
    document: {
      createElement: () => ({
        innerHTML: "",
        addEventListener() {},
      }),
    },
    escapeHtml: (s) => String(s || ""),
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nrenderList();`, context);
  return list;
}

for (const [filter, titles] of [
  ["all", ["Private", "Own shared", "Received"]],
  ["mine", ["Private"]],
  ["shared", ["Own shared", "Received"]],
  ["favorites", ["Private", "Own shared", "Received"]],
]) {
  test(`${filter} only renders accessible entries and preserves visibility scope`, () => {
    const list = renderRows(filter);
    assert.equal(list.children.length, titles.length);
    for (const [i, title] of titles.entries()) {
      assert.ok(list.children[i].innerHTML.includes(`<span class="title">${title}</span>`));
    }
    assert.ok(list.children.every((row) => !row.innerHTML.includes("(kein Zugriff)")));
  });
}

test("search and tag filters cannot reveal inaccessible inventory", () => {
  const list = renderRows("all", { search: "kein Zugriff", tagFilters: ["test"] });
  assert.equal(list.children.length, 0);
  assert.ok(list.innerHTML.includes("Keine Secrets gefunden."));
});

test("accessible secrets remain searchable with tag filters", () => {
  const list = renderRows("all", { search: "received", tagFilters: ["test"] });
  assert.equal(list.children.length, 1);
  assert.ok(list.children[0].innerHTML.includes('<span class="title">Received</span>'));
});

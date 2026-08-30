/** Client-side vault import parsers (Bitwarden JSON, CSV, KeePass XML). No secrets leave the browser until encrypted POST. */
(function (global) {
  function hostFromUrl(u) {
    try {
      return new URL(u).hostname;
    } catch {
      return "";
    }
  }

  function splitUrls(raw) {
    if (Array.isArray(raw)) {
      return raw.map((u) => String(u || "").trim()).filter(Boolean);
    }
    const s = String(raw || "").trim();
    if (!s) return [];
    return s
      .split(/[;\n]+/)
      .map((u) => u.trim())
      .filter(Boolean);
  }

  function normalizeItem(raw) {
    const tags = Array.isArray(raw.tags)
      ? raw.tags
      : String(raw.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
    let urls = splitUrls(raw.urls);
    if (!urls.length) urls = splitUrls(raw.url);
    return {
      title: String(raw.title || raw.name || "Import").trim() || "Import",
      username: String(raw.username || ""),
      password: String(raw.password || ""),
      url: urls[0] || "",
      urls,
      notes: String(raw.notes || ""),
      totp_seed: String(raw.totp_seed || raw.totp || "").trim(),
      tags,
      favorite: !!raw.favorite,
      collection_id: String(raw.collection_id || raw.folder || "").trim(),
      extra: Array.isArray(raw.extra) ? raw.extra : [],
    };
  }

  function parseBitwarden(jsonText) {
    const data = JSON.parse(jsonText);
    const folders = {};
    for (const f of data.folders || []) {
      folders[f.id] = f.name;
    }
    const out = [];
    for (const it of data.items || []) {
      if (it.type !== 1 && it.type !== undefined && it.login == null) continue; // 1 = login
      const login = it.login || {};
      const urls = (login.uris || []).map((x) => x && x.uri).filter(Boolean);
      out.push(
        normalizeItem({
          title: it.name,
          username: login.username,
          password: login.password,
          urls,
          notes: it.notes,
          totp: login.totp,
          folder: it.folderId ? folders[it.folderId] || "" : "",
          favorite: !!it.favorite,
          tags: (it.collectionIds || []).join(","),
        })
      );
    }
    return out;
  }

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    function splitRow(line) {
      const cells = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (q && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = !q;
        } else if (c === "," && !q) {
          cells.push(cur);
          cur = "";
        } else cur += c;
      }
      cells.push(cur);
      return cells.map((x) => x.trim());
    }
    const header = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
    const idx = (names) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iTitle = idx(["title", "name", "account"]);
    const iUser = idx(["username", "user", "login"]);
    const iPass = idx(["password", "pass"]);
    const iUrl = idx(["url", "uri", "website", "login_uri", "urls"]);
    const iNotes = idx(["notes", "note", "comments"]);
    const iTotp = idx(["totp", "otp", "otpauth", "totp_seed"]);
    const iFolder = idx(["folder", "group", "collection", "collection_id"]);
    const out = [];
    for (let r = 1; r < lines.length; r++) {
      const cells = splitRow(lines[r]);
      if (!cells.length) continue;
      out.push(
        normalizeItem({
          title: iTitle >= 0 ? cells[iTitle] : cells[0],
          username: iUser >= 0 ? cells[iUser] : "",
          password: iPass >= 0 ? cells[iPass] : "",
          urls: iUrl >= 0 ? cells[iUrl] : "",
          notes: iNotes >= 0 ? cells[iNotes] : "",
          totp: iTotp >= 0 ? cells[iTotp] : "",
          folder: iFolder >= 0 ? cells[iFolder] : "",
        })
      );
    }
    return out;
  }

  function kpString(entry, key) {
    const strings = entry.getElementsByTagName("String");
    for (let i = 0; i < strings.length; i++) {
      const k = strings[i].getElementsByTagName("Key")[0];
      const v = strings[i].getElementsByTagName("Value")[0];
      if (k && v && k.textContent === key) return v.textContent || "";
    }
    return "";
  }

  function walkKeePassGroup(group, folderPath, out) {
    let directName = "";
    for (const child of group.children || []) {
      if (child.tagName === "Name") {
        directName = child.textContent || "";
        break;
      }
    }
    const path = folderPath ? folderPath + "/" + directName : directName;
    for (const child of group.children || []) {
      if (child.tagName === "Entry") {
        out.push(
          normalizeItem({
            title: kpString(child, "Title"),
            username: kpString(child, "UserName"),
            password: kpString(child, "Password"),
            url: kpString(child, "URL"),
            notes: kpString(child, "Notes"),
            totp: kpString(child, "otp") || kpString(child, "TOTP"),
            folder: path,
          })
        );
      } else if (child.tagName === "Group") {
        walkKeePassGroup(child, path, out);
      }
    }
  }

  function parseKeePass(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("KeePass-XML ungültig");
    const out = [];
    const root = doc.getElementsByTagName("Root")[0];
    if (!root) return out;
    for (const child of root.children || []) {
      if (child.tagName === "Group") walkKeePassGroup(child, "", out);
    }
    return out.filter((x) => x.title || x.username || x.password);
  }

  function detectAndParse(filename, text) {
    const name = (filename || "").toLowerCase();
    if (name.endsWith(".json") || text.trim().startsWith("{")) {
      return { format: "bitwarden-json", items: parseBitwarden(text) };
    }
    if (name.endsWith(".xml") || text.includes("<KeePassFile") || text.includes("<Group>")) {
      return { format: "keepass-xml", items: parseKeePass(text) };
    }
    return { format: "csv", items: parseCSV(text) };
  }

  global.TVImport = { detectAndParse, hostFromUrl, normalizeItem };
})(typeof window !== "undefined" ? window : globalThis);

/** Client-side vault import parsers. No secrets leave the browser until encrypted POST. */
(function (global) {
  function hostFromUrl(u) {
    const s = String(u || "").trim();
    if (!s) return "";
    try {
      return new URL(s).hostname;
    } catch {
      const m = s.match(/^https?:\/\/([^/:?#]+)/i);
      return m ? m[1] : "";
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
    const extra = Array.isArray(raw.extra) ? raw.extra : [];
    return {
      title: String(raw.title || raw.name || "Import").trim() || "Import",
      username: String(raw.username || ""),
      password: String(raw.password || ""),
      url: urls[0] || "",
      urls,
      notes: String(raw.notes || ""),
      totp_seed: String(raw.totp_seed || raw.totp || "").trim(),
      tags,
      favorite: !!raw.favorite || raw.fav === "1" || raw.fav === 1,
      collection_id: String(raw.collection_id || raw.folder || raw.group || raw.grouping || "").trim(),
      extra,
    };
  }

  function parseTeamVaultExport(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((it) =>
      normalizeItem({
        title: it.title || it.name,
        username: it.username,
        password: it.password,
        urls: it.urls || it.url,
        notes: it.notes,
        totp_seed: it.totp_seed || it.totp,
        tags: it.tags,
        favorite: it.favorite,
        collection_id: it.collection_id || it.folder,
        extra: it.extra,
      })
    );
  }

  function parseBitwarden(data) {
    const folders = {};
    for (const f of data.folders || []) {
      folders[f.id] = f.name;
    }
    const out = [];
    for (const it of data.items || []) {
      if (it.type !== 1 && it.type !== undefined && it.login == null) continue;
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

  function loginField(fields, designation, type) {
    if (!Array.isArray(fields)) return "";
    const hit = fields.find((f) => f && (f.designation === designation || f.name === designation || f.type === type));
    return hit ? String(hit.value || "") : "";
  }

  function parse1PasswordPux(data) {
    const out = [];
    for (const acc of data.accounts || []) {
      for (const vault of acc.vaults || []) {
        const folder = (vault.attrs && vault.attrs.name) || "";
        for (const it of vault.items || []) {
          const ov = it.overview || {};
          const det = it.details || {};
          const fields = det.loginFields || det.fields || [];
          const urls = [];
          if (ov.url) urls.push(ov.url);
          for (const u of ov.urls || []) {
            const href = typeof u === "string" ? u : u && (u.url || u.href);
            if (href) urls.push(href);
          }
          out.push(
            normalizeItem({
              title: ov.title || ov.name || "Import",
              username: loginField(fields, "username") || det.username || "",
              password: loginField(fields, "password") || det.password || "",
              urls,
              notes: det.notesPlain || det.notes || "",
              totp: loginField(fields, "totp") || det.totp || "",
              folder,
            })
          );
        }
      }
    }
    return out;
  }

  function parseProtonPass(data) {
    const out = [];
    const vaults = data.vaults || {};
    for (const id of Object.keys(vaults)) {
      const vault = vaults[id] || {};
      const folder = vault.name || "";
      for (const it of vault.items || []) {
        const d = (it.data && it.data) || it;
        const meta = d.metadata || {};
        const content = d.content || d;
        const urls = splitUrls(content.urls || content.url || []);
        out.push(
          normalizeItem({
            title: meta.name || content.name || "Import",
            username: content.itemUsername || content.itemEmail || content.username || "",
            password: content.password || "",
            urls,
            notes: meta.note || content.note || "",
            totp: content.totpUri || content.totp || "",
            folder,
          })
        );
      }
    }
    return out;
  }

  function parseJSON(jsonText) {
    const data = JSON.parse(jsonText);
    if (!data || typeof data !== "object") return { format: "json", items: [] };
    if (data.kind === "teamvault-backup") {
      return { format: "teamvault-backup", encrypted: true, raw: data, items: [] };
    }
    if (data.kind === "teamvault-export") {
      return { format: "teamvault-export", items: parseTeamVaultExport(data) };
    }
    if (Array.isArray(data.accounts) && data.accounts.some((a) => a && a.vaults)) {
      return { format: "1password-pux", items: parse1PasswordPux(data) };
    }
    if (data.vaults && !Array.isArray(data.vaults) && typeof data.vaults === "object") {
      return { format: "proton-pass", items: parseProtonPass(data) };
    }
    if (Array.isArray(data.items) || Array.isArray(data.folders)) {
      return { format: "bitwarden-json", items: parseBitwarden(data) };
    }
    if (Array.isArray(data)) {
      return { format: "json-array", items: data.map(normalizeItem) };
    }
    return { format: "json", items: parseTeamVaultExport(data) };
  }

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

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { format: "csv", items: [] };
    const header = splitRow(lines[0]).map((h) =>
      h
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/-+/g, "_")
    );
    const idx = (names) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iTitle = idx(["title", "name", "account", "label"]);
    const iUser = idx(["username", "user", "login", "login_username", "user_name"]);
    const iPass = idx(["password", "pass", "login_password"]);
    const iUrl = idx(["url", "uri", "website", "login_uri", "urls", "web_site", "login_url"]);
    const iNotes = idx(["notes", "note", "comments", "extra", "comment"]);
    const iTotp = idx(["totp", "otp", "otpauth", "totp_seed", "otp_auth", "one-time_password"]);
    const iFolder = idx(["folder", "group", "collection", "collection_id", "grouping", "vault"]);
    const iTags = idx(["tags", "tag"]);
    const iFav = idx(["favorite", "fav", "favourite"]);
    let format = "csv";
    const joined = header.join(",");
    if (joined.includes("http_realm") || joined.includes("form_action_origin")) format = "firefox-csv";
    else if (header.includes("grouping") && header.includes("extra")) format = "lastpass-csv";
    else if (header.includes("otpauth") || (header.includes("type") && header.includes("title") && header.includes("url"))) {
      format = "1password-csv";
    } else if (header.includes("group") && header.includes("title") && header.includes("username")) format = "keepassxc-csv";
    else if (header[0] === "name" && header.includes("url") && header.includes("username")) format = "chrome-csv";

    const out = [];
    for (let r = 1; r < lines.length; r++) {
      const cells = splitRow(lines[r]);
      if (!cells.length) continue;
      const url = iUrl >= 0 ? cells[iUrl] : "";
      let title = iTitle >= 0 ? cells[iTitle] : "";
      if (!title) title = hostFromUrl(url) || cells[0] || "Import";
      const favRaw = iFav >= 0 ? cells[iFav] : "";
      out.push(
        normalizeItem({
          title,
          username: iUser >= 0 ? cells[iUser] : "",
          password: iPass >= 0 ? cells[iPass] : "",
          urls: url,
          notes: iNotes >= 0 ? cells[iNotes] : "",
          totp: iTotp >= 0 ? cells[iTotp] : "",
          folder: iFolder >= 0 ? cells[iFolder] : "",
          tags: iTags >= 0 ? cells[iTags] : "",
          favorite: favRaw === "1" || /^true|yes|y$/i.test(favRaw),
        })
      );
    }
    return { format, items: out };
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
    const trimmed = String(text || "").trim();
    if (name.endsWith(".tvbak") || name.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return parseJSON(trimmed);
    }
    if (name.endsWith(".xml") || trimmed.includes("<KeePassFile") || trimmed.includes("<Group>")) {
      return { format: "keepass-xml", items: parseKeePass(trimmed) };
    }
    return parseCSV(trimmed);
  }

  global.TVImport = { detectAndParse, hostFromUrl, normalizeItem };
})(typeof window !== "undefined" ? window : globalThis);

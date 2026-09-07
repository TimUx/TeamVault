/* TeamVault extension popup — mature autofill + domain match (ZK: keys only here). */
const api = typeof browser !== "undefined" ? browser : chrome;
const state = { base: "", sk: null, me: null, cache: [], tabHost: "", tabOrigin: "" };
const accentOptions = new Set(["blue", "indigo", "teal", "graphite", "rose", "amber", "emerald"]);

function applyAccent(pref) {
  const accent = accentOptions.has(pref) ? pref : "blue";
  document.documentElement.setAttribute("data-accent", accent);
  const sel = document.getElementById("accent");
  if (sel) sel.value = accent;
}

async function applyRemotePreferences(me) {
  const prefs = me && me.preferences;
  if (!prefs || typeof prefs !== "object") return;
  applyAccent(prefs.accent);
  await api.storage.local.set({ accent: accentOptions.has(prefs.accent) ? prefs.accent : "blue" });
}

function showErr(msg) {
  const el = document.getElementById("err");
  el.hidden = !msg;
  el.textContent = msg || "";
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(state.base + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function normalizeSecretsList(data) {
  if (Array.isArray(data)) return { items: data, total: data.length };
  return { items: data.items || [], total: data.total ?? (data.items || []).length };
}

function openDK(env) {
  return TVCrypto.openDataKeyEnvelope(
    TVCrypto.b64dec(env.ephemeral_pub_b64),
    TVCrypto.b64dec(env.nonce_b64),
    TVCrypto.b64dec(env.wrapped_dk_b64),
    state.sk
  );
}

const { originFromUrl, hostFromUrl, originsMatch, hostsMatch, parseVersion, newerVersion } = TVMatch;

function absoluteUrl(base, path) {
  if (!path || /^https?:\/\//i.test(path)) return path || "";
  return base.replace(/\/$/, "") + "/" + String(path).replace(/^\//, "");
}

async function extensionDownloadUrl() {
  try {
    const meta = await apiFetch("/api/client-downloads");
    let preferred = meta.extension?.crx || meta.extension?.zip;
    if (api.runtime.getBrowserInfo) {
      const info = await api.runtime.getBrowserInfo().catch(() => null);
      if (String(info?.name || "").toLowerCase().includes("firefox")) preferred = meta.extension?.xpi || preferred;
    }
    return absoluteUrl(state.base, preferred?.url || "");
  } catch (_) {
    return "";
  }
}

async function checkForUpdate() {
  const el = document.getElementById("update");
  el.textContent = "";
  el.hidden = true;
  try {
    const remote = await apiFetch("/api/version");
    const latest = remote.version || "";
    const current = api.runtime.getManifest().version;
    if (!newerVersion(current, latest)) return;
    el.append("Update verfügbar: TeamVault Extension ", latest, " ist bereit.");
    const url = await extensionDownloadUrl();
    if (url) {
      el.append(" ");
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Download";
      el.append(a);
    }
    el.hidden = false;
  } catch (_) {}
}

/** TOTP (RFC 6238, SHA-1, 6 digits) — see lib/tv-totp.js */
const totpNow = TVTotp.totpNow;

async function boot() {
  const cfg = await api.storage.local.get(["base", "tenant", "user", "accent"]);
  applyAccent(cfg.accent || "blue");
  state.base = (cfg.base || "http://127.0.0.1:8080").replace(/\/$/, "");
  document.getElementById("base").value = state.base;
  checkForUpdate();
  if (cfg.user) document.getElementById("user").value = cfg.user;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      state.tabHost = hostFromUrl(tab.url);
      state.tabOrigin = originFromUrl(tab.url);
      document.getElementById("tabHost").textContent = state.tabOrigin
        ? "Seite: " + state.tabOrigin
        : "";
    }
  } catch (_) {}
  try {
    const me = await apiFetch("/api/me");
    state.me = me;
    await applyRemotePreferences(me);
    document.getElementById("login").hidden = true;
    document.getElementById("unlock").hidden = false;
    document.getElementById("who").textContent = me.username + " · " + me.tenant_id;
  } catch (_) {}
}

/**
 * The extension ships fixed host_permissions only for the built-in local
 * dev defaults (http://127.0.0.1/*, http://localhost/*). Manifest host
 * match patterns without an explicit port match any port (Chrome treats
 * an unspecified port as a wildcard; Firefox doesn't support port
 * matching at all — see MDN "Match patterns"), so these two static
 * patterns already cover any port, e.g. http://127.0.0.1:8080. Any other
 * self-hosted TeamVault server — internal DNS name, private IP, custom
 * port, HTTP or HTTPS — is granted on demand via the optional
 * "https://" and "http://" wildcard host permissions declared in
 * manifest.json, requested only once the user actually configures that
 * server URL.
 */
function isBuiltinLocalOrigin(base) {
  try {
    const u = new URL(base);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

document.getElementById("saveBase").onclick = async () => {
  state.base = document.getElementById("base").value.trim().replace(/\/$/, "");
  const accent = document.getElementById("accent").value;
  applyAccent(accent);
  await api.storage.local.set({ base: state.base, accent });
  if (!isBuiltinLocalOrigin(state.base) && api.permissions?.request) {
    try {
      await api.permissions.request({ origins: [state.base + "/*"] });
    } catch (_) {}
  }
  showErr("");
  checkForUpdate();
};

document.getElementById("accent").onchange = async (ev) => {
  const accent = ev.target.value;
  applyAccent(accent);
  await api.storage.local.set({ accent });
  if (state.me) {
    apiFetch("/api/me/preferences", {
      method: "PUT",
      body: JSON.stringify({ accent }),
    }).catch(() => {});
  }
};

document.getElementById("doLogin").onclick = async () => {
  showErr("");
  try {
    const tenant = document.getElementById("tenant").value.trim();
    const user = document.getElementById("user").value.trim();
    const selectionToken = document.getElementById("doLogin").dataset.loginToken || "";
    await api.storage.local.set({ tenant, user, base: state.base });
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        tenant_slug: tenant,
        username: user,
        password: document.getElementById("lpw").value,
        ...(selectionToken ? { login_token: selectionToken } : {}),
      }),
    });
    if (res.needs_tenant && res.login_token) {
      const select = document.getElementById("tenant");
      select.innerHTML = "";
      for (const t of res.tenants || []) {
        const option = document.createElement("option");
        option.value = t.slug;
        option.textContent = t.name === t.slug ? t.name : `${t.name} (${t.slug})`;
        select.appendChild(option);
      }
      select.hidden = false;
      document.getElementById("tenantLabel").hidden = false;
      document.getElementById("doLogin").dataset.loginToken = res.login_token;
      document.getElementById("doLogin").textContent = "Tenant auswählen";
      return;
    }
    if (res.needs_totp && res.login_token) {
      document.getElementById("doLogin").dataset.loginToken = res.login_token;
      document.getElementById("login").hidden = true;
      document.getElementById("totpStep").hidden = false;
      return;
    }
    if (res.needs_vault_onboard) throw new Error("Bitte zuerst im Web-UI onboarden");
    state.me = res;
    await applyRemotePreferences(res);
    if (res.tenant_slug) {
      document.getElementById("tenant").value = res.tenant_slug;
      await api.storage.local.set({ tenant: res.tenant_slug });
    }
    document.getElementById("login").hidden = true;
    document.getElementById("unlock").hidden = false;
    document.getElementById("who").textContent = res.username;
  } catch (e) {
    showErr(e.message);
  }
};

document.getElementById("doTotp").onclick = async () => {
  showErr("");
  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login_token: document.getElementById("doLogin").dataset.loginToken || "",
        totp_code: document.getElementById("totp").value.trim(),
      }),
    });
    if (res.needs_vault_onboard) throw new Error("Bitte zuerst im Web-UI onboarden");
    state.me = res;
    if (res.tenant_slug) await api.storage.local.set({ tenant: res.tenant_slug });
    document.getElementById("totpStep").hidden = true;
    document.getElementById("unlock").hidden = false;
    document.getElementById("who").textContent = res.username;
  } catch (e) {
    showErr(e.message);
  }
};

document.getElementById("doUnlock").onclick = async () => {
  showErr("");
  try {
    const keys = await apiFetch("/api/vault/keys");
    const params = await apiFetch("/api/vault/crypto-params");
    state.sk = await TVCrypto.unlockPrivateKey(
      document.getElementById("mpw").value,
      TVCrypto.b64dec(keys.salt_b64),
      TVCrypto.b64dec(keys.encrypted_private_key_nonce_b64),
      TVCrypto.b64dec(keys.encrypted_private_key_b64),
      params
    );
    document.getElementById("mpw").value = "";
    document.getElementById("unlock").hidden = true;
    document.getElementById("vault").hidden = false;
    await refresh();
  } catch (e) {
    showErr(e.message);
  }
};

document.getElementById("lock").onclick = () => {
  if (state.sk) state.sk.fill(0);
  state.sk = null;
  state.cache = [];
  document.getElementById("vault").hidden = true;
  document.getElementById("unlock").hidden = false;
};

document.getElementById("logout").onclick = async () => {
  if (state.sk) state.sk.fill(0);
  state.sk = null;
  state.cache = [];
  try {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (_) {}
  document.getElementById("unlock").hidden = true;
  document.getElementById("vault").hidden = true;
  document.getElementById("login").hidden = false;
};

async function decryptPayloadFor(id) {
  const det = await apiFetch("/api/secrets/" + id);
  const dk = openDK(det.envelope);
  try {
    const pt = await TVCrypto.decryptPayload(
      TVCrypto.b64dec(det.ciphertext_b64),
      TVCrypto.b64dec(det.nonce_b64),
      dk,
      det.key_version
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } finally {
    dk.fill(0);
  }
}

async function fillTab(payload, expectedOrigin) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Kein aktives Tab");
  const liveOrigin = tab.url ? originFromUrl(tab.url) : "";
  if (expectedOrigin && liveOrigin !== expectedOrigin) {
    throw new Error("Tab-Origin hat sich geändert (" + (liveOrigin || "?") + "). Fill abgebrochen.");
  }
  let totp = "";
  if (payload.totp_seed) {
    try {
      totp = await totpNow(payload.totp_seed);
    } catch (_) {}
  }
  const msg = {
    type: "tv-fill",
    username: payload.username || "",
    password: payload.password || "",
    totp,
    expectedOrigin: expectedOrigin || liveOrigin,
  };
  try {
    return await api.tabs.sendMessage(tab.id, msg);
  } catch {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await api.tabs.sendMessage(tab.id, msg);
  }
}

function urlOriginsAllowed(it, tabOrigin) {
  const origins = it.urlOrigins || [];
  if (!origins.length) return true;
  return !!(tabOrigin && origins.some((o) => originsMatch(o, tabOrigin)));
}

function urlHostsAllowed(it) {
  return urlOriginsAllowed(it, state.tabOrigin);
}

function paintList() {
  const list = document.getElementById("slist");
  const q = (document.getElementById("filter").value || "").trim().toLowerCase();
  const onlyHost = document.getElementById("matchHost").checked;
  const visFilter = document.getElementById("visFilter").value || "all";
  list.innerHTML = "";
  let rows = state.cache.slice();
  if (visFilter !== "all") {
    rows = rows.filter((r) => (r.visibility || "private") === visFilter);
  }
  if (onlyHost && state.tabOrigin) {
    rows = rows.filter((r) => urlOriginsAllowed(r, state.tabOrigin));
  }
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.urlHost || "").includes(q) ||
        (r.urlHosts || []).some((h) => h.includes(q)) ||
        (r.collection_id || "").toLowerCase().includes(q)
    );
  }
  document.getElementById("matchHint").textContent = onlyHost && state.tabHost
    ? rows.length + " Treffer für " + state.tabHost
    : rows.length + " Einträge";
  for (const it of rows) {
    const row = document.createElement("div");
    row.className = "row-item";
    const span = document.createElement("span");
    span.className = "title";
    span.textContent = it.title || it.id;
    const vis = (it.visibility || "private") === "shared" ? "shared" : "private";
    const visBadge = document.createElement("span");
    visBadge.className = "badge " + vis;
    visBadge.textContent = vis === "shared" ? "geteilt" : "privat";
    span.appendChild(visBadge);
    if (it.urlHost) {
      const badge = document.createElement("small");
      badge.textContent = it.urlHost;
      span.appendChild(document.createElement("br"));
      span.appendChild(badge);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const fill = document.createElement("button");
    fill.type = "button";
    fill.textContent = "Fill";
    fill.onclick = async () => {
      try {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        const liveOrigin = tab?.url ? originFromUrl(tab.url) : "";
        state.tabOrigin = liveOrigin;
        state.tabHost = tab?.url ? hostFromUrl(tab.url) : "";
        if (!urlOriginsAllowed(it, liveOrigin)) {
          showErr("Fill blockiert: Secret-URL passt nicht zur Tab-Origin (" + (liveOrigin || "?") + ").");
          return;
        }
        const payload = await decryptPayloadFor(it.id);
        const result = await fillTab(payload, liveOrigin);
        if (result?.blocked) {
          showErr("Fill blockiert: Seite hat navigiert (" + (result.origin || "?") + ").");
        }
      } catch (e) {
        showErr(e.message);
      }
    };
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copy";
    copy.onclick = async () => {
      try {
        if (!urlOriginsAllowed(it, state.tabOrigin)) {
          showErr("Copy blockiert: Secret-URL passt nicht zur Tab-Origin (" + (state.tabOrigin || "?") + ").");
          return;
        }
        const payload = await decryptPayloadFor(it.id);
        await navigator.clipboard.writeText(payload.password || "");
      } catch (e) {
        showErr(e.message);
      }
    };
    actions.appendChild(fill);
    actions.appendChild(copy);
    row.appendChild(span);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function fetchAllSecrets() {
  const pageSize = 200;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = normalizeSecretsList(await apiFetch(`/api/secrets?limit=${pageSize}&offset=${offset}`));
    all.push(...page.items);
    if (!page.items.length || all.length >= page.total) break;
  }
  return all;
}

async function refresh() {
  showErr("");
  const items = await fetchAllSecrets();
  const cache = [];
  for (const it of items) {
    if (!it.has_access || !it.envelope) continue;
    const entry = {
      id: it.id,
      title: it.id,
      urlHost: "",
      urlHosts: [],
      collection_id: it.collection_id || "",
      visibility: (it.visibility || "private") === "shared" ? "shared" : "private",
    };
    try {
      const dk = openDK(it.envelope);
      const kv = it.envelope.key_version || it.key_version || 1;
      entry.title = await TVCrypto.decryptTitle(
        TVCrypto.b64dec(it.title_ciphertext_b64),
        TVCrypto.b64dec(it.title_nonce_b64),
        dk,
        kv
      );
      dk.fill(0);
    } catch (_) {}
    // Lazy URL host: decrypt payload once for matching (kept only in popup memory)
    try {
      const payload = await decryptPayloadFor(it.id);
      const urls = Array.isArray(payload.urls) && payload.urls.length
        ? payload.urls
        : payload.url
          ? [payload.url]
          : [];
      entry.urlHosts = urls.map((u) => hostFromUrl(u)).filter(Boolean);
      entry.urlOrigins = urls.map((u) => originFromUrl(u)).filter(Boolean);
      entry.urlHost = entry.urlHosts[0] || "";
      if (!entry.urlHost && entry.title) {
        const m = entry.title.match(/([a-z0-9-]+\.[a-z]{2,})/i);
        if (m) {
          entry.urlHost = m[1].toLowerCase();
          entry.urlHosts = [entry.urlHost];
        }
      }
    } catch (_) {}
    cache.push(entry);
  }
  state.cache = cache;
  // Prefer domain matches at top
  if (state.tabHost) {
    state.cache.sort((a, b) => {
      const am = (a.urlHosts || []).some((h) => hostsMatch(h, state.tabHost)) || (a.urlHost && hostsMatch(a.urlHost, state.tabHost)) ? 0 : 1;
      const bm = (b.urlHosts || []).some((h) => hostsMatch(h, state.tabHost)) || (b.urlHost && hostsMatch(b.urlHost, state.tabHost)) ? 0 : 1;
      return am - bm || (a.title || "").localeCompare(b.title || "");
    });
    document.getElementById("matchHost").checked = state.cache.some(
      (r) => (r.urlHosts || []).some((h) => hostsMatch(h, state.tabHost)) || (r.urlHost && hostsMatch(r.urlHost, state.tabHost))
    );
  }
  paintList();
}

document.getElementById("filter").oninput = () => paintList();
document.getElementById("matchHost").onchange = () => paintList();
document.getElementById("visFilter").onchange = () => paintList();

boot().catch((e) => showErr(e.message));

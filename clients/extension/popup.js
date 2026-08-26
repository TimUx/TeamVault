/* teamVault extension popup — mature autofill + domain match (ZK: keys only here). */
const api = typeof browser !== "undefined" ? browser : chrome;
const state = { base: "", sk: null, me: null, cache: [], tabHost: "" };

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

function hostFromUrl(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostsMatch(a, b) {
  if (!a || !b) return false;
  a = a.replace(/^www\./, "").toLowerCase();
  b = b.replace(/^www\./, "").toLowerCase();
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

/** Minimal TOTP (RFC 6238, SHA-1, 6 digits) — secret base32 or otpauth URL. */
async function totpNow(seed) {
  if (!seed) return "";
  let secret = seed.trim();
  if (secret.startsWith("otpauth://")) {
    try {
      secret = new URL(secret).searchParams.get("secret") || "";
    } catch {
      return "";
    }
  }
  const cleaned = secret.replace(/\s+/g, "").toUpperCase().replace(/=+$/, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of cleaned) {
    const v = alphabet.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = await crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[sig.length - 1] & 0xf;
  const code = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(code % 1e6).padStart(6, "0");
}

async function boot() {
  const cfg = await api.storage.local.get(["base", "tenant", "user"]);
  state.base = (cfg.base || "http://127.0.0.1:8080").replace(/\/$/, "");
  document.getElementById("base").value = state.base;
  if (cfg.tenant) document.getElementById("tenant").value = cfg.tenant;
  if (cfg.user) document.getElementById("user").value = cfg.user;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      state.tabHost = hostFromUrl(tab.url);
      document.getElementById("tabHost").textContent = state.tabHost
        ? "Seite: " + state.tabHost
        : "";
    }
  } catch (_) {}
  try {
    const me = await apiFetch("/api/me");
    state.me = me;
    document.getElementById("login").hidden = true;
    document.getElementById("unlock").hidden = false;
    document.getElementById("who").textContent = me.username + " · " + me.tenant_id;
  } catch (_) {}
}

document.getElementById("saveBase").onclick = async () => {
  state.base = document.getElementById("base").value.trim().replace(/\/$/, "");
  await api.storage.local.set({ base: state.base });
  if (state.base.startsWith("https://") && api.permissions?.request) {
    try {
      await api.permissions.request({ origins: [state.base.replace(/\/$/, "") + "/*"] });
    } catch (_) {}
  }
  showErr("");
};

document.getElementById("doLogin").onclick = async () => {
  showErr("");
  try {
    const tenant = document.getElementById("tenant").value.trim();
    const user = document.getElementById("user").value.trim();
    await api.storage.local.set({ tenant, user, base: state.base });
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        tenant_slug: tenant,
        username: user,
        password: document.getElementById("lpw").value,
        totp_code: document.getElementById("totp").value.trim(),
      }),
    });
    if (res.needs_vault_onboard) throw new Error("Bitte zuerst im Web-UI onboarden");
    state.me = res;
    document.getElementById("login").hidden = true;
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

async function fillTab(payload) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Kein aktives Tab");
  let totp = "";
  if (payload.totp_seed) {
    try {
      totp = await totpNow(payload.totp_seed);
    } catch (_) {}
  }
  try {
    return await api.tabs.sendMessage(tab.id, {
      type: "tv-fill",
      username: payload.username || "",
      password: payload.password || "",
      totp,
    });
  } catch {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await api.tabs.sendMessage(tab.id, {
      type: "tv-fill",
      username: payload.username || "",
      password: payload.password || "",
      totp,
    });
  }
}

function paintList() {
  const list = document.getElementById("slist");
  const q = (document.getElementById("filter").value || "").trim().toLowerCase();
  const onlyHost = document.getElementById("matchHost").checked;
  list.innerHTML = "";
  let rows = state.cache.slice();
  if (onlyHost && state.tabHost) {
    rows = rows.filter((r) => r.urlHost && hostsMatch(r.urlHost, state.tabHost));
  }
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.urlHost || "").includes(q) ||
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
        const payload = await decryptPayloadFor(it.id);
        await fillTab(payload);
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

async function refresh() {
  showErr("");
  const page = normalizeSecretsList(await apiFetch("/api/secrets?limit=200&offset=0"));
  const cache = [];
  for (const it of page.items) {
    if (!it.has_access || !it.envelope) continue;
    const entry = { id: it.id, title: it.id, urlHost: "", collection_id: it.collection_id || "" };
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
      entry.urlHost = hostFromUrl(payload.url || "");
      if (!entry.urlHost && entry.title) {
        const m = entry.title.match(/([a-z0-9-]+\.[a-z]{2,})/i);
        if (m) entry.urlHost = m[1].toLowerCase();
      }
    } catch (_) {}
    cache.push(entry);
  }
  state.cache = cache;
  // Prefer domain matches at top
  if (state.tabHost) {
    state.cache.sort((a, b) => {
      const am = a.urlHost && hostsMatch(a.urlHost, state.tabHost) ? 0 : 1;
      const bm = b.urlHost && hostsMatch(b.urlHost, state.tabHost) ? 0 : 1;
      return am - bm || (a.title || "").localeCompare(b.title || "");
    });
    document.getElementById("matchHost").checked = state.cache.some(
      (r) => r.urlHost && hostsMatch(r.urlHost, state.tabHost)
    );
  }
  paintList();
}

document.getElementById("filter").oninput = () => paintList();
document.getElementById("matchHost").onchange = () => paintList();

boot().catch((e) => showErr(e.message));

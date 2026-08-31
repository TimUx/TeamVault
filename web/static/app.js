const state = {
  step: 0,
  draft: {
    storage: { backend: "sqlite", dsn: "" },
    tenant: { name: "", slug: "", recovery_mode: "user_kit", escrow_allowed: false },
    admin: { username: "admin", display_name: "", email: "", password: "", password2: "" },
    argon2: { Time: 3, Memory: 65536, Threads: 1, KeyLen: 32 },
  },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

/** Flat stroke icons (inline SVG, no CDN — air-gap). */
const ICO = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  group: '<circle cx="9" cy="8" r="3.5"/><circle cx="16.5" cy="9.5" r="2.75"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M14 20a5 5 0 0 1 8 0"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/>',
  network: '<rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="8" y="14" width="8" height="8" rx="1"/><path d="M6 10v2a2 2 0 0 0 2 2h2M18 10v2a2 2 0 0 1-2 2h-2M12 14v-2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  building: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  rotate: '<path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  layoutList: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  layoutTable: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/>',
  layoutGrid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  cert: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
};

function icon(name, cls) {
  const body = ICO[name] || ICO.key;
  return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function navLink(nav, icoName, label, extraClass, attrs) {
  const cls = ["sidebar-link", extraClass].filter(Boolean).join(" ");
  const extra = attrs ? " " + attrs : "";
  return `<button type="button" class="${cls}" data-nav="${nav}"${extra}><span class="nav-ico">${icon(icoName)}</span><span>${label}</span></button>`;
}

function btnLabel(icoName, label) {
  return `${icon(icoName, "btn-ico")}<span>${label}</span>`;
}

function syncThemeToggles(theme) {
  const dark = theme === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.classList.add("btn-icon");
    btn.setAttribute("aria-label", dark ? "Hellmodus" : "Dunkelmodus");
    btn.title = dark ? "Hellmodus" : "Dunkelmodus";
    btn.innerHTML = icon(dark ? "sun" : "moon");
  });
}

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("tv-theme", t); } catch (_) {}
  syncThemeToggles(t);
}

function initTheme() {
  let t = "light";
  try { t = localStorage.getItem("tv-theme") || "light"; } catch (_) {}
  applyTheme(t);
}

function ensureHeaderControls() {
  const top = document.querySelector(".top");
  if (!top || top.querySelector("[data-theme-toggle]")) return;
  const actions = document.createElement("div");
  actions.className = "top-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon";
  btn.id = "themeToggle";
  btn.setAttribute("data-theme-toggle", "1");
  btn.onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  };
  actions.appendChild(btn);
  const help = document.createElement("a");
  help.href = "/help";
  help.className = "btn-ghost";
  help.textContent = "Hilfe";
  help.style.textDecoration = "none";
  help.style.padding = "0.35rem 0.65rem";
  help.style.display = "inline-flex";
  help.style.alignItems = "center";
  actions.appendChild(help);
  top.appendChild(actions);
  syncThemeToggles(document.documentElement.getAttribute("data-theme") || "light");
}

function formatAboutLine(info) {
  const product = (info && info.product) || "TeamVault";
  let version = String((info && info.version) || "dev");
  const commit = info && info.commit && info.commit !== "none" ? String(info.commit) : "";
  const developer = (info && info.developer) || "Timo Braun";
  const semver = version.match(/^v?(\d+\.\d+\.\d+)/);
  if (semver) {
    version = "v" + semver[1];
  } else if (commit && version !== "dev") {
    version = version + " (" + commit.slice(0, 7) + ")";
  }
  return `${product} ${version} · Entwickler: ${developer}`;
}

function formatSessionInfo(me) {
  if (!me) return "";
  const tenant = me.tenant_name || me.tenant_slug || me.tenant_id || "";
  let line = `Angemeldet als ${me.username}`;
  if (tenant) line += ` · ${tenant}`;
  if (me.totp_enabled) line += " · TOTP aktiv";
  return line;
}

let aboutCache = null;

async function loadAboutInfo() {
  if (aboutCache) return aboutCache;
  try {
    aboutCache = await api("/api/version");
  } catch (_) {
    aboutCache = { product: "TeamVault", version: "dev", commit: "none", developer: "Timo Braun" };
  }
  return aboutCache;
}

async function paintAbout() {
  const info = await loadAboutInfo();
  const line = formatAboutLine(info);
  document.querySelectorAll("#about, .about-line").forEach((el) => {
    el.textContent = line;
  });
  let foot = document.getElementById("aboutFoot");
  if (!foot) {
    foot = document.createElement("footer");
    foot.id = "aboutFoot";
    foot.className = "about-foot";
    document.body.appendChild(foot);
  }
  // Hide page footer inside app shell (sidebar already shows about).
  if (document.body.classList.contains("app-wide")) {
    foot.hidden = true;
  } else {
    foot.hidden = false;
    foot.textContent = line;
  }
}

function copyText(text) {
  return navigator.clipboard.writeText(text || "");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function generatePassword(len = 20, opts = {}) {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+?";
  let alphabet = lower + upper + digits;
  if (opts.symbols !== false) alphabet += symbols;
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  // Ensure character classes
  const req = [lower, upper, digits];
  if (opts.symbols !== false) req.push(symbols);
  const arr = out.split("");
  for (let i = 0; i < req.length && i < arr.length; i++) {
    const set = req[i];
    arr[i] = set[bytes[i] % set.length];
  }
  return arr.join("");
}

/** RFC6238 TOTP (SHA-1, 6 digits). Accepts base32 or otpauth:// URL. */
async function totpNow(seed) {
  if (!seed) return "";
  let secret = String(seed).trim();
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
  if (!bytes.length) return "";
  const key = await crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[sig.length - 1] & 0xf;
  const code = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(code % 1e6).padStart(6, "0");
}

function totpSecondsLeft() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

function flashCopy(btn) {
  if (!btn) return;
  const prev = btn.innerHTML;
  btn.innerHTML = btnLabel("copy", "Kopiert");
  btn.classList.add("copied");
  setTimeout(() => { btn.innerHTML = prev; btn.classList.remove("copied"); }, 1200);
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function normalizeSecretsList(data) {
  if (Array.isArray(data)) {
    return { items: data, total: data.length, limit: data.length, offset: 0 };
  }
  return {
    items: data.items || [],
    total: data.total ?? (data.items || []).length,
    limit: data.limit ?? 50,
    offset: data.offset ?? 0,
  };
}

function renderWizard(app) {
  const steps = ["Willkommen", "Storage", "Tenant/Admin", "Krypto", "Recovery", "Commit"];
  const wrap = el(`<div><div class="steps" id="stepper"></div><div class="panel" id="panel"></div></div>`);
  app.appendChild(wrap);
  const paint = () => {
    wrap.querySelector("#stepper").innerHTML = steps.map((s, i) => `<span class="${i === state.step ? "on" : ""}">${i + 1}. ${s}</span>`).join("");
    const panel = wrap.querySelector("#panel");
    panel.innerHTML = "";
    panel.appendChild(stepView(paint));
  };
  paint();
}

function stepView(repaint) {
  const d = state.draft;
  if (state.step === 0) {
    const n = el(`<div>
      <h1>Willkommen bei TeamVault</h1>
      <p class="lead">Zero-Knowledge Passwortmanager. Secrets werden nur clientseitig entschlüsselt. Genau ein Bootstrap-Secret entsperrt die Config.</p>
      <p class="hint">Der erste Admin ist immer lokal authentifiziert (Schutz vor LDAP-Aussperrung).</p>
      <div class="row"><button class="btn-accent" type="button">Weiter</button></div>
    </div>`);
    n.querySelector("button").onclick = () => { state.step = 1; repaint(); };
    return n;
  }
  if (state.step === 1) {
    const n = el(`<div>
      <h1>Storage</h1>
      <label>Backend</label>
      <select id="backend"><option value="sqlite">SQLite</option><option value="json">JSON-File</option></select>
      <label>Pfad / DSN (optional)</label>
      <input id="dsn" placeholder="Standard unter data/" />
      <div class="row">
        <button class="btn-ghost" type="button" data-b>Zurück</button>
        <button class="btn-accent" type="button" data-n>Weiter</button>
      </div>
    </div>`);
    n.querySelector("#backend").value = d.storage.backend;
    n.querySelector("#dsn").value = d.storage.dsn;
    n.querySelector("[data-b]").onclick = () => { state.step = 0; repaint(); };
    n.querySelector("[data-n]").onclick = () => {
      d.storage.backend = n.querySelector("#backend").value;
      d.storage.dsn = n.querySelector("#dsn").value.trim();
      state.step = 2; repaint();
    };
    return n;
  }
  if (state.step === 2) {
    const n = el(`<div>
      <h1>Tenant & lokaler Admin</h1>
      <label>Tenant-Name</label><input id="tname" />
      <label>Slug</label><input id="tslug" placeholder="mein-team" />
      <label>Admin-Username</label><input id="user" />
      <label>Anzeigename</label><input id="disp" />
      <label>E-Mail</label><input id="email" type="email" />
      <label>Login-Passwort (≥12)</label><input id="pw" type="password" />
      <label>Passwort wiederholen</label><input id="pw2" type="password" />
      <div class="error" id="err" hidden></div>
      <div class="row">
        <button class="btn-ghost" type="button" data-b>Zurück</button>
        <button class="btn-accent" type="button" data-n>Weiter</button>
      </div>
    </div>`);
    n.querySelector("#tname").value = d.tenant.name;
    n.querySelector("#tslug").value = d.tenant.slug;
    n.querySelector("#user").value = d.admin.username;
    n.querySelector("#disp").value = d.admin.display_name;
    n.querySelector("#email").value = d.admin.email;
    n.querySelector("[data-b]").onclick = () => { state.step = 1; repaint(); };
    n.querySelector("[data-n]").onclick = () => {
      d.tenant.name = n.querySelector("#tname").value.trim();
      d.tenant.slug = n.querySelector("#tslug").value.trim();
      d.admin.username = n.querySelector("#user").value.trim();
      d.admin.display_name = n.querySelector("#disp").value.trim();
      d.admin.email = n.querySelector("#email").value.trim();
      d.admin.password = n.querySelector("#pw").value;
      d.admin.password2 = n.querySelector("#pw2").value;
      const err = n.querySelector("#err");
      if (d.admin.password !== d.admin.password2) { err.hidden = false; err.textContent = "Passwörter stimmen nicht überein"; return; }
      if (d.admin.password.length < 12) { err.hidden = false; err.textContent = "Passwort zu kurz"; return; }
      state.step = 3; repaint();
    };
    return n;
  }
  if (state.step === 3) {
    const n = el(`<div>
      <h1>Argon2id-Parameter</h1>
      <p class="hint">Clientseitige Vault-KDF (Master-Passwort). Login-Hash ist getrennt.</p>
      <label>Memory (KiB)</label><input id="mem" type="number" />
      <label>Time (Iterationen)</label><input id="time" type="number" />
      <label>Parallelism</label><input id="par" type="number" />
      <div class="row">
        <button class="btn-ghost" type="button" data-b>Zurück</button>
        <button class="btn-accent" type="button" data-n>Weiter</button>
      </div>
    </div>`);
    n.querySelector("#mem").value = d.argon2.Memory;
    n.querySelector("#time").value = d.argon2.Time;
    n.querySelector("#par").value = d.argon2.Threads;
    n.querySelector("[data-b]").onclick = () => { state.step = 2; repaint(); };
    n.querySelector("[data-n]").onclick = () => {
      d.argon2.Memory = Number(n.querySelector("#mem").value);
      d.argon2.Time = Number(n.querySelector("#time").value);
      d.argon2.Threads = Number(n.querySelector("#par").value);
      state.step = 4; repaint();
    };
    return n;
  }
  if (state.step === 4) {
    const n = el(`<div>
      <h1>Key-Recovery</h1>
      <label>Modus</label>
      <select id="mode">
        <option value="user_kit">User Recovery-Kit</option>
        <option value="admin_escrow">Admin-Escrow</option>
      </select>
      <label class="inline"><input id="escrow" type="checkbox" /> Escrow als Option erlauben</label>
      <p class="hint">Escrow-Shares werden nicht im Wizard erzeugt — erst in der Admin-UI nach Login.</p>
      <div class="row">
        <button class="btn-ghost" type="button" data-b>Zurück</button>
        <button class="btn-accent" type="button" data-n>Weiter</button>
      </div>
    </div>`);
    n.querySelector("#mode").value = d.tenant.recovery_mode;
    n.querySelector("#escrow").checked = d.tenant.escrow_allowed;
    n.querySelector("[data-b]").onclick = () => { state.step = 3; repaint(); };
    n.querySelector("[data-n]").onclick = () => {
      d.tenant.recovery_mode = n.querySelector("#mode").value;
      d.tenant.escrow_allowed = n.querySelector("#escrow").checked;
      state.step = 5; repaint();
    };
    return n;
  }
  // commit
  const n = el(`<div>
    <h1>Review & Commit</h1>
    <p class="lead">Atomarer Commit — danach ist das System initialisiert.</p>
    <pre class="hint" id="sum"></pre>
    <div class="error" id="err" hidden></div>
    <div class="ok" id="ok" hidden></div>
    <div class="row">
      <button class="btn-ghost" type="button" data-b>Zurück</button>
      <button class="btn-accent" type="button" data-n>Einrichten</button>
    </div>
  </div>`);
  n.querySelector("#sum").textContent = JSON.stringify({
    storage: d.storage, tenant: { ...d.tenant }, admin: { username: d.admin.username, email: d.admin.email }, argon2: d.argon2,
  }, null, 2);
  n.querySelector("[data-b]").onclick = () => { state.step = 4; repaint(); };
  n.querySelector("[data-n]").onclick = async () => {
    const err = n.querySelector("#err");
    const ok = n.querySelector("#ok");
    err.hidden = true; ok.hidden = true;
    try {
      const body = {
        storage: d.storage,
        tenant: d.tenant,
        admin: { username: d.admin.username, display_name: d.admin.display_name, email: d.admin.email, password: d.admin.password },
        argon2: d.argon2,
      };
      const res = await api("/api/setup/commit", { method: "POST", body: JSON.stringify(body) });
      ok.hidden = false;
      ok.textContent = `OK — Tenant ${res.tenant_id}. Weiter zum Login…`;
      setTimeout(() => { location.href = "/login"; }, 800);
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };
  return n;
}

function renderLogin(app) {
  const n = el(`<div class="panel">
    <h1>Login</h1>
    <p class="lead">Login-Passwort oder Passkey. Zum Entschlüsseln des Vaults brauchen Sie weiterhin Ihr Master-Passwort.</p>
    <label>Organisation</label>
    <select id="slug" autocomplete="organization" disabled>
      <option value="">Lade Organisationen…</option>
    </select>
    <p class="hint">Bestehende Mandanten — Auswahl für diesen Login.</p>
    <label>Username</label><input id="user" autocomplete="username" />
    <label>Passwort</label><input id="pw" type="password" autocomplete="current-password" />
    <label>TOTP (falls aktiv)</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" />
    <div class="error" id="err" hidden></div>
    <div class="row">
      <button class="btn-accent" type="button" id="doLogin">Anmelden</button>
      <button class="btn-ghost" type="button" id="doPasskey">Passkey</button>
    </div>
    <div id="offlineLogin" class="offline-login" hidden>
      <hr />
      <p class="hint">Ohne Netzwerk: gespeicherte verschlüsselte Kopie mit Master-Passwort entsperren (kein Login, kein TOTP).</p>
      <button class="btn-ghost btn-with-ico" type="button" id="doOffline">${btnLabel("unlock", "Offline entsperren")}</button>
    </div>
  </div>`);
  const slugSel = n.querySelector("#slug");
  (async () => {
    try {
      const tenants = await api("/api/auth/tenants");
      slugSel.innerHTML = "";
      if (!tenants.length) {
        slugSel.innerHTML = '<option value="">Keine Organisation vorhanden</option>';
        return;
      }
      let saved = "";
      try { saved = localStorage.getItem("tv-tenant-slug") || ""; } catch (_) {}
      tenants.sort((a, b) => a.name.localeCompare(b.name, "de"));
      for (const t of tenants) {
        const o = document.createElement("option");
        o.value = t.slug;
        o.textContent = t.name === t.slug ? t.name : `${t.name} (${t.slug})`;
        slugSel.appendChild(o);
      }
      slugSel.disabled = false;
      if (saved && tenants.some((t) => t.slug === saved)) slugSel.value = saved;
      else if (tenants.length === 1) slugSel.value = tenants[0].slug;
    } catch (_) {
      slugSel.innerHTML = '<option value="">Organisationen konnten nicht geladen werden</option>';
    }
  })();
  n.querySelector("#doLogin").onclick = async () => {
    const err = n.querySelector("#err");
    err.hidden = true;
    try {
      const tenantSlug = slugSel.value.trim();
      if (!tenantSlug) throw new Error("Bitte Organisation wählen");
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          tenant_slug: tenantSlug,
          username: n.querySelector("#user").value.trim(),
          password: n.querySelector("#pw").value,
          totp_code: n.querySelector("#totp").value.trim(),
        }),
      });
      try { localStorage.setItem("tv-tenant-slug", tenantSlug); } catch (_) {}
      location.href = res.needs_vault_onboard ? "/onboard" : "/app";
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  ["#pw", "#totp", "#user", "#slug"].forEach((sel) => {
    n.querySelector(sel).addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") n.querySelector("#doLogin").click();
    });
  });
  n.querySelector("#doPasskey").onclick = async () => {
    const err = n.querySelector("#err");
    err.hidden = true;
    try {
      if (!window.PublicKeyCredential) throw new Error("Passkeys werden von diesem Browser nicht unterstützt");
      const tenant = slugSel.value.trim();
      if (!tenant) throw new Error("Bitte Organisation wählen");
      const username = n.querySelector("#user").value.trim();
      const begin = await api("/api/webauthn/login/begin", {
        method: "POST",
        body: JSON.stringify({ tenant_slug: tenant, username }),
      });
      const cred = await navigator.credentials.get({
        publicKey: restorePublicKeyRequest(begin.publicKey),
      });
      const res = await api("/api/webauthn/login/finish", {
        method: "POST",
        body: JSON.stringify({
          tenant_slug: tenant,
          username,
          challenge_key: begin.challenge_key,
          credential: credentialToJSON(cred),
          totp_code: n.querySelector("#totp").value.trim(),
        }),
      });
      try { localStorage.setItem("tv-tenant-slug", tenant); } catch (_) {}
      location.href = res.needs_vault_onboard ? "/onboard" : "/app";
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  (async () => {
    if (!global.TVOfflineStore?.isAvailable()) return;
    try {
      const snaps = await TVOfflineStore.listSnapshots({ validOnly: true });
      if (snaps.length) n.querySelector("#offlineLogin").hidden = false;
    } catch (_) {}
  })();
  n.querySelector("#doOffline").onclick = () => {
    location.href = "/app?offline=1";
  };
  app.appendChild(n);
}

function b64urlToBuf(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function bufToB64url(buf) {
  const u8 = new Uint8Array(buf);
  let s = "";
  u8.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function restorePublicKeyRequest(pk) {
  const o = { ...pk, challenge: b64urlToBuf(pk.challenge) };
  if (pk.allowCredentials) {
    o.allowCredentials = pk.allowCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
  }
  return o;
}
function restorePublicKeyCreation(pk) {
  const o = {
    ...pk,
    challenge: b64urlToBuf(pk.challenge),
    user: { ...pk.user, id: b64urlToBuf(pk.user.id) },
  };
  if (pk.excludeCredentials) {
    o.excludeCredentials = pk.excludeCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
  }
  return o;
}
function credentialToJSON(cred) {
  const r = cred.response;
  const out = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {},
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
  };
  if (r.attestationObject) {
    out.response = {
      clientDataJSON: bufToB64url(r.clientDataJSON),
      attestationObject: bufToB64url(r.attestationObject),
      transports: r.getTransports?.() || [],
    };
  } else {
    out.response = {
      clientDataJSON: bufToB64url(r.clientDataJSON),
      authenticatorData: bufToB64url(r.authenticatorData),
      signature: bufToB64url(r.signature),
      userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
    };
  }
  return out;
}

function renderOnboard(app) {
  const n = el(`<div class="panel">
    <h1>Vault-Onboarding</h1>
    <p class="lead">Master-Passwort wird nur im Browser verwendet (Zero-Knowledge). Server sieht es nie.</p>
    <label>Master-Passwort (≥12)</label><input id="mpw" type="password" autocomplete="new-password" />
    <label>Wiederholen</label><input id="mpw2" type="password" autocomplete="new-password" />
    <div class="error" id="err" hidden></div>
    <div class="ok" id="kit" hidden></div>
    <div class="row"><button class="btn-accent" type="button" id="doOnboard">Schlüssel erzeugen</button></div>
  </div>`);
  n.querySelector("#doOnboard").onclick = async () => {
    const err = n.querySelector("#err"); const kitBox = n.querySelector("#kit");
    err.hidden = true; kitBox.hidden = true;
    const mpw = n.querySelector("#mpw").value;
    if (mpw.length < 12 || mpw !== n.querySelector("#mpw2").value) {
      err.hidden = false; err.textContent = "Master-Passwort ungültig / stimmt nicht überein"; return;
    }
    try {
      const me = await api("/api/me");
      const params = await api("/api/vault/crypto-params");
      const id = await TVCrypto.createIdentity(mpw, params);
      const body = {
        public_key_b64: TVCrypto.b64enc(id.publicKey),
        encrypted_private_key_b64: TVCrypto.b64enc(id.sealedPrivateKey),
        encrypted_private_key_nonce_b64: TVCrypto.b64enc(id.nonce),
        salt_b64: TVCrypto.b64enc(id.salt),
        argon2: params,
      };
      if (me.recovery_mode === "admin_escrow") {
        const st = await api("/api/vault/status");
        if (!st.has_escrow_pubkey) throw new Error("Admin muss zuerst Escrow-Public-Key setzen");
        const ep = await api("/api/vault/escrow-pubkey");
        const sealed = TVCrypto.sealForEscrow(id.secretKey, TVCrypto.b64dec(ep.public_key_b64));
        body.escrow_envelope_b64 = TVCrypto.b64enc(sealed);
      } else {
        const kit = TVCrypto.randomKitSecret();
        const sealed = await TVCrypto.sealWithRecoveryKit(id.secretKey, kit, params);
        body.encrypted_private_key_recovery_b64 = TVCrypto.b64enc(sealed.sealed);
        body.recovery_nonce_b64 = TVCrypto.b64enc(sealed.nonce);
        body.recovery_salt_b64 = TVCrypto.b64enc(sealed.salt);
        const kitB64 = TVCrypto.b64enc(kit);
        kit.fill(0);
        const kitText =
          "TeamVault Recovery-Kit\n" +
          "Bewahren Sie diese Datei sicher auf.\n" +
          "Ohne Kit und ohne Master-Passwort sind Secrets verloren.\n\n" +
          kitB64 + "\n";
        kitBox.hidden = false;
        kitBox.innerHTML =
          "<strong>Recovery-Kit (einmalig sichern):</strong>" +
          "<p class='hint'>Ohne dieses Kit und ohne Master-Passwort sind Secrets verloren.</p>" +
          "<code class='mono' id='kitval'></code>" +
          "<div class='row'>" +
          "<button class='btn-accent' type='button' id='kitCopy'>Kopieren</button>" +
          "<button class='btn-ghost' type='button' id='kitDl'>Download .txt</button>" +
          "</div>";
        kitBox.querySelector("#kitval").textContent = kitB64;
        kitBox.querySelector("#kitCopy").onclick = async (ev) => {
          await copyText(kitB64);
          flashCopy(ev.currentTarget);
        };
        kitBox.querySelector("#kitDl").onclick = () => downloadText("TeamVault-recovery-kit.txt", kitText);
      }
      id.secretKey.fill(0);
      await api("/api/vault/onboard", { method: "POST", body: JSON.stringify(body) });
      n.querySelector("#mpw").value = "";
      n.querySelector("#mpw2").value = "";
      const go = document.createElement("div");
      go.className = "row";
      go.innerHTML = `<button class="btn-accent" type="button">Weiter zur App</button>`;
      go.querySelector("button").onclick = () => { location.href = "/app"; };
      n.appendChild(go);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  app.appendChild(n);
}

const vault = {
  sk: null,
  me: null,
  params: null,
  policy: null,
  offlineMode: false,
  offlineSnapshot: null,
  offlinePicker: false,
  idleMin: 15,
  idleTimer: null,
  idleBound: false,
  secretsCache: [],
  secretsTotal: 0,
  secretsOffset: 0,
  pageLimit: 50,
  searchQuery: "",
  tagFilter: "",
  ownershipFilter: "mine", // mine | shared
  viewMode: (function () {
    try {
      const v = localStorage.getItem("tv-secrets-view");
      if (v === "table" || v === "tiles" || v === "list") return v;
    } catch (_) {}
    return "table";
  })(),
  groups: [],
  totpTimer: null,
  selectedIds: new Set(),
};

function isAdmin() {
  const roles = vault.me?.roles || [];
  return roles.includes("tenant_admin") || roles.includes("platform_admin");
}

function isAuditor() {
  return (vault.me?.roles || []).includes("auditor");
}

function canSeeAdminNav() {
  return isAdmin() || isAuditor();
}

function isAuditorOnly() {
  return isAuditor() && !isAdmin();
}

function clearVaultKey() {
  if (vault.sk) vault.sk.fill(0);
  vault.sk = null;
  if (vault.totpTimer) {
    clearInterval(vault.totpTimer);
    vault.totpTimer = null;
  }
}

function touchIdle() {
  if (!vault.sk) return;
  clearTimeout(vault.idleTimer);
  vault.idleTimer = setTimeout(() => {
    clearVaultKey();
    const overlay = document.getElementById("lockOverlay");
    if (overlay) {
      overlay.hidden = false;
      const mpw = overlay.querySelector("#lockMpw");
      if (mpw) mpw.value = "";
      const err = overlay.querySelector("#lockErr");
      if (err) { err.hidden = true; err.textContent = ""; }
      const trap = (ev) => {
        if (ev.key !== "Tab" || overlay.hidden) return;
        const focusable = overlay.querySelectorAll("input, button");
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      };
      overlay._focusTrap = trap;
      document.addEventListener("keydown", trap);
      document.addEventListener("keydown", overlay._escLock = (ev) => {
        if (ev.key === "Escape" && !overlay.hidden) {
          ev.preventDefault();
          mpw?.focus();
        }
      });
      mpw?.focus();
      announceA11y("Vault gesperrt. Master-Passwort eingeben.");
    }
  }, vault.idleMin * 60 * 1000);
}

function bindIdleListeners() {
  if (vault.idleBound) return;
  vault.idleBound = true;
  ["click", "keydown", "mousemove", "touchstart"].forEach((ev) => {
    document.addEventListener(ev, touchIdle, { passive: true });
  });
}

async function unlockVault(masterPassword, opts = {}) {
  const snapshot = opts.snapshot || (vault.offlineMode || vault.offlinePicker ? vault.offlineSnapshot : null);
  if (snapshot) {
    const sk = await TVCrypto.unlockPrivateKey(
      masterPassword,
      TVCrypto.b64dec(snapshot.keys.salt_b64),
      TVCrypto.b64dec(snapshot.keys.encrypted_private_key_nonce_b64),
      TVCrypto.b64dec(snapshot.keys.encrypted_private_key_b64),
      snapshot.crypto_params
    );
    vault.sk = sk;
    vault.params = snapshot.crypto_params;
    return;
  }
  const keys = await api("/api/vault/keys");
  const params = await api("/api/vault/crypto-params");
  const sk = await TVCrypto.unlockPrivateKey(
    masterPassword,
    TVCrypto.b64dec(keys.salt_b64),
    TVCrypto.b64dec(keys.encrypted_private_key_nonce_b64),
    TVCrypto.b64dec(keys.encrypted_private_key_b64),
    params
  );
  vault.sk = sk;
  vault.params = params;
}

function offlinePolicyAllowed() {
  return vault.policy?.offline_cache_allowed !== false;
}

function formatOfflineSessionInfo(snapshot) {
  if (!snapshot) return "Offline";
  const tenant = snapshot.tenant_name || snapshot.tenant_slug || snapshot.tenant_id || "";
  const synced = snapshot.synced_at ? new Date(snapshot.synced_at).toLocaleString("de-DE") : "—";
  let line = `Offline · ${snapshot.username}`;
  if (tenant) line += ` · ${tenant}`;
  line += ` · Sync ${synced}`;
  return line;
}

function openDKFromEnvelope(env) {
  return TVCrypto.openDataKeyEnvelope(
    TVCrypto.b64dec(env.ephemeral_pub_b64),
    TVCrypto.b64dec(env.nonce_b64),
    TVCrypto.b64dec(env.wrapped_dk_b64),
    vault.sk
  );
}

function fieldRow(label, value, opts = {}) {
  const { copy = true, mask = false, multiline = false, download = false } = opts;
  const display = value == null || value === "" ? "—" : String(value);
  const safe = display.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const copyAttr = copy && display !== "—" ? `data-copy="${encodeURIComponent(String(value))}"` : "";
  const dlAttr = download && display !== "—" ? `data-download="${encodeURIComponent(String(value))}" data-dlname="${encodeURIComponent(opts.filename || label || "download.txt")}"` : "";
  const actions = [];
  if (copy && display !== "—") actions.push(`<button type="button" class="copy-btn" ${copyAttr} title="Kopieren" aria-label="Kopieren">${btnLabel("copy", "Kopieren")}</button>`);
  if (download && display !== "—") actions.push(`<button type="button" class="copy-btn" ${dlAttr} title="Download" aria-label="Download">${btnLabel("download", "Download")}</button>`);
  return `<div class="secret-field${multiline ? " secret-field-block" : ""}">
    <div class="sf-label">${label}</div>
    <div class="sf-value${mask ? " masked" : ""}${multiline ? " mono prewrap" : ""}">${mask && display !== "—" ? "••••••••" : safe}</div>
    ${actions.length ? `<div class="sf-actions">${actions.join("")}</div>` : "<span></span>"}
  </div>`;
}

/** Normalize decrypted secret payload (legacy url → urls[], ensure extra[]). */
function normalizeSecretPayload(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  let urls = Array.isArray(p.urls) ? p.urls.map((u) => String(u || "").trim()).filter(Boolean) : [];
  if (!urls.length && p.url) urls = [String(p.url).trim()].filter(Boolean);
  const tags = Array.isArray(p.tags)
    ? p.tags.map((t) => String(t).trim()).filter(Boolean)
    : String(p.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  const extra = Array.isArray(p.extra)
    ? p.extra
        .filter((e) => e && typeof e === "object")
        .map((e) => ({
          id: String(e.id || ""),
          type: String(e.type || "text"),
          label: String(e.label || e.type || "Feld"),
          value: String(e.value == null ? "" : e.value),
        }))
    : [];
  return {
    username: String(p.username || ""),
    password: String(p.password || ""),
    urls,
    notes: String(p.notes || ""),
    totp_seed: String(p.totp_seed || "").trim(),
    tags,
    favorite: !!p.favorite,
    extra,
  };
}

function parseTagsInput(raw) {
  return String(raw || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function mergeTags(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const t of list) {
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

function mergeFolderIntoTags(payload, collectionId) {
  const folder = String(collectionId || "").trim();
  if (!folder) return payload;
  return { ...payload, tags: mergeTags(payload.tags || [], [folder]) };
}

function importItemTags(it) {
  return mergeTags(it.tags || [], parseTagsInput(it.collection_id));
}

function newExtraId() {
  return "x_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const EXTRA_ADD_OPTIONS = [
  { type: "url", label: "Website (URL)", singleton: false },
  { type: "totp", label: "TOTP-Seed", singleton: true },
  { type: "notes", label: "Notizen", singleton: true },
  { type: "tags", label: "Tags", singleton: true },
  { type: "favorite", label: "Favorit", singleton: true },
  { type: "ssh_private_key", label: "SSH Private Key", singleton: false, file: true },
  { type: "ssh_public_key", label: "SSH Public Key", singleton: false, file: true },
  { type: "s3_access_key", label: "S3 Access Key", singleton: false },
  { type: "s3_secret_key", label: "S3 Secret Key", singleton: false, secret: true },
  { type: "certificate", label: "Zertifikat (PEM)", singleton: false, file: true },
  { type: "text", label: "Freitext", singleton: false },
  { type: "secret", label: "Geheimnis (Custom)", singleton: false, secret: true },
];

function isMultilineExtraType(type) {
  return type === "ssh_private_key" || type === "ssh_public_key" || type === "certificate" || type === "notes";
}

function isSecretExtraType(type) {
  return type === "s3_secret_key" || type === "secret" || type === "ssh_private_key";
}

function extraSupportsFile(type) {
  return type === "ssh_private_key" || type === "ssh_public_key" || type === "certificate";
}

function announceA11y(msg) {
  const live = document.getElementById("a11yLive");
  if (!live || !msg) return;
  live.textContent = "";
  live.textContent = msg;
}

function renderApp(app) {
  document.body.classList.add("app-wide");
  const n = el(`<div class="app-frame">
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
    <aside class="app-sidebar" id="appSidebar" hidden>
      <div class="app-sidebar-brand">${icon("shield", "brand-ico")} <span>TeamVault</span></div>
      <nav class="app-sidebar-nav" id="appSidebarNav">
        <div class="sidebar-section">
          <div class="sidebar-section-title">Vault</div>
          ${navLink("vault:mine", "key", "Meine Secrets", "active")}
          ${navLink("vault:shared", "share", "Geteilt mit mir")}
          ${navLink("vault:create", "plus", "Neu anlegen")}
          ${navLink("vault:import", "upload", "Import")}
          ${navLink("vault:backup", "download", "Sicherung")}
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Konto</div>
          ${navLink("account", "user", "Konto")}
          <a class="sidebar-link" href="/help" target="_blank" rel="noopener"><span class="nav-ico">${icon("book")}</span><span>Hilfe</span></a>
        </div>
        <div class="sidebar-section" id="navAdminSection" hidden>
          <div class="sidebar-section-title">Administration</div>
          ${navLink("admin:users", "users", "Benutzer", "admin-link", 'data-admin-only')}
          ${navLink("admin:groups", "group", "Gruppen", "admin-link", 'data-admin-only')}
          ${navLink("admin:trust", "cert", "Firmen-CA", "admin-link", 'data-admin-only')}
          ${navLink("admin:ldap", "network", "LDAP", "admin-link", 'data-admin-only')}
          ${navLink("admin:smtp", "mail", "SMTP", "admin-link", 'data-admin-only')}
          ${navLink("admin:crypto", "shield", "Krypto &amp; Policy", "admin-link", 'data-admin-only')}
          ${navLink("admin:recovery", "lock", "Recovery &amp; Escrow", "admin-link", 'data-admin-only')}
          ${navLink("admin:apikeys", "key", "API-Keys", "admin-link", 'data-admin-only')}
          ${navLink("admin:platform", "building", "Tenants &amp; Migration", "admin-link platform-link", 'data-admin-only hidden')}
          ${navLink("admin:audit", "clipboard", "Audit", "admin-link")}
        </div>
      </nav>
      <div class="app-sidebar-foot">
        <p class="hint" id="info">Lade…</p>
        <p class="hint about-line" id="about"></p>
        <button class="btn-ghost btn-with-ico" type="button" id="out">${btnLabel("logout", "Logout")}</button>
      </div>
    </aside>

    <div class="app-main">
      <header class="app-topbar">
        <button type="button" class="menu-toggle btn-icon" id="menuToggle" aria-label="Menü">${icon("menu")}</button>
        <h1 id="pageTitle">Vault</h1>
        <div class="app-topbar-actions">
          <button type="button" class="btn-icon" data-theme-toggle aria-label="Dunkelmodus" title="Dunkelmodus">${icon("moon")}</button>
        </div>
      </header>
      <div class="offline-banner hint" id="offlineBanner" hidden role="status">Offline-Modus — nur Lesen. Änderungen sind erst nach Online-Anmeldung möglich.</div>

      <div class="app-content">
        <div id="lockOverlay" class="lock-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="lockTitle">
          <div class="lock-card">
            <h1 id="lockTitle">${icon("lock", "heading-ico")} Vault gesperrt</h1>
            <p class="lead">Idle-Timeout. Master-Passwort erneut eingeben (bleibt nur im Speicher).</p>
            <label for="lockMpw">Master-Passwort</label>
            <input id="lockMpw" type="password" autocomplete="current-password" />
            <div class="error" id="lockErr" hidden role="alert"></div>
            <div class="row"><button class="btn-accent btn-with-ico" type="button" id="lockUnlock">${btnLabel("unlock", "Entsperren")}</button></div>
          </div>
        </div>

        <div class="panel app-unlock-panel" id="unlock">
          <h1>${icon("unlock", "heading-ico")} Vault entsperren</h1>
          <p class="lead" id="unlockLead">Master-Passwort bleibt im Browser (Zero-Knowledge).</p>
          <p class="hint" id="offlineUnlockHint" hidden>Offline: nur Master-Passwort — kein Login und kein TOTP.</p>
          <label id="offlineSnapLabel" hidden for="offlineSnap">Gespeicherte Offline-Kopie</label>
          <select id="offlineSnap" hidden></select>
          <label>Master-Passwort</label><input id="mpw" type="password" autocomplete="current-password" />
          <div class="error" id="uerr" hidden></div>
          <div class="row"><button class="btn-accent btn-with-ico" type="button" id="ulock">${btnLabel("unlock", "Entsperren")}</button></div>
        </div>

        <div id="vaultui" hidden>
          <div class="app-tab active" data-pane="vault">
            <div class="vault-section active" data-vault="secrets">
              <div class="secrets-workspace">
                <div class="panel vault-chrome">
                  <div class="toolbar toolbar-compact">
                    <div>
                      <label><span class="label-with-ico">${icon("search", "label-ico")} Suche</span></label>
                      <input id="ssearch" type="search" placeholder="Titel, Tags, Benutzer, Gruppen…" />
                    </div>
                    <div>
                      <label>Tag</label>
                      <select id="stag"><option value="">Alle Tags</option></select>
                    </div>
                    <div class="secrets-view-wrap">
                      <label>Ansicht</label>
                      <div class="secrets-view-toggle" role="group" aria-label="Ansicht">
                        <button type="button" class="btn-icon" data-view="list" title="Liste" aria-label="Liste">${icon("layoutList")}</button>
                        <button type="button" class="btn-icon" data-view="table" title="Tabelle" aria-label="Tabelle">${icon("layoutTable")}</button>
                        <button type="button" class="btn-icon" data-view="tiles" title="Kacheln" aria-label="Kacheln">${icon("layoutGrid")}</button>
                      </div>
                    </div>
                  </div>
                  <div class="selection-bar selection-bar-compact" id="selBar">
                    <label class="inline"><input type="checkbox" id="selAllVisible" /> Sichtbare</label>
                    <span class="hint" id="selCount">0 ausgewählt</span>
                    <button class="btn-ghost btn-sm" type="button" id="selClear">Auswahl aufheben</button>
                    <button class="btn-ghost btn-sm" type="button" id="selAllLoaded">Alle geladenen</button>
                    <span class="hint" id="sCount"></span>
                  </div>
                  <div class="row row-compact">
                    <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sMore" hidden>${btnLabel("chevron", "Mehr laden")}</button>
                    <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sExportTv">${btnLabel("download", "Export TeamVault")}</button>
                    <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sExportJson">${btnLabel("download", "Export Bitwarden")}</button>
                    <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sExportCsv">${btnLabel("download", "Export CSV")}</button>
                    <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sExportBak">${btnLabel("lock", "Export verschlüsselt")}</button>
                  </div>
                </div>
                <div class="panel secrets-stage">
                  <div id="slist" class="list secrets-list"></div>
                </div>
              </div>
              <div class="secret-modal" id="sdetail" hidden role="dialog" aria-modal="true" aria-labelledby="dtitle">
                <div class="secret-modal-backdrop" id="sdetailBackdrop"></div>
                <div class="secret-modal-panel panel">
                  <div class="secret-modal-head">
                    <h1 id="dtitle">Secret</h1>
                    <div class="row row-compact">
                      <button class="btn-accent btn-sm btn-with-ico" type="button" id="dedit">${btnLabel("save", "Bearbeiten")}</button>
                      <button class="btn-ghost btn-sm" type="button" id="sdetailClose">Schließen</button>
                    </div>
                  </div>
                  <div id="dview">
                    <div id="dfields" class="secret-fields"></div>
                    <p class="hint" id="drec"></p>
                    <label>Teilen mit User</label>
                    <div class="row row-compact share-row">
                      <select id="shareto"></select>
                      <button class="btn-accent btn-sm btn-with-ico" type="button" id="share">${btnLabel("share", "Teilen")}</button>
                    </div>
                    <div id="groupShareBlock" hidden>
                      <label>Teilen mit Gruppe</label>
                      <div class="row row-compact share-row">
                        <select id="sharegroup"><option value="">— Gruppe wählen —</option></select>
                        <button class="btn-ghost btn-sm btn-with-ico" type="button" id="shareGroup">${btnLabel("users", "Gruppe teilen")}</button>
                      </div>
                      <p class="hint" id="groupShareHint" hidden></p>
                    </div>
                    <div class="row row-compact">
                      <button class="btn-ghost btn-sm btn-with-ico" type="button" id="revoke">${btnLabel("rotate", "Zugriff entziehen + rotieren")}</button>
                      <button class="btn-danger btn-sm btn-with-ico" type="button" id="sdel">${btnLabel("trash", "Löschen")}</button>
                      <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sExportOne">${btnLabel("download", "Export")}</button>
                    </div>
                  </div>
                  <div id="deditForm" hidden>
                    <label>Titel</label><input id="edtitle" />
                    <label>Tags</label><input id="edtags" placeholder="storage, prod (Komma)" />
                    <label>Benutzername</label><input id="eduser" autocomplete="off" />
                    <label>Passwort</label><input id="edpw" type="password" autocomplete="off" />
                    <label>Notizen</label><textarea id="ednotes" rows="3"></textarea>
                    <div class="row row-compact">
                      <button class="btn-accent btn-sm" type="button" id="dsave">Speichern</button>
                      <button class="btn-ghost btn-sm" type="button" id="dcancel">Abbrechen</button>
                    </div>
                  </div>
                  <div class="error" id="derr" hidden></div>
                </div>
              </div>
            </div>

            <div class="vault-section" data-vault="create">
              <div class="panel">
                <label>Titel</label><input id="stitle" />
                <label>Tags</label><input id="stagsIn" placeholder="storage, prod (Komma)" autocomplete="off" />
                <label>Benutzername</label><input id="suser" autocomplete="off" />
                <label>Passwort</label>
                <div class="row gen-row" style="margin-top:0.35rem">
                  <input id="spw" type="password" autocomplete="new-password" style="flex:1" />
                  <button class="btn-ghost btn-with-ico" type="button" id="spwShow">${btnLabel("eye", "Anzeigen")}</button>
                  <button class="btn-ghost btn-with-ico" type="button" id="spwGen">${btnLabel("spark", "Generator")}</button>
                </div>
                <div class="gen-opts hint">
                  Länge <input id="spwLen" type="number" min="12" max="64" value="20" style="width:4rem" />
                  <label class="inline"><input id="spwSym" type="checkbox" checked /> Symbole</label>
                </div>
                <div id="sextraSlots" class="extra-slots"></div>
                <div class="row extra-add-row">
                  <label class="inline">Feld hinzufügen
                    <select id="sextraAdd">
                      <option value="">— wählen —</option>
                      <option value="url">Website (URL)</option>
                      <option value="totp">TOTP-Seed</option>
                      <option value="notes">Notizen</option>
                      <option value="tags">Tags</option>
                      <option value="favorite">Favorit</option>
                      <option value="ssh_private_key">SSH Private Key</option>
                      <option value="ssh_public_key">SSH Public Key</option>
                      <option value="s3_access_key">S3 Access Key</option>
                      <option value="s3_secret_key">S3 Secret Key</option>
                      <option value="certificate">Zertifikat (PEM)</option>
                      <option value="text">Freitext</option>
                      <option value="secret">Geheimnis (Custom)</option>
                    </select>
                  </label>
                  <button class="btn-ghost" type="button" id="sextraAddBtn">Hinzufügen</button>
                </div>
                <label>Teilen mit Usern (optional)</label>
                <select id="screateUsers" multiple size="4"></select>
                <p class="hint">Strg/Cmd-Klick für Mehrfachauswahl. Nur onboardete User.</p>
                <div id="screateGroupsWrap" hidden>
                  <label>Gruppen teilen (optional)</label>
                  <select id="screateGroups" multiple size="3"></select>
                </div>
                <div class="error" id="serr" hidden></div>
                <div class="row"><button class="btn-accent btn-with-ico" type="button" id="screate">${btnLabel("save", "Speichern (clientseitig verschlüsselt)")}</button></div>
              </div>
            </div>

            <div class="vault-section" data-vault="import">
              <div class="panel">
                <p class="hint">Unterstützt: TeamVault JSON/.tvbak, Bitwarden JSON, KeePass XML, KeePassXC/Chrome/Firefox/LastPass/1Password-CSV, Proton Pass JSON, 1Password 1PUX (<code>export.data</code>). Parsing und Verschlüsselung nur im Browser.</p>
                <input id="simport" type="file" accept=".json,.csv,.xml,.tvbak,text/csv,application/json,text/xml" />
                <div id="simportPwWrap" hidden>
                  <label>Backup-Passwort</label>
                  <input id="simportPw" type="password" autocomplete="off" />
                  <div class="row">
                    <button class="btn-accent btn-with-ico" type="button" id="simportUnlock">${btnLabel("unlock", "Sicherung entsperren")}</button>
                  </div>
                </div>
                <div id="simportPreviewWrap" hidden>
                  <label class="inline"><input type="checkbox" id="simportAll" checked /> Alle Einträge</label>
                  <span class="hint" id="simportCount"></span>
                  <div class="import-preview-wrap">
                    <table class="secrets-table" id="simportPreview">
                      <thead><tr><th></th><th>Titel</th><th>Benutzer</th><th>URL</th><th>Tags</th></tr></thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
                <div class="row">
                  <button class="btn-ghost btn-with-ico" type="button" id="simportRun" disabled>${btnLabel("upload", "Auswahl importieren")}</button>
                  <span class="hint" id="simportHint"></span>
                </div>
                <div class="error" id="ierr" hidden></div>
                <div class="ok" id="iok" hidden></div>
              </div>
            </div>

            <div class="vault-section" data-vault="backup">
              <div class="panel">
                <h2>Verschlüsselte Sicherung</h2>
                <p class="hint">Alle Secrets, die Sie entschlüsseln können, als <code>.tvbak</code> (Argon2id + AES-GCM). Der Server sieht den Klartext nicht. Backup-Passwort mindestens 12 Zeichen — getrennt vom Master-Passwort wählen.</p>
                <label>Backup-Passwort</label>
                <input id="bak_pw" type="password" autocomplete="new-password" />
                <label>Wiederholen</label>
                <input id="bak_pw2" type="password" autocomplete="new-password" />
                <div class="row">
                  <button class="btn-accent btn-with-ico" type="button" id="bak_create">${btnLabel("download", "Sicherung herunterladen")}</button>
                </div>
                <h2>Wiederherstellen</h2>
                <p class="hint">TeamVault-Sicherung (<code>.tvbak</code>) oder Klartext-Export. Einträge werden als neue Secrets angelegt (kein Überschreiben bestehender IDs).</p>
                <input id="bak_file" type="file" accept=".tvbak,.json,application/json" />
                <label>Backup-Passwort (bei .tvbak)</label>
                <input id="bak_restore_pw" type="password" autocomplete="off" />
                <div class="row">
                  <button class="btn-ghost btn-with-ico" type="button" id="bak_restore">${btnLabel("upload", "Wiederherstellen")}</button>
                  <span class="hint" id="bak_hint"></span>
                </div>
                <div class="error" id="bak_err" hidden></div>
                <div class="ok" id="bak_ok" hidden></div>
              </div>
            </div>
          </div>

          <div class="app-tab" data-pane="account">
            <div class="panel">
              <p class="hint">TOTP und Passkey betreffen nur den Login — der Vault bleibt Master-Passwort-pflichtig.</p>
              <div class="row">
                <button class="btn-accent" type="button" id="totp">TOTP einrichten</button>
                <button class="btn-ghost" type="button" id="passkey">Passkeys</button>
              </div>
              <div id="totpbox" hidden>
                <p class="hint">otpauth-URL (kein externes QR/CDN):</p>
                <pre class="mono" id="otpurl"></pre>
                <div class="row">
                  <button class="btn-ghost" type="button" id="otpCopy">otpauth kopieren</button>
                  <button class="btn-ghost" type="button" id="otpReveal">Secret kurz anzeigen</button>
                </div>
                <p class="hint secret-reveal" id="otpSecret" hidden></p>
                <label>Code bestätigen</label><input id="code" inputmode="numeric" autocomplete="one-time-code" />
                <div class="row"><button class="btn-accent" type="button" id="en">Aktivieren</button></div>
                <div class="error" id="terr" hidden></div>
              </div>
              <div id="pkbox" hidden>
                <label>Name</label><input id="pkname" value="Mein Passkey" />
                <div id="pklist" class="list"></div>
                <div class="row"><button class="btn-accent" type="button" id="pkreg">Registrieren</button></div>
                <div class="error" id="pkerr" hidden></div>
              </div>
              <h2>Login-Passwort ändern</h2>
              <p class="hint">Nur bei lokalem Auth-Backend. LDAP-User ändern das Passwort in AD.</p>
              <label>Aktuelles Login-Passwort</label><input id="lpw_cur" type="password" autocomplete="current-password" />
              <label>Neues Login-Passwort (≥12)</label><input id="lpw_new" type="password" autocomplete="new-password" />
              <div class="row"><button class="btn-accent" type="button" id="lpw_save">Login-Passwort speichern</button></div>
              <h2>Master-Passwort ändern</h2>
              <p class="hint">Clientseitig: Private Key wird neu versiegelt; Server speichert nur Ciphertexte. Recovery-Kit / Escrow wird mit erneuert.</p>
              <label>Aktuelles Master-Passwort</label><input id="mpw_cur" type="password" autocomplete="current-password" />
              <label>Neues Master-Passwort</label><input id="mpw_new" type="password" autocomplete="new-password" />
              <label>Recovery-Kit speichern (bei user_kit)</label><input id="mpw_kit" type="text" readonly placeholder="wird erzeugt…" />
              <div class="row"><button class="btn-accent" type="button" id="mpw_save">Master-Passwort speichern</button></div>
              <h2>Offline-Vault auf diesem Gerät</h2>
              <p class="hint" id="offlineAccHint">Verschlüsselte Kopie für Offline-Lesen (30 Tage, nur Ciphertext). Schreiben bleibt online.</p>
              <p class="hint" id="offlineAccStatus">—</p>
              <label class="inline"><input id="offline_optin" type="checkbox" /> Offline-Kopie nach Entsperren aktualisieren</label>
              <div class="row">
                <button class="btn-ghost btn-sm" type="button" id="offline_sync">Jetzt synchronisieren</button>
                <button class="btn-ghost btn-sm" type="button" id="offline_wipe">Offline-Kopie löschen</button>
              </div>
              <div class="error" id="acc_err" hidden></div>
              <div class="ok" id="acc_ok" hidden></div>
            </div>
          </div>

          <div class="app-tab" data-pane="admin" id="adminPane" hidden>
            <div class="panel" id="admin">
              <div class="error" id="aerr" hidden></div>
              <p class="hint" id="overview"></p>
              <div id="adminFull">
                <div class="admin-section" data-admin-section="users">
                  <div id="ulist" class="list"></div>
                  <div class="hint" id="udisable_hint" hidden></div>
                  <h3 class="admin-subhead">Neuer User</h3>
                  <label>Username</label><input id="nuser" />
                  <label>Anzeigename</label><input id="ndisplay" />
                  <label>E-Mail</label><input id="nemail" type="email" autocomplete="off" />
                  <label>Passwort (≥12)</label><input id="npw" type="password" />
                  <div class="row"><button class="btn-accent" type="button" id="ucreate">User anlegen</button></div>
                </div>
                <div class="admin-section" data-admin-section="groups">
                  <div class="groups-workspace">
                    <aside class="groups-pool panel-inset">
                      <h3>User</h3>
                      <p class="hint">Aktive User in eine Gruppe ziehen.</p>
                      <div id="userPool" class="drag-pool"></div>
                    </aside>
                    <div class="groups-board">
                      <div class="groups-toolbar row">
                        <input id="gname" placeholder="Neue Gruppe…" />
                        <button class="btn-accent" type="button" id="gcreate">Gruppe anlegen</button>
                      </div>
                      <div id="glist" class="groups-grid"></div>
                    </div>
                  </div>
                  <div class="row"><button class="btn-ghost" type="button" id="ldap_sync">LDAP-Sync (Disable fehlende)</button></div>
                </div>
                <div id="userEditModal" class="admin-modal" hidden role="dialog" aria-modal="true" aria-labelledby="userEditTitle">
                  <div class="admin-modal-backdrop" id="userEditBackdrop"></div>
                  <div class="admin-modal-panel panel">
                    <div class="admin-modal-head">
                      <h2 id="userEditTitle">User bearbeiten</h2>
                      <button type="button" class="btn-ghost btn-sm" id="userEditClose">Schließen</button>
                    </div>
                    <p class="hint" id="userEditMeta"></p>
                    <label>Anzeigename</label><input id="ue_display" />
                    <label>E-Mail</label><input id="ue_email" type="email" autocomplete="off" />
                    <div id="ue_local_block">
                      <label>Neues Login-Passwort (optional, ≥12)</label><input id="ue_password" type="password" autocomplete="new-password" />
                    </div>
                    <fieldset class="role-fieldset">
                      <legend>Rollen</legend>
                      <label class="inline"><input type="checkbox" id="ue_role_member" value="member" /> member</label>
                      <label class="inline"><input type="checkbox" id="ue_role_admin" value="tenant_admin" /> tenant_admin</label>
                      <label class="inline"><input type="checkbox" id="ue_role_auditor" value="auditor" /> auditor</label>
                      <label class="inline" id="ue_role_plat_wrap"><input type="checkbox" id="ue_role_plat" value="platform_admin" /> platform_admin</label>
                    </fieldset>
                    <div class="error" id="ue_err" hidden></div>
                    <div class="row">
                      <button class="btn-accent" type="button" id="ue_save">Speichern</button>
                    </div>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="trust">
                  <p class="hint">Instanzweites Firmen-Root-Zertifikat (PEM). Gilt für LDAPS, SMTP und spätere TLS-Verbindungen (z. B. interne Dienste). Mehrere Zertifikate in einer Datei sind möglich (Root + Zwischen-CAs).</p>
                  <label>Firmen-Root-Zertifikat (PEM)</label>
                  <input id="trust_ca_file" type="file" accept=".pem,.crt,.cer,.txt,application/x-pem-file,application/x-x509-ca-cert" />
                  <textarea id="trust_ca_pem" rows="8" class="mono" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
                  <p class="hint" id="trust_ca_status"></p>
                  <div class="row">
                    <button class="btn-accent" type="button" id="trust_ca_save">CA speichern</button>
                    <button class="btn-ghost btn-sm" type="button" id="trust_ca_clear">Zertifikat entfernen</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="ldap">
                  <p class="hint">LDAP/AD nur für Login-Bind. Host muss zum Zertifikatsnamen (CN/SAN) passen. Die Firmen-CA liegt unter Administration → Firmen-CA.</p>
                  <label class="inline"><input id="ldap_en" type="checkbox" /> Aktiv</label>
                  <label>Host</label><input id="ldap_host" />
                  <label>Port</label><input id="ldap_port" type="number" placeholder="636 bei LDAPS" />
                  <label class="inline"><input id="ldap_tls" type="checkbox" checked /> LDAPS / TLS</label>
                  <label>Base DN</label><input id="ldap_base" />
                  <label>Bind DN</label><input id="ldap_bind" />
                  <label>Bind-Passwort</label><input id="ldap_pw" type="password" placeholder="unverändert lassen = behalten" />
                  <label>User-Filter</label><input id="ldap_filter" placeholder="(uid=%s)" />
                  <p class="hint" id="ldap_trust_hint"></p>
                  <label class="inline"><input id="ldap_skip_tls" type="checkbox" /> TLS-Zertifikatsfehler ignorieren</label>
                  <p class="hint">Unsicher: Signatur und Hostname werden nicht geprüft. Nur wenn keine Firmen-CA hinterlegt werden kann. Anschließend Test-Bind nutzen.</p>
                  <div class="row">
                    <button class="btn-accent" type="button" id="ldap_save">LDAP speichern</button>
                    <button class="btn-ghost" type="button" id="ldap_test">Test-Bind</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="smtp">
                  <p class="hint">SMTP-TLS nutzt die zentrale Firmen-CA (Administration → Firmen-CA).</p>
                  <label class="inline"><input id="mail_en" type="checkbox" /> Aktiv</label>
                  <label>Host</label><input id="mail_host" />
                  <label>Port</label><input id="mail_port" type="number" />
                  <label>From</label><input id="mail_from" />
                  <label>Username</label><input id="mail_user" />
                  <label>Passwort</label><input id="mail_pw" type="password" placeholder="unverändert lassen = behalten" />
                  <div class="row">
                    <button class="btn-accent" type="button" id="mail_save">Mail speichern</button>
                    <button class="btn-ghost" type="button" id="mail_test">SMTP testen</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="crypto">
                  <p class="hint">Argon2id-Presets (Vault-KDF):</p>
                  <div class="preset-row" id="presetRow"></div>
                  <label>Argon2 Memory (KiB)</label><input id="arg_mem" type="number" />
                  <label>Argon2 Time</label><input id="arg_time" type="number" />
                  <label>Argon2 Threads</label><input id="arg_threads" type="number" value="1" />
                  <label class="inline"><input id="totp_req" type="checkbox" /> TOTP Pflicht (Hinweis nach Login)</label>
                  <label class="inline"><input id="admin_env_only" type="checkbox" /> Admins: Secret-Liste nur mit Envelope</label>
                  <label class="inline"><input id="offline_cache" type="checkbox" checked /> Offline-Vault-Cache erlauben (Ciphertext auf Geräten)</label>
                  <div class="row">
                    <button class="btn-accent" type="button" id="crypto_save">Krypto speichern</button>
                    <button class="btn-ghost" type="button" id="policy_save">Policy speichern</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="recovery">
                  <p class="hint">Wechsel erzwingt Re-Onboarding aller User. Bestätigung: <code>REONBOARD</code></p>
                  <label>Modus</label>
                  <select id="rec_mode">
                    <option value="user_kit">User Recovery-Kit</option>
                    <option value="admin_escrow">Admin-Escrow</option>
                  </select>
                  <label class="inline"><input id="rec_escrow" type="checkbox" /> Escrow erlauben</label>
                  <label>Bestätigung</label><input id="rec_confirm" placeholder="REONBOARD" autocomplete="off" />
                  <div class="row"><button class="btn-danger" type="button" id="rec_save">Recovery-Modus ändern</button></div>
                  <h2>Escrow-Pubkey + Shamir (clientseitig)</h2>
                  <p class="hint">Privater Escrow-Key wird nur im Browser gesplittet (secrets.js). Server speichert nur den Public Key. Alternativ: <code>tvcli escrow-split</code>.</p>
                  <label>Shamir k</label><input id="shamir_k" type="number" value="3" />
                  <label>Shamir n</label><input id="shamir_n" type="number" value="5" />
                  <div class="ok" id="escrow_out" hidden></div>
                  <div class="row"><button class="btn-accent" type="button" id="escrow_gen">Escrow-Keypair + Shares</button></div>
                </div>
                <div class="admin-section" data-admin-section="apikeys">
                  <p class="hint">Scopes: <code>read</code> (GET allowlist), <code>vault</code> (Secret-Schreibaktionen), <code>admin</code> (/api/admin/*). User-Rollen gelten zusätzlich.</p>
                  <div id="klist" class="list"></div>
                  <label>Name</label><input id="kname" />
                  <label class="inline"><input id="kscope_read" type="checkbox" checked /> read</label>
                  <label class="inline"><input id="kscope_vault" type="checkbox" /> vault</label>
                  <label class="inline"><input id="kscope_admin" type="checkbox" /> admin</label>
                  <div class="row"><button class="btn-accent" type="button" id="kcreate">API-Key erzeugen</button></div>
                  <div class="ok" id="ktoken" hidden></div>
                </div>
                <div class="admin-section" data-admin-section="platform" id="plat" hidden>
                  <h2>Tenants (platform_admin)</h2>
                  <div id="tlist" class="list"></div>
                  <label>Name</label><input id="tname" />
                  <label>Slug</label><input id="tslug" />
                  <div class="row"><button class="btn-accent" type="button" id="tcreate">Tenant anlegen</button></div>
                  <h2>Storage-Migration</h2>
                  <p class="hint">Exportiert nur Ciphertext. Bestätigung: MIGRATE</p>
                  <label>Ziel-Backend</label>
                  <select id="mig_backend"><option value="json">json</option><option value="sqlite">sqlite</option></select>
                  <label>DSN / Pfad</label><input id="mig_dsn" placeholder="leer = data/vault-migrated.*" />
                  <label>Bestätigung</label><input id="mig_confirm" placeholder="MIGRATE" />
                  <div class="row"><button class="btn-danger" type="button" id="mig_go">Migrieren</button></div>
                  <h2>Instanz-Backup / Restore</h2>
                  <p class="hint">Snapshot enthält nur Ciphertext + Metadaten (Tenants, User, Gruppen, Secrets, Passkeys). Unlock-Keyfile und Recovery-Kits <strong>nicht</strong> in dieser Datei — separat sichern. Restore mit <code>RESTORE</code> ersetzt den gesamten Vault-Store. Danach neu anmelden, falls User-IDs abweichen.</p>
                  <div class="row">
                    <button class="btn-accent btn-with-ico" type="button" id="inst_bak_dl">${btnLabel("download", "Snapshot herunterladen")}</button>
                  </div>
                  <label>Snapshot-Datei</label>
                  <input id="inst_bak_file" type="file" accept=".json,application/json" />
                  <label>Bestätigung</label>
                  <input id="inst_bak_confirm" placeholder="RESTORE" autocomplete="off" />
                  <div class="row">
                    <button class="btn-danger" type="button" id="inst_bak_restore">Wiederherstellen</button>
                  </div>
                  <div class="ok" id="inst_bak_ok" hidden></div>
                </div>
              </div>
              <div class="admin-section" data-admin-section="audit">
                <div id="alist" class="list hint"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`);
  app.appendChild(n);
  const live = document.createElement("div");
  live.id = "a11yLive";
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  app.appendChild(live);
  let currentSecret = null;
  let currentSecretPayload = null;
  let currentSecretTitle = "";
  let totpSecretPlain = "";

  const NAV_TITLES = {
    "vault:mine": "Meine Secrets",
    "vault:shared": "Geteilt mit mir",
    "vault:create": "Neu anlegen",
    "vault:import": "Import",
    "vault:backup": "Sicherung",
    account: "Konto",
    "admin:users": "Benutzer",
    "admin:groups": "Gruppen",
    "admin:trust": "Firmen-CA",
    "admin:ldap": "LDAP",
    "admin:smtp": "SMTP",
    "admin:crypto": "Krypto & Policy",
    "admin:recovery": "Recovery & Escrow",
    "admin:apikeys": "API-Keys",
    "admin:platform": "Tenants & Migration",
    "admin:audit": "Audit",
  };

  function closeMobileNav() {
    n.querySelector("#appSidebar").classList.remove("open");
    n.querySelector("#sidebarBackdrop").classList.remove("open");
    const mt = n.querySelector("#menuToggle");
    if (mt) mt.setAttribute("aria-expanded", "false");
  }

  function offlineWriteNav(nav) {
    return nav === "vault:create" || nav === "vault:import" || nav === "vault:backup" || (nav && nav.startsWith("admin:"));
  }

  function applyOfflineReadOnlyUI() {
    if (!vault.offlineMode) return;
    const banner = n.querySelector("#offlineBanner");
    if (banner) banner.hidden = false;
    n.querySelectorAll(
      '.sidebar-link[data-nav="vault:create"], .sidebar-link[data-nav="vault:import"], .sidebar-link[data-nav="vault:backup"]'
    ).forEach((el) => {
      el.disabled = true;
      el.classList.add("disabled");
      el.title = "Nur online verfügbar";
    });
    const adminSec = n.querySelector("#navAdminSection");
    if (adminSec) adminSec.hidden = true;
    n.querySelectorAll("#sExportTv, #sExportJson, #sExportCsv, #sExportBak, #sMore").forEach((el) => {
      if (el) el.hidden = true;
    });
    const accHint = n.querySelector("#offlineAccHint");
    if (accHint) {
      accHint.textContent = "Im Offline-Modus nur Lesen. Online anmelden für Synchronisation und Einstellungen.";
    }
    const optIn = n.querySelector("#offline_optin");
    const syncBtn = n.querySelector("#offline_sync");
    const wipeBtn = n.querySelector("#offline_wipe");
    if (optIn) optIn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    if (wipeBtn) wipeBtn.disabled = false;
  }

  function updateOfflineAccountUI(snapshot) {
    const status = n.querySelector("#offlineAccStatus");
    const optIn = n.querySelector("#offline_optin");
    const hint = n.querySelector("#offlineAccHint");
    if (!status || !optIn) return;
    if (!TVOfflineStore?.isAvailable()) {
      status.textContent = "IndexedDB nicht verfügbar.";
      optIn.disabled = true;
      return;
    }
    if (!offlinePolicyAllowed()) {
      status.textContent = "Vom Administrator deaktiviert.";
      optIn.checked = false;
      optIn.disabled = true;
      if (hint) hint.textContent = "Offline-Cache ist für diesen Mandanten nicht erlaubt.";
      return;
    }
    optIn.disabled = vault.offlineMode;
    optIn.checked = TVOfflineStore.getOptIn();
    if (snapshot && !TVOfflineStore.isExpired(snapshot)) {
      const exp = snapshot.expires_at ? new Date(snapshot.expires_at).toLocaleString("de-DE") : "—";
      status.textContent = `Zuletzt synchronisiert: ${new Date(snapshot.synced_at).toLocaleString("de-DE")} · gültig bis ${exp} · ${snapshot.secrets?.length || 0} Secrets`;
    } else {
      status.textContent = "Keine gültige Offline-Kopie auf diesem Gerät.";
    }
  }

  function navigateTo(nav) {
    if (!vault.sk) return;
    if (vault.offlineMode && offlineWriteNav(nav)) {
      announceA11y("Nur online verfügbar");
      return;
    }
    n.querySelectorAll(".sidebar-link").forEach((b) => {
      const on = b.dataset.nav === nav;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    n.querySelector("#pageTitle").textContent = NAV_TITLES[nav] || "TeamVault";

    let pane = "vault";
    let vaultSec = null;
    let adminSec = null;
    if (nav === "account") {
      pane = "account";
    } else if (nav.startsWith("admin:")) {
      pane = "admin";
      adminSec = nav.slice("admin:".length);
    } else if (nav.startsWith("vault:")) {
      pane = "vault";
      vaultSec = nav.slice("vault:".length);
      if (vaultSec === "mine" || vaultSec === "shared") {
        vault.ownershipFilter = vaultSec;
        vaultSec = "secrets";
      }
    }

    n.querySelectorAll(".app-tab").forEach((p) => {
      p.classList.toggle("active", p.dataset.pane === pane);
    });
    if (pane === "vault") {
      n.querySelectorAll(".vault-section").forEach((s) => {
        s.classList.toggle("active", s.dataset.vault === vaultSec);
      });
      if (vaultSec === "secrets") paintSecretList();
    }
    if (pane === "admin") {
      n.querySelectorAll(".admin-section").forEach((s) => {
        s.classList.toggle("active", s.dataset.adminSection === adminSec);
      });
    }
    closeMobileNav();
    if (nav === "account") updateOfflineAccountUI(vault.offlineSnapshot);
  }

  const offlineUrlParam = new URLSearchParams(location.search).get("offline") === "1";

  async function populateOfflinePicker(snaps) {
    const sel = n.querySelector("#offlineSnap");
    const label = n.querySelector("#offlineSnapLabel");
    const hint = n.querySelector("#offlineUnlockHint");
    const lead = n.querySelector("#unlockLead");
    if (!sel || !snaps.length) return;
    vault.offlinePicker = true;
    if (hint) hint.hidden = false;
    if (lead) lead.hidden = true;
    sel.hidden = snaps.length <= 1;
    if (label) label.hidden = snaps.length <= 1;
    sel.innerHTML = snaps
      .map((s) => {
        const tenant = s.tenant_name || s.tenant_slug || s.tenant_id;
        const synced = s.synced_at ? new Date(s.synced_at).toLocaleString("de-DE") : "—";
        return `<option value="${s.key}">${s.username} · ${tenant} · ${synced}</option>`;
      })
      .join("");
    const pick = () => {
      const key = sel.value || snaps[0].key;
      vault.offlineSnapshot = snaps.find((s) => s.key === key) || snaps[0];
    };
    pick();
    sel.onchange = pick;
    n.querySelector("#info").textContent = formatOfflineSessionInfo(vault.offlineSnapshot);
  }

  async function initAppSession() {
    if (offlineUrlParam) {
      try {
        const snaps = await TVOfflineStore.listSnapshots({ validOnly: true });
        if (!snaps.length) {
          location.href = "/login";
          return;
        }
        await populateOfflinePicker(snaps);
        if (offlineUrlParam) history.replaceState(null, "", "/app");
        return;
      } catch (_) {
        location.href = "/login";
        return;
      }
    }
    try {
      const me = await api("/api/me");
      if (me.needs_vault_onboard) { location.href = "/onboard"; return; }
      vault.me = me;
      n.querySelector("#info").textContent = formatSessionInfo(me);
      try {
        vault.policy = await api("/api/policy/client");
        vault.idleMin = vault.policy.unlock_idle_minutes || 15;
      } catch (_) {}
    } catch (_) {
      try {
        const snaps = await TVOfflineStore.listSnapshots({ validOnly: true });
        if (!snaps.length) {
          location.href = "/login";
          return;
        }
        await populateOfflinePicker(snaps);
      } catch (e2) {
        location.href = "/login";
      }
    }
  }

  initAppSession();

  n.querySelector("#out").onclick = async () => {
    clearVaultKey();
    if (!vault.offlineMode) {
      try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) {}
    }
    vault.offlineMode = false;
    vault.offlineSnapshot = null;
    vault.offlinePicker = false;
    location.href = "/login";
  };

  n.querySelectorAll(".sidebar-link[data-nav]").forEach((btn) => {
    btn.onclick = () => navigateTo(btn.dataset.nav);
  });
  n.querySelector("#menuToggle").onclick = () => {
    n.querySelector("#appSidebar").classList.add("open");
    n.querySelector("#sidebarBackdrop").classList.add("open");
    n.querySelector("#menuToggle").setAttribute("aria-expanded", "true");
  };
  n.querySelector("#sidebarBackdrop").onclick = () => closeMobileNav();
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeMobileNav();
  });
  n.querySelector("#menuToggle").setAttribute("aria-expanded", "false");
  n.querySelector("[data-theme-toggle]").onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  };
  syncThemeToggles(document.documentElement.getAttribute("data-theme") || "light");

  n.querySelector("#offline_optin").onchange = () => {
    if (!TVOfflineStore?.isAvailable()) return;
    TVOfflineStore.setOptIn(n.querySelector("#offline_optin").checked);
  };
  n.querySelector("#offline_sync").onclick = async () => {
    const err = n.querySelector("#acc_err");
    const ok = n.querySelector("#acc_ok");
    err.hidden = true;
    ok.hidden = true;
    try {
      if (vault.offlineMode) throw new Error("Nur online verfügbar");
      if (!vault.sk) throw new Error("Vault zuerst entsperren");
      if (!offlinePolicyAllowed()) throw new Error("Offline-Cache vom Administrator deaktiviert");
      TVOfflineStore.setOptIn(true);
      n.querySelector("#offline_optin").checked = true;
      await syncOfflineSnapshot();
      ok.hidden = false;
      ok.textContent = "Offline-Kopie aktualisiert.";
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };
  n.querySelector("#offline_wipe").onclick = async () => {
    const err = n.querySelector("#acc_err");
    const ok = n.querySelector("#acc_ok");
    err.hidden = true;
    ok.hidden = true;
    try {
      if (!TVOfflineStore?.isAvailable()) throw new Error("IndexedDB nicht verfügbar");
      const tid = vault.me?.tenant_id || vault.offlineSnapshot?.tenant_id;
      const uid = vault.me?.user_id || vault.offlineSnapshot?.user_id;
      if (tid && uid) await TVOfflineStore.deleteSnapshot(tid, uid);
      vault.offlineSnapshot = null;
      updateOfflineAccountUI(null);
      ok.hidden = false;
      ok.textContent = "Offline-Kopie gelöscht.";
      if (vault.offlineMode) {
        clearVaultKey();
        location.href = "/login";
      }
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };

  n.querySelector("#totp").onclick = async () => {
    const box = n.querySelector("#totpbox"); box.hidden = false;
    const res = await api("/api/totp/setup", { method: "POST", body: "{}" });
    totpSecretPlain = res.secret || "";
    n.querySelector("#otpurl").textContent = res.otpauth_url || "";
    const sec = n.querySelector("#otpSecret");
    sec.hidden = true;
    sec.textContent = "";
    n.querySelector("#otpReveal").textContent = "Secret kurz anzeigen";
  };
  n.querySelector("#otpCopy").onclick = async (ev) => {
    await copyText(n.querySelector("#otpurl").textContent);
    flashCopy(ev.currentTarget);
  };
  n.querySelector("#otpReveal").onclick = (ev) => {
    const sec = n.querySelector("#otpSecret");
    if (sec.hidden) {
      sec.hidden = false;
      sec.textContent = "Secret: " + totpSecretPlain;
      ev.currentTarget.textContent = "Secret verbergen";
      setTimeout(() => {
        sec.hidden = true;
        sec.textContent = "";
        ev.currentTarget.textContent = "Secret kurz anzeigen";
      }, 15000);
    } else {
      sec.hidden = true;
      sec.textContent = "";
      ev.currentTarget.textContent = "Secret kurz anzeigen";
    }
  };
  n.querySelector("#passkey").onclick = async () => {
    n.querySelector("#pkbox").hidden = false;
    await refreshPasskeys();
  };
  async function refreshPasskeys() {
    const list = n.querySelector("#pklist");
    const creds = await api("/api/webauthn/credentials");
    list.innerHTML = creds.map((c) =>
      `<div class="list-row"><span>${c.name}</span><button class="btn-ghost" data-pkdel="${c.id}" type="button">Löschen</button></div>`
    ).join("") || "<p class='hint'>Keine Passkeys</p>";
    list.querySelectorAll("[data-pkdel]").forEach((btn) => {
      btn.onclick = async () => {
        await api("/api/webauthn/credentials/" + btn.dataset.pkdel, { method: "DELETE" });
        await refreshPasskeys();
      };
    });
  }
  n.querySelector("#pkreg").onclick = async () => {
    const err = n.querySelector("#pkerr"); err.hidden = true;
    try {
      if (!window.PublicKeyCredential) throw new Error("Passkeys nicht unterstützt");
      const begin = await api("/api/webauthn/register/begin", { method: "POST", body: "{}" });
      const cred = await navigator.credentials.create({
        publicKey: restorePublicKeyCreation(begin.publicKey),
      });
      await api("/api/webauthn/register/finish", {
        method: "POST",
        body: JSON.stringify({
          challenge_key: begin.challenge_key,
          name: n.querySelector("#pkname").value.trim() || "Passkey",
          credential: credentialToJSON(cred),
        }),
      });
      await refreshPasskeys();
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  n.querySelector("#en").onclick = async () => {
    try {
      await api("/api/totp/enable", { method: "POST", body: JSON.stringify({ code: n.querySelector("#code").value.trim() }) });
      totpSecretPlain = "";
      location.reload();
    } catch (e) {
      const terr = n.querySelector("#terr"); terr.hidden = false; terr.textContent = e.message;
    }
  };

  n.querySelector("#lpw_save").onclick = async () => {
    const err = n.querySelector("#acc_err"); const ok = n.querySelector("#acc_ok");
    err.hidden = true; ok.hidden = true;
    try {
      await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: n.querySelector("#lpw_cur").value,
          new_password: n.querySelector("#lpw_new").value,
        }),
      });
      n.querySelector("#lpw_cur").value = "";
      n.querySelector("#lpw_new").value = "";
      ok.hidden = false; ok.textContent = "Login-Passwort geändert.";
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };

  n.querySelector("#mpw_save").onclick = async () => {
    const err = n.querySelector("#acc_err"); const ok = n.querySelector("#acc_ok");
    err.hidden = true; ok.hidden = true;
    try {
      const cur = n.querySelector("#mpw_cur").value;
      const neu = n.querySelector("#mpw_new").value;
      if (!neu || neu.length < 8) throw new Error("Neues Master-Passwort zu kurz");
      const params = vault.params || await api("/api/vault/crypto-params");
      const keys = await api("/api/vault/keys");
      const sk = await TVCrypto.unlockPrivateKey(
        cur,
        TVCrypto.b64dec(keys.salt_b64),
        TVCrypto.b64dec(keys.encrypted_private_key_nonce_b64),
        TVCrypto.b64dec(keys.encrypted_private_key_b64),
        params
      );
      const sealed = await TVCrypto.sealPrivateKey(sk, neu, params);
      const body = {
        encrypted_private_key_b64: TVCrypto.b64enc(sealed.sealedPrivateKey),
        encrypted_private_key_nonce_b64: TVCrypto.b64enc(sealed.nonce),
        salt_b64: TVCrypto.b64enc(sealed.salt),
        argon2: params,
      };
      const mode = vault.me?.recovery_mode || "user_kit";
      if (mode === "admin_escrow") {
        const vs = await api("/api/vault/status");
        if (!vs.escrow_public_key_b64) throw new Error("Escrow-Pubkey nicht verfügbar — Admin muss Escrow konfigurieren");
        body.escrow_envelope_b64 = TVCrypto.b64enc(TVCrypto.sealForEscrow(sk, TVCrypto.b64dec(vs.escrow_public_key_b64)));
      } else {
        const kit = TVCrypto.randomKitSecret();
        const rec = await TVCrypto.sealWithRecoveryKit(sk, kit, params);
        body.encrypted_private_key_recovery_b64 = TVCrypto.b64enc(rec.sealed);
        body.recovery_nonce_b64 = TVCrypto.b64enc(rec.nonce);
        body.recovery_salt_b64 = TVCrypto.b64enc(rec.salt);
        n.querySelector("#mpw_kit").value = TVCrypto.b64enc(kit);
        kit.fill(0);
      }
      await api("/api/vault/change-master", { method: "POST", body: JSON.stringify(body) });
      sk.fill(0);
      if (vault.sk) vault.sk.fill(0);
      vault.sk = await TVCrypto.unlockPrivateKey(neu, sealed.salt, sealed.nonce, sealed.sealedPrivateKey, params);
      n.querySelector("#mpw_cur").value = "";
      n.querySelector("#mpw_new").value = "";
      ok.hidden = false;
      ok.textContent = mode === "user_kit"
        ? "Master-Passwort geändert. Recovery-Kit oben speichern (einmalig)."
        : "Master-Passwort geändert.";
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };

  async function ensureAllSecretsLoaded() {
    if (vault.offlineMode) return;
    while (vault.secretsCache.length < vault.secretsTotal) {
      await refreshSecrets(false);
    }
  }

  async function collectDecryptedExportItems(ids) {
    const want = ids && ids.length ? new Set(ids) : null;
    const items = [];
    for (const it of vault.secretsCache) {
      if (want && !want.has(it.id)) continue;
      if (!it.has_access || !it.envelope) continue;
      try {
        const dk = openDKFromEnvelope(it.envelope);
        const kv = it.envelope.key_version || it.key_version || 1;
        const title = it._title || await TVCrypto.decryptTitle(
          TVCrypto.b64dec(it.title_ciphertext_b64),
          TVCrypto.b64dec(it.title_nonce_b64),
          dk, kv
        );
        const det = await api("/api/secrets/" + it.id);
        const ddk = openDKFromEnvelope(det.envelope);
        const pt = await TVCrypto.decryptPayload(
          TVCrypto.b64dec(det.ciphertext_b64),
          TVCrypto.b64dec(det.nonce_b64),
          ddk, det.key_version || kv
        );
        ddk.fill(0); dk.fill(0);
        const payload = normalizeSecretPayload(JSON.parse(new TextDecoder().decode(pt)));
        items.push({ title, payload: mergeFolderIntoTags(payload, it.collection_id) });
      } catch (_) { /* skip undecryptable */ }
    }
    return items;
  }

  function downloadBlob(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function selectedExportIds() {
    const visible = filterVisibleSecrets();
    if (vault.selectedIds.size) {
      return visible.filter((it) => vault.selectedIds.has(it.id) && it.has_access).map((it) => it.id);
    }
    return visible.filter((it) => it.has_access).map((it) => it.id);
  }

  function confirmPlainExport(kind, count) {
    const scope = vault.selectedIds.size ? `${count} ausgewählte` : `${count} sichtbare`;
    return confirm(
      `Klartext-Export (${kind}) von ${scope} Secrets speichern? Die Datei enthält Passwörter im Klartext — sicher ablegen und danach löschen.`
    );
  }

  async function runPlainExport(format) {
    try {
      if (!window.TVVaultIO) throw new Error("Export-Modul nicht geladen");
      const ids = selectedExportIds();
      if (!ids.length) throw new Error("Keine Secrets zum Export");
      const label = format === "csv" ? "CSV" : format === "bitwarden" ? "Bitwarden-JSON" : "TeamVault-JSON";
      if (!confirmPlainExport(label, ids.length)) return;
      const items = await collectDecryptedExportItems(ids);
      if (format === "csv") {
        downloadBlob("teamvault-export.csv", TVVaultIO.toCSV(items), "text/csv");
      } else if (format === "bitwarden") {
        downloadBlob("teamvault-export.json", JSON.stringify(TVVaultIO.toBitwardenJSON(items), null, 2), "application/json");
      } else {
        downloadBlob("teamvault-export.json", JSON.stringify(TVVaultIO.toTeamVaultJSON(items), null, 2), "application/json");
      }
    } catch (e) { alert(e.message); }
  }

  async function runEncryptedExport(ids) {
    const pw = prompt("Backup-Passwort (mind. 12 Zeichen). Die Datei ist ohne dieses Passwort wertlos.");
    if (pw == null) return;
    if (pw.length < 12) throw new Error("Backup-Passwort mindestens 12 Zeichen");
    const items = await collectDecryptedExportItems(ids);
    if (!items.length) throw new Error("Keine Secrets zum Export");
    const wrapped = await TVVaultIO.wrapBackup(TVVaultIO.toTeamVaultJSON(items), pw, vault.params || {});
    downloadBlob("teamvault-backup.tvbak", JSON.stringify(wrapped, null, 2), "application/json");
  }

  n.querySelector("#sExportTv").onclick = () => runPlainExport("teamvault");
  n.querySelector("#sExportJson").onclick = () => runPlainExport("bitwarden");
  n.querySelector("#sExportCsv").onclick = () => runPlainExport("csv");
  n.querySelector("#sExportBak").onclick = async () => {
    try {
      const ids = selectedExportIds();
      if (!ids.length) throw new Error("Keine Secrets zum Export");
      if (!confirm(`Verschlüsselte Sicherung von ${ids.length} Secrets erzeugen?`)) return;
      await runEncryptedExport(ids);
    } catch (e) { alert(e.message); }
  };

  function updateSelectionBar() {
    const visible = filterVisibleSecrets();
    const nSel = visible.filter((it) => vault.selectedIds.has(it.id)).length;
    const countEl = n.querySelector("#selCount");
    if (countEl) countEl.textContent = nSel + " ausgewählt";
    const all = n.querySelector("#selAllVisible");
    if (all) all.checked = visible.length > 0 && nSel === visible.length;
  }

  function bindSecretCheckbox(cb, id) {
    cb.checked = vault.selectedIds.has(id);
    cb.onchange = () => {
      if (cb.checked) vault.selectedIds.add(id);
      else vault.selectedIds.delete(id);
      updateSelectionBar();
    };
  }

  n.querySelector("#selAllVisible").onchange = () => {
    const on = n.querySelector("#selAllVisible").checked;
    for (const it of filterVisibleSecrets()) {
      if (on) vault.selectedIds.add(it.id);
      else vault.selectedIds.delete(it.id);
    }
    paintSecretList();
  };
  n.querySelector("#selClear").onclick = () => {
    vault.selectedIds.clear();
    paintSecretList();
  };
  n.querySelector("#selAllLoaded").onclick = async () => {
    try {
      await ensureAllSecretsLoaded();
      for (const it of vault.secretsCache) {
        if (it.has_access) vault.selectedIds.add(it.id);
      }
      paintSecretList();
    } catch (e) { alert(e.message); }
  };

  async function syncOfflineSnapshot() {
    if (!global.TVOfflineStore?.isAvailable()) return;
    if (vault.offlineMode || !vault.sk || !vault.me) return;
    if (!offlinePolicyAllowed()) return;
    if (!TVOfflineStore.getOptIn()) return;
    const keys = await api("/api/vault/keys");
    const params = vault.params || (await api("/api/vault/crypto-params"));
    await ensureAllSecretsLoaded();
    const secrets = [];
    for (const it of vault.secretsCache) {
      if (!it.has_access || !it.envelope) continue;
      try {
        const det = await api("/api/secrets/" + it.id);
        secrets.push({
          id: it.id,
          title_ciphertext_b64: det.title_ciphertext_b64,
          title_nonce_b64: det.title_nonce_b64,
          ciphertext_b64: det.ciphertext_b64,
          nonce_b64: det.nonce_b64,
          key_version: det.key_version,
          envelope: det.envelope,
          created_by: it.created_by,
          created_by_username: det.created_by_username,
          shared_groups: det.shared_groups || it.shared_groups,
          recipients: det.recipients,
          has_access: true,
        });
      } catch (_) { /* skip */ }
    }
    const snap = TVOfflineStore.buildSnapshot({ me: vault.me, keys, params, secrets });
    await TVOfflineStore.putSnapshot(snap);
    vault.offlineSnapshot = snap;
    updateOfflineAccountUI(snap);
  }

  async function maybePromptOfflineOptIn() {
    if (!TVOfflineStore?.isAvailable() || !offlinePolicyAllowed()) return;
    if (TVOfflineStore.hasOptInChoice()) return;
    const ok = confirm(
      "Vault auf diesem Gerät auch ohne Netzwerk vorhalten?\n\n" +
        "Es werden nur verschlüsselte Daten lokal gespeichert (30 Tage). " +
        "Schreiben und Teilen bleiben nur online möglich."
    );
    TVOfflineStore.setOptIn(ok);
    if (ok) {
      try {
        await syncOfflineSnapshot();
      } catch (e) {
        console.warn("offline snapshot", e);
      }
    }
  }

  async function afterOfflineUnlock() {
    const snap = vault.offlineSnapshot;
    if (!snap) throw new Error("Keine Offline-Kopie");
    vault.offlineMode = true;
    vault.offlinePicker = false;
    vault.me = {
      user_id: snap.user_id,
      username: snap.username,
      tenant_id: snap.tenant_id,
      tenant_slug: snap.tenant_slug,
      tenant_name: snap.tenant_name,
      roles: [],
    };
    vault.idleMin = 15;
    bindIdleListeners();
    touchIdle();
    n.querySelector("#unlock").hidden = true;
    n.querySelector("#lockOverlay").hidden = true;
    n.querySelector("#vaultui").hidden = false;
    n.querySelector("#appSidebar").hidden = false;
    n.querySelector("#mpw").value = "";
    n.querySelector("#info").textContent = formatOfflineSessionInfo(snap);
    vault.secretsCache = (snap.secrets || []).map((it) => ({ ...it }));
    vault.secretsTotal = vault.secretsCache.length;
    vault.secretsOffset = vault.secretsCache.length;
    await decryptListTitles(vault.secretsCache);
    applyOfflineReadOnlyUI();
    updateOfflineAccountUI(snap);
    navigateTo("vault:mine");
    announceA11y("Offline-Modus — nur Lesen");
  }

  async function afterUnlock() {
    try {
      vault.me = await api("/api/me");
      n.querySelector("#info").textContent = formatSessionInfo(vault.me);
    } catch (_) {}
    try {
      const pol = await api("/api/policy/client");
      vault.policy = pol;
      vault.idleMin = pol.unlock_idle_minutes || 15;
    } catch (_) {}
    bindIdleListeners();
    touchIdle();
    n.querySelector("#unlock").hidden = true;
    n.querySelector("#lockOverlay").hidden = true;
    const lockOv = n.querySelector("#lockOverlay");
    if (lockOv && lockOv._focusTrap) {
      document.removeEventListener("keydown", lockOv._focusTrap);
      lockOv._focusTrap = null;
    }
    if (lockOv && lockOv._escLock) {
      document.removeEventListener("keydown", lockOv._escLock);
      lockOv._escLock = null;
    }
    n.querySelector("#vaultui").hidden = false;
    n.querySelector("#appSidebar").hidden = false;
    n.querySelector("#mpw").value = "";
    n.querySelector("#lockMpw").value = "";
    if (canSeeAdminNav()) {
      n.querySelector("#navAdminSection").hidden = false;
      n.querySelector("#adminPane").hidden = false;
      if (isAuditorOnly()) {
        n.querySelector("#adminFull").hidden = true;
        n.querySelectorAll("[data-admin-only]").forEach((el) => { el.hidden = true; });
      } else {
        n.querySelector("#adminFull").hidden = false;
        n.querySelectorAll("[data-admin-only]").forEach((el) => {
          if (el.classList.contains("platform-link")) return;
          el.hidden = false;
        });
      }
      try { await refreshAdmin(); } catch (e) { console.warn('refreshAdmin', e); }
    }
    await refreshGroupShareUI();
    await refreshSharePickers();
    vault.secretsCache = [];
    vault.secretsOffset = 0;
    await refreshSecrets(true);
    navigateTo("vault:mine");
    updateOfflineAccountUI(await TVOfflineStore.getSnapshot(vault.me?.tenant_id, vault.me?.user_id));
    maybePromptOfflineOptIn().then(() => {
      if (TVOfflineStore.getOptIn()) {
        syncOfflineSnapshot().catch((e) => console.warn("offline snapshot", e));
      }
    });
  }

  async function refreshGroupShareUI() {
    const block = n.querySelector("#groupShareBlock");
    const sel = n.querySelector("#sharegroup");
    const hint = n.querySelector("#groupShareHint");
    if (!block || !sel) return;
    try {
      vault.groups = await api("/api/groups");
    } catch (_) {
      vault.groups = [];
    }
    const groups = vault.groups || [];
    sel.innerHTML = `<option value="">— Gruppe wählen —</option>` +
      groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
    const canShare = isAdmin() || groups.length > 0;
    block.hidden = !canShare;
    if (hint) {
      if (canShare && !groups.length && isAdmin()) {
        hint.hidden = false;
        hint.textContent = "Noch keine Gruppen — unter Admin → Gruppen anlegen.";
      } else {
        hint.hidden = true;
        hint.textContent = "";
      }
    }
    const gWrap = n.querySelector("#screateGroupsWrap");
    const gSel = n.querySelector("#screateGroups");
    if (gWrap && gSel) {
      gWrap.hidden = !groups.length;
      if (groups.length) {
        gSel.innerHTML = groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
      }
    }
  }

  async function refreshSharePickers() {
    try {
      const pks = await api("/api/users/public-keys");
      const userSel = n.querySelector("#screateUsers");
      if (userSel) {
        userSel.innerHTML = pks
          .filter((p) => p.user_id !== vault.me?.user_id && p.onboarded !== false)
          .map((p) => `<option value="${p.user_id}" data-pk="${p.public_key_b64}">${p.username}</option>`)
          .join("");
      }
    } catch (_) {}
  }

  function closeSecretModal() {
    const panel = n.querySelector("#sdetail");
    if (panel) panel.hidden = true;
    document.body.classList.remove("secret-modal-open");
    const editForm = n.querySelector("#deditForm");
    const dview = n.querySelector("#dview");
    if (editForm) editForm.hidden = true;
    if (dview) dview.hidden = false;
    currentSecret = null;
    currentSecretPayload = null;
    currentSecretTitle = "";
  }

  n.querySelector("#sdetailClose").onclick = closeSecretModal;
  n.querySelector("#sdetailBackdrop").onclick = closeSecretModal;
  n.querySelector("#dcancel").onclick = () => {
    n.querySelector("#deditForm").hidden = true;
    n.querySelector("#dview").hidden = false;
  };
  n.querySelector("#dedit").onclick = () => {
    if (!currentSecret || !currentSecretPayload) return;
    n.querySelector("#edtitle").value = currentSecretTitle || "";
    n.querySelector("#eduser").value = currentSecretPayload.username || "";
    n.querySelector("#edpw").value = currentSecretPayload.password || "";
    n.querySelector("#edtags").value = (currentSecretPayload.tags || []).join(", ");
    n.querySelector("#ednotes").value = currentSecretPayload.notes || "";
    n.querySelector("#dview").hidden = true;
    n.querySelector("#deditForm").hidden = false;
  };
  n.querySelector("#dsave").onclick = async () => {
    const err = n.querySelector("#derr"); err.hidden = true;
    try {
      if (!currentSecret || !vault.sk) throw new Error("Kein Secret geladen");
      const title = n.querySelector("#edtitle").value.trim();
      if (!title) throw new Error("Titel erforderlich");
      const payload = normalizeSecretPayload({
        ...currentSecretPayload,
        username: n.querySelector("#eduser").value,
        password: n.querySelector("#edpw").value,
        tags: n.querySelector("#edtags").value.split(",").map((t) => t.trim()).filter(Boolean),
        notes: n.querySelector("#ednotes").value,
      });
      const kv = currentSecret.key_version;
      const dk = openDKFromEnvelope(currentSecret.envelope);
      const titleEnc = await TVCrypto.encryptTitle(title, dk, kv);
      const bodyEnc = await TVCrypto.encryptPayload(
        new TextEncoder().encode(JSON.stringify(payload)),
        dk, kv
      );
      dk.fill(0);
      await api("/api/secrets/" + currentSecret.id, {
        method: "PUT",
        body: JSON.stringify({
          title_ciphertext_b64: TVCrypto.b64enc(titleEnc.ciphertext),
          title_nonce_b64: TVCrypto.b64enc(titleEnc.nonce),
          ciphertext_b64: TVCrypto.b64enc(bodyEnc.ciphertext),
          nonce_b64: TVCrypto.b64enc(bodyEnc.nonce),
          key_version: kv,
        }),
      });
      n.querySelector("#deditForm").hidden = true;
      n.querySelector("#dview").hidden = false;
      await refreshSecrets(true);
      await openSecret(currentSecret.id);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#ulock").onclick = async () => {
    const err = n.querySelector("#uerr"); err.hidden = true;
    try {
      const mpw = n.querySelector("#mpw").value;
      if (vault.offlinePicker) {
        await unlockVault(mpw, { snapshot: vault.offlineSnapshot });
        await afterOfflineUnlock();
        return;
      }
      await unlockVault(mpw);
      await afterUnlock();
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  n.querySelector("#mpw").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") n.querySelector("#ulock").click();
  });

  n.querySelector("#lockUnlock").onclick = async () => {
    const err = n.querySelector("#lockErr"); err.hidden = true;
    try {
      const mpw = n.querySelector("#lockMpw").value;
      if (vault.offlineMode && vault.offlineSnapshot) {
        await unlockVault(mpw, { snapshot: vault.offlineSnapshot });
      } else {
        await unlockVault(mpw);
      }
      n.querySelector("#lockOverlay").hidden = true;
      touchIdle();
      n.querySelector("#lockMpw").value = "";
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  n.querySelector("#lockMpw").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") n.querySelector("#lockUnlock").click();
  });

  function syncViewToggle() {
    n.querySelectorAll("[data-view]").forEach((btn) => {
      const on = btn.dataset.view === vault.viewMode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setViewMode(mode) {
    if (mode !== "list" && mode !== "table" && mode !== "tiles") return;
    vault.viewMode = mode;
    try { localStorage.setItem("tv-secrets-view", mode); } catch (_) {}
    syncViewToggle();
    paintSecretList();
  }

  n.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = () => setViewMode(btn.dataset.view);
  });
  syncViewToggle();

  n.querySelector("#ssearch").oninput = () => {
    vault.searchQuery = n.querySelector("#ssearch").value.trim().toLowerCase();
    paintSecretList();
  };
  n.querySelector("#stag").onchange = () => {
    vault.tagFilter = n.querySelector("#stag").value;
    paintSecretList();
  };
  n.querySelector("#spwGen").onclick = () => {
    const len = Math.min(64, Math.max(12, parseInt(n.querySelector("#spwLen").value, 10) || 20));
    const symbols = n.querySelector("#spwSym").checked;
    n.querySelector("#spw").type = "text";
    n.querySelector("#spw").value = generatePassword(len, { symbols });
  };
  n.querySelector("#spwShow").onclick = () => {
    const inp = n.querySelector("#spw");
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    n.querySelector("#spwShow").innerHTML = btnLabel("eye", show ? "Verbergen" : "Anzeigen");
  };

  function createSlotHasType(type) {
    return !!n.querySelector(`#sextraSlots [data-slot-type="${type}"]`);
  }

  function addCreateSlot(type) {
    const def = EXTRA_ADD_OPTIONS.find((o) => o.type === type);
    if (!def) return;
    if (def.singleton && createSlotHasType(type)) {
      throw new Error(def.label + " ist bereits hinzugefügt");
    }
    const slots = n.querySelector("#sextraSlots");
    const id = newExtraId();
    const row = document.createElement("div");
    row.className = "extra-slot";
    row.dataset.slotType = type;
    row.dataset.slotId = id;
    const label = def.label;
    let body = "";
    if (type === "url") {
      body = `<label>Website (URL)</label><input type="url" class="slot-val" placeholder="https://…" />`;
    } else if (type === "totp") {
      body = `<label>TOTP-Seed (base32 oder otpauth://)</label><input class="slot-val" autocomplete="off" />`;
    } else if (type === "notes") {
      body = `<label>Notizen</label><textarea class="slot-val" rows="3"></textarea>`;
    } else if (type === "tags") {
      body = `<label>Tags (Komma)</label><input class="slot-val" placeholder="vpn, prod" />`;
    } else if (type === "favorite") {
      body = `<label class="inline"><input type="checkbox" class="slot-fav" /> Favorit</label>`;
    } else if (type === "text" || type === "secret") {
      const inpType = type === "secret" ? "password" : "text";
      body = `<label>Bezeichnung</label><input class="slot-label" value="${label.replace(/"/g, "&quot;")}" />
        <label>Wert</label><input type="${inpType}" class="slot-val" autocomplete="off" />`;
    } else {
      const multiline = isMultilineExtraType(type);
      const secret = isSecretExtraType(type);
      body = `<label>${label}</label>`;
      if (multiline) {
        body += `<textarea class="slot-val mono" rows="4" autocomplete="off"></textarea>`;
      } else {
        body += `<input type="${secret ? "password" : "text"}" class="slot-val" autocomplete="off" />`;
      }
      if (extraSupportsFile(type)) {
        body += `<div class="row gen-row"><input type="file" class="slot-file" accept=".pem,.crt,.cer,.key,.pub,.txt,text/plain" />
          <span class="hint slot-file-hint"></span></div>`;
      }
    }
    row.innerHTML = body + `<div class="row"><button type="button" class="btn-ghost slot-remove">Entfernen</button></div>`;
    row.querySelector(".slot-remove").onclick = () => row.remove();
    const fileInp = row.querySelector(".slot-file");
    if (fileInp) {
      fileInp.onchange = async () => {
        const f = fileInp.files && fileInp.files[0];
        if (!f) return;
        const text = await f.text();
        row.querySelector(".slot-val").value = text;
        const hint = row.querySelector(".slot-file-hint");
        if (hint) hint.textContent = f.name + " geladen";
      };
    }
    slots.appendChild(row);
  }

  function collectCreatePayload() {
    const payload = {
      username: n.querySelector("#suser").value,
      password: n.querySelector("#spw").value,
      urls: [],
      notes: "",
      totp_seed: "",
      tags: [],
      favorite: false,
      extra: [],
    };
    n.querySelectorAll("#sextraSlots .extra-slot").forEach((row) => {
      const type = row.dataset.slotType;
      if (type === "url") {
        const u = (row.querySelector(".slot-val")?.value || "").trim();
        if (u) payload.urls.push(u);
        return;
      }
      if (type === "totp") {
        payload.totp_seed = (row.querySelector(".slot-val")?.value || "").trim();
        return;
      }
      if (type === "notes") {
        payload.notes = row.querySelector(".slot-val")?.value || "";
        return;
      }
      if (type === "tags") {
        payload.tags = mergeTags(payload.tags, parseTagsInput(row.querySelector(".slot-val")?.value));
        return;
      }
      if (type === "favorite") {
        payload.favorite = !!row.querySelector(".slot-fav")?.checked;
        return;
      }
      const def = EXTRA_ADD_OPTIONS.find((o) => o.type === type);
      const labelInp = row.querySelector(".slot-label");
      const label = (labelInp?.value || def?.label || type).trim() || type;
      const value = row.querySelector(".slot-val")?.value || "";
      payload.extra.push({ id: row.dataset.slotId || newExtraId(), type, label, value });
    });
    payload.tags = mergeTags(payload.tags, parseTagsInput(n.querySelector("#stagsIn")?.value));
    return payload;
  }

  function resetCreateForm() {
    n.querySelector("#stitle").value = "";
    n.querySelector("#suser").value = "";
    n.querySelector("#spw").value = "";
    n.querySelector("#spw").type = "password";
    n.querySelector("#stagsIn").value = "";
    n.querySelector("#sextraSlots").innerHTML = "";
    n.querySelector("#sextraAdd").value = "";
    n.querySelector("#spwShow").innerHTML = btnLabel("eye", "Anzeigen");
  }

  n.querySelector("#sextraAddBtn").onclick = () => {
    const err = n.querySelector("#serr");
    err.hidden = true;
    try {
      const type = n.querySelector("#sextraAdd").value;
      if (!type) throw new Error("Feldtyp wählen");
      addCreateSlot(type);
      n.querySelector("#sextraAdd").value = "";
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };

  let importPending = [];
  let importEncryptedRaw = null;

  function resetImportUi() {
    importPending = [];
    importEncryptedRaw = null;
    n.querySelector("#simportRun").disabled = true;
    n.querySelector("#simportPreviewWrap").hidden = true;
    n.querySelector("#simportPwWrap").hidden = true;
    n.querySelector("#simportHint").textContent = "";
    n.querySelector("#simportPreview tbody").innerHTML = "";
  }

  function renderImportPreview(items) {
    const wrap = n.querySelector("#simportPreviewWrap");
    const tbody = n.querySelector("#simportPreview tbody");
    tbody.innerHTML = "";
    items.forEach((it, i) => {
      const tr = el(`<tr>
        <td><input type="checkbox" class="imp-check" checked data-i="${i}" /></td>
        <td></td><td></td><td class="muted"></td><td class="muted"></td>
      </tr>`);
      tr.children[1].textContent = it.title || "Import";
      tr.children[2].textContent = it.username || "—";
      tr.children[3].textContent = it.url || (it.urls && it.urls[0]) || "—";
      tr.children[4].textContent = importItemTags(it).join(", ") || "—";
      tbody.appendChild(tr);
    });
    wrap.hidden = items.length === 0;
    n.querySelector("#simportAll").checked = true;
    n.querySelector("#simportCount").textContent = items.length + " Einträge";
    n.querySelector("#simportRun").disabled = items.length === 0;
  }

  n.querySelector("#simportAll").onchange = () => {
    const on = n.querySelector("#simportAll").checked;
    n.querySelectorAll(".imp-check").forEach((cb) => { cb.checked = on; });
  };

  n.querySelector("#simport").onchange = async () => {
    const err = n.querySelector("#ierr"); err.hidden = true;
    n.querySelector("#iok").hidden = true;
    resetImportUi();
    const file = n.querySelector("#simport").files?.[0];
    if (!file) return;
    try {
      if (!window.TVImport) throw new Error("Import-Modul nicht geladen");
      const text = await file.text();
      const parsed = TVImport.detectAndParse(file.name, text);
      if (parsed.encrypted) {
        importEncryptedRaw = parsed.raw;
        n.querySelector("#simportPwWrap").hidden = false;
        n.querySelector("#simportHint").textContent = "Verschlüsselte Sicherung — Passwort eingeben";
        return;
      }
      importPending = parsed.items || [];
      n.querySelector("#simportHint").textContent =
        `${parsed.format}: ${importPending.length} Einträge erkannt`;
      renderImportPreview(importPending);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#simportUnlock").onclick = async () => {
    const err = n.querySelector("#ierr"); err.hidden = true;
    try {
      if (!importEncryptedRaw) throw new Error("Keine Sicherung geladen");
      const pw = n.querySelector("#simportPw").value;
      const data = await TVVaultIO.unwrapBackup(importEncryptedRaw, pw);
      importPending = (data.items || []).map((it) => TVImport.normalizeItem(it));
      n.querySelector("#simportPwWrap").hidden = true;
      n.querySelector("#simportHint").textContent = `teamvault-backup: ${importPending.length} Einträge`;
      renderImportPreview(importPending);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  async function postEncryptedSecret(title, payload, shareOpts) {
    const kv = 1;
    const dk = TVCrypto.generateDataKey();
    const titleEnc = await TVCrypto.encryptTitle(title, dk, kv);
    const bodyEnc = await TVCrypto.encryptPayload(
      new TextEncoder().encode(JSON.stringify(payload)),
      dk,
      kv
    );
    const meKeys = await api("/api/vault/keys");
    const envelopes = [];
    const seen = new Set();
    const addEnv = (uid, pkB64) => {
      if (!uid || seen.has(uid) || !pkB64) return;
      envelopes.push(TVCrypto.envelopeToAPI(
        uid,
        TVCrypto.sealDataKeyForRecipient(dk, TVCrypto.b64dec(pkB64), kv)
      ));
      seen.add(uid);
    };
    addEnv(vault.me.user_id, meKeys.public_key_b64);
    const userSel = n.querySelector("#screateUsers");
    if (userSel && shareOpts !== false) {
      for (const opt of userSel.selectedOptions) {
        addEnv(opt.value, opt.dataset.pk);
      }
    }
    const gSel = n.querySelector("#screateGroups");
    if (gSel && shareOpts !== false) {
      for (const opt of gSel.selectedOptions) {
        const pks = await api("/api/groups/" + encodeURIComponent(opt.value) + "/member-keys");
        for (const p of pks) addEnv(p.user_id, p.public_key_b64);
      }
    }
    dk.fill(0);
    const body = {
      title_ciphertext_b64: TVCrypto.b64enc(titleEnc.ciphertext),
      title_nonce_b64: TVCrypto.b64enc(titleEnc.nonce),
      ciphertext_b64: TVCrypto.b64enc(bodyEnc.ciphertext),
      nonce_b64: TVCrypto.b64enc(bodyEnc.nonce),
      key_version: kv,
      envelopes,
    };
    await api("/api/secrets", { method: "POST", body: JSON.stringify(body) });
  }

  async function importNormalizedItems(items, hintEl, okEl, errEl) {
    errEl.hidden = true;
    okEl.hidden = true;
    if (!items.length) return;
    let done = 0;
    let failed = 0;
    if (!vault.sk) throw new Error("Vault gesperrt");
    for (const it of items) {
      if (hintEl) hintEl.textContent = `Importiere ${done + 1}/${items.length}…`;
      try {
        await postEncryptedSecret(
          it.title,
          normalizeSecretPayload({
            username: it.username || "",
            password: it.password || "",
            notes: it.notes || "",
            url: it.url || "",
            urls: it.urls || [],
            totp_seed: it.totp_seed || "",
            tags: importItemTags(it),
            favorite: !!it.favorite,
            extra: it.extra || [],
          })
        );
        done++;
      } catch {
        failed++;
      }
      it.password = "";
      it.totp_seed = "";
      it.notes = "";
    }
    if (hintEl) hintEl.textContent = "";
    okEl.hidden = false;
    okEl.textContent = failed
      ? `${done} importiert, ${failed} fehlgeschlagen`
      : `${done} Einträge importiert`;
    await refreshSecrets(true);
  }

  n.querySelector("#simportRun").onclick = async () => {
    const err = n.querySelector("#ierr");
    const ok = n.querySelector("#iok");
    try {
      const checks = [...n.querySelectorAll(".imp-check")];
      const items = checks.length
        ? checks.filter((cb) => cb.checked).map((cb) => importPending[Number(cb.dataset.i)]).filter(Boolean)
        : importPending.slice();
      if (!items.length) throw new Error("Keine Einträge ausgewählt");
      n.querySelector("#simportRun").disabled = true;
      await importNormalizedItems(items, n.querySelector("#simportHint"), ok, err);
      n.querySelector("#simport").value = "";
      resetImportUi();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
      n.querySelector("#simportRun").disabled = importPending.length === 0;
    }
  };

  n.querySelector("#bak_create").onclick = async () => {
    const err = n.querySelector("#bak_err");
    const ok = n.querySelector("#bak_ok");
    err.hidden = true; ok.hidden = true;
    try {
      const pw = n.querySelector("#bak_pw").value;
      const pw2 = n.querySelector("#bak_pw2").value;
      if (pw !== pw2) throw new Error("Passwörter stimmen nicht überein");
      await ensureAllSecretsLoaded();
      const ids = vault.secretsCache.filter((it) => it.has_access).map((it) => it.id);
      if (!ids.length) throw new Error("Keine Secrets zum Sichern");
      const items = await collectDecryptedExportItems(ids);
      const wrapped = await TVVaultIO.wrapBackup(TVVaultIO.toTeamVaultJSON(items), pw, vault.params || {});
      downloadBlob("teamvault-backup.tvbak", JSON.stringify(wrapped, null, 2), "application/json");
      n.querySelector("#bak_pw").value = "";
      n.querySelector("#bak_pw2").value = "";
      ok.hidden = false;
      ok.textContent = `${items.length} Secrets gesichert (verschlüsselt). Datei und Passwort getrennt aufbewahren.`;
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#bak_restore").onclick = async () => {
    const err = n.querySelector("#bak_err");
    const ok = n.querySelector("#bak_ok");
    const hint = n.querySelector("#bak_hint");
    err.hidden = true; ok.hidden = true;
    try {
      const file = n.querySelector("#bak_file").files?.[0];
      if (!file) throw new Error("Datei wählen");
      const parsed = TVImport.detectAndParse(file.name, await file.text());
      let items = parsed.items || [];
      if (parsed.encrypted) {
        const data = await TVVaultIO.unwrapBackup(parsed.raw, n.querySelector("#bak_restore_pw").value);
        items = (data.items || []).map((it) => TVImport.normalizeItem(it));
      }
      if (!items.length) throw new Error("Keine Einträge in der Datei");
      if (!confirm(`${items.length} Secrets wiederherstellen? Bestehende Einträge bleiben erhalten.`)) return;
      await importNormalizedItems(items, hint, ok, err);
      n.querySelector("#bak_file").value = "";
      n.querySelector("#bak_restore_pw").value = "";
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  function updateTagOptions() {
    const sel = n.querySelector("#stag");
    if (!sel) return;
    const cur = vault.tagFilter;
    const tags = [...new Set(vault.secretsCache.flatMap((s) => s._tags || []).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">Alle Tags</option>` + tags.map((t) =>
      `<option value="${escHtml(t).replace(/"/g, "&quot;")}">${escHtml(t)}</option>`
    ).join("");
    sel.value = tags.includes(cur) ? cur : "";
    if (sel.value !== cur) vault.tagFilter = sel.value;
  }

  function needsSecretMeta(it) {
    return !it._metaLoaded && it.has_access;
  }

  function matchesOwnership(it) {
    const me = vault.me?.user_id;
    if (!it.has_access || !me) return false;
    const mine = (it.created_by || "") === me;
    return vault.ownershipFilter === "shared" ? !mine : mine;
  }

  function filterVisibleSecrets() {
    const q = vault.searchQuery;
    const tag = vault.tagFilter;
    return vault.secretsCache.filter((it) => {
      if (!matchesOwnership(it)) return false;
      if (tag && !(it._tags || []).includes(tag)) return false;
      if (!q) return true;
      const title = (it._title || "").toLowerCase();
      const user = (it._username || "").toLowerCase();
      const tags = (it._tags || []).join(" ").toLowerCase();
      const creator = (it.created_by_username || "").toLowerCase();
      const groups = (it.shared_groups || []).join(" ").toLowerCase();
      return title.includes(q) || user.includes(q) || tags.includes(q) ||
        creator.includes(q) || groups.includes(q) ||
        (it.id || "").toLowerCase().includes(q);
    });
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function enrichSecretMeta(it) {
    if (it._metaLoaded) return;
    if (!it.has_access || !it.envelope || !vault.sk) return;
    try {
      const det = await api("/api/secrets/" + it.id);
      const dk = openDKFromEnvelope(det.envelope);
      const kv = det.key_version || it.envelope.key_version || 1;
      const pt = await TVCrypto.decryptPayload(
        TVCrypto.b64dec(det.ciphertext_b64),
        TVCrypto.b64dec(det.nonce_b64),
        dk, kv
      );
      dk.fill(0);
      const payload = normalizeSecretPayload(JSON.parse(new TextDecoder().decode(pt)));
      it._username = payload.username || "";
      it._tags = payload.tags || [];
      it._favorite = !!payload.favorite;
      it._url = (payload.urls && payload.urls[0]) || "";
      it._metaLoaded = true;
    } catch {
      it._username = "";
      it._tags = [];
      it._favorite = false;
      it._url = "";
      it._metaLoaded = true;
    }
  }

  function secretTitleLabel(it) {
    if (it._title) return it._title;
    return it.id + (it.has_access ? " (Titel n.v.)" : " · kein Zugriff");
  }

  function paintSecretList() {
    const list = n.querySelector("#slist");
    if (!list) return;
    list.innerHTML = "";
    list.className = "list secrets-list secrets-view-" + vault.viewMode;

    const enrichThenRepaint = (pending) => {
      list.innerHTML = `<p class="hint">Lade Details…</p>`;
      mapPool(pending, 4, enrichSecretMeta).then(() => {
        updateTagOptions();
        paintSecretList();
      });
    };

    if (vault.tagFilter || vault.searchQuery) {
      const pending = vault.secretsCache.filter(needsSecretMeta);
      if (pending.length) {
        enrichThenRepaint(pending);
        return;
      }
    }

    const visible = filterVisibleSecrets();

    const pendingVisible = visible.filter(needsSecretMeta);
    if (pendingVisible.length) {
      enrichThenRepaint(pendingVisible);
      return;
    }

    if (!visible.length) {
      const empty = vault.ownershipFilter === "shared"
        ? "Keine geteilten Secrets."
        : "Noch keine eigenen Secrets.";
      list.innerHTML = `<p class="hint">${empty}</p>`;
    } else if (vault.viewMode === "table") {
      const table = el(`<table class="secrets-table"><thead><tr>
        <th class="st-check"></th><th>Titel</th><th>Benutzer</th><th>Tags</th><th>Gruppen</th><th></th><th></th>
      </tr></thead><tbody></tbody></table>`);
      const tbody = table.querySelector("tbody");
      for (const it of visible) {
        const tr = el(`<tr>
          <td class="st-check"><input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} /></td>
          <td class="st-title"></td>
          <td class="st-user">${escHtml(it._username || "—")}</td>
          <td class="st-tags"></td>
          <td class="st-groups muted">${escHtml((it.shared_groups || []).join(", ") || "—")}</td>
          <td class="st-fav">${it._favorite ? icon("star", "fav-ico") : ""}</td>
          <td class="st-act"><button type="button" class="btn-ghost btn-with-ico btn-sm">${btnLabel("open", "Öffnen")}</button></td>
        </tr>`);
        bindSecretCheckbox(tr.querySelector(".sec-check"), it.id);
        const titleCell = tr.querySelector(".st-title");
        titleCell.appendChild(document.createTextNode(secretTitleLabel(it)));
        const tagsCell = tr.querySelector(".st-tags");
        if (it._tags && it._tags.length) {
          tagsCell.innerHTML = `<span class="tags">${it._tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join("")}</span>`;
        } else {
          tagsCell.textContent = "—";
        }
        tr.querySelector("button").onclick = () => openSecret(it.id);
        tbody.appendChild(tr);
      }
      list.appendChild(table);
    } else if (vault.viewMode === "tiles") {
      const grid = el(`<div class="secrets-tiles"></div>`);
      for (const it of visible) {
        const tile = el(`<article class="secret-tile">
          <div class="secret-tile-head">
            <input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} />
            <span class="list-row-ico" aria-hidden="true">${icon("key")}</span>
            ${it._favorite ? `<span class="fav-mark" title="Favorit">${icon("star", "fav-ico")}</span>` : ""}
          </div>
          <h3 class="secret-tile-title"></h3>
          <p class="secret-tile-meta hint"></p>
          <div class="secret-tile-tags"></div>
          <button type="button" class="btn-ghost btn-with-ico btn-sm">${btnLabel("open", "Öffnen")}</button>
        </article>`);
        bindSecretCheckbox(tile.querySelector(".sec-check"), it.id);
        tile.querySelector(".secret-tile-title").textContent = secretTitleLabel(it);
        const bits = [];
        if (it._username) bits.push(it._username);
        if (it.shared_groups && it.shared_groups.length) bits.push(it.shared_groups.join(", "));
        if (it._url) bits.push(it._url);
        tile.querySelector(".secret-tile-meta").textContent = bits.join(" · ") || "—";
        const tagsEl = tile.querySelector(".secret-tile-tags");
        if (it._tags && it._tags.length) {
          tagsEl.innerHTML = `<span class="tags">${it._tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join("")}</span>`;
        }
        tile.querySelector("button").onclick = () => openSecret(it.id);
        grid.appendChild(tile);
      }
      list.appendChild(grid);
    } else {
      for (const it of visible) {
        const row = el(`<div class="list-row">
          <input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} />
          <span class="list-row-main"></span>
          <button class="btn-ghost btn-with-ico" type="button">${btnLabel("open", "Öffnen")}</button>
        </div>`);
        bindSecretCheckbox(row.querySelector(".sec-check"), it.id);
        const span = row.querySelector(".list-row-main");
        const lead = `<span class="list-row-ico" aria-hidden="true">${icon(it.has_access ? "key" : "lock")}</span>`;
        span.innerHTML = lead;
        span.appendChild(document.createTextNode(
          secretTitleLabel(it) +
          (it._username ? ` · ${it._username}` : "") +
          (it.shared_groups && it.shared_groups.length ? ` · ${it.shared_groups.join(", ")}` : "") +
          (it._tags && it._tags.length ? ` · #${it._tags.join(", #")}` : "")
        ));
        row.querySelector("button").onclick = () => openSecret(it.id);
        list.appendChild(row);
      }
    }

    const scopeLabel = vault.ownershipFilter === "shared" ? "geteilt" : "eigene";
    n.querySelector("#sCount").textContent =
      `${visible.length} ${scopeLabel} · ${vault.secretsCache.length} geladen · ${vault.secretsTotal} gesamt`;
    n.querySelector("#sMore").hidden = vault.secretsCache.length >= vault.secretsTotal;
    updateTagOptions();
    updateSelectionBar();
  }

  async function decryptListTitles(items) {
    await mapPool(items, 4, async (it) => {
      if (!it.has_access || !vault.sk || !it.envelope) {
        it._title = "";
        return;
      }
      try {
        const dk = openDKFromEnvelope(it.envelope);
        const kv = it.envelope.key_version || it.key_version || 1;
        it._title = await TVCrypto.decryptTitle(
          TVCrypto.b64dec(it.title_ciphertext_b64),
          TVCrypto.b64dec(it.title_nonce_b64),
          dk,
          kv
        );
        dk.fill(0);
      } catch {
        it._title = "";
      }
    });
  }

  async function refreshSecrets(reset) {
    if (vault.offlineMode) {
      if (reset) {
        vault.secretsCache = (vault.offlineSnapshot?.secrets || []).map((it) => ({ ...it }));
        vault.secretsTotal = vault.secretsCache.length;
        vault.secretsOffset = vault.secretsCache.length;
        await decryptListTitles(vault.secretsCache);
      }
      paintSecretList();
      return;
    }
    if (reset) {
      vault.secretsCache = [];
      vault.secretsOffset = 0;
    }
    const data = normalizeSecretsList(
      await api(`/api/secrets?limit=${vault.pageLimit}&offset=${vault.secretsOffset}`)
    );
    vault.secretsTotal = data.total;
    const page = data.items;
    await decryptListTitles(page);
    vault.secretsCache = vault.secretsCache.concat(page);
    vault.secretsOffset = vault.secretsCache.length;
    updateTagOptions();
    paintSecretList();
  }

  n.querySelector("#sMore").onclick = async () => {
    await refreshSecrets(false);
  };

  async function openSecret(id) {
    const err = n.querySelector("#derr"); err.hidden = true;
    const panel = n.querySelector("#sdetail");
    panel.hidden = false;
    n.querySelector("#deditForm").hidden = true;
    n.querySelector("#dview").hidden = false;
    document.body.classList.add("secret-modal-open");
    if (vault.totpTimer) {
      clearInterval(vault.totpTimer);
      vault.totpTimer = null;
    }
    ["#dedit", "#share", "#revoke", "#sdel", "#sExportOne"].forEach((sel) => {
      const el = n.querySelector(sel);
      if (el) el.hidden = false;
    });
    const shareRows = n.querySelectorAll(".share-row");
    shareRows.forEach((row) => { row.hidden = false; });
    try {
      let det;
      if (vault.offlineMode && vault.offlineSnapshot) {
        det = (vault.offlineSnapshot.secrets || []).find((s) => s.id === id);
        if (!det) throw new Error("Secret nicht in Offline-Kopie");
      } else {
        det = await api("/api/secrets/" + id);
      }
      currentSecret = det;
      const dk = openDKFromEnvelope(det.envelope);
      const kv = det.key_version;
      const title = await TVCrypto.decryptTitle(
        TVCrypto.b64dec(det.title_ciphertext_b64),
        TVCrypto.b64dec(det.title_nonce_b64),
        dk, kv
      );
      const pt = await TVCrypto.decryptPayload(
        TVCrypto.b64dec(det.ciphertext_b64),
        TVCrypto.b64dec(det.nonce_b64),
        dk, kv
      );
      const payload = normalizeSecretPayload(JSON.parse(new TextDecoder().decode(pt)));
      dk.fill(0);
      currentSecretPayload = payload;
      currentSecretTitle = title;
      n.querySelector("#dtitle").textContent = (payload.favorite ? "★ " : "") + title;
      const tags = payload.tags;
      const fields = n.querySelector("#dfields");
      const totpSeed = payload.totp_seed || "";
      let html =
        fieldRow("Benutzer", payload.username || "") +
        fieldRow("Passwort", payload.password || "", { mask: true });
      payload.urls.forEach((u, i) => {
        html += fieldRow(payload.urls.length > 1 ? `Website ${i + 1}` : "Website", u);
      });
      if (totpSeed) {
        html += `<div class="secret-field totp-live" id="dtotpLive">
              <div class="sf-label">TOTP</div>
              <div class="sf-value mono"><span id="dtotpCode">······</span>
                <span class="hint" id="dtotpLeft"></span></div>
              <button type="button" class="copy-btn" id="dtotpCopy">${btnLabel("copy", "Kopieren")}</button>
            </div>`;
        html += fieldRow("TOTP-Seed", totpSeed, { mask: true });
      }
      if (payload.notes) html += fieldRow("Notizen", payload.notes, { multiline: true });
      if (tags.length) {
        html += `<div class="secret-field"><div class="sf-label">Tags</div><div class="sf-value"><div class="tags">${
          tags.map((t) => `<span class="tag">${String(t).replace(/</g, "")}</span>`).join("")
        }</div></div><span></span></div>`;
      }
      if (payload.favorite) html += fieldRow("Favorit", "ja", { copy: false });
      payload.extra.forEach((ex) => {
        const multiline = isMultilineExtraType(ex.type);
        const mask = isSecretExtraType(ex.type);
        const dl = extraSupportsFile(ex.type);
        html += fieldRow(ex.label || ex.type, ex.value || "", {
          mask,
          multiline,
          download: dl,
          filename: (ex.label || ex.type || "download").replace(/\s+/g, "_") + ".txt",
        });
      });
      fields.innerHTML = html;
      fields.querySelectorAll(".copy-btn[data-copy]").forEach((btn) => {
        btn.onclick = async () => {
          await copyText(decodeURIComponent(btn.dataset.copy));
          flashCopy(btn);
        };
      });
      fields.querySelectorAll(".copy-btn[data-download]").forEach((btn) => {
        btn.onclick = () => {
          const text = decodeURIComponent(btn.dataset.download);
          const name = decodeURIComponent(btn.dataset.dlname || "download.txt");
          downloadText(name, text);
          flashCopy(btn);
        };
      });
      const pwField = fields.querySelectorAll(".secret-field")[1];
      if (pwField && payload.password) {
        const val = pwField.querySelector(".sf-value");
        const actions = pwField.querySelector(".sf-actions") || pwField;
        const reveal = document.createElement("button");
        reveal.type = "button";
        reveal.className = "copy-btn";
        reveal.innerHTML = btnLabel("eye", "Anzeigen");
        let shown = false;
        reveal.onclick = () => {
          shown = !shown;
          val.textContent = shown ? payload.password : "••••••••";
          reveal.innerHTML = btnLabel("eye", shown ? "Verbergen" : "Anzeigen");
        };
        actions.appendChild(reveal);
      }
      fields.querySelectorAll(".secret-field").forEach((sf) => {
        if (!sf.querySelector(".sf-value.masked")) return;
        const label = sf.querySelector(".sf-label")?.textContent || "";
        if (label === "Passwort" || label === "Benutzer") return;
        const valEl = sf.querySelector(".sf-value");
        const btn = sf.querySelector(".copy-btn[data-copy]");
        if (!btn || !valEl) return;
        const raw = decodeURIComponent(btn.dataset.copy || "");
        if (!raw) return;
        const reveal = document.createElement("button");
        reveal.type = "button";
        reveal.className = "copy-btn";
        reveal.innerHTML = btnLabel("eye", "Anzeigen");
        let shown = false;
        reveal.onclick = () => {
          shown = !shown;
          valEl.textContent = shown ? raw : "••••••••";
          reveal.innerHTML = btnLabel("eye", shown ? "Verbergen" : "Anzeigen");
        };
        (sf.querySelector(".sf-actions") || sf).appendChild(reveal);
      });
      if (totpSeed) {
        const codeEl = fields.querySelector("#dtotpCode");
        const leftEl = fields.querySelector("#dtotpLeft");
        const copyBtn = fields.querySelector("#dtotpCopy");
        let lastCode = "";
        const tick = async () => {
          try {
            lastCode = await totpNow(totpSeed);
            if (codeEl) codeEl.textContent = lastCode || "—";
            if (leftEl) leftEl.textContent = lastCode ? ` · ${totpSecondsLeft()}s` : "";
          } catch {
            if (codeEl) codeEl.textContent = "—";
          }
        };
        await tick();
        vault.totpTimer = setInterval(tick, 1000);
        if (copyBtn) {
          copyBtn.onclick = async () => {
            if (!lastCode) return;
            await copyText(lastCode);
            flashCopy(copyBtn);
          };
        }
      }
      const groupHint = (det.shared_groups || currentSecret?.shared_groups || []).join(", ");
      n.querySelector("#drec").textContent =
        "Empfänger: " + (det.recipients || []).join(", ") +
        " · v" + kv +
        (groupHint ? " · Gruppen: " + groupHint : "");
      const editBtn = n.querySelector("#dedit");
      const shareBtn = n.querySelector("#share");
      const revokeBtn = n.querySelector("#revoke");
      const delBtn = n.querySelector("#sdel");
      const exportOne = n.querySelector("#sExportOne");
      const shareRow = shareBtn?.closest(".share-row");
      const groupBlock = n.querySelector("#groupShareBlock");
      const offlineDetail = !!vault.offlineMode;
      if (editBtn) editBtn.hidden = offlineDetail;
      if (shareBtn) shareBtn.hidden = offlineDetail;
      if (revokeBtn) revokeBtn.hidden = offlineDetail;
      if (delBtn) delBtn.hidden = offlineDetail;
      if (shareRow && offlineDetail) shareRow.hidden = true;
      if (groupBlock && offlineDetail) groupBlock.hidden = true;
      if (exportOne) exportOne.hidden = offlineDetail;
      if (!offlineDetail) {
        const pks = await api("/api/users/public-keys");
        const sel = n.querySelector("#shareto");
        sel.innerHTML = pks.filter((p) => !(det.recipients || []).includes(p.user_id))
          .map((p) => `<option value="${p.user_id}" data-pk="${p.public_key_b64}">${p.username}</option>`).join("");
        await refreshGroupShareUI();
      }
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  }

  n.querySelector("#screate").onclick = async () => {
    const err = n.querySelector("#serr"); err.hidden = true;
    try {
      const title = n.querySelector("#stitle").value.trim();
      if (!title) throw new Error("Titel erforderlich");
      const payload = collectCreatePayload();
      await postEncryptedSecret(title, payload);
      resetCreateForm();
      await refreshSecrets(true);
      navigateTo("vault:mine");
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#share").onclick = async () => {
    const err = n.querySelector("#derr"); err.hidden = true;
    try {
      const sel = n.querySelector("#shareto");
      const opt = sel.selectedOptions[0];
      if (!opt) throw new Error("Kein Empfänger");
      const dk = openDKFromEnvelope(currentSecret.envelope);
      const env = TVCrypto.sealDataKeyForRecipient(dk, TVCrypto.b64dec(opt.dataset.pk), currentSecret.key_version);
      dk.fill(0);
      await api("/api/secrets/" + currentSecret.id + "/share", {
        method: "POST",
        body: JSON.stringify({ envelopes: [TVCrypto.envelopeToAPI(opt.value, env)] }),
      });
      await openSecret(currentSecret.id);
      await refreshSecrets(true);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#shareGroup").onclick = async () => {
    const err = n.querySelector("#derr"); err.hidden = true;
    try {
      const gid = n.querySelector("#sharegroup").value;
      if (!gid) throw new Error("Keine Gruppe gewählt");
      const pks = await api("/api/secrets/" + currentSecret.id + "/group-member-keys?group_id=" + encodeURIComponent(gid));
      if (!pks.length) throw new Error("Keine onboardeten Gruppenmitglieder");
      const dk = openDKFromEnvelope(currentSecret.envelope);
      const envelopes = pks.map((p) =>
        TVCrypto.envelopeToAPI(
          p.user_id,
          TVCrypto.sealDataKeyForRecipient(dk, TVCrypto.b64dec(p.public_key_b64), currentSecret.key_version)
        )
      );
      dk.fill(0);
      await api("/api/secrets/" + currentSecret.id + "/share-group", {
        method: "POST",
        body: JSON.stringify({ group_id: gid, envelopes }),
      });
      await openSecret(currentSecret.id);
      await refreshSecrets(true);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#revoke").onclick = async () => {
    const err = n.querySelector("#derr"); err.hidden = true;
    try {
      const drop = prompt("User-ID entfernen (danach Pflicht-Rotation):");
      if (!drop) return;
      const keep = (currentSecret.recipients || []).filter((id) => id !== drop);
      if (!keep.includes(vault.me.user_id)) keep.push(vault.me.user_id);
      const oldDk = openDKFromEnvelope(currentSecret.envelope);
      const kv = currentSecret.key_version;
      const title = await TVCrypto.decryptTitle(
        TVCrypto.b64dec(currentSecret.title_ciphertext_b64),
        TVCrypto.b64dec(currentSecret.title_nonce_b64),
        oldDk, kv
      );
      const pt = await TVCrypto.decryptPayload(
        TVCrypto.b64dec(currentSecret.ciphertext_b64),
        TVCrypto.b64dec(currentSecret.nonce_b64),
        oldDk, kv
      );
      oldDk.fill(0);
      const newKv = kv + 1;
      const newDk = TVCrypto.generateDataKey();
      const titleEnc = await TVCrypto.encryptTitle(title, newDk, newKv);
      const bodyEnc = await TVCrypto.encryptPayload(pt, newDk, newKv);
      const pks = await api("/api/users/public-keys");
      const byId = Object.fromEntries(pks.map((p) => [p.user_id, p.public_key_b64]));
      const envelopes = keep.map((uid) => {
        if (!byId[uid]) throw new Error("Pubkey fehlt: " + uid);
        return TVCrypto.envelopeToAPI(uid, TVCrypto.sealDataKeyForRecipient(newDk, TVCrypto.b64dec(byId[uid]), newKv));
      });
      newDk.fill(0);
      await api("/api/secrets/" + currentSecret.id + "/rotate", {
        method: "POST",
        body: JSON.stringify({
          title_ciphertext_b64: TVCrypto.b64enc(titleEnc.ciphertext),
          title_nonce_b64: TVCrypto.b64enc(titleEnc.nonce),
          ciphertext_b64: TVCrypto.b64enc(bodyEnc.ciphertext),
          nonce_b64: TVCrypto.b64enc(bodyEnc.nonce),
          key_version: newKv,
          envelopes,
        }),
      });
      await openSecret(currentSecret.id);
      await refreshSecrets(true);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  n.querySelector("#sExportOne").onclick = async () => {
    if (!currentSecret) return;
    try {
      const fmt = (prompt("Format: json, bitwarden, csv oder backup", "json") || "").trim().toLowerCase();
      if (!fmt) return;
      const ids = [currentSecret.id];
      if (fmt === "backup") {
        await runEncryptedExport(ids);
        return;
      }
      if (!["json", "bitwarden", "csv"].includes(fmt)) throw new Error("Unbekanntes Format");
      if (!confirmPlainExport(fmt, 1)) return;
      const items = await collectDecryptedExportItems(ids);
      if (!items.length) throw new Error("Secret nicht entschlüsselbar");
      if (fmt === "csv") {
        downloadBlob("teamvault-secret.csv", TVVaultIO.toCSV(items), "text/csv");
      } else if (fmt === "bitwarden") {
        downloadBlob("teamvault-secret.json", JSON.stringify(TVVaultIO.toBitwardenJSON(items), null, 2), "application/json");
      } else {
        downloadBlob("teamvault-secret.json", JSON.stringify(TVVaultIO.toTeamVaultJSON(items), null, 2), "application/json");
      }
    } catch (e) { alert(e.message); }
  };

  n.querySelector("#sdel").onclick = async () => {
    if (!confirm("Secret löschen?")) return;
    await api("/api/secrets/" + currentSecret.id, { method: "DELETE" });
    closeSecretModal();
    document.body.classList.remove("secret-modal-open");
    await refreshSecrets(true);
  };

  let editingUser = null;
  let groupsDnDBusy = false;

  function parseUserRoles(rolesJson) {
    try {
      const r = JSON.parse(rolesJson || "[]");
      return Array.isArray(r) ? r : [];
    } catch (_) {
      return [];
    }
  }

  function formatUserRoles(rolesJson) {
    const r = parseUserRoles(rolesJson);
    return r.length ? r.join(", ") : "member";
  }

  function closeUserEditor() {
    editingUser = null;
    const modal = n.querySelector("#userEditModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("admin-modal-open");
  }

  function openUserEditor(user) {
    editingUser = user;
    const modal = n.querySelector("#userEditModal");
    if (!modal) return;
    n.querySelector("#userEditTitle").textContent = `User: ${user.username}`;
    n.querySelector("#userEditMeta").textContent =
      `${user.status}${user.onboarded ? " · onboarded" : ""} · ${user.auth_backend}`;
    n.querySelector("#ue_display").value = user.display_name || "";
    n.querySelector("#ue_email").value = user.email || "";
    n.querySelector("#ue_password").value = "";
    const roles = parseUserRoles(user.roles);
    n.querySelector("#ue_role_member").checked = roles.includes("member");
    n.querySelector("#ue_role_admin").checked = roles.includes("tenant_admin");
    n.querySelector("#ue_role_auditor").checked = roles.includes("auditor");
    n.querySelector("#ue_role_plat").checked = roles.includes("platform_admin");
    const platWrap = n.querySelector("#ue_role_plat_wrap");
    if (platWrap) {
      platWrap.hidden = !(vault.me?.roles || []).includes("platform_admin");
    }
    const localBlock = n.querySelector("#ue_local_block");
    if (localBlock) localBlock.hidden = user.auth_backend !== "local";
    n.querySelector("#ue_err").hidden = true;
    modal.hidden = false;
    document.body.classList.add("admin-modal-open");
  }

  function readDragPayload(ev) {
    try {
      return JSON.parse(ev.dataTransfer.getData("text/plain") || "{}");
    } catch (_) {
      return {};
    }
  }

  function wireDragUser(el, uid, username, fromGid) {
    el.draggable = true;
    el.dataset.uid = uid;
    el.dataset.username = username;
    if (fromGid) el.dataset.gid = fromGid;
    el.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ uid, fromGid: fromGid || "" }));
      ev.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  }

  async function groupsMemberAdd(gid, uid) {
    await api("/api/admin/groups/" + encodeURIComponent(gid) + "/members", {
      method: "POST",
      body: JSON.stringify({ user_id: uid }),
    });
  }

  async function groupsMemberRemove(gid, uid) {
    await api("/api/admin/groups/" + encodeURIComponent(gid) + "/members/" + encodeURIComponent(uid), {
      method: "DELETE",
    });
  }

  async function handleGroupDrop(gid, payload) {
    if (groupsDnDBusy || !payload.uid) return;
    groupsDnDBusy = true;
    const errEl = n.querySelector("#aerr");
    try {
      if (payload.fromGid && payload.fromGid === gid) return;
      await groupsMemberAdd(gid, payload.uid);
      await refreshAdmin();
      await refreshSharePickers();
    } catch (e) {
      if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
    } finally {
      groupsDnDBusy = false;
    }
  }

  async function handlePoolDrop(payload) {
    if (groupsDnDBusy || !payload.uid || !payload.fromGid) return;
    groupsDnDBusy = true;
    const errEl = n.querySelector("#aerr");
    try {
      await groupsMemberRemove(payload.fromGid, payload.uid);
      await refreshAdmin();
      await refreshSharePickers();
    } catch (e) {
      if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
    } finally {
      groupsDnDBusy = false;
    }
  }

  function wireDropZone(zone, onDrop) {
    zone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", (ev) => {
      if (!zone.contains(ev.relatedTarget)) zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      zone.classList.remove("drag-over");
      const payload = readDragPayload(ev);
      await onDrop(payload);
    });
  }

  function paintGroupsWorkspace(users, groups) {
    const pool = n.querySelector("#userPool");
    const glist = n.querySelector("#glist");
    if (!pool || !glist) return;

    pool.innerHTML = "";
    users.filter((u) => u.status !== "disabled").forEach((u) => {
      const chip = document.createElement("div");
      chip.className = "drag-user";
      chip.textContent = u.display_name || u.username;
      wireDragUser(chip, u.id, u.username, "");
      pool.appendChild(chip);
    });
    wireDropZone(pool, handlePoolDrop);

    if (!groups.length) {
      glist.innerHTML = "<p class='hint'>Noch keine Gruppen — oben anlegen.</p>";
      return;
    }

    glist.innerHTML = groups.map((g) => {
      const members = (g.members || []).map((m) => {
        const uid = typeof m === "string" ? m : m.user_id;
        const un = typeof m === "string" ? m : (m.username || m.user_id);
        return `<div class="drag-user in-group" data-uid="${escHtml(uid)}" data-gid="${escHtml(g.id)}" data-username="${escHtml(un)}">${escHtml(un)}</div>`;
      }).join("");
      return `<div class="group-card" data-gid="${escHtml(g.id)}">
        <div class="group-card-head">
          <input class="group-name" value="${escHtml(g.name)}" data-gid="${escHtml(g.id)}" aria-label="Gruppenname" />
          <button type="button" class="btn-ghost btn-sm group-del" data-gid="${escHtml(g.id)}">Löschen</button>
        </div>
        <input class="group-desc" placeholder="Beschreibung (optional)" value="${escHtml(g.description || "")}" data-gid="${escHtml(g.id)}" aria-label="Beschreibung" />
        <div class="group-drop" data-gid="${escHtml(g.id)}">
          ${members || '<span class="hint group-drop-hint">User hierher ziehen</span>'}
        </div>
      </div>`;
    }).join("");

    glist.querySelectorAll(".drag-user.in-group").forEach((el) => {
      wireDragUser(el, el.dataset.uid, el.dataset.username, el.dataset.gid);
    });
    glist.querySelectorAll(".group-drop").forEach((zone) => {
      wireDropZone(zone, (payload) => handleGroupDrop(zone.dataset.gid, payload));
    });
    glist.querySelectorAll(".group-del").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Gruppe wirklich löschen? Mitglieder-Zuordnungen werden entfernt.")) return;
        const errEl = n.querySelector("#aerr");
        try {
          await api("/api/admin/groups/" + encodeURIComponent(btn.dataset.gid), { method: "DELETE" });
          await refreshAdmin();
          await refreshSharePickers();
        } catch (e) {
          if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
        }
      };
    });
    const saveGroupField = async (gid, name, description) => {
      const errEl = n.querySelector("#aerr");
      try {
        await api("/api/admin/groups/" + encodeURIComponent(gid), {
          method: "PUT",
          body: JSON.stringify({ name: name.trim(), description: description.trim() }),
        });
        await refreshAdmin();
        await refreshSharePickers();
      } catch (e) {
        if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
      }
    };
    glist.querySelectorAll(".group-name").forEach((inp) => {
      inp.addEventListener("change", () => {
        const card = inp.closest(".group-card");
        const desc = card?.querySelector(".group-desc")?.value || "";
        if (inp.value.trim()) saveGroupField(inp.dataset.gid, inp.value, desc);
      });
    });
    glist.querySelectorAll(".group-desc").forEach((inp) => {
      inp.addEventListener("change", () => {
        const card = inp.closest(".group-card");
        const name = card?.querySelector(".group-name")?.value || "";
        if (name.trim()) saveGroupField(inp.dataset.gid, name, inp.value);
      });
    });
  }

  function paintUsersList(users) {
    n.querySelector("#ulist").innerHTML = users.map((u) =>
      `<div class="list-row user-row">
        <div class="list-row-main">
          <strong>${escHtml(u.username)}</strong>
          <span class="hint">${escHtml(u.display_name || "—")} · ${escHtml(u.status)}${u.onboarded ? " · onboarded" : ""} · ${escHtml(u.auth_backend)} · ${escHtml(formatUserRoles(u.roles))}</span>
        </div>
        <div class="row user-row-actions">
          <button class="btn-ghost btn-sm" data-edit-user="${escHtml(u.id)}" type="button">Bearbeiten</button>
          ${u.status !== "disabled" ? `<button class="btn-ghost btn-sm" data-dis="${escHtml(u.id)}" type="button">Disable</button>` : ""}
        </div>
      </div>`
    ).join("") || "<p class='hint'>Keine User</p>";
    n.querySelector("#ulist").querySelectorAll("[data-edit-user]").forEach((btn) => {
      btn.onclick = () => {
        const u = users.find((x) => x.id === btn.dataset.editUser);
        if (u) openUserEditor(u);
      };
    });
    n.querySelector("#ulist").querySelectorAll("[data-dis]").forEach((btn) => {
      btn.onclick = async () => {
        const uid = btn.dataset.dis;
        await api("/api/admin/users/" + uid + "/disable", { method: "POST", body: "{}" });
        const hint = n.querySelector("#udisable_hint");
        try {
          const secrets = await api("/api/admin/users/" + uid + "/accessible-secrets");
          hint.hidden = false;
          if (secrets.length) {
            hint.textContent = "User deaktiviert. Secrets mit Envelope rotieren (Revoke + Rotate): " +
              secrets.map((s) => s.id).join(", ");
          } else {
            hint.textContent = "User deaktiviert. Keine Secrets mit Envelope — Rotation nicht nötig.";
          }
        } catch (_) {
          hint.hidden = false;
          hint.textContent = "User deaktiviert. Bitte Secrets mit dessen Zugriff manuell rotieren (Zero-Knowledge — kein Auto-Rotate).";
        }
        await refreshAdmin();
      };
    });
  }

  const userEditModal = n.querySelector("#userEditModal");
  if (userEditModal) {
    n.querySelector("#userEditClose").onclick = closeUserEditor;
    n.querySelector("#userEditBackdrop").onclick = closeUserEditor;
    n.querySelector("#ue_save").onclick = async () => {
      if (!editingUser) return;
      const errEl = n.querySelector("#ue_err");
      errEl.hidden = true;
      try {
        const roles = [];
        if (n.querySelector("#ue_role_member").checked) roles.push("member");
        if (n.querySelector("#ue_role_admin").checked) roles.push("tenant_admin");
        if (n.querySelector("#ue_role_auditor").checked) roles.push("auditor");
        if (n.querySelector("#ue_role_plat").checked) roles.push("platform_admin");
        if (!roles.length) throw new Error("Mindestens eine Rolle wählen");
        const body = {
          display_name: n.querySelector("#ue_display").value.trim(),
          email: n.querySelector("#ue_email").value.trim(),
          roles,
        };
        const pw = n.querySelector("#ue_password").value;
        if (pw) {
          if (editingUser.auth_backend !== "local") throw new Error("Login-Passwort nur für lokale User");
          if (pw.length < 12) throw new Error("Passwort mindestens 12 Zeichen");
          body.password = pw;
        }
        await api("/api/admin/users/" + encodeURIComponent(editingUser.id), {
          method: "PUT",
          body: JSON.stringify(body),
        });
        closeUserEditor();
        await refreshAdmin();
      } catch (e) {
        errEl.hidden = false;
        errEl.textContent = e.message;
      }
    };
  }

  async function refreshAdmin() {
    if (isAuditorOnly()) {
      try {
        const auditRaw = await api("/api/admin/audit");
        const audit = Array.isArray(auditRaw) ? auditRaw : (auditRaw.items || []);
        n.querySelector("#alist").innerHTML = audit.slice(0, 50).map((e) =>
          `<div>${e.created_at} · ${e.action} · ${e.actor_id} · ${e.resource_type}/${e.resource_id}</div>`
        ).join("") || "<p>Keine Events</p>";
        n.querySelector("#overview").textContent = "Auditor — nur Audit-Ansicht";
      } catch (e) {
        n.querySelector("#overview").textContent = e.message;
      }
      return;
    }
    const ov = await api("/api/admin/overview");
    n.querySelector("#overview").textContent =
      `Storage ${ov.storage.backend} · Vault ${ov.vault_ok ? "OK" : "FAIL"} · LDAP ${ov.ldap_enabled ? ov.ldap_host : "aus"} · Tenants ${ov.tenant_count}`;
    const users = await api("/api/admin/users");
    paintUsersList(users);
    const groups = await api("/api/admin/groups");
    vault.groups = groups;
    paintGroupsWorkspace(users, groups);
    await refreshGroupShareUI();
    const ldap = await api("/api/admin/ldap");
    n.querySelector("#ldap_en").checked = !!ldap.enabled;
    n.querySelector("#ldap_host").value = ldap.host || "";
    n.querySelector("#ldap_port").value = ldap.port || "";
    const ldapPort = Number(ldap.port) || 0;
    n.querySelector("#ldap_tls").checked = !(ldap.host && ldapPort === 389 && !ldap.use_tls);
    n.querySelector("#ldap_base").value = ldap.base_dn || "";
    n.querySelector("#ldap_bind").value = ldap.bind_dn || "";
    n.querySelector("#ldap_filter").value = ldap.user_filter || "";
    n.querySelector("#ldap_skip_tls").checked = !!ldap.insecure_skip_verify;
    const trust = await api("/api/admin/trust");
    n.querySelector("#trust_ca_pem").value = trust.ca_cert_pem || "";
    n.querySelector("#trust_ca_file").value = "";
    paintTrustCAStatus();
    const th = n.querySelector("#ldap_trust_hint");
    if (th) {
      th.textContent = trust.present
        ? `Zentrale Firmen-CA aktiv (${trust.cert_count || 1} Zertifikat${(trust.cert_count || 1) === 1 ? "" : "e"}).`
        : "Keine zentrale Firmen-CA — LDAPS prüft gegen System-CAs. Unter Firmen-CA hinterlegen.";
    }
    const mail = await api("/api/admin/mail");
    n.querySelector("#mail_en").checked = !!mail.enabled;
    n.querySelector("#mail_host").value = mail.host || "";
    n.querySelector("#mail_port").value = mail.port || "";
    n.querySelector("#mail_from").value = mail.from || "";
    n.querySelector("#mail_user").value = mail.username || "";
    const cryptoP = await api("/api/admin/crypto");
    n.querySelector("#arg_mem").value = cryptoP.Memory || cryptoP.memory || 65536;
    n.querySelector("#arg_time").value = cryptoP.Time || cryptoP.time || 3;
    n.querySelector("#arg_threads").value = cryptoP.Threads || cryptoP.threads || 1;
    try {
      const presets = await api("/api/crypto/presets");
      const row = n.querySelector("#presetRow");
      row.innerHTML = (presets.presets || []).map((p) =>
        `<button type="button" class="btn-ghost btn-sm" data-preset="${p.id}">${p.label}</button>`
      ).join("");
      row.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.onclick = () => {
          const p = (presets.presets || []).find((x) => x.id === btn.dataset.preset);
          if (!p) return;
          n.querySelector("#arg_mem").value = p.memory_kib;
          n.querySelector("#arg_time").value = p.time;
          n.querySelector("#arg_threads").value = p.threads;
        };
      });
    } catch (_) {}
    try {
      const me = vault.me;
      if (me?.recovery_mode) n.querySelector("#rec_mode").value = me.recovery_mode;
    } catch (_) {}
    const pol = await api("/api/admin/policy");
    n.querySelector("#totp_req").checked = !!pol.totp_required;
    n.querySelector("#admin_env_only").checked = !!pol.admin_secrets_envelope_only;
    const offlineCache = n.querySelector("#offline_cache");
    if (offlineCache) offlineCache.checked = pol.offline_cache_allowed !== false;
    const auditRaw = await api("/api/admin/audit");
    const audit = Array.isArray(auditRaw) ? auditRaw : (auditRaw.items || []);
    n.querySelector("#alist").innerHTML = audit.slice(0, 30).map((e) =>
      `<div>${e.created_at} · ${e.action} · ${e.actor_id} · ${e.resource_type}/${e.resource_id}</div>`
    ).join("") || "<p>Keine Events</p>";
    const keys = await api("/api/admin/api-keys");
    n.querySelector("#klist").innerHTML = keys.map((k) => {
      const scopeLabel = k.legacy_no_scopes ? "legacy (nur read)" : (k.scopes || []).join(", ") || "?";
      return `<div class="list-row"><span>${k.name} [${scopeLabel}] ${k.revoked ? "(revoked)" : ""}</span>` +
      (!k.revoked ? `<button class="btn-ghost" data-kr="${k.id}" type="button">Revoke</button>` : "") + `</div>`;
    }).join("") || "<p class='hint'>Keine Keys</p>";
    n.querySelector("#klist").querySelectorAll("[data-kr]").forEach((btn) => {
      btn.onclick = async () => {
        await api("/api/admin/api-keys/" + btn.dataset.kr + "/revoke", { method: "POST", body: "{}" });
        await refreshAdmin();
      };
    });
    const roles = vault.me?.roles || [];
    if (roles.includes("platform_admin")) {
      n.querySelector("#plat").hidden = false;
      const platLink = n.querySelector(".platform-link");
      if (platLink) platLink.hidden = false;
      const tenants = await api("/api/admin/tenants");
      n.querySelector("#tlist").innerHTML = tenants.map((t) =>
        `<div class="list-row"><span>${t.name} (${t.slug}) · ${t.status}</span>` +
        (t.status !== "disabled" ? `<button class="btn-ghost" data-td="${t.id}" type="button">Disable</button>` : "") + `</div>`
      ).join("");
      n.querySelector("#tlist").querySelectorAll("[data-td]").forEach((btn) => {
        btn.onclick = async () => {
          await api("/api/admin/tenants/" + btn.dataset.td + "/disable", { method: "POST", body: "{}" });
          await refreshAdmin();
        };
      });
    }
  }

  n.querySelector("#ucreate").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: n.querySelector("#nuser").value.trim(),
          display_name: n.querySelector("#ndisplay").value.trim(),
          email: n.querySelector("#nemail").value.trim(),
          password: n.querySelector("#npw").value,
        }),
      });
      n.querySelector("#nuser").value = "";
      n.querySelector("#ndisplay").value = "";
      n.querySelector("#nemail").value = "";
      n.querySelector("#npw").value = "";
      await refreshAdmin();
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  n.querySelector("#gcreate").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/groups", {
        method: "POST",
        body: JSON.stringify({ name: n.querySelector("#gname").value.trim() }),
      });
      n.querySelector("#gname").value = "";
      await refreshAdmin();
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  function ldapFormPayload() {
    return {
      enabled: n.querySelector("#ldap_en").checked,
      host: n.querySelector("#ldap_host").value.trim(),
      port: Number(n.querySelector("#ldap_port").value) || 0,
      base_dn: n.querySelector("#ldap_base").value.trim(),
      bind_dn: n.querySelector("#ldap_bind").value.trim(),
      bind_password: n.querySelector("#ldap_pw").value || "***",
      user_filter: n.querySelector("#ldap_filter").value.trim(),
      use_tls: n.querySelector("#ldap_tls").checked,
      insecure_skip_verify: n.querySelector("#ldap_skip_tls").checked,
    };
  }
  function paintTrustCAStatus() {
    const pem = (n.querySelector("#trust_ca_pem").value || "").trim();
    const st = n.querySelector("#trust_ca_status");
    if (!st) return;
    if (!pem) {
      st.textContent = "Kein Firmen-CA hinterlegt — ausgehende TLS-Verbindungen (LDAP, SMTP, …) prüfen gegen System-CAs.";
      return;
    }
    const blocks = pem.split("-----BEGIN CERTIFICATE-----").length - 1;
    st.textContent = blocks > 0
      ? `CA hinterlegt (${blocks} Zertifikat${blocks === 1 ? "" : "e"}, ${pem.length} Zeichen). Gilt instanzweit.`
      : "Text enthält kein PEM-Zertifikat (erwartet -----BEGIN CERTIFICATE-----).";
  }
  n.querySelector("#trust_ca_file").onchange = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    n.querySelector("#trust_ca_pem").value = (await f.text()).trim();
    paintTrustCAStatus();
  };
  n.querySelector("#trust_ca_pem").oninput = paintTrustCAStatus;
  n.querySelector("#trust_ca_clear").onclick = () => {
    n.querySelector("#trust_ca_pem").value = "";
    n.querySelector("#trust_ca_file").value = "";
    paintTrustCAStatus();
  };
  n.querySelector("#trust_ca_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/trust", {
        method: "PUT",
        body: JSON.stringify({ ca_cert_pem: n.querySelector("#trust_ca_pem").value.trim() }),
      });
      await refreshAdmin();
      err.hidden = false; err.style.color = "var(--color-ok)"; err.textContent = "Firmen-CA gespeichert";
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
  n.querySelector("#ldap_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/ldap", {
        method: "PUT",
        body: JSON.stringify(ldapFormPayload()),
      });
      n.querySelector("#ldap_pw").value = "";
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#ldap_test").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/ldap/test", {
        method: "POST",
        body: JSON.stringify(ldapFormPayload()),
      });
      err.hidden = false; err.style.color = "var(--color-ok)"; err.textContent = "LDAP Test OK";
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
  n.querySelector("#mail_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/mail", {
        method: "PUT",
        body: JSON.stringify({
          enabled: n.querySelector("#mail_en").checked,
          host: n.querySelector("#mail_host").value.trim(),
          port: Number(n.querySelector("#mail_port").value) || 0,
          from: n.querySelector("#mail_from").value.trim(),
          username: n.querySelector("#mail_user").value.trim(),
          password: n.querySelector("#mail_pw").value || "***",
          use_tls: true,
        }),
      });
      n.querySelector("#mail_pw").value = "";
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#mail_test").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      const res = await api("/api/admin/mail/test", { method: "POST", body: "{}" });
      err.hidden = false; err.style.color = "var(--color-ok)"; err.textContent = res.note || "OK";
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
  n.querySelector("#crypto_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/crypto", {
        method: "PUT",
        body: JSON.stringify({
          Memory: Number(n.querySelector("#arg_mem").value),
          Time: Number(n.querySelector("#arg_time").value),
          Threads: Number(n.querySelector("#arg_threads").value) || 1,
          KeyLen: 32,
        }),
      });
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#policy_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/policy", {
        method: "PUT",
        body: JSON.stringify({
          totp_required: n.querySelector("#totp_req").checked,
          admin_secrets_envelope_only: n.querySelector("#admin_env_only").checked,
          offline_cache_allowed: n.querySelector("#offline_cache").checked,
          session_hours: 8,
          unlock_idle_minutes: vault.idleMin || 15,
          escrow_shamir_k: Number(n.querySelector("#shamir_k").value) || 3,
          escrow_shamir_n: Number(n.querySelector("#shamir_n").value) || 5,
          ldap_sync_hours: 24,
        }),
      });
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#rec_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      if (n.querySelector("#rec_confirm").value.trim() !== "REONBOARD") {
        throw new Error('Bestätigung muss genau "REONBOARD" sein');
      }
      await api("/api/admin/tenant/recovery", {
        method: "POST",
        body: JSON.stringify({
          recovery_mode: n.querySelector("#rec_mode").value,
          escrow_allowed: n.querySelector("#rec_escrow").checked,
          confirm: "REONBOARD",
        }),
      });
      n.querySelector("#rec_confirm").value = "";
      err.hidden = false; err.style.color = "var(--color-ok)";
      err.textContent = "Recovery-Modus geändert — User müssen neu onboarden.";
    } catch (e) {
      err.hidden = false; err.style.color = ""; err.textContent = e.message;
    }
  };
  n.querySelector("#escrow_gen").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    const out = n.querySelector("#escrow_out");
    try {
      const k = Number(n.querySelector("#shamir_k").value) || 3;
      const nn = Number(n.querySelector("#shamir_n").value) || 5;
      const kp = TVCrypto.generateBoxKeyPair();
      await api("/api/admin/tenant/escrow-pubkey", {
        method: "POST",
        body: JSON.stringify({ public_key_b64: TVCrypto.b64enc(kp.publicKey) }),
      });
      const hex = Array.from(kp.secretKey).map((b) => b.toString(16).padStart(2, "0")).join("");
      let shares = null;
      let sharesHtml = "";
      if (typeof secrets !== "undefined" && secrets.share) {
        shares = secrets.share(hex, nn, k);
        sharesHtml = "<br/><strong>Shamir-Shares (einzeln verwahren):</strong><ol>" +
          shares.map((s, i) => `<li><code class="mono">share_${i + 1}=${s}</code></li>`).join("") +
          "</ol>";
      } else {
        sharesHtml = "<br/>secrets.js fehlt — nutze <code>tvcli escrow-split</code>.";
      }
      kp.secretKey.fill(0);
      out.hidden = false;
      out.innerHTML = "<strong>Escrow Public Key gespeichert.</strong> Privater Key wird nicht im DOM gehalten." +
        sharesHtml +
        (shares ? "<div class='row'><button class='btn-ghost' type='button' id='escrow_dl'>Shares als Datei speichern</button></div>" : "");
      const dl = out.querySelector("#escrow_dl");
      if (dl && shares) {
        dl.onclick = () => {
          const blob = new Blob([shares.map((s, i) => `share_${i + 1}=${s}`).join("\n") + "\n"], { type: "text/plain" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "teamvault-escrow-shares.txt";
          a.click();
          URL.revokeObjectURL(a.href);
        };
      }
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#ldap_sync").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      const res = await api("/api/admin/ldap/sync", { method: "POST", body: "{}" });
      err.hidden = false; err.style.color = "var(--color-ok)";
      err.textContent = `LDAP-Sync: geprüft ${res.checked}, deaktiviert ${res.disabled}`;
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
  n.querySelector("#kcreate").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    const box = n.querySelector("#ktoken");
    try {
      const scopes = [];
      if (n.querySelector("#kscope_read").checked) scopes.push("read");
      if (n.querySelector("#kscope_vault").checked) scopes.push("vault");
      if (n.querySelector("#kscope_admin").checked) scopes.push("admin");
      if (!scopes.length) throw new Error("Mindestens einen Scope wählen");
      const res = await api("/api/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: n.querySelector("#kname").value.trim(), scopes }),
      });
      box.hidden = false;
      box.textContent = "Token (einmalig): " + res.token;
      n.querySelector("#kname").value = "";
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#tcreate").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ name: n.querySelector("#tname").value.trim(), slug: n.querySelector("#tslug").value.trim() }),
      });
      n.querySelector("#tname").value = "";
      n.querySelector("#tslug").value = "";
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#mig_go").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      const res = await api("/api/admin/storage/migrate", {
        method: "POST",
        body: JSON.stringify({
          backend: n.querySelector("#mig_backend").value,
          dsn: n.querySelector("#mig_dsn").value.trim(),
          confirm: n.querySelector("#mig_confirm").value.trim(),
        }),
      });
      err.hidden = false; err.style.color = "var(--color-ok)";
      err.textContent = "Migration OK → " + JSON.stringify(res.storage);
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
  n.querySelector("#inst_bak_dl").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      const res = await fetch("/api/admin/backup", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      downloadBlob("teamvault-instance-backup.json", JSON.stringify(data, null, 2), "application/json");
      const ok = n.querySelector("#inst_bak_ok");
      ok.hidden = false;
      ok.textContent = "Snapshot heruntergeladen (nur Ciphertext). Unlock-Keyfile separat sichern.";
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
  n.querySelector("#inst_bak_restore").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    const ok = n.querySelector("#inst_bak_ok"); ok.hidden = true;
    try {
      const file = n.querySelector("#inst_bak_file").files?.[0];
      if (!file) throw new Error("Snapshot-Datei wählen");
      const confirm = n.querySelector("#inst_bak_confirm").value.trim();
      const text = await file.text();
      const res = await fetch("/api/admin/backup/restore?confirm=" + encodeURIComponent(confirm), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok.hidden = false;
      ok.textContent = "Restore OK (" + (data.exported_at || "") + "). Bei Abweichungen neu anmelden.";
    } catch (e) { err.hidden = false; err.style.color = ""; err.textContent = e.message; }
  };
}

async function boot() {
  initTheme();
  ensureHeaderControls();
  paintAbout();
  const status = await api("/api/setup/status");
  const app = document.getElementById("app");
  app.innerHTML = "";
  const path = location.pathname;
  if (!status.initialized) {
    if (path !== "/setup" && path !== "/") location.href = "/setup";
    renderWizard(app);
    paintAbout();
    return;
  }
  if (path === "/setup") {
    app.appendChild(el(`<div class="panel"><h1>Bereits eingerichtet</h1><a class="btn-accent" href="/login" style="display:inline-block;text-decoration:none;padding:.6rem 1rem;">Zum Login</a></div>`));
    paintAbout();
    return;
  }
  if (path === "/onboard") { renderOnboard(app); paintAbout(); return; }
  if (path === "/app") { renderApp(app); paintAbout(); return; }
  renderLogin(app);
  paintAbout();
}

boot().catch((e) => {
  document.getElementById("app").textContent = "Fehler: " + e.message;
});

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
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
}

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("tv-theme", t); } catch (_) {}
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.textContent = t === "dark" ? "Hell" : "Dunkel";
  });
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
  btn.className = "btn-ghost btn-sm";
  btn.id = "themeToggle";
  btn.setAttribute("data-theme-toggle", "1");
  btn.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "Hell" : "Dunkel";
  btn.onclick = () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  };
  actions.appendChild(btn);
  top.appendChild(actions);
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
  const prev = btn.textContent;
  btn.textContent = "Kopiert";
  btn.classList.add("copied");
  setTimeout(() => { btn.textContent = prev; btn.classList.remove("copied"); }, 1200);
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
    <p class="lead">Login-Passwort oder Passkey. Vault-Entschlüsselung braucht weiterhin das Master-Passwort (OQ-04).</p>
    <label>Tenant-Slug</label><input id="slug" />
    <label>Username</label><input id="user" />
    <label>Passwort</label><input id="pw" type="password" />
    <label>TOTP (falls aktiv)</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" />
    <div class="error" id="err" hidden></div>
    <div class="row">
      <button class="btn-accent" type="button" id="doLogin">Anmelden</button>
      <button class="btn-ghost" type="button" id="doPasskey">Passkey</button>
    </div>
  </div>`);
  n.querySelector("#doLogin").onclick = async () => {
    const err = n.querySelector("#err");
    err.hidden = true;
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          tenant_slug: n.querySelector("#slug").value.trim(),
          username: n.querySelector("#user").value.trim(),
          password: n.querySelector("#pw").value,
          totp_code: n.querySelector("#totp").value.trim(),
        }),
      });
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
      const tenant = n.querySelector("#slug").value.trim();
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
      location.href = res.needs_vault_onboard ? "/onboard" : "/app";
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
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
  idleMin: 15,
  idleTimer: null,
  idleBound: false,
  secretsCache: [],
  secretsTotal: 0,
  secretsOffset: 0,
  pageLimit: 50,
  searchQuery: "",
  folderFilter: "",
  groups: [],
  totpTimer: null,
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

async function unlockVault(masterPassword) {
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
  if (copy && display !== "—") actions.push(`<button type="button" class="copy-btn" ${copyAttr}>Kopieren</button>`);
  if (download && display !== "—") actions.push(`<button type="button" class="copy-btn" ${dlAttr}>Download</button>`);
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
      <div class="app-sidebar-brand">TeamVault</div>
      <nav class="app-sidebar-nav" id="appSidebarNav">
        <div class="sidebar-section">
          <div class="sidebar-section-title">Vault</div>
          <button type="button" class="sidebar-link active" data-nav="vault:secrets">Secrets</button>
          <button type="button" class="sidebar-link" data-nav="vault:create">Neu anlegen</button>
          <button type="button" class="sidebar-link" data-nav="vault:import">Import</button>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Konto</div>
          <button type="button" class="sidebar-link" data-nav="account">Konto</button>
        </div>
        <div class="sidebar-section" id="navAdminSection" hidden>
          <div class="sidebar-section-title">Administration</div>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:users" data-admin-only>Benutzer</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:groups" data-admin-only>Gruppen</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:ldap" data-admin-only>LDAP</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:smtp" data-admin-only>SMTP</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:crypto" data-admin-only>Krypto &amp; Policy</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:recovery" data-admin-only>Recovery &amp; Escrow</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:apikeys" data-admin-only>API-Keys</button>
          <button type="button" class="sidebar-link admin-link platform-link" data-nav="admin:platform" data-admin-only hidden>Tenants &amp; Migration</button>
          <button type="button" class="sidebar-link admin-link" data-nav="admin:audit">Audit</button>
        </div>
      </nav>
      <div class="app-sidebar-foot">
        <p class="hint" id="info">Lade…</p>
        <button class="btn-ghost" type="button" id="out">Logout</button>
      </div>
    </aside>

    <div class="app-main">
      <header class="app-topbar">
        <button type="button" class="menu-toggle" id="menuToggle" aria-label="Menü">☰</button>
        <h1 id="pageTitle">Vault</h1>
        <div class="app-topbar-actions">
          <button type="button" class="btn-ghost btn-sm" data-theme-toggle>Dunkel</button>
        </div>
      </header>

      <div class="app-content">
        <div id="lockOverlay" class="lock-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="lockTitle">
          <div class="lock-card">
            <h1 id="lockTitle">Vault gesperrt</h1>
            <p class="lead">Idle-Timeout. Master-Passwort erneut eingeben (bleibt nur im Speicher).</p>
            <label for="lockMpw">Master-Passwort</label>
            <input id="lockMpw" type="password" autocomplete="current-password" />
            <div class="error" id="lockErr" hidden role="alert"></div>
            <div class="row"><button class="btn-accent" type="button" id="lockUnlock">Entsperren</button></div>
          </div>
        </div>

        <div class="panel app-unlock-panel" id="unlock">
          <h1>Vault entsperren</h1>
          <p class="lead">Master-Passwort bleibt im Browser (Zero-Knowledge).</p>
          <label>Master-Passwort</label><input id="mpw" type="password" autocomplete="current-password" />
          <div class="error" id="uerr" hidden></div>
          <div class="row"><button class="btn-accent" type="button" id="ulock">Entsperren</button></div>
        </div>

        <div id="vaultui" hidden>
          <div class="app-tab active" data-pane="vault">
            <div class="vault-section active" data-vault="secrets">
              <div class="panel">
                <div class="toolbar">
                  <div>
                    <label>Suche</label>
                    <input id="ssearch" type="search" placeholder="Titel, Ordner…" />
                  </div>
                  <div>
                    <label>Ordner</label>
                    <select id="sfolder"><option value="">Alle</option></select>
                  </div>
                </div>
                <div id="slist" class="list"></div>
                <div class="row">
                  <button class="btn-ghost" type="button" id="sMore" hidden>Mehr laden</button>
                  <button class="btn-ghost" type="button" id="sExportJson">Export JSON</button>
                  <button class="btn-ghost" type="button" id="sExportCsv">Export CSV</button>
                  <span class="hint" id="sCount"></span>
                </div>
              </div>
              <div class="panel" id="sdetail" hidden>
                <h1 id="dtitle">Secret</h1>
                <div id="dfields" class="secret-fields"></div>
                <p class="hint" id="drec"></p>
                <label>Teilen mit User</label>
                <select id="shareto"></select>
                <div id="gshareWrap" hidden>
                  <label>Gruppe teilen</label>
                  <select id="sharegroup"><option value="">— Gruppe wählen —</option></select>
                </div>
                <div class="row">
                  <button class="btn-accent" type="button" id="share">Teilen</button>
                  <button class="btn-ghost" type="button" id="shareGroup" hidden>Gruppe teilen</button>
                  <button class="btn-ghost" type="button" id="revoke">Zugriff entziehen + rotieren</button>
                  <button class="btn-danger" type="button" id="sdel">Löschen</button>
                </div>
                <div class="error" id="derr" hidden></div>
              </div>
            </div>

            <div class="vault-section" data-vault="create">
              <div class="panel">
                <label>Titel</label><input id="stitle" />
                <label>Ordner</label>
                <input id="sfolderIn" list="folderList" placeholder="z. B. Infrastruktur" autocomplete="off" />
                <datalist id="folderList"></datalist>
                <label>Benutzername</label><input id="suser" autocomplete="off" />
                <label>Passwort</label>
                <div class="row gen-row" style="margin-top:0.35rem">
                  <input id="spw" type="password" autocomplete="new-password" style="flex:1" />
                  <button class="btn-ghost" type="button" id="spwShow">Anzeigen</button>
                  <button class="btn-ghost" type="button" id="spwGen">Generator</button>
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
                <div class="error" id="serr" hidden></div>
                <div class="row"><button class="btn-accent" type="button" id="screate">Speichern (clientseitig verschlüsselt)</button></div>
              </div>
            </div>

            <div class="vault-section" data-vault="import">
              <div class="panel">
                <p class="hint">Bitwarden-JSON, CSV oder KeePass-XML — Parsing und Verschlüsselung nur im Browser (Zero-Knowledge).</p>
                <input id="simport" type="file" accept=".json,.csv,.xml,text/csv,application/json,text/xml" />
                <div class="row">
                  <button class="btn-ghost" type="button" id="simportRun" disabled>Import starten</button>
                  <span class="hint" id="simportHint"></span>
                </div>
                <div class="error" id="ierr" hidden></div>
                <div class="ok" id="iok" hidden></div>
              </div>
            </div>
          </div>

          <div class="app-tab" data-pane="account">
            <div class="panel">
              <p class="hint">TOTP und Passkey betreffen nur den Login — Vault bleibt Master-Passwort-pflichtig (OQ-04).</p>
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
                  <label>Username</label><input id="nuser" />
                  <label>Passwort (≥12)</label><input id="npw" type="password" />
                  <div class="row"><button class="btn-accent" type="button" id="ucreate">User anlegen</button></div>
                </div>
                <div class="admin-section" data-admin-section="groups">
                  <div id="glist" class="list"></div>
                  <label>Gruppenname</label><input id="gname" />
                  <div class="row"><button class="btn-accent" type="button" id="gcreate">Gruppe anlegen</button></div>
                  <label>Member hinzufügen (Group-ID)</label><input id="gmid" placeholder="grp_…" />
                  <label>User-ID</label><input id="gmuid" placeholder="usr_…" />
                  <div class="row"><button class="btn-ghost" type="button" id="gmadd">Member speichern</button></div>
                  <div class="row"><button class="btn-ghost" type="button" id="ldap_sync">LDAP-Sync (Disable fehlende)</button></div>
                </div>
                <div class="admin-section" data-admin-section="ldap">
                  <label class="inline"><input id="ldap_en" type="checkbox" /> Aktiv</label>
                  <label>Host</label><input id="ldap_host" />
                  <label>Port</label><input id="ldap_port" type="number" />
                  <label>Base DN</label><input id="ldap_base" />
                  <label>Bind DN</label><input id="ldap_bind" />
                  <label>Bind-Passwort</label><input id="ldap_pw" type="password" placeholder="unverändert lassen = behalten" />
                  <label>User-Filter</label><input id="ldap_filter" placeholder="(uid=%s)" />
                  <div class="row">
                    <button class="btn-accent" type="button" id="ldap_save">LDAP speichern</button>
                    <button class="btn-ghost" type="button" id="ldap_test">Test-Bind</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="smtp">
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
                  <div class="row">
                    <button class="btn-accent" type="button" id="crypto_save">Krypto speichern</button>
                    <button class="btn-ghost" type="button" id="policy_save">Policy speichern</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="recovery">
                  <p class="hint">Wechsel erzwingt Re-Onboarding aller User (OQ-03). Bestätigung: <code>REONBOARD</code></p>
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
  let totpSecretPlain = "";

  const NAV_TITLES = {
    "vault:secrets": "Secrets",
    "vault:create": "Neu anlegen",
    "vault:import": "Import",
    account: "Konto",
    "admin:users": "Benutzer",
    "admin:groups": "Gruppen",
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

  function navigateTo(nav) {
    if (!vault.sk) return;
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
    }

    n.querySelectorAll(".app-tab").forEach((p) => {
      p.classList.toggle("active", p.dataset.pane === pane);
    });
    if (pane === "vault") {
      n.querySelectorAll(".vault-section").forEach((s) => {
        s.classList.toggle("active", s.dataset.vault === vaultSec);
      });
    }
    if (pane === "admin") {
      n.querySelectorAll(".admin-section").forEach((s) => {
        s.classList.toggle("active", s.dataset.adminSection === adminSec);
      });
    }
    closeMobileNav();
  }

  api("/api/me").then((me) => {
    if (me.needs_vault_onboard) { location.href = "/onboard"; return; }
    vault.me = me;
    n.querySelector("#info").textContent = `Angemeldet als ${me.username} · Tenant ${me.tenant_id}` +
      (me.totp_enabled ? " · TOTP aktiv" : "");
  }).catch(() => { location.href = "/login"; });

  n.querySelector("#out").onclick = async () => {
    clearVaultKey();
    await api("/api/auth/logout", { method: "POST", body: "{}" });
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
  {
    const t = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    n.querySelector("[data-theme-toggle]").textContent = t === "dark" ? "Hell" : "Dunkel";
  }

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

  async function collectDecryptedExportItems() {
    const items = [];
    for (const it of vault.secretsCache) {
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
        const payload = JSON.parse(await TVCrypto.decryptPayload(
          TVCrypto.b64dec(det.ciphertext_b64),
          TVCrypto.b64dec(det.nonce_b64),
          ddk, det.key_version || kv
        ));
        ddk.fill(0); dk.fill(0);
        items.push({ title, payload, collection_id: it.collection_id || "" });
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

  n.querySelector("#sExportJson").onclick = async () => {
    if (!confirm("Klartext-Export als JSON speichern? Die Datei enthält Passwörter im Klartext — sicher ablegen und danach löschen.")) return;
    try {
      const items = await collectDecryptedExportItems();
      const bw = {
        encrypted: false,
        items: items.map((it) => ({
          type: 1,
          name: it.title,
          folderId: it.collection_id || null,
          login: {
            username: it.payload.username || "",
            password: it.payload.password || "",
            totp: it.payload.totp || null,
            uris: (it.payload.urls || (it.payload.url ? [it.payload.url] : [])).map((u) => ({ uri: u })),
          },
          notes: (it.payload.extra || []).filter((e) => e.type === "notes").map((e) => e.value).join("\n") || "",
        })),
      };
      downloadBlob("teamvault-export.json", JSON.stringify(bw, null, 2), "application/json");
    } catch (e) { alert(e.message); }
  };
  n.querySelector("#sExportCsv").onclick = async () => {
    if (!confirm("Klartext-Export als CSV speichern? Die Datei enthält Passwörter im Klartext — sicher ablegen und danach löschen.")) return;
    try {
      const items = await collectDecryptedExportItems();
      const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const lines = ["title,username,password,url,folder,notes"];
      for (const it of items) {
        const url = (it.payload.urls && it.payload.urls[0]) || it.payload.url || "";
        const notes = (it.payload.extra || []).filter((e) => e.type === "notes").map((e) => e.value).join(" ");
        lines.push([it.title, it.payload.username, it.payload.password, url, it.collection_id, notes].map(esc).join(","));
      }
      downloadBlob("teamvault-export.csv", lines.join("\n"), "text/csv");
    } catch (e) { alert(e.message); }
  };

  async function afterUnlock() {
    try {
      vault.me = await api("/api/me");
      n.querySelector("#info").textContent = `Angemeldet als ${vault.me.username} · Tenant ${vault.me.tenant_id}` +
        (vault.me.totp_enabled ? " · TOTP aktiv" : "");
    } catch (_) {}
    try {
      const pol = await api("/api/policy/client");
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
    if (isAdmin()) {
      n.querySelector("#gshareWrap").hidden = false;
      n.querySelector("#shareGroup").hidden = false;
      try {
        vault.groups = await api("/api/admin/groups");
        const sel = n.querySelector("#sharegroup");
        sel.innerHTML = `<option value="">— Gruppe wählen —</option>` +
          vault.groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
      } catch (_) { vault.groups = []; }
    } else {
      try {
        vault.groups = await api("/api/groups");
        if (vault.groups.length) {
          n.querySelector("#gshareWrap").hidden = false;
          n.querySelector("#shareGroup").hidden = false;
          const sel = n.querySelector("#sharegroup");
          sel.innerHTML = `<option value="">— Gruppe wählen —</option>` +
            vault.groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
        }
      } catch (_) { vault.groups = []; }
    }
    vault.secretsCache = [];
    vault.secretsOffset = 0;
    await refreshSecrets(true);
    navigateTo("vault:secrets");
  }

  n.querySelector("#ulock").onclick = async () => {
    const err = n.querySelector("#uerr"); err.hidden = true;
    try {
      await unlockVault(n.querySelector("#mpw").value);
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
      await unlockVault(n.querySelector("#lockMpw").value);
      await afterUnlock();
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };
  n.querySelector("#lockMpw").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") n.querySelector("#lockUnlock").click();
  });

  n.querySelector("#ssearch").oninput = () => {
    vault.searchQuery = n.querySelector("#ssearch").value.trim().toLowerCase();
    paintSecretList();
  };
  n.querySelector("#sfolder").onchange = () => {
    vault.folderFilter = n.querySelector("#sfolder").value;
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
    n.querySelector("#spwShow").textContent = show ? "Verbergen" : "Anzeigen";
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
        payload.tags = (row.querySelector(".slot-val")?.value || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
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
    return payload;
  }

  function resetCreateForm() {
    n.querySelector("#stitle").value = "";
    n.querySelector("#suser").value = "";
    n.querySelector("#spw").value = "";
    n.querySelector("#spw").type = "password";
    n.querySelector("#sfolderIn").value = "";
    n.querySelector("#sextraSlots").innerHTML = "";
    n.querySelector("#sextraAdd").value = "";
    n.querySelector("#spwShow").textContent = "Anzeigen";
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
  n.querySelector("#simport").onchange = async () => {
    const err = n.querySelector("#ierr"); err.hidden = true;
    n.querySelector("#iok").hidden = true;
    importPending = [];
    n.querySelector("#simportRun").disabled = true;
    const file = n.querySelector("#simport").files?.[0];
    if (!file) return;
    try {
      if (!window.TVImport) throw new Error("Import-Modul nicht geladen");
      const text = await file.text();
      const parsed = TVImport.detectAndParse(file.name, text);
      importPending = parsed.items;
      n.querySelector("#simportHint").textContent =
        `${parsed.format}: ${importPending.length} Einträge bereit`;
      n.querySelector("#simportRun").disabled = importPending.length === 0;
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  async function postEncryptedSecret(title, payload, collectionId) {
    const kv = 1;
    const dk = TVCrypto.generateDataKey();
    const titleEnc = await TVCrypto.encryptTitle(title, dk, kv);
    const bodyEnc = await TVCrypto.encryptPayload(
      new TextEncoder().encode(JSON.stringify(payload)),
      dk,
      kv
    );
    const meKeys = await api("/api/vault/keys");
    const env = TVCrypto.sealDataKeyForRecipient(dk, TVCrypto.b64dec(meKeys.public_key_b64), kv);
    dk.fill(0);
    const body = {
      title_ciphertext_b64: TVCrypto.b64enc(titleEnc.ciphertext),
      title_nonce_b64: TVCrypto.b64enc(titleEnc.nonce),
      ciphertext_b64: TVCrypto.b64enc(bodyEnc.ciphertext),
      nonce_b64: TVCrypto.b64enc(bodyEnc.nonce),
      key_version: kv,
      envelopes: [TVCrypto.envelopeToAPI(vault.me.user_id, env)],
    };
    if (collectionId) body.collection_id = collectionId;
    await api("/api/secrets", { method: "POST", body: JSON.stringify(body) });
  }

  n.querySelector("#simportRun").onclick = async () => {
    const err = n.querySelector("#ierr");
    const ok = n.querySelector("#iok");
    err.hidden = true;
    ok.hidden = true;
    if (!importPending.length) return;
    const items = importPending.slice();
    importPending = [];
    n.querySelector("#simportRun").disabled = true;
    let done = 0;
    let failed = 0;
    const hint = n.querySelector("#simportHint");
    try {
      if (!vault.sk) throw new Error("Vault gesperrt");
      for (const it of items) {
        hint.textContent = `Importiere ${done + 1}/${items.length}…`;
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
              tags: it.tags || [],
              favorite: !!it.favorite,
              extra: it.extra || [],
            }),
            it.collection_id || ""
          );
          done++;
        } catch {
          failed++;
        }
        it.password = "";
        it.totp_seed = "";
        it.notes = "";
      }
      hint.textContent = "";
      n.querySelector("#simport").value = "";
      ok.hidden = false;
      ok.textContent = failed
        ? `${done} importiert, ${failed} fehlgeschlagen`
        : `${done} Einträge importiert`;
      await refreshSecrets(true);
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };

  function updateFolderOptions() {
    const sel = n.querySelector("#sfolder");
    const cur = vault.folderFilter;
    const folders = [...new Set(vault.secretsCache.map((s) => s.collection_id).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">Alle</option>` + folders.map((f) =>
      `<option value="${f.replace(/"/g, "&quot;")}">${f}</option>`
    ).join("");
    sel.value = cur;
    const dl = n.querySelector("#folderList");
    if (dl) {
      dl.innerHTML = folders.map((f) => `<option value="${f.replace(/"/g, "&quot;")}"></option>`).join("");
    }
  }

  function paintSecretList() {
    const list = n.querySelector("#slist");
    list.innerHTML = "";
    const q = vault.searchQuery;
    const folder = vault.folderFilter;
    const visible = vault.secretsCache.filter((it) => {
      if (folder && (it.collection_id || "") !== folder) return false;
      if (!q) return true;
      const title = (it._title || "").toLowerCase();
      const folderName = (it.collection_id || "").toLowerCase();
      return title.includes(q) || folderName.includes(q) || (it.id || "").toLowerCase().includes(q);
    });
    for (const it of visible) {
      const row = el(`<div class="list-row"><span></span><button class="btn-ghost" type="button">Öffnen</button></div>`);
      const span = row.querySelector("span");
      const mark = it._favorite ? `<span class="fav-mark">★</span>` : "";
      if (it._title) {
        span.innerHTML = mark + "";
        span.appendChild(document.createTextNode(it._title + (it.collection_id ? ` · ${it.collection_id}` : "")));
      } else {
        span.textContent = it.id + (it.has_access ? " (Titel n.v.)" : " · kein Zugriff");
      }
      row.querySelector("button").onclick = () => openSecret(it.id);
      list.appendChild(row);
    }
    n.querySelector("#sCount").textContent =
      `${visible.length} angezeigt · ${vault.secretsCache.length} geladen · ${vault.secretsTotal} gesamt`;
    n.querySelector("#sMore").hidden = vault.secretsCache.length >= vault.secretsTotal;
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
    updateFolderOptions();
    paintSecretList();
  }

  n.querySelector("#sMore").onclick = async () => {
    await refreshSecrets(false);
  };

  async function openSecret(id) {
    const err = n.querySelector("#derr"); err.hidden = true;
    const panel = n.querySelector("#sdetail"); panel.hidden = false;
    navigateTo("vault:secrets");
    if (vault.totpTimer) {
      clearInterval(vault.totpTimer);
      vault.totpTimer = null;
    }
    try {
      const det = await api("/api/secrets/" + id);
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
              <button type="button" class="copy-btn" id="dtotpCopy">Kopieren</button>
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
        reveal.textContent = "Anzeigen";
        let shown = false;
        reveal.onclick = () => {
          shown = !shown;
          val.textContent = shown ? payload.password : "••••••••";
          reveal.textContent = shown ? "Verbergen" : "Anzeigen";
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
        reveal.textContent = "Anzeigen";
        let shown = false;
        reveal.onclick = () => {
          shown = !shown;
          valEl.textContent = shown ? raw : "••••••••";
          reveal.textContent = shown ? "Verbergen" : "Anzeigen";
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
      n.querySelector("#drec").textContent =
        "Empfänger: " + (det.recipients || []).join(", ") +
        " · v" + kv +
        (det.collection_id ? " · Ordner " + det.collection_id : "");
      const pks = await api("/api/users/public-keys");
      const sel = n.querySelector("#shareto");
      sel.innerHTML = pks.filter((p) => !(det.recipients || []).includes(p.user_id))
        .map((p) => `<option value="${p.user_id}" data-pk="${p.public_key_b64}">${p.username}</option>`).join("");
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
      const collectionId = n.querySelector("#sfolderIn").value.trim();
      await postEncryptedSecret(title, payload, collectionId);
      resetCreateForm();
      await refreshSecrets(true);
      navigateTo("vault:secrets");
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

  n.querySelector("#sdel").onclick = async () => {
    if (!confirm("Secret löschen?")) return;
    await api("/api/secrets/" + currentSecret.id, { method: "DELETE" });
    n.querySelector("#sdetail").hidden = true;
    await refreshSecrets(true);
  };

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
    n.querySelector("#ulist").innerHTML = users.map((u) =>
      `<div class="list-row"><span>${u.username} · ${u.status}${u.onboarded ? " · onboarded" : ""} · ${u.auth_backend}</span>` +
      (u.status !== "disabled" ? `<button class="btn-ghost" data-dis="${u.id}" type="button">Disable</button>` : "") +
      `</div>`
    ).join("");
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
    const groups = await api("/api/admin/groups");
    vault.groups = groups;
    n.querySelector("#glist").innerHTML = groups.map((g) =>
      `<div class="list-row"><span>${g.name} · ${g.id} (${(g.members || []).length})</span></div>`
    ).join("") || "<p class='hint'>Keine Gruppen</p>";
    const gsel = n.querySelector("#sharegroup");
    if (gsel) {
      gsel.innerHTML = `<option value="">— Gruppe wählen —</option>` +
        groups.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
    }
    const ldap = await api("/api/admin/ldap");
    n.querySelector("#ldap_en").checked = !!ldap.enabled;
    n.querySelector("#ldap_host").value = ldap.host || "";
    n.querySelector("#ldap_port").value = ldap.port || "";
    n.querySelector("#ldap_base").value = ldap.base_dn || "";
    n.querySelector("#ldap_bind").value = ldap.bind_dn || "";
    n.querySelector("#ldap_filter").value = ldap.user_filter || "";
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
        body: JSON.stringify({ username: n.querySelector("#nuser").value.trim(), password: n.querySelector("#npw").value }),
      });
      n.querySelector("#nuser").value = "";
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
  n.querySelector("#ldap_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/ldap", {
        method: "PUT",
        body: JSON.stringify({
          enabled: n.querySelector("#ldap_en").checked,
          host: n.querySelector("#ldap_host").value.trim(),
          port: Number(n.querySelector("#ldap_port").value) || 0,
          base_dn: n.querySelector("#ldap_base").value.trim(),
          bind_dn: n.querySelector("#ldap_bind").value.trim(),
          bind_password: n.querySelector("#ldap_pw").value || "***",
          user_filter: n.querySelector("#ldap_filter").value.trim(),
          use_tls: true,
        }),
      });
      n.querySelector("#ldap_pw").value = "";
      await refreshAdmin();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#ldap_test").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/ldap/test", { method: "POST", body: "{}" });
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
  n.querySelector("#gmadd").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/groups/" + n.querySelector("#gmid").value.trim() + "/members", {
        method: "POST",
        body: JSON.stringify({ user_id: n.querySelector("#gmuid").value.trim() }),
      });
      await refreshAdmin();
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
}

async function boot() {
  initTheme();
  ensureHeaderControls();
  const status = await api("/api/setup/status");
  const app = document.getElementById("app");
  app.innerHTML = "";
  const path = location.pathname;
  if (!status.initialized) {
    if (path !== "/setup" && path !== "/") location.href = "/setup";
    renderWizard(app);
    return;
  }
  if (path === "/setup") {
    app.appendChild(el(`<div class="panel"><h1>Bereits eingerichtet</h1><a class="btn-accent" href="/login" style="display:inline-block;text-decoration:none;padding:.6rem 1rem;">Zum Login</a></div>`));
    return;
  }
  if (path === "/onboard") { renderOnboard(app); return; }
  if (path === "/app") { renderApp(app); return; }
  renderLogin(app);
}

boot().catch((e) => {
  document.getElementById("app").textContent = "Fehler: " + e.message;
});

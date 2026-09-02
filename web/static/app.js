const state = {
  step: 0,
  draft: {
    storage: { backend: "sqlite", dsn: "" },
    tenant: { name: "", slug: "", recovery_mode: "user_kit", escrow_allowed: false },
    admin: { username: "admin", display_name: "", email: "", password: "", password2: "" },
    setup_token: "",
    argon2: { Time: 3, Memory: 65536, Threads: 1, KeyLen: 32 },
  },
};

const ROLE_LABELS = {
  member: "Mitglied",
  tenant_admin: "Organisations-Administrator",
  platform_admin: "Plattform-Administrator",
  auditor: "Auditor (nur Lesen)",
};
function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function formatUserStatus(status) {
  const labels = {
    active: "Aktiv",
    disabled: "Deaktiviert",
    pending_onboarding: "Onboarding ausstehend",
  };
  return labels[status] || status;
}

function formatAuthBackend(backend) {
  const labels = { local: "Lokal", ldap: "LDAP" };
  return labels[backend] || backend;
}

const PASSWORD_POLICY = "mindestens 16 Zeichen, Groß- und Kleinbuchstaben, Ziffer, Sonderzeichen, keine Umlaute";

function passwordPolicyError(pw, kind) {
  const label = kind || "Passwort";
  if (typeof pw !== "string" || pw.length < 16) {
    return label + ": " + PASSWORD_POLICY + ".";
  }
  if (/[äöüÄÖÜß]/.test(pw) || /[^\x21-\x7E]/.test(pw)) {
    return label + ": keine Umlaute und nur ASCII-Zeichen ohne Leerzeichen.";
  }
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    return label + ": " + PASSWORD_POLICY + ".";
  }
  return "";
}

function masterPasswordError(pw) {
  return passwordPolicyError(pw, "Master-Passwort");
}

function localLoginPasswordError(pw) {
  return passwordPolicyError(pw, "Login-Passwort");
}

function tvBaseFromPath() {
  const p = location.pathname;
  const routes = ["/app", "/login", "/setup", "/onboard"];
  for (const s of routes) {
    if (p === s) return "";
    if (p.endsWith(s) && p.length > s.length) return p.slice(0, p.length - s.length);
  }
  const hm = p.match(/^(.*)\/help(?:\/|$)/);
  return hm ? hm[1] : "";
}

function tvBase() {
  if (typeof window.__TV_BASE__ === "string") {
    const v = window.__TV_BASE__.replace(/\/$/, "");
    if (v) return v;
  }
  try {
    const meta = (document.querySelector('meta[name="tv-base"]')?.content || "").replace(/\/$/, "");
    if (meta) return meta;
  } catch (_) {}
  return tvBaseFromPath();
}

function tvPath(path) {
  if (!path || path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : "/" + path;
  const b = tvBase();
  return b ? b + p : p;
}

function tvRelPath() {
  const p = location.pathname;
  const b = tvBase();
  if (!b) return p;
  if (p === b) return "/";
  if (p.startsWith(b + "/")) return p.slice(b.length) || "/";
  return p;
}

function tvGo(path) {
  location.href = tvPath(path);
}

async function api(path, opts = {}) {
  const { headers: extraHeaders, ...rest } = opts;
  const res = await fetch(tvPath(path), {
    credentials: "same-origin",
    ...rest,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
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

/** Panel-interne Tabs: Gruppe mit [data-panel-group], Buttons [data-panel-tab], Panels [data-panel-pane]. */
function bindPanelTabs(root, group, opts = {}) {
  const scope = root.querySelector(`[data-panel-group="${group}"]`);
  if (!scope) return;
  const tabs = [...scope.querySelectorAll(`[data-panel-tab]`)].filter(
    (btn) => btn.closest("[data-panel-group]") === scope
  );
  const panes = [...scope.querySelectorAll(`[data-panel-pane]`)].filter(
    (pane) => pane.closest("[data-panel-group]") === scope
  );
  function show(id) {
    tabs.forEach((btn) => {
      const on = btn.dataset.panelTab === id;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    panes.forEach((pane) => {
      const on = pane.dataset.panelPane === id;
      pane.classList.toggle("active", on);
      pane.hidden = !on;
    });
    if (typeof opts.onShow === "function") opts.onShow(id);
  }
  tabs.forEach((btn) => {
    btn.onclick = () => show(btn.dataset.panelTab);
  });
  const initial = tabs.find((b) => b.classList.contains("active"))?.dataset.panelTab || tabs[0]?.dataset.panelTab;
  if (initial) show(initial);
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
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
  more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
};

function icon(name, cls) {
  const body = ICO[name] || ICO.key;
  return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Info callout with icon — for explanatory hints (not status lines or inline labels). */
function hintBox(bodyHtml, opts = {}) {
  const { id, hidden, className } = opts;
  let cls = "hint-box";
  if (className) cls += " " + className;
  let attrs = `class="${cls}" role="note"`;
  if (id) attrs += ` id="${id}"`;
  if (hidden) attrs += " hidden";
  return `<div ${attrs}>
    <span class="hint-box-icon" aria-hidden="true">${icon("info", "hint-box-ico")}</span>
    <div class="hint-box-body">${bodyHtml}</div>
  </div>`;
}

function setHintBox(el, html) {
  if (!el) return;
  const body = el.querySelector(".hint-box-body") || el;
  body.textContent = String(html == null ? "" : html).replace(/<[^>]*>/g, "");
}

function navLink(nav, icoName, label, extraClass, attrs) {
  const cls = ["sidebar-link", extraClass].filter(Boolean).join(" ");
  const extra = attrs ? " " + attrs : "";
  return `<button type="button" class="${cls}" data-nav="${nav}"${extra}><span class="nav-ico">${icon(icoName)}</span><span>${label}</span></button>`;
}

function navSectionDefaultCollapsed(sectionId) {
  return sectionId === "admin";
}

function navSubsectionDefaultCollapsed() {
  return true;
}

function navSection(sectionId, title, bodyHtml, sectionAttrs) {
  const extra = sectionAttrs ? ` ${sectionAttrs}` : "";
  const collapsed = navSectionDefaultCollapsed(sectionId);
  return `<div class="sidebar-section${collapsed ? " collapsed" : ""}" data-nav-section="${sectionId}"${extra}>
    <button type="button" class="sidebar-section-toggle" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="navSec-${sectionId}">
      <span class="sidebar-section-chevron" aria-hidden="true">${icon("chevron")}</span>
      <span class="sidebar-section-title-text">${title}</span>
    </button>
    <div class="sidebar-section-body" id="navSec-${sectionId}">
      ${bodyHtml}
    </div>
  </div>`;
}

function navSubSection(subId, title, bodyHtml) {
  const collapsed = navSubsectionDefaultCollapsed();
  return `<div class="sidebar-subsection${collapsed ? " collapsed" : ""}" data-nav-subsection="${subId}">
    <button type="button" class="sidebar-subsection-toggle" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="navSub-${subId}">
      <span class="sidebar-section-chevron" aria-hidden="true">${icon("chevron")}</span>
      <span>${title}</span>
    </button>
    <div class="sidebar-subsection-body" id="navSub-${subId}">
      ${bodyHtml}
    </div>
  </div>`;
}

const NAV_SECTIONS_KEY = "tv-nav-sections";
const NAV_SUBSECTIONS_KEY = "tv-nav-subsections";

function loadNavSectionsState() {
  try {
    const raw = localStorage.getItem(NAV_SECTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveNavSectionState(sectionId, collapsed) {
  try {
    const state = loadNavSectionsState();
    state[sectionId] = collapsed;
    localStorage.setItem(NAV_SECTIONS_KEY, JSON.stringify(state));
  } catch (_) {}
}

function loadNavSubsectionsState() {
  try {
    const raw = localStorage.getItem(NAV_SUBSECTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveNavSubsectionState(subId, collapsed) {
  try {
    const state = loadNavSubsectionsState();
    state[subId] = collapsed;
    localStorage.setItem(NAV_SUBSECTIONS_KEY, JSON.stringify(state));
  } catch (_) {}
}

function navSectionIdForRoute(nav) {
  if (nav === "account") return "account";
  if (nav && nav.startsWith("admin:")) return "admin";
  return "vault";
}

function navSubsectionIdForRoute(nav) {
  if (!nav || !nav.startsWith("admin:")) return null;
  const key = nav.slice("admin:".length);
  if (key === "users" || key === "groups") return "admin-org";
  if (key === "trust" || key === "access" || key === "ldap" || key === "smtp") return "admin-connect";
  if (key === "crypto" || key === "recovery" || key === "apikeys") return "admin-security";
  if (key === "platform" || key === "system" || key === "audit") return "admin-platform";
  return null;
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
  help.href = tvPath("/help");
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
  const raw = String((info && info.version) || "dev").trim();
  const developer = (info && info.developer) || "Timo Braun";
  const semver = raw.match(/^v?(\d+\.\d+\.\d+)(?:[-+].*)?$/i);
  const version = semver ? `v${semver[1]}` : "dev";
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

function paintSessionBar(root, data) {
  const info = root.querySelector("#info");
  if (!info) return;
  if (data?.expired) info.textContent = "Offline-Kopie abgelaufen";
  else if (data?.snapshot) info.textContent = formatOfflineSessionInfo(data.snapshot);
  else if (data?.me) info.textContent = formatSessionInfo(data.me);
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

function flashCopyIcon(btn) {
  if (!btn) return;
  btn.classList.add("copied");
  const prev = btn.getAttribute("aria-label");
  btn.setAttribute("aria-label", "Kopiert");
  setTimeout(() => {
    btn.classList.remove("copied");
    if (prev) btn.setAttribute("aria-label", prev);
  }, 1200);
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
      ${hintBox("Zero-Knowledge Passwortmanager. Secrets werden nur clientseitig entschlüsselt. Genau ein Bootstrap-Secret entsperrt die Config.")}
      ${hintBox("Der erste Admin ist immer lokal authentifiziert (Schutz vor LDAP-Aussperrung).")}
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
      <label>Login-Passwort (${PASSWORD_POLICY})</label><input id="pw" type="password" minlength="16" />
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
      const pwErr = localLoginPasswordError(d.admin.password);
      if (pwErr) { err.hidden = false; err.textContent = pwErr; return; }
      state.step = 3; repaint();
    };
    return n;
  }
  if (state.step === 3) {
    const n = el(`<div>
      <h1>Argon2id-Parameter</h1>
      ${hintBox("Clientseitige Vault-KDF (Master-Passwort). Login-Hash ist getrennt.")}
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
      ${hintBox("Escrow-Shares werden nicht im Wizard erzeugt — erst in der Admin-UI nach Login.")}
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
    ${hintBox("Atomarer Commit — danach ist das System initialisiert. Das Setup-Token steht in der Server-Konsole und in der Datei setup.token im Datenverzeichnis.")}
    <pre class="hint" id="sum"></pre>
    <label>Setup-Token</label>
    <input id="setup_token" type="password" autocomplete="off" />
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
  n.querySelector("#setup_token").value = d.setup_token || "";
  n.querySelector("[data-b]").onclick = () => { state.step = 4; repaint(); };
  n.querySelector("[data-n]").onclick = async () => {
    const err = n.querySelector("#err");
    const ok = n.querySelector("#ok");
    err.hidden = true; ok.hidden = true;
    d.setup_token = (n.querySelector("#setup_token").value || "").trim();
    if (!d.setup_token) { err.hidden = false; err.textContent = "Setup-Token fehlt (Server-Konsole / setup.token)"; return; }
    try {
      const body = {
        storage: d.storage,
        tenant: d.tenant,
        admin: { username: d.admin.username, display_name: d.admin.display_name, email: d.admin.email, password: d.admin.password },
        argon2: d.argon2,
      };
      const res = await api("/api/setup/commit", {
        method: "POST",
        headers: { "X-TeamVault-Setup-Token": d.setup_token },
        body: JSON.stringify(body),
      });
      ok.hidden = false;
      ok.textContent = `OK — Tenant ${res.tenant_id}. Weiter zum Login…`;
      setTimeout(() => { tvGo("/login"); }, 800);
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };
  return n;
}

function totpDigitRowHTML(idPrefix = "totpD") {
  const inputs = Array.from({ length: 6 }, (_, i) =>
    `<input class="totp-digit" id="${idPrefix}${i}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1"${i === 0 ? ' autocomplete="one-time-code"' : ' autocomplete="off"'} aria-label="TOTP Ziffer ${i + 1}" />`
  ).join("");
  return `<div class="totp-digit-row" data-totp-row="${idPrefix}">${inputs}</div>`;
}

function bindTotpDigitInputs(rowEl, opts = {}) {
  const inputs = [...rowEl.querySelectorAll(".totp-digit")];
  function readCode() {
    return inputs.map((inp) => inp.value.replace(/\D/g, "").slice(-1)).join("");
  }
  function clear() {
    inputs.forEach((inp) => { inp.value = ""; });
    inputs[0]?.focus();
  }
  inputs.forEach((inp, idx) => {
    inp.addEventListener("input", () => {
      const v = inp.value.replace(/\D/g, "");
      inp.value = v.slice(-1);
      if (inp.value && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (readCode().length === 6 && typeof opts.onComplete === "function") opts.onComplete(readCode());
    });
    inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Backspace" && !inp.value && idx > 0) {
        inputs[idx - 1].focus();
        inputs[idx - 1].value = "";
      }
      if (ev.key === "ArrowLeft" && idx > 0) inputs[idx - 1].focus();
      if (ev.key === "ArrowRight" && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (ev.key === "Enter" && typeof opts.onEnter === "function") opts.onEnter(readCode());
    });
    inp.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const text = (ev.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      text.split("").forEach((ch, i) => { if (inputs[i]) inputs[i].value = ch; });
      const next = Math.min(text.length, inputs.length - 1);
      inputs[next]?.focus();
      if (text.length >= 6 && typeof opts.onComplete === "function") opts.onComplete(readCode());
    });
  });
  return { readCode, clear, focusFirst: () => inputs[0]?.focus() };
}

function renderLogin(app) {
  const n = el(`<div class="panel">
    <h1>Login</h1>
    <div id="loginStep1">
      ${hintBox("Login-Passwort oder Passkey. Zum Entschlüsseln des Vaults brauchen Sie weiterhin Ihr Master-Passwort.")}
      <label>Organisation</label>
      <select id="slug" autocomplete="organization" disabled>
        <option value="">Lade Organisationen…</option>
      </select>
      ${hintBox("Bestehende Mandanten — Auswahl für diesen Login.")}
      <label>Username</label><input id="user" autocomplete="username" />
      <label>Passwort</label><input id="pw" type="password" autocomplete="current-password" />
      <div class="error login-err" hidden></div>
      <div class="row">
        <button class="btn-accent" type="button" id="doLogin">Anmelden</button>
        <button class="btn-ghost" type="button" id="doPasskey">Passkey</button>
      </div>
      <div id="offlineLogin" class="offline-login" hidden>
        <hr />
        ${hintBox("Ohne Netzwerk: gespeicherte verschlüsselte Kopie mit Master-Passwort entsperren (kein Login, kein TOTP).")}
        <p class="error" id="offlineExpired" hidden role="alert"></p>
        <button class="btn-ghost btn-with-ico" type="button" id="doOffline">${btnLabel("unlock", "Offline entsperren")}</button>
      </div>
    </div>
    <div id="loginStep2" hidden>
      <p class="login-step-title">Zwei-Faktor-Authentifizierung</p>
      ${hintBox("Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.")}
      ${totpDigitRowHTML("loginTotp")}
      <div class="error login-err" hidden></div>
      <div class="row">
        <button class="btn-accent" type="button" id="doTotpLogin">Bestätigen</button>
        <button class="btn-ghost" type="button" id="totpBack">Zurück</button>
      </div>
    </div>
  </div>`);
  const slugSel = n.querySelector("#slug");
  const step1 = n.querySelector("#loginStep1");
  const step2 = n.querySelector("#loginStep2");
  let pendingLoginToken = "";
  const totpCtrl = bindTotpDigitInputs(n.querySelector("#loginTotp0").closest(".totp-digit-row"), {
    onComplete: () => n.querySelector("#doTotpLogin")?.click(),
    onEnter: () => n.querySelector("#doTotpLogin")?.click(),
  });

  function setLoginErr(msg) {
    n.querySelectorAll(".login-err").forEach((el) => {
      if (msg) {
        el.hidden = false;
        el.textContent = msg;
      } else {
        el.hidden = true;
        el.textContent = "";
      }
    });
  }

  function showTotpStep(token) {
    pendingLoginToken = token;
    step1.hidden = true;
    step2.hidden = false;
    setLoginErr("");
    totpCtrl.clear();
  }

  function showStep1() {
    pendingLoginToken = "";
    step2.hidden = true;
    step1.hidden = false;
    setLoginErr("");
    totpCtrl.clear();
  }

  async function finishAuth(res, tenantSlug) {
    if (res.needs_totp && res.login_token) {
      showTotpStep(res.login_token);
      return;
    }
    if (tenantSlug) {
      try { localStorage.setItem("tv-tenant-slug", tenantSlug); } catch (_) {}
    }
    tvGo(res.needs_vault_onboard ? "/onboard" : "/app");
  }
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
    setLoginErr("");
    try {
      const tenantSlug = slugSel.value.trim();
      if (!tenantSlug) throw new Error("Bitte Organisation wählen");
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          tenant_slug: tenantSlug,
          username: n.querySelector("#user").value.trim(),
          password: n.querySelector("#pw").value,
        }),
      });
      await finishAuth(res, tenantSlug);
    } catch (e) {
      setLoginErr(e.message);
    }
  };
  ["#pw", "#user", "#slug"].forEach((sel) => {
    n.querySelector(sel).addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") n.querySelector("#doLogin").click();
    });
  });
  n.querySelector("#doPasskey").onclick = async () => {
    setLoginErr("");
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
        }),
      });
      await finishAuth(res, tenant);
    } catch (e) {
      setLoginErr(e.message);
    }
  };
  n.querySelector("#doTotpLogin").onclick = async () => {
    setLoginErr("");
    try {
      const code = totpCtrl.readCode();
      if (code.length !== 6) throw new Error("Bitte 6-stelligen TOTP-Code eingeben");
      if (!pendingLoginToken) throw new Error("Anmeldung abgelaufen — bitte erneut anmelden");
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login_token: pendingLoginToken, totp_code: code }),
      });
      await finishAuth(res, slugSel.value.trim());
    } catch (e) {
      setLoginErr(e.message);
      totpCtrl.clear();
    }
  };
  n.querySelector("#totpBack").onclick = showStep1;
  (async () => {
    if (!window.TVOfflineStore?.isAvailable()) return;
    try {
      const valid = await TVOfflineStore.listSnapshots({ validOnly: true });
      const all = await TVOfflineStore.listSnapshots({ validOnly: false });
      const expired = all.filter((s) => s.expired);
      const box = n.querySelector("#offlineLogin");
      const expiredEl = n.querySelector("#offlineExpired");
      if (valid.length) {
        box.hidden = false;
        if (expiredEl) expiredEl.hidden = true;
      } else if (expired.length) {
        box.hidden = false;
        if (expiredEl) {
          expiredEl.hidden = false;
          expiredEl.textContent =
            "Offline-Kopie abgelaufen (max. 30 Tage). Bitte online anmelden und unter Konto neu synchronisieren.";
        }
        n.querySelector("#doOffline").disabled = true;
      }
    } catch (_) {}
  })();
  n.querySelector("#doOffline").onclick = () => {
    tvGo("/app?offline=1");
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
  const wrap = el(`<div class="onboard-wrap">
    <div class="steps" id="obStepper">
      <span class="on" data-ob-step="1">1. Master-Passwort</span>
      <span data-ob-step="2">2. Recovery-Kit</span>
      <span data-ob-step="3">3. Fertig</span>
    </div>
    <div class="panel" id="obPanel"></div>
  </div>`);
  const panel = wrap.querySelector("#obPanel");
  const stepper = wrap.querySelector("#obStepper");

  function setStepper(active, escrowMode) {
    const labels = escrowMode
      ? ["1. Master-Passwort", "2. Fertig"]
      : ["1. Master-Passwort", "2. Recovery-Kit", "3. Fertig"];
    stepper.innerHTML = labels.map((label, i) => {
      const n = i + 1;
      return `<span class="${n === active ? "on" : ""}" data-ob-step="${n}">${label}</span>`;
    }).join("");
  }

  function renderPasswordStep() {
    setStepper(1, false);
    panel.innerHTML = `
      <h1>Vault-Onboarding</h1>
      ${hintBox("Legen Sie Ihr persönliches Master-Passwort fest. Es wird nur im Browser verwendet (Zero-Knowledge) — der Server sieht es nie. Anforderungen: " + PASSWORD_POLICY + ".")}
      <label>Master-Passwort (${PASSWORD_POLICY})</label>
      <input id="mpw" type="password" autocomplete="new-password" minlength="16" />
      <label>Wiederholen</label>
      <input id="mpw2" type="password" autocomplete="new-password" minlength="16" />
      <div class="error" id="err" hidden></div>
      <div class="row onboard-actions">
        <button class="btn-accent" type="button" id="doOnboard">Schlüssel erzeugen</button>
      </div>`;
    panel.querySelector("#doOnboard").onclick = runOnboard;
    panel.querySelector("#mpw2").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") panel.querySelector("#doOnboard").click();
    });
  }

  async function runOnboard() {
    const err = panel.querySelector("#err");
    err.hidden = true;
    const btn = panel.querySelector("#doOnboard");
    const mpw = panel.querySelector("#mpw").value;
    if (mpw !== panel.querySelector("#mpw2").value) {
      err.hidden = false;
      err.textContent = "Master-Passwort stimmt nicht überein.";
      return;
    }
    const pwErr = masterPasswordError(mpw);
    if (pwErr) {
      err.hidden = false;
      err.textContent = pwErr;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Wird erzeugt…";
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
      let kitB64 = "";
      let kitText = "";
      const escrowMode = me.recovery_mode === "admin_escrow";
      if (escrowMode) {
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
        kitB64 = TVCrypto.b64enc(kit);
        kitText =
          "TeamVault Recovery-Kit\n" +
          "Bewahren Sie diese Datei sicher auf.\n" +
          "Ohne Kit und ohne Master-Passwort sind Secrets verloren.\n\n" +
          kitB64 + "\n";
        kit.fill(0);
      }
      id.secretKey.fill(0);
      await api("/api/vault/onboard", { method: "POST", body: JSON.stringify(body) });
      renderDoneStep({ escrowMode, kitB64, kitText });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Schlüssel erzeugen";
      err.hidden = false;
      err.textContent = e.message;
    }
  }

  function renderDoneStep({ escrowMode, kitB64, kitText }) {
    setStepper(2, escrowMode);
    const kitSection = escrowMode ? "" : `
      <h2>Recovery-Kit sichern</h2>
      ${hintBox("Dieses Kit wird nur einmal angezeigt. Ohne Kit und ohne Master-Passwort sind Ihre Secrets nicht wiederherstellbar.")}
      <ol class="onboard-checklist">
        <li>Recovery-Kit <strong>kopieren</strong> oder als Datei <strong>herunterladen</strong></li>
        <li>An einem sicheren Ort aufbewahren (Passwort-Manager, Tresor, …)</li>
        <li>Unten bestätigen und zur App wechseln</li>
      </ol>
      <code class="mono onboard-kit" id="kitval"></code>
      <div class="row onboard-kit-actions">
        <button class="btn-ghost" type="button" id="kitCopy">In Zwischenablage kopieren</button>
        <button class="btn-ghost" type="button" id="kitDl">Als .txt herunterladen</button>
      </div>
      <label class="inline onboard-confirm"><input id="kitSaved" type="checkbox" /> Ich habe das Recovery-Kit gesichert</label>`;
    panel.innerHTML = `
      <h1>Vault eingerichtet</h1>
      <div class="onboard-success">
        <strong>Schlüssel wurden erfolgreich erzeugt.</strong>
        ${escrowMode
          ? hintBox("Ihr privater Schlüssel liegt verschlüsselt auf dem Server. Wiederherstellung erfolgt über den Admin-Escrow.")
          : hintBox("Bevor Sie fortfahren, sichern Sie bitte Ihr Recovery-Kit.")}
      </div>
      ${kitSection}
      <div class="error" id="err" hidden></div>
      <div class="row onboard-actions">
        <button class="btn-accent" type="button" id="goApp" ${escrowMode ? "" : "disabled"}>Weiter zur App</button>
      </div>`;
    if (!escrowMode) {
      panel.querySelector("#kitval").textContent = kitB64;
      panel.querySelector("#kitCopy").onclick = async (ev) => {
        await copyText(kitB64);
        flashCopy(ev.currentTarget);
      };
      panel.querySelector("#kitDl").onclick = () => downloadText("TeamVault-recovery-kit.txt", kitText);
      const goBtn = panel.querySelector("#goApp");
      const saved = panel.querySelector("#kitSaved");
      saved.onchange = () => {
        goBtn.disabled = !saved.checked;
        if (saved.checked) setStepper(3, false);
      };
    }
    panel.querySelector("#goApp").onclick = () => tvGo("/app");
  }

  renderPasswordStep();
  app.appendChild(wrap);
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
  tagFilters: [],
  ownershipFilter: "mine", // mine | shared (legacy; use listScope)
  listScope: "mine", // mine | shared | favorites
  sortMode: (function () {
    try {
      const v = localStorage.getItem("tv-secrets-sort");
      if (v === "title-asc" || v === "title-desc" || v === "recent") return v;
    } catch (_) {}
    return "title-asc";
  })(),
  userFavoriteIds: new Set(),
  viewMode: (function () {
    try {
      const v = localStorage.getItem("tv-secrets-view");
      if (v === "table" || v === "tiles" || v === "list") return v;
    } catch (_) {}
    return "table";
  })(),
  usersViewMode: (function () {
    try {
      const v = localStorage.getItem("tv-users-view");
      if (v === "table" || v === "tiles" || v === "list") return v;
    } catch (_) {}
    return "table";
  })(),
  adminUsers: [],
  adminOverview: null,
  groups: [],
  totpTimer: null,
  selectedIds: new Set(),
  offlineSyncRunning: false,
};

function userFavoritesStorageKey() {
  const me = vault.me;
  if (!me?.user_id || !me?.tenant_id) return null;
  return `tv-fav:${me.tenant_id}:${me.user_id}`;
}

function loadUserFavoritesFromStorage() {
  const key = userFavoritesStorageKey();
  if (!key) {
    vault.userFavoriteIds = new Set();
    return;
  }
  try {
    const raw = localStorage.getItem(key);
    vault.userFavoriteIds = new Set(raw ? JSON.parse(raw) : []);
  } catch (_) {
    vault.userFavoriteIds = new Set();
  }
}

function persistUserFavorites() {
  const key = userFavoritesStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...vault.userFavoriteIds]));
  } catch (_) {}
}

function isUserFavorite(secretId) {
  return vault.userFavoriteIds.has(secretId);
}

function setUserFavorite(secretId, on) {
  if (!secretId) return;
  if (on) vault.userFavoriteIds.add(secretId);
  else vault.userFavoriteIds.delete(secretId);
  persistUserFavorites();
}

function toggleUserFavorite(secretId) {
  setUserFavorite(secretId, !isUserFavorite(secretId));
}

function removeUserFavorite(secretId) {
  if (!secretId || !vault.userFavoriteIds.has(secretId)) return;
  vault.userFavoriteIds.delete(secretId);
  persistUserFavorites();
}

function isAdmin() {
  const roles = vault.me?.roles || [];
  return roles.includes("tenant_admin") || roles.includes("platform_admin");
}

function isPlatformAdmin() {
  return (vault.me?.roles || []).includes("platform_admin");
}

function isTenantAdminOnly() {
  return isAdmin() && !isPlatformAdmin();
}

const PLATFORM_ADMIN_NAV = new Set([
  "admin:trust", "admin:access", "admin:smtp", "admin:crypto",
  "admin:apikeys", "admin:platform", "admin:system",
]);

const PLATFORM_ADMIN_SECTIONS = new Set([
  "trust", "access", "smtp", "crypto", "apikeys", "platform", "system",
]);

function canAccessAdminNav(nav) {
  if (isAuditorOnly()) return nav === "admin:audit";
  if (!isAdmin()) return false;
  if (PLATFORM_ADMIN_NAV.has(nav)) return isPlatformAdmin();
  return true;
}

function defaultAdminNav() {
  if (isAuditorOnly()) return "admin:audit";
  return "admin:users";
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
  const params = keys.argon2 || await api("/api/vault/crypto-params");
  const sk = await TVCrypto.unlockPrivateKey(
    masterPassword,
    TVCrypto.b64dec(keys.salt_b64),
    TVCrypto.b64dec(keys.encrypted_private_key_nonce_b64),
    TVCrypto.b64dec(keys.encrypted_private_key_b64),
    params
  );
  vault.sk = sk;
  vault.params = params;
  if (keys.kdf_params_stored === false) {
    api("/api/vault/kdf-params", { method: "POST", body: JSON.stringify({ argon2: params }) }).catch(() => {});
  }
}

function offlinePolicyAllowed() {
  return vault.policy?.offline_cache_allowed !== false;
}

function cliIntegrationEnabled() {
  return vault.policy?.cli_integration_enabled === true;
}

function browserIntegrationEnabled() {
  return vault.policy?.browser_integration_enabled === true;
}

function anyClientIntegrationEnabled() {
  return cliIntegrationEnabled() || browserIntegrationEnabled();
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

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fieldRow(label, value, opts = {}) {
  const { copy = true, mask = false, multiline = false, download = false } = opts;
  const display = value == null || value === "" ? "—" : String(value);
  const safe = escapeHtml(display);
  const copyAttr = copy && display !== "—" ? `data-copy="${encodeURIComponent(String(value))}"` : "";
  const dlAttr = download && display !== "—" ? `data-download="${encodeURIComponent(String(value))}" data-dlname="${encodeURIComponent(opts.filename || label || "download.txt")}"` : "";
  const actions = [];
  if (copy && display !== "—") actions.push(`<button type="button" class="copy-btn" ${copyAttr} title="Kopieren" aria-label="Kopieren">${btnLabel("copy", "Kopieren")}</button>`);
  if (download && display !== "—") actions.push(`<button type="button" class="copy-btn" ${dlAttr} title="Download" aria-label="Download">${btnLabel("download", "Download")}</button>`);
  return `<div class="secret-field${multiline ? " secret-field-block" : ""}">
    <div class="sf-label">${escapeHtml(label)}</div>
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

function extraAddSelectHtml() {
  return EXTRA_ADD_OPTIONS.map((o) => `<option value="${o.type}">${o.label}</option>`).join("");
}

function slotContainerHasType(slotsEl, type) {
  return !!slotsEl?.querySelector(`[data-slot-type="${type}"]`);
}

/** Append an extra field row; optional prefill: { id, value, label, favorite }. */
function addExtraSlot(slotsEl, type, prefill) {
  const def = EXTRA_ADD_OPTIONS.find((o) => o.type === type);
  if (!def || !slotsEl) return null;
  if (def.singleton && slotContainerHasType(slotsEl, type)) {
    throw new Error(def.label + " ist bereits hinzugefügt");
  }
  const pf = prefill && typeof prefill === "object" ? prefill : {};
  const id = String(pf.id || newExtraId());
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
    const lab = String(pf.label || label).replace(/"/g, "&quot;");
    body = `<label>Bezeichnung</label><input class="slot-label" value="${lab}" />
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
  if (type === "favorite") {
    const cb = row.querySelector(".slot-fav");
    if (cb) cb.checked = !!pf.favorite;
  } else if (pf.value != null && pf.value !== "") {
    const val = row.querySelector(".slot-val");
    if (val) val.value = String(pf.value);
  }
  slotsEl.appendChild(row);
  return row;
}

/** Build payload from core fields + extra slots (same shape as create). */
function collectPayloadFromSlots(slotsEl, core) {
  const payload = {
    username: String(core?.username || ""),
    password: String(core?.password || ""),
    urls: [],
    notes: "",
    totp_seed: "",
    tags: [],
    favorite: false,
    extra: [],
  };
  (slotsEl ? slotsEl.querySelectorAll(".extra-slot") : []).forEach((row) => {
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
  payload.tags = mergeTags(payload.tags, parseTagsInput(core?.tagsInput));
  return payload;
}

/** Fill slot container from an existing normalized payload. */
function hydrateExtraSlots(slotsEl, payload) {
  if (!slotsEl) return;
  slotsEl.innerHTML = "";
  const p = normalizeSecretPayload(payload);
  for (const u of p.urls) addExtraSlot(slotsEl, "url", { value: u });
  if (p.totp_seed) addExtraSlot(slotsEl, "totp", { value: p.totp_seed });
  if (p.notes) addExtraSlot(slotsEl, "notes", { value: p.notes });
  if (p.favorite) addExtraSlot(slotsEl, "favorite", { favorite: true });
  for (const e of p.extra) {
    const known = EXTRA_ADD_OPTIONS.some((o) => o.type === e.type);
    addExtraSlot(slotsEl, known ? e.type : "text", {
      id: e.id,
      label: e.label,
      value: e.value,
    });
  }
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
    <aside class="app-sidebar" id="appSidebar">
      <div class="app-sidebar-brand">${icon("shield", "brand-ico")} <span>TeamVault</span></div>
      <nav class="app-sidebar-nav" id="appSidebarNav">
        ${navSection("vault", "Vault", `
          ${navLink("vault:mine", "key", "Meine Secrets", "active")}
          ${navLink("vault:shared", "share", "Geteilte Secrets")}
          ${navLink("vault:favorites", "star", "Favoriten")}
          ${navLink("vault:create", "plus", "Neu anlegen")}
          ${navLink("vault:import", "upload", "Import")}
          ${navLink("vault:backup", "download", "Sicherung")}
        `)}
        ${navSection("account", "Konto", `
          ${navLink("account", "user", "Konto")}
          <a class="sidebar-link" href="${tvPath("/help")}" target="_blank" rel="noopener"><span class="nav-ico">${icon("book")}</span><span>Hilfe</span></a>
        `)}
        ${navSection("admin", "Administration", `
          ${navSubSection("admin-org", "Benutzer &amp; Gruppen", `
            ${navLink("admin:users", "users", "Benutzer", "admin-link", 'data-admin-only')}
            ${navLink("admin:groups", "group", "Gruppen", "admin-link", 'data-admin-only')}
          `)}
          ${navSubSection("admin-connect", "Verbindungen", `
            ${navLink("admin:trust", "cert", "Firmen-CA", "admin-link", 'data-admin-only data-platform-only')}
            ${navLink("admin:access", "network", "Zugriff &amp; Proxy", "admin-link", 'data-admin-only data-platform-only')}
            ${navLink("admin:ldap", "network", "LDAP", "admin-link", 'data-admin-only')}
            ${navLink("admin:smtp", "mail", "SMTP", "admin-link", 'data-admin-only data-platform-only')}
          `)}
          ${navSubSection("admin-security", "Sicherheit", `
            ${navLink("admin:crypto", "shield", "Krypto &amp; Policy", "admin-link", 'data-admin-only data-platform-only')}
            ${navLink("admin:recovery", "lock", "Recovery &amp; Escrow", "admin-link", 'data-admin-only')}
            ${navLink("admin:apikeys", "key", "API-Keys", "admin-link", 'data-admin-only data-platform-only')}
          `)}
          ${navSubSection("admin-platform", "Plattform", `
            ${navLink("admin:platform", "building", "Tenants &amp; Migration", "admin-link platform-link", 'data-admin-only data-platform-only hidden')}
            ${navLink("admin:system", "info", "System", "admin-link", 'data-admin-only data-platform-only')}
            ${navLink("admin:audit", "clipboard", "Audit", "admin-link", 'data-admin-only')}
          `)}
        `, 'id="navAdminSection" hidden')}
      </nav>
      <div class="app-sidebar-foot">
        <p class="offline-sync-bar hint" id="offlineSyncBar" hidden role="status"></p>
        <button class="btn-ghost btn-with-ico btn-sm" type="button" id="out">${btnLabel("logout", "Abmelden")}</button>
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
            ${hintBox("Idle-Timeout. Master-Passwort erneut eingeben (bleibt nur im Speicher).")}
            <label for="lockMpw">Master-Passwort</label>
            <input id="lockMpw" type="password" autocomplete="current-password" />
            <div class="error" id="lockErr" hidden role="alert"></div>
            <div class="row"><button class="btn-accent btn-with-ico" type="button" id="lockUnlock">${btnLabel("unlock", "Entsperren")}</button></div>
          </div>
        </div>

        <div class="panel app-unlock-panel" id="unlock">
          <h1>${icon("unlock", "heading-ico")} Vault entsperren</h1>
          ${hintBox("Master-Passwort bleibt im Browser (Zero-Knowledge).", { id: "unlockLead" })}
          ${hintBox("Offline: nur Master-Passwort — kein Login und kein TOTP.", { id: "offlineUnlockHint", hidden: true })}
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
                    <div class="tag-filter-wrap">
                      <label>Tags <span class="hint">(UND)</span></label>
                      <div class="tag-filter" id="stagFilter">
                        <button type="button" class="tag-filter-toggle btn-ghost btn-sm" id="stagToggle" aria-expanded="false" aria-controls="stagMenu">Tags wählen…</button>
                        <div class="tag-filter-selected tags" id="stagSelected"></div>
                        <div class="tag-filter-menu" id="stagMenu" hidden>
                          <p class="hint tag-filter-hint">Mehrere Tags = alle müssen passen</p>
                          <div id="stagOptions" class="tag-filter-options"></div>
                          <button type="button" class="btn-ghost btn-sm" id="stagClear">Filter leeren</button>
                        </div>
                      </div>
                    </div>
                    <div class="secrets-sort-wrap">
                      <label for="ssort">Sortierung</label>
                      <select id="ssort" class="secrets-sort-select">
                        <option value="title-asc">Titel A–Z</option>
                        <option value="title-desc">Titel Z–A</option>
                        <option value="recent">Zuletzt geändert</option>
                      </select>
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
                  <div class="secrets-chrome-foot">
                    <span class="hint" id="sCount"></span>
                    <div class="secrets-actions-wrap" id="sActionsWrap">
                      <button type="button" class="btn-ghost btn-sm btn-with-ico" id="sActionsToggle" aria-expanded="false" aria-controls="sActionsMenu" aria-haspopup="true">
                        ${btnLabel("more", "Aktionen")}
                      </button>
                      <div class="secrets-actions-menu panel-inset" id="sActionsMenu" hidden role="menu">
                        <p class="secrets-actions-heading">Auswahl</p>
                        <label class="secrets-actions-item inline"><input type="checkbox" id="selAllVisible" /> Alle sichtbaren</label>
                        <button type="button" class="secrets-actions-item btn-ghost btn-sm" id="selAllLoaded" role="menuitem">Alle geladenen auswählen</button>
                        <button type="button" class="secrets-actions-item btn-ghost btn-sm" id="selClear" role="menuitem">Auswahl aufheben</button>
                        <p class="hint secrets-actions-meta" id="selCount">Keine Auswahl</p>
                        <div class="secrets-actions-export" id="sExportGroup">
                          <hr class="secrets-actions-divider" />
                          <p class="secrets-actions-heading">Export</p>
                          ${hintBox("Gilt für die aktuelle Auswahl (Häkchen in der Liste).", { className: "hint-box-compact" })}
                          <button type="button" class="secrets-actions-item btn-ghost btn-sm btn-with-ico" id="sExportTv" role="menuitem">${btnLabel("download", "TeamVault JSON")}</button>
                          <button type="button" class="secrets-actions-item btn-ghost btn-sm btn-with-ico" id="sExportJson" role="menuitem">${btnLabel("download", "Bitwarden JSON")}</button>
                          <button type="button" class="secrets-actions-item btn-ghost btn-sm btn-with-ico" id="sExportCsv" role="menuitem">${btnLabel("download", "CSV")}</button>
                          <button type="button" class="secrets-actions-item btn-ghost btn-sm btn-with-ico" id="sExportBak" role="menuitem">${btnLabel("lock", "Verschlüsselt (.tvbak)")}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="panel secrets-stage">
                  <div id="slist" class="list secrets-list"></div>
                  <div class="secrets-load-more" id="sLoadMoreWrap" hidden>
                    <p class="hint" id="sLoadMoreHint"></p>
                    <button type="button" class="btn-ghost btn-sm" id="sMore">Weitere laden</button>
                  </div>
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
                    <div id="accessPanel" class="access-panel" hidden>
                      <h3 class="access-panel-title">Zugriff</h3>
                      ${hintBox("Klicken oder per Drag &amp; Drop hinzufügen. Entfernen rotiert den Datenschlüssel.")}
                      <label class="inline access-cap-pick">Rechte für neue Freigaben
                        <select id="dShareCap" aria-label="Rechte für neue Freigaben">
                          <option value="read">Lesen</option>
                          <option value="write" selected>Bearbeiten</option>
                          <option value="share">Teilen</option>
                          <option value="admin">Verwalten</option>
                        </select>
                      </label>
                      <div class="access-workspace">
                        <div class="panel-inset access-col">
                          <h3>Verfügbar</h3>
                          <input id="accessAvailSearch" type="search" placeholder="Suchen…" autocomplete="off" />
                          <div id="accessAvailable" class="access-list drag-pool" data-zone="available"></div>
                        </div>
                        <div class="panel-inset access-col">
                          <h3>Aktueller Zugriff</h3>
                          <div id="accessCurrent" class="access-list group-drop" data-zone="current"></div>
                        </div>
                      </div>
                    </div>
                    <div class="row row-compact">
                      <button class="btn-danger btn-sm btn-with-ico" type="button" id="sdel">${btnLabel("trash", "Löschen")}</button>
                      <button class="btn-ghost btn-sm btn-with-ico" type="button" id="sExportOne">${btnLabel("download", "Export")}</button>
                    </div>
                  </div>
                  <div id="deditForm" hidden>
                    <label>Titel</label><input id="edtitle" />
                    <label>Tags</label><input id="edtags" placeholder="storage, prod (Komma)" autocomplete="off" />
                    <label>Benutzername</label><input id="eduser" autocomplete="off" />
                    <label>Passwort</label>
                    <div class="row gen-row" style="margin-top:0.35rem">
                      <input id="edpw" type="password" autocomplete="off" style="flex:1" />
                      <button class="btn-ghost btn-sm btn-with-ico" type="button" id="edpwShow">${btnLabel("eye", "Anzeigen")}</button>
                      <button class="btn-ghost btn-sm btn-with-ico" type="button" id="edpwGen">${btnLabel("spark", "Generator")}</button>
                    </div>
                    <div class="gen-opts hint">
                      Länge <input id="edpwLen" type="number" min="12" max="64" value="20" style="width:4rem" />
                      <label class="inline"><input id="edpwSym" type="checkbox" checked /> Symbole</label>
                    </div>
                    <div id="eextraSlots" class="extra-slots"></div>
                    <div class="row extra-add-row">
                      <label class="inline">Feld hinzufügen
                        <select id="eextraAdd">
                          <option value="">— wählen —</option>
                          ${extraAddSelectHtml()}
                        </select>
                      </label>
                      <button class="btn-ghost btn-sm" type="button" id="eextraAddBtn">Hinzufügen</button>
                    </div>
                    <div class="row row-compact">
                      <button class="btn-accent btn-sm" type="button" id="dsave">Speichern</button>
                      <button class="btn-ghost btn-sm" type="button" id="dcancel">Abbrechen</button>
                    </div>
                  </div>
                  <div class="error" id="derr" hidden></div>
                </div>
              </div>
              <div class="secret-modal" id="shareAccessModal" hidden role="dialog" aria-modal="true" aria-labelledby="shareAccessTitle">
                <div class="secret-modal-backdrop" id="shareAccessBackdrop"></div>
                <div class="secret-modal-panel panel share-access-panel">
                  <div class="secret-modal-head">
                    <h1 id="shareAccessTitle">Zugriff</h1>
                    <button class="btn-ghost btn-sm" type="button" id="shareAccessClose">Schließen</button>
                  </div>
                  <p class="hint" id="shareAccessSubtitle"></p>
                  ${hintBox("Klicken oder per Drag &amp; Drop hinzufügen. Entfernen rotiert den Datenschlüssel.")}
                  <label class="inline access-cap-pick">Rechte für neue Freigaben
                    <select id="smShareCap" aria-label="Rechte für neue Freigaben">
                      <option value="read">Lesen</option>
                      <option value="write" selected>Bearbeiten</option>
                      <option value="share">Teilen</option>
                      <option value="admin">Verwalten</option>
                    </select>
                  </label>
                  <div class="access-workspace">
                    <div class="panel-inset access-col">
                      <h3>Verfügbar</h3>
                      <input id="smAccessSearch" type="search" placeholder="Suchen…" autocomplete="off" />
                      <div id="smAccessAvailable" class="access-list drag-pool" data-zone="available"></div>
                    </div>
                    <div class="panel-inset access-col">
                      <h3>Aktueller Zugriff</h3>
                      <div id="smAccessCurrent" class="access-list group-drop" data-zone="current"></div>
                    </div>
                  </div>
                  <div class="error" id="smAccessErr" hidden></div>
                </div>
              </div>
            </div>

            <div class="vault-section" data-vault="create">
              <div class="panel">
                ${hintBox("Privat = nur Sie unter „Meine Secrets“. Geteilt = Team-Eintrag unter „Geteilte Secrets“; Rechte der Empfänger unten wählbar (Standard: Bearbeiten).")}
                <div class="panel-tabs" role="tablist" aria-label="Secret-Typ" id="svisTabs">
                  <button type="button" class="panel-tab active" role="tab" data-svis="private" aria-selected="true">Privat</button>
                  <button type="button" class="panel-tab" role="tab" data-svis="shared" aria-selected="false">Geteilt</button>
                </div>
                <input type="hidden" id="svis" value="private" />
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
                      ${extraAddSelectHtml()}
                    </select>
                  </label>
                  <button class="btn-ghost" type="button" id="sextraAddBtn">Hinzufügen</button>
                </div>
                <div id="sshareWrap" hidden>
                  <label>Teilen mit Usern</label>
                  <select id="screateUsers" multiple size="4"></select>
                  ${hintBox("Strg/Cmd-Klick für Mehrfachauswahl. Mindestens ein User oder eine Gruppe.")}
                  <div id="screateGroupsWrap" hidden>
                    <label>Gruppen</label>
                    <select id="screateGroups" multiple size="3"></select>
                  </div>
                  <label class="inline access-cap-pick">Rechte der Empfänger
                    <select id="screateCap" aria-label="Rechte der Empfänger">
                      <option value="read">Lesen</option>
                      <option value="write" selected>Bearbeiten</option>
                      <option value="share">Teilen</option>
                      <option value="admin">Verwalten</option>
                    </select>
                  </label>
                </div>
                <div class="error" id="serr" hidden></div>
                <div class="row"><button class="btn-accent btn-with-ico" type="button" id="screate">${btnLabel("save", "Speichern (clientseitig verschlüsselt)")}</button></div>
              </div>
            </div>

            <div class="vault-section" data-vault="import">
              <div class="panel">
                ${hintBox("Unterstützt: TeamVault JSON/.tvbak, Bitwarden JSON, KeePass XML, KeePassXC/Chrome/Firefox/LastPass/1Password-CSV, Proton Pass JSON, 1Password 1PUX (<code>export.data</code>). Parsing und Verschlüsselung nur im Browser.")}
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
              <div class="panel" data-panel-group="backup">
                ${hintBox("Clientseitige Sicherung — der Server sieht keinen Klartext.")}
                <div class="panel-tabs" role="tablist" aria-label="Sicherung">
                  <button type="button" class="panel-tab active" role="tab" data-panel-tab="export" aria-selected="true">Sicherung erstellen</button>
                  <button type="button" class="panel-tab" role="tab" data-panel-tab="restore" aria-selected="false">Wiederherstellen</button>
                </div>
                <div class="panel-tab-pane active" role="tabpanel" data-panel-pane="export">
                  ${hintBox("Alle Secrets, die Sie entschlüsseln können, als <code>.tvbak</code> (Argon2id + AES-GCM). Backup-Passwort mindestens 12 Zeichen — getrennt vom Master-Passwort wählen.")}
                  <label>Backup-Passwort</label>
                  <input id="bak_pw" type="password" autocomplete="new-password" />
                  <label>Wiederholen</label>
                  <input id="bak_pw2" type="password" autocomplete="new-password" />
                  <div class="row">
                    <button class="btn-accent btn-with-ico" type="button" id="bak_create">${btnLabel("download", "Sicherung herunterladen")}</button>
                  </div>
                </div>
                <div class="panel-tab-pane" role="tabpanel" data-panel-pane="restore" hidden>
                  ${hintBox("TeamVault-Sicherung (<code>.tvbak</code>) oder Klartext-Export. Einträge werden als neue Secrets angelegt (kein Überschreiben bestehender IDs).")}
                  <input id="bak_file" type="file" accept=".tvbak,.json,application/json" />
                  <label>Backup-Passwort (bei .tvbak)</label>
                  <input id="bak_restore_pw" type="password" autocomplete="off" />
                  <div class="row">
                    <button class="btn-ghost btn-with-ico" type="button" id="bak_restore">${btnLabel("upload", "Wiederherstellen")}</button>
                    <span class="hint" id="bak_hint"></span>
                  </div>
                </div>
                <div class="error" id="bak_err" hidden></div>
                <div class="ok" id="bak_ok" hidden></div>
              </div>
            </div>
          </div>

          <div class="app-tab" data-pane="account">
            <div class="panel account-panel" data-panel-group="account">
              ${hintBox("Login-Absicherung und Geräte-Kopie — der Vault bleibt Master-Passwort-pflichtig.")}
              <div class="panel-tabs" role="tablist" aria-label="Konto-Bereiche">
                <button type="button" class="panel-tab active" role="tab" data-panel-tab="totp" aria-selected="true">TOTP</button>
                <button type="button" class="panel-tab" role="tab" data-panel-tab="passkeys" aria-selected="false">Passkeys</button>
                <button type="button" class="panel-tab" role="tab" data-panel-tab="login" aria-selected="false" hidden>Login-Passwort</button>
                <button type="button" class="panel-tab" role="tab" data-panel-tab="master" aria-selected="false">Master-Passwort</button>
                <button type="button" class="panel-tab" role="tab" data-panel-tab="offline" aria-selected="false">Offline-Vault</button>
                <button type="button" class="panel-tab" role="tab" data-panel-tab="clients" aria-selected="false" hidden>Clients</button>
              </div>

              <div class="panel-tab-pane active" role="tabpanel" data-panel-pane="totp">
                ${hintBox("Zwei-Faktor per Authenticator-App (nur Login). QR-Code kommt vom Server (scannbar).")}
                <div class="row">
                  <button class="btn-accent" type="button" id="totpSetup">TOTP einrichten</button>
                </div>
                ${hintBox("Nach dem Scannen den <strong>aktuellen</strong> 6-stelligen Code eingeben. „TOTP einrichten“ nicht erneut klicken — sonst stimmt der Authenticator-Eintrag nicht mehr.", { id: "totpSetupHint", hidden: true })}
                <div id="totpbox" hidden>
                  <div class="totp-setup-grid">
                    <div class="totp-qr-wrap" id="otpQr" aria-live="polite"></div>
                    <div>
                      <p class="hint">otpauth-URL:</p>
                      <pre class="mono" id="otpurl"></pre>
                      <div class="row">
                        <button class="btn-ghost" type="button" id="otpCopy">otpauth kopieren</button>
                        <button class="btn-ghost" type="button" id="otpReveal">Secret kurz anzeigen</button>
                      </div>
                      <p class="hint secret-reveal" id="otpSecret" hidden></p>
                    </div>
                  </div>
                  <label>Code bestätigen</label><input id="code" inputmode="numeric" autocomplete="one-time-code" />
                  <div class="row"><button class="btn-accent" type="button" id="en">Aktivieren</button></div>
                  <div class="error" id="terr" hidden></div>
                </div>
              </div>

              <div class="panel-tab-pane" role="tabpanel" data-panel-pane="passkeys" hidden>
                ${hintBox("Passkeys werden vom Browser bzw. Betriebssystem eingerichtet (Windows Hello, Face ID, Sicherheitsschlüssel). TeamVault erzeugt dafür keinen eigenen QR.")}
                <label>Name</label><input id="pkname" value="Mein Passkey" />
                <div id="pklist" class="list"></div>
                <div class="row"><button class="btn-accent" type="button" id="pkreg">Registrieren</button></div>
                <div class="error" id="pkerr" hidden></div>
              </div>

              <div class="panel-tab-pane" role="tabpanel" data-panel-pane="login" hidden>
                ${hintBox("Nur bei lokalem Auth-Backend. LDAP-User ändern das Passwort im Verzeichnis (LDAP/AD-Richtlinie).")}
                <label>Aktuelles Login-Passwort</label><input id="lpw_cur" type="password" autocomplete="current-password" />
                <label>Neues Login-Passwort (${PASSWORD_POLICY})</label><input id="lpw_new" type="password" autocomplete="new-password" minlength="16" />
                <div class="row"><button class="btn-accent" type="button" id="lpw_save">Login-Passwort speichern</button></div>
              </div>

              <div class="panel-tab-pane" role="tabpanel" data-panel-pane="master" hidden>
                ${hintBox("Clientseitig: Private Key wird neu versiegelt; Server speichert nur Ciphertexte. Recovery-Kit / Escrow wird mit erneuert. Neues Passwort: " + PASSWORD_POLICY + ".")}
                <label>Aktuelles Master-Passwort</label><input id="mpw_cur" type="password" autocomplete="current-password" />
                <label>Neues Master-Passwort (${PASSWORD_POLICY})</label><input id="mpw_new" type="password" autocomplete="new-password" minlength="16" />
                <label>Recovery-Kit speichern (bei user_kit)</label><input id="mpw_kit" type="text" readonly placeholder="wird erzeugt…" />
                <div class="row"><button class="btn-accent" type="button" id="mpw_save">Master-Passwort speichern</button></div>
              </div>

              <div class="panel-tab-pane" role="tabpanel" data-panel-pane="offline" hidden>
                ${hintBox("Verschlüsselte Kopie für Offline-Lesen (30 Tage, nur Ciphertext). Schreiben bleibt online.", { id: "offlineAccHint" })}
                <p class="hint" id="offlineAccStatus">—</p>
                <label class="inline"><input id="offline_optin" type="checkbox" /> Offline-Kopie nach Entsperren aktualisieren</label>
                <div class="row">
                  <button class="btn-ghost btn-sm" type="button" id="offline_sync">Jetzt synchronisieren</button>
                  <button class="btn-ghost btn-sm" type="button" id="offline_wipe">Offline-Kopie löschen</button>
                </div>
              </div>

              <div class="panel-tab-pane" role="tabpanel" data-panel-pane="clients" hidden>
                ${hintBox("CLI und Browser-Extension von dieser Instanz — Zero-Knowledge bleibt erhalten (Entschlüsselung nur lokal).")}
                <div id="clientDownloadsApp" class="client-dl-grid"></div>
                <div class="hint-box" id="accClientsHelp" hidden></div>
              </div>

              <div class="error" id="acc_err" hidden></div>
              <div class="ok" id="acc_ok" hidden></div>
            </div>
          </div>

          <div class="app-tab" data-pane="admin" id="adminPane" hidden>
            <div class="panel" id="admin">
              <div class="error" id="aerr" hidden></div>
              <div id="adminFull">
                <div class="admin-section" data-admin-section="users">
                  <div class="users-toolbar row">
                    <button class="btn-accent" type="button" id="uopenCreate">User anlegen</button>
                    <div class="secrets-view-toggle" role="group" aria-label="User-Ansicht">
                      <button type="button" class="btn-icon" data-users-view="list" title="Liste" aria-label="Liste">${icon("layoutList")}</button>
                      <button type="button" class="btn-icon" data-users-view="table" title="Tabelle" aria-label="Tabelle">${icon("layoutTable")}</button>
                      <button type="button" class="btn-icon" data-users-view="tiles" title="Kacheln" aria-label="Kacheln">${icon("layoutGrid")}</button>
                    </div>
                  </div>
                  <div id="ulist" class="list users-list"></div>
                  <div class="hint" id="udisable_hint" hidden></div>
                  <div id="ldapUserImport" class="panel-inset" hidden>
                    <h3 class="admin-subhead">LDAP-Verzeichnis</h3>
                    ${hintBox("User vor der ersten Anmeldung importieren — danach in Gruppen zuweisen.")}
                    <div class="row">
                      <input id="ldap_user_q" placeholder="Suche (mind. 2 Zeichen)…" />
                      <button class="btn-ghost" type="button" id="ldap_user_search">Suchen</button>
                    </div>
                    <div id="ldap_user_results" class="list"></div>
                    <div class="row">
                      <button class="btn-accent" type="button" id="ldap_user_import" hidden>Auswahl importieren</button>
                    </div>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="groups">
                  <div class="groups-workspace">
                    <aside class="groups-pool panel-inset">
                      <h3>User</h3>
                      ${hintBox("Aktive User in eine Gruppe ziehen.")}
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
                <div id="userCreateModal" class="admin-modal" hidden role="dialog" aria-modal="true" aria-labelledby="userCreateTitle">
                  <div class="admin-modal-backdrop" id="userCreateBackdrop"></div>
                  <div class="admin-modal-panel panel">
                    <div class="admin-modal-head">
                      <h2 id="userCreateTitle">Neuer User</h2>
                      <button type="button" class="btn-ghost btn-sm" id="userCreateClose">Schließen</button>
                    </div>
                    <label>Auth-Backend</label>
                    <select id="nauth">
                      <option value="local">Lokal (Passwort)</option>
                      <option value="ldap">LDAP / AD</option>
                    </select>
                    <label>Username</label><input id="nuser" autocomplete="off" />
                    <label>Anzeigename</label><input id="ndisplay" />
                    <label>E-Mail</label><input id="nemail" type="email" autocomplete="off" />
                    <div id="npw_block">
                      <label>Passwort (${PASSWORD_POLICY})</label><input id="npw" type="password" autocomplete="new-password" minlength="16" />
                    </div>
                    <div class="error" id="uc_err" hidden></div>
                    <div class="row">
                      <button class="btn-accent" type="button" id="ucreate">User anlegen</button>
                    </div>
                  </div>
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
                      <label>Neues Login-Passwort (optional, ${PASSWORD_POLICY})</label><input id="ue_password" type="password" autocomplete="new-password" minlength="16" />
                    </div>
                    <fieldset class="role-fieldset">
                      <legend>Rollen</legend>
                      <label class="inline" title="Vault nutzen, Secrets lesen und bearbeiten (Standard)"><input type="checkbox" id="ue_role_member" value="member" /> Mitglied</label>
                      <label class="inline" title="Benutzer, Gruppen, LDAP und Recovery im eigenen Tenant"><input type="checkbox" id="ue_role_admin" value="tenant_admin" /> Organisations-Administrator</label>
                      <label class="inline" title="Audit-Log einsehen (ohne Schreibrechte)"><input type="checkbox" id="ue_role_auditor" value="auditor" /> Auditor (nur Lesen)</label>
                      <label class="inline" id="ue_role_plat_wrap" title="Tenants, Storage-Migration, plattformweite Übersicht"><input type="checkbox" id="ue_role_plat" value="platform_admin" /> Plattform-Administrator</label>
                    </fieldset>
                    <div class="error" id="ue_err" hidden></div>
                    <div class="row">
                      <button class="btn-accent" type="button" id="ue_save">Speichern</button>
                    </div>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="trust">
                  ${hintBox("Instanzweites Firmen-Root-Zertifikat (PEM). Gilt für LDAPS, SMTP und spätere TLS-Verbindungen (z. B. interne Dienste). Mehrere Zertifikate in einer Datei sind möglich (Root + Zwischen-CAs).")}
                  <label>Firmen-Root-Zertifikat (PEM)</label>
                  <input id="trust_ca_file" type="file" accept=".pem,.crt,.cer,.txt,application/x-pem-file,application/x-x509-ca-cert" />
                  <textarea id="trust_ca_pem" rows="8" class="mono" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
                  <p class="hint" id="trust_ca_status"></p>
                  <div class="row">
                    <button class="btn-accent" type="button" id="trust_ca_save">CA speichern</button>
                    <button class="btn-ghost btn-sm" type="button" id="trust_ca_clear">Zertifikat entfernen</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="access">
                  ${hintBox("Öffentlicher Zugriff: Domain, Subdomain oder Unterpfad. Standalone ohne Proxy: Felder leer lassen, „Proxy-Header vertrauen“ aus.")}
                  ${hintBox("Einige Werte werden durch Umgebungsvariablen überschrieben (Container-Bootstrap).", { id: "pa_env_hint", hidden: true })}
                  <label>URL-Pfad-Präfix</label>
                  <input id="pa_base" placeholder="/vault (leer = Domain-Root)" />
                  <label>Öffentliche URL (optional)</label>
                  <input id="pa_url" placeholder="https://storage.example.com/vault" />
                  <label class="inline"><input id="pa_trust" type="checkbox" /> Proxy-Header vertrauen (X-Forwarded-Proto/Host)</label>
                  <label class="inline"><input id="pa_prefix" type="checkbox" /> Pfad aus X-Forwarded-Prefix ableiten (wenn Präfix leer)</label>
                  <p class="hint" id="pa_effective"></p>
                  <div class="row">
                    <button class="btn-accent" type="button" id="pa_save">Zugriff speichern</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="ldap">
                  ${hintBox("LDAP/AD nur für Login-Bind (tenant-spezifisch). Host muss zum Zertifikatsnamen (CN/SAN) passen. Die instanzweite Firmen-CA verwaltet der Plattform-Administrator.")}
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
                  ${hintBox("Unsicher: Signatur und Hostname werden nicht geprüft. Nur wenn keine Firmen-CA hinterlegt werden kann. Anschließend Test-Bind nutzen.")}
                  <div class="row">
                    <button class="btn-accent" type="button" id="ldap_save">LDAP speichern</button>
                    <button class="btn-ghost" type="button" id="ldap_test">Test-Bind</button>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="smtp">
                  ${hintBox("SMTP-TLS nutzt die zentrale Firmen-CA (Administration → Firmen-CA).")}
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
                <div class="admin-section" data-admin-section="crypto" data-panel-group="crypto">
                  <div class="panel-tabs" role="tablist" aria-label="Krypto und Policy">
                    <button type="button" class="panel-tab active" role="tab" data-panel-tab="kdf" aria-selected="true">Argon2 / KDF</button>
                    <button type="button" class="panel-tab" role="tab" data-panel-tab="policy" aria-selected="false">Policy</button>
                  </div>
                  <div class="panel-tab-pane active" role="tabpanel" data-panel-pane="kdf">
                    ${hintBox("Argon2id-Presets (Vault-KDF):")}
                    <div class="preset-row" id="presetRow"></div>
                    <label>Argon2 Memory (KiB)</label><input id="arg_mem" type="number" />
                    <label>Argon2 Time</label><input id="arg_time" type="number" />
                    <label>Argon2 Threads</label><input id="arg_threads" type="number" value="1" />
                    <div class="row">
                      <button class="btn-accent" type="button" id="crypto_save">Krypto speichern</button>
                    </div>
                  </div>
                  <div class="panel-tab-pane" role="tabpanel" data-panel-pane="policy" hidden>
                    ${hintBox("Tenant-Policy für Login und Vault-Verhalten.")}
                    <label class="inline"><input id="totp_req" type="checkbox" /> TOTP Pflicht (Hinweis nach Login)</label>
                    <label class="inline"><input id="admin_env_only" type="checkbox" /> Admins: Secret-Liste nur mit Envelope</label>
                    <label class="inline"><input id="offline_cache" type="checkbox" checked /> Offline-Vault-Cache erlauben (Ciphertext auf Geräten)</label>
                    <label class="inline"><input id="cli_integration" type="checkbox" /> CLI-Integration anzeigen (Konto, Hilfe)</label>
                    <label class="inline"><input id="browser_integration" type="checkbox" /> Browser-Extension-Integration anzeigen (Konto, Hilfe)</label>
                    ${hintBox("CLI/Extension standardmäßig ausgeblendet — sinnvoll wenn Firmen-GPOs die Browser-Installation blockieren. IT kann Artefakte weiterhin unter /downloads/ bereitstellen.")}
                    <div class="row">
                      <button class="btn-accent" type="button" id="policy_save">Policy speichern</button>
                    </div>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="recovery" data-panel-group="recovery">
                  <div class="panel-tabs" role="tablist" aria-label="Recovery und Escrow">
                    <button type="button" class="panel-tab active" role="tab" data-panel-tab="mode" aria-selected="true">Recovery-Modus</button>
                    <button type="button" class="panel-tab" role="tab" data-panel-tab="escrow" aria-selected="false">Escrow / Shamir</button>
                  </div>
                  <div class="panel-tab-pane active" role="tabpanel" data-panel-pane="mode">
                    ${hintBox("Wechsel erzwingt Re-Onboarding aller User. Bestätigung: <code>REONBOARD</code>")}
                    <label>Modus</label>
                    <select id="rec_mode">
                      <option value="user_kit">User Recovery-Kit</option>
                      <option value="admin_escrow">Admin-Escrow</option>
                    </select>
                    <label class="inline"><input id="rec_escrow" type="checkbox" /> Escrow erlauben</label>
                    <label>Bestätigung</label><input id="rec_confirm" placeholder="REONBOARD" autocomplete="off" />
                    <div class="row"><button class="btn-danger" type="button" id="rec_save">Recovery-Modus ändern</button></div>
                  </div>
                  <div class="panel-tab-pane" role="tabpanel" data-panel-pane="escrow" hidden>
                    ${hintBox("Erstes Setzen: Keypair im Browser, Server speichert nur den Public Key. Ersetzen nur mit k-aus-n Shares (Zeremonie). SK verlässt den Client nicht. Alternativ: <code>tvcli escrow-split</code>.")}
                    <label>Shamir k</label><input id="shamir_k" type="number" value="3" />
                    <label>Shamir n</label><input id="shamir_n" type="number" value="5" />
                    <div class="ok" id="escrow_out" hidden></div>
                    <div class="row"><button class="btn-accent" type="button" id="escrow_gen">Escrow-Keypair + Shares (erstes Setzen)</button></div>
                    <label>Bestehende Shares (eine Zeile je Share, mind. k)</label>
                    <textarea id="escrow_shares" rows="5" placeholder="share_1=…&#10;share_2=…"></textarea>
                    <div class="row"><button class="btn-danger" type="button" id="escrow_replace">Escrow ersetzen (k-aus-n)</button></div>
                  </div>
                </div>
                <div class="admin-section" data-admin-section="apikeys">
                  ${hintBox("Scopes: <code>read</code> (GET allowlist), <code>vault</code> (Secret-Schreibaktionen), <code>admin</code> (/api/admin/*). User-Rollen gelten zusätzlich.")}
                  <div id="klist" class="list"></div>
                  <label>Name</label><input id="kname" />
                  <label class="inline"><input id="kscope_read" type="checkbox" checked /> read</label>
                  <label class="inline"><input id="kscope_vault" type="checkbox" /> vault</label>
                  <label class="inline"><input id="kscope_admin" type="checkbox" /> admin</label>
                  <div class="row"><button class="btn-accent" type="button" id="kcreate">API-Key erzeugen</button></div>
                  <div class="ok" id="ktoken" hidden></div>
                </div>
                <div class="admin-section" data-admin-section="platform" id="plat" hidden data-panel-group="platform">
                  <div class="panel-tabs" role="tablist" aria-label="Plattform">
                    <button type="button" class="panel-tab active" role="tab" data-panel-tab="tenants" aria-selected="true">Tenants</button>
                    <button type="button" class="panel-tab" role="tab" data-panel-tab="migrate" aria-selected="false">Storage-Migration</button>
                    <button type="button" class="panel-tab" role="tab" data-panel-tab="instance" aria-selected="false">Instanz-Backup</button>
                  </div>
                  <div class="panel-tab-pane active" role="tabpanel" data-panel-pane="tenants">
                    ${hintBox("Tenants anlegen und verwalten (Plattform-Administrator).")}
                    <div id="tlist" class="list"></div>
                    <label>Name</label><input id="tname" />
                    <label>Slug</label><input id="tslug" />
                    <div class="row"><button class="btn-accent" type="button" id="tcreate">Tenant anlegen</button></div>
                  </div>
                  <div class="panel-tab-pane" role="tabpanel" data-panel-pane="migrate" hidden>
                    ${hintBox("Exportiert nur Ciphertext. Bestätigung: MIGRATE")}
                    <label>Ziel-Backend</label>
                    <select id="mig_backend"><option value="json">json</option><option value="sqlite">sqlite</option></select>
                    <label>DSN / Pfad</label><input id="mig_dsn" placeholder="leer = data/vault-migrated.*" />
                    <label>Bestätigung</label><input id="mig_confirm" placeholder="MIGRATE" />
                    <div class="row"><button class="btn-danger" type="button" id="mig_go">Migrieren</button></div>
                  </div>
                  <div class="panel-tab-pane" role="tabpanel" data-panel-pane="instance" hidden>
                    ${hintBox("Snapshot enthält nur Ciphertext + Metadaten (Tenants, User, Gruppen, Secrets, Passkeys). Unlock-Keyfile und Recovery-Kits <strong>nicht</strong> in dieser Datei — separat sichern. Restore mit <code>RESTORE</code> ersetzt den gesamten Vault-Store. Danach neu anmelden, falls User-IDs abweichen.")}
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
              </div>
              <div class="admin-section" data-admin-section="audit">
                <div id="alist" class="list hint"></div>
              </div>
              <div class="admin-section" data-admin-section="system">
                <h2>System &amp; Instanz</h2>
                ${hintBox("Storage, Vault-Gesundheit und angebundene Dienste.")}
                <dl class="system-overview" id="sysOverview"></dl>
                <h3 class="admin-subhead">Version</h3>
                <p class="hint" id="sysVersion">—</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer class="app-footer">
        <div class="app-footer-inner">
          <p class="app-footer-session hint" id="info">Lade…</p>
          <p class="app-footer-about about-line" id="about"></p>
        </div>
      </footer>
    </div>
  </div>`);
  const backdrop = document.createElement("div");
  backdrop.className = "sidebar-backdrop";
  backdrop.id = "sidebarBackdrop";
  app.appendChild(backdrop);
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
    "vault:shared": "Geteilte Secrets",
    "vault:favorites": "Favoriten",
    "vault:create": "Neu anlegen",
    "vault:import": "Import",
    "vault:backup": "Sicherung",
    account: "Konto",
    "admin:users": "Benutzer",
    "admin:groups": "Gruppen",
    "admin:trust": "Firmen-CA",
    "admin:access": "Zugriff & Proxy",
    "admin:ldap": "LDAP",
    "admin:smtp": "SMTP",
    "admin:crypto": "Krypto & Policy",
    "admin:recovery": "Recovery & Escrow",
    "admin:apikeys": "API-Keys",
    "admin:platform": "Tenants & Migration",
    "admin:system": "System",
    "admin:audit": "Audit",
  };

  function setNavSectionCollapsed(sectionEl, collapsed, persist) {
    if (!sectionEl) return;
    sectionEl.classList.toggle("collapsed", collapsed);
    const btn = sectionEl.querySelector(".sidebar-section-toggle");
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (persist) saveNavSectionState(sectionEl.dataset.navSection, collapsed);
  }

  function expandNavSectionForRoute(nav) {
    const id = navSectionIdForRoute(nav);
    const sec = n.querySelector(`[data-nav-section="${id}"]`);
    if (sec) setNavSectionCollapsed(sec, false, true);
    const subId = navSubsectionIdForRoute(nav);
    if (subId) {
      const sub = n.querySelector(`[data-nav-subsection="${subId}"]`);
      if (sub) setNavSubsectionCollapsed(sub, false, true);
    }
  }

  function setNavSubsectionCollapsed(subEl, collapsed, persist) {
    if (!subEl) return;
    subEl.classList.toggle("collapsed", collapsed);
    const btn = subEl.querySelector(".sidebar-subsection-toggle");
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (persist) saveNavSubsectionState(subEl.dataset.navSubsection, collapsed);
  }

  function initSidebarSections() {
    const saved = loadNavSectionsState();
    n.querySelectorAll(".sidebar-section[data-nav-section]").forEach((sec) => {
      const id = sec.dataset.navSection;
      const collapsed = Object.prototype.hasOwnProperty.call(saved, id)
        ? !!saved[id]
        : navSectionDefaultCollapsed(id);
      setNavSectionCollapsed(sec, collapsed, false);
      const btn = sec.querySelector(".sidebar-section-toggle");
      if (!btn) return;
      btn.onclick = () => {
        setNavSectionCollapsed(sec, !sec.classList.contains("collapsed"), true);
      };
    });
    const savedSub = loadNavSubsectionsState();
    n.querySelectorAll(".sidebar-subsection[data-nav-subsection]").forEach((sub) => {
      const id = sub.dataset.navSubsection;
      const collapsed = Object.prototype.hasOwnProperty.call(savedSub, id)
        ? !!savedSub[id]
        : navSubsectionDefaultCollapsed();
      setNavSubsectionCollapsed(sub, collapsed, false);
      const btn = sub.querySelector(".sidebar-subsection-toggle");
      if (!btn) return;
      btn.onclick = () => {
        setNavSubsectionCollapsed(sub, !sub.classList.contains("collapsed"), true);
      };
    });
  }

  function closeMobileNav() {
    n.querySelector("#appSidebar").classList.remove("open");
    backdrop.classList.remove("open");
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
    n.querySelectorAll("#sExportGroup, #sMore, #sActionsWrap").forEach((el) => {
      if (el) el.hidden = true;
    });
    const accHint = n.querySelector("#offlineAccHint");
    if (accHint) {
      setHintBox(accHint, "Im Offline-Modus nur Lesen. Online anmelden für Synchronisation und Einstellungen.");
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
      if (hint) setHintBox(hint, "Offline-Cache ist für diesen Mandanten nicht erlaubt.");
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

  function syncAdminNavVisibility() {
    const navAdmin = n.querySelector("#navAdminSection");
    if (navAdmin) navAdmin.hidden = !canSeeAdminNav();

    n.querySelectorAll(".sidebar-link[data-nav]").forEach((el) => {
      const nav = el.dataset.nav || "";
      if (!nav.startsWith("admin:")) return;
      el.hidden = !canAccessAdminNav(nav);
    });

    const platform = isPlatformAdmin();
    const plat = n.querySelector("#plat");
    if (plat) plat.hidden = !platform;
    n.querySelectorAll(".admin-section[data-admin-section]").forEach((sec) => {
      const id = sec.dataset.adminSection;
      if (!id) return;
      if (PLATFORM_ADMIN_SECTIONS.has(id)) {
        sec.hidden = !platform;
      } else if (id === "audit") {
        sec.hidden = !(isAuditor() || isAdmin());
      } else {
        sec.hidden = isAuditorOnly() || !isAdmin();
      }
    });

    n.querySelectorAll(".sidebar-subsection[data-nav-subsection]").forEach((sub) => {
      const visible = sub.querySelectorAll(".sidebar-link[data-nav]:not([hidden])");
      sub.hidden = visible.length === 0;
    });
  }

  function navigateTo(nav) {
    if (!vault.sk) return;
    if (vault.offlineMode && offlineWriteNav(nav)) {
      announceA11y("Nur online verfügbar");
      return;
    }
    if (nav.startsWith("admin:") && !canAccessAdminNav(nav)) {
      nav = defaultAdminNav();
    }
    expandNavSectionForRoute(nav);
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
      if (vaultSec === "mine" || vaultSec === "shared" || vaultSec === "favorites") {
        vault.listScope = vaultSec;
        vault.ownershipFilter = vaultSec === "shared" ? "shared" : "mine";
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
        return `<option value="${escapeHtml(s.key)}">${escapeHtml(s.username)} · ${escapeHtml(tenant)} · ${escapeHtml(synced)}</option>`;
      })
      .join("");
    const pick = () => {
      const key = sel.value || snaps[0].key;
      vault.offlineSnapshot = snaps.find((s) => s.key === key) || snaps[0];
    };
    pick();
    sel.onchange = pick;
    paintSessionBar(n, { snapshot: vault.offlineSnapshot });
  }

  async function showOfflineExpiredMessage() {
    const err = n.querySelector("#uerr");
    const unlock = n.querySelector("#unlock");
    if (unlock) unlock.hidden = false;
    if (err) {
      err.hidden = false;
      err.textContent =
        "Offline-Kopie abgelaufen (max. 30 Tage). Bitte online anmelden und unter Konto → Offline-Vault neu synchronisieren.";
    }
    paintSessionBar(n, { expired: true });
  }

  async function initAppSession() {
    if (offlineUrlParam) {
      try {
        const snaps = await TVOfflineStore.listSnapshots({ validOnly: true });
        if (!snaps.length) {
          const all = await TVOfflineStore.listSnapshots({ validOnly: false });
          if (all.some((s) => s.expired)) {
            await showOfflineExpiredMessage();
            history.replaceState(null, "", tvPath("/app"));
            return;
          }
          tvGo("/login");
          return;
        }
        await populateOfflinePicker(snaps);
        history.replaceState(null, "", tvPath("/app"));
        return;
      } catch (_) {
        tvGo("/login");
        return;
      }
    }
    try {
      const me = await api("/api/me");
      if (me.needs_vault_onboard) { tvGo("/onboard"); return; }
      vault.me = me;
      loadUserFavoritesFromStorage();
      paintSessionBar(n, { me });
      syncAdminNavVisibility();
      try {
        vault.policy = await api("/api/policy/client");
        vault.idleMin = vault.policy.unlock_idle_minutes || 15;
        syncAccountClientsUI();
        syncAccountAuthUI();
      } catch (_) {}
    } catch (_) {
      try {
        const snaps = await TVOfflineStore.listSnapshots({ validOnly: true });
        if (!snaps.length) {
          const all = await TVOfflineStore.listSnapshots({ validOnly: false });
          if (all.some((s) => s.expired)) {
            await showOfflineExpiredMessage();
            return;
          }
          tvGo("/login");
          return;
        }
        await populateOfflinePicker(snaps);
      } catch (e2) {
        tvGo("/login");
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
    tvGo("/login");
  };

  n.querySelectorAll(".sidebar-link[data-nav]").forEach((btn) => {
    btn.onclick = () => navigateTo(btn.dataset.nav);
  });
  initSidebarSections();
  n.querySelector("#menuToggle").onclick = () => {
    n.querySelector("#appSidebar").classList.add("open");
    backdrop.classList.add("open");
    n.querySelector("#menuToggle").setAttribute("aria-expanded", "true");
  };
  backdrop.onclick = () => closeMobileNav();
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
      setOfflineSyncProgress("", false);
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
        tvGo("/login");
      }
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };

  function syncAccountAuthUI() {
    const tab = n.querySelector('[data-panel-tab="login"]');
    const pane = n.querySelector('[data-panel-pane="login"]');
    const isLocal = (vault.me?.auth_backend || "local") === "local";
    if (tab) tab.hidden = !isLocal;
    if (pane && !isLocal) pane.hidden = true;
  }

  function syncAccountClientsUI() {
    const tab = n.querySelector('[data-panel-tab="clients"]');
    const pane = n.querySelector('[data-panel-pane="clients"]');
    const show = anyClientIntegrationEnabled();
    if (tab) tab.hidden = !show;
    if (pane && !show) pane.hidden = true;
    const helpHint = n.querySelector("#accClientsHelp");
    if (helpHint) {
      const links = [];
      if (cliIntegrationEnabled()) links.push(`<a href="${tvPath("/help/cli")}" target="_blank" rel="noopener">CLI</a>`);
      if (browserIntegrationEnabled()) links.push(`<a href="${tvPath("/help/extension")}" target="_blank" rel="noopener">Extension</a>`);
      helpHint.hidden = !links.length;
      if (links.length) helpHint.innerHTML = `Ausführliche Anleitung: ${links.join(" · ")}`;
    }
  }

  bindPanelTabs(n, "backup");
  bindPanelTabs(n, "crypto");
  bindPanelTabs(n, "recovery");
  bindPanelTabs(n, "platform");
  bindPanelTabs(n, "account", {
    onShow(tab) {
      if (tab === "passkeys") refreshPasskeys().catch(() => {});
      if (tab === "offline") updateOfflineAccountUI(vault.offlineSnapshot);
      if (tab === "clients") refreshClientDownloadsUI().catch(() => {});
    },
  });

  function fmtClientBytes(n) {
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }
  function detectClientPlatform() {
    const ua = navigator.userAgent || "";
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || "";
    const s = (plat + " " + ua).toLowerCase();
    if (s.includes("win")) return "windows";
    return "linux";
  }
  function detectClientArch() {
    const ua = navigator.userAgent || "";
    return /arm64|aarch64/i.test(ua) ? "arm64" : "amd64";
  }
  function pickClientCLI(cli, platform, arch) {
    return (
      cli.find((c) => c.platform === platform && c.arch === arch) ||
      cli.find((c) => c.platform === platform) ||
      cli[0]
    );
  }
  async function copyClientText(text, btn) {
    await copyText(text);
    if (btn) flashCopy(btn);
  }
  async function refreshClientDownloadsUI() {
    const root = n.querySelector("#clientDownloadsApp");
    if (!root) return;
    if (!anyClientIntegrationEnabled()) {
      root.innerHTML = hintBox("CLI und Browser-Extension sind auf dieser Instanz deaktiviert (Plattform-Policy).");
      return;
    }
    root.innerHTML = "<p class='hint'>Lade Downloads…</p>";
    const res = await fetch(tvPath("/api/client-downloads"), { credentials: "include" });
    if (!res.ok) throw new Error("Downloads nicht verfügbar");
    const data = await res.json();
    const showCli = cliIntegrationEnabled();
    const showExt = browserIntegrationEnabled();
    const plat = detectClientPlatform();
    const arch = detectClientArch();
    const cli = data.cli || [];
    const rec = pickClientCLI(cli, plat, arch);
    const cliLinks = cli.map((c) =>
      `<li><a href="${tvPath(c.url)}" download>${c.name}</a> <span class="hint">(${fmtClientBytes(c.size)})</span></li>`
    ).join("");
    const ext = data.extension || {};
    const crx = ext.crx;
    const cliInstall = plat === "windows" ? data.install.cli_windows : data.install.cli_unix;
    const extInstall = plat === "windows" ? (data.install.extension_user_ps || data.install.extension_windows) : data.install.extension_unix;
    const cards = [];
    if (showCli) {
      cards.push(`<div class="client-dl-card">
        <h4>CLI (tvcli)</h4>
        ${rec
          ? `${hintBox(`Empfohlen: ${rec.platform}/${rec.arch}`)}
             <div class="row">
               <a class="btn-accent" href="${tvPath(rec.url)}" download>tvcli herunterladen</a>
               <button type="button" class="btn-ghost btn-sm" id="cliInstallCopy">Einzeiler kopieren</button>
             </div>
             <ul class="client-dl-links">${cliLinks}</ul>`
          : hintBox("CLI-Binaries noch nicht bereitgestellt.")}
      </div>`);
    }
    if (showExt) {
      cards.push(`<div class="client-dl-card">
        <h4>Browser-Extension</h4>
        ${crx
          ? `${hintBox("Schritt 1: Browser-Richtlinie per PowerShell (siehe Hilfe). Ohne Richtlinie wird nur die .crx heruntergeladen.")}
             <div class="row">
               <button type="button" class="btn-ghost btn-sm" id="extInstallCopy">Einrichtung (Einzeiler)</button>
               <a class="btn-accent" href="${tvPath(crx.url)}" id="extCrxBtn">Extension installieren</a>
             </div>
             ${hintBox(`Extension-ID: <code>${ext.id || "—"}</code> · <a href="${tvPath("/help/extension")}" target="_blank" rel="noopener">Anleitung</a> · <a href="${tvPath("/help/extension")}#fallback">Entwicklermodus</a>`)}`
          : hintBox("Extension noch nicht bereitgestellt.")}
      </div>`);
    }
    root.innerHTML = cards.join("");
    const cliBtn = root.querySelector("#cliInstallCopy");
    if (cliBtn && cliInstall) {
      cliBtn.onclick = () => copyClientText(cliInstall, cliBtn);
    }
    const extBtn = root.querySelector("#extInstallCopy");
    if (extBtn && extInstall) {
      extBtn.onclick = () => copyClientText(extInstall, extBtn);
    }
  }

  n.querySelector("#totpSetup").onclick = async () => {
    const setupBtn = n.querySelector("#totpSetup");
    const box = n.querySelector("#totpbox"); box.hidden = false;
    const terr = n.querySelector("#terr"); terr.hidden = true;
    try {
      const res = await api("/api/totp/setup", { method: "POST", body: "{}" });
      totpSecretPlain = res.secret || "";
      const otpUrl = res.otpauth_url || "";
      n.querySelector("#otpurl").textContent = otpUrl;
      const qr = n.querySelector("#otpQr");
      if (res.qr_data_url && qr) {
        const img = document.createElement("img");
        img.src = res.qr_data_url;
        img.width = 200;
        img.height = 200;
        img.alt = "TOTP QR-Code";
        qr.replaceChildren(img);
        qr.hidden = false;
      } else if (otpUrl && globalThis.TVQR) TVQR.mount(qr, otpUrl, { size: 200 });
      else if (qr) {
        qr.innerHTML = hintBox("QR nicht verfügbar — bitte otpauth-URL kopieren.");
        qr.hidden = false;
      }
      const sec = n.querySelector("#otpSecret");
      sec.hidden = true;
      sec.textContent = "";
      n.querySelector("#otpReveal").textContent = "Secret kurz anzeigen";
      const hint = n.querySelector("#totpSetupHint");
      if (hint) hint.hidden = false;
      if (setupBtn) {
        setupBtn.disabled = true;
        setupBtn.title = "Bereits eingerichtet — zuerst Code bestätigen oder Seite neu laden";
      }
      n.querySelector("#code")?.focus();
    } catch (e) {
      const terr = n.querySelector("#terr");
      terr.hidden = false;
      terr.textContent = e.message;
    }
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
  async function refreshPasskeys() {
    const list = n.querySelector("#pklist");
    const creds = await api("/api/webauthn/credentials");
    list.innerHTML = creds.map((c) =>
      `<div class="list-row"><span>${escapeHtml(c.name)}</span><button class="btn-ghost" data-pkdel="${escapeHtml(c.id)}" type="button">Löschen</button></div>`
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
    const terr = n.querySelector("#terr"); terr.hidden = true;
    try {
      const code = String(n.querySelector("#code").value || "").replace(/\s+/g, "").replace(/\D/g, "");
      if (code.length !== 6) throw new Error("Bitte den 6-stelligen Code eingeben");
      await api("/api/totp/enable", { method: "POST", body: JSON.stringify({ code }) });
      totpSecretPlain = "";
      location.reload();
    } catch (e) {
      terr.hidden = false;
      terr.textContent = e.message;
    }
  };

  n.querySelector("#lpw_save").onclick = async () => {
    const err = n.querySelector("#acc_err"); const ok = n.querySelector("#acc_ok");
    err.hidden = true; ok.hidden = true;
    try {
      const neu = n.querySelector("#lpw_new").value;
      const pwErr = localLoginPasswordError(neu);
      if (pwErr) throw new Error(pwErr);
      await api("/api/me/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: n.querySelector("#lpw_cur").value,
          new_password: neu,
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
      const pwErr = masterPasswordError(neu);
      if (pwErr) throw new Error(pwErr);
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
    if (countEl) countEl.textContent = nSel ? `${nSel} ausgewählt` : "Keine Auswahl";
    const sCount = n.querySelector("#sCount");
    if (sCount) {
      const scopeLabel = vault.listScope === "favorites"
        ? "Favoriten"
        : vault.listScope === "shared"
          ? "geteilt"
          : "privat";
      const loaded = vault.secretsCache.length;
      const total = vault.secretsTotal;
      const extra = loaded < total ? ` · ${loaded}/${total} geladen` : "";
      sCount.textContent = `${visible.length} ${scopeLabel}${extra}`;
    }
    const all = n.querySelector("#selAllVisible");
    if (all) all.checked = visible.length > 0 && nSel === visible.length;
    const moreWrap = n.querySelector("#sLoadMoreWrap");
    const moreBtn = n.querySelector("#sMore");
    const moreHint = n.querySelector("#sLoadMoreHint");
    const hasMore = vault.secretsCache.length < vault.secretsTotal;
    if (moreWrap) moreWrap.hidden = !hasMore || vault.offlineMode;
    if (moreHint && hasMore) {
      const rest = vault.secretsTotal - vault.secretsCache.length;
      moreHint.textContent =
        `Noch ${rest} Eintrag${rest === 1 ? "" : "e"} nicht geladen (${vault.secretsCache.length} von ${vault.secretsTotal}). ` +
        "Bei vielen Secrets werden sie schrittweise vom Server geholt.";
    }
    if (moreBtn && hasMore) {
      moreBtn.textContent = `Weitere ${Math.min(vault.pageLimit, restCount(vault))} laden`;
    }
    const toggle = n.querySelector("#sActionsToggle");
    if (toggle) {
      const badge = nSel > 0 ? ` (${nSel})` : "";
      toggle.innerHTML = btnLabel("more", `Aktionen${badge}`);
    }
  }

  function restCount(v) {
    return Math.max(0, v.secretsTotal - v.secretsCache.length);
  }

  function closeSecretsActionsMenu() {
    const menu = n.querySelector("#sActionsMenu");
    const toggle = n.querySelector("#sActionsToggle");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  const sActionsToggle = n.querySelector("#sActionsToggle");
  if (sActionsToggle) {
    sActionsToggle.onclick = (ev) => {
      ev.stopPropagation();
      const menu = n.querySelector("#sActionsMenu");
      const open = menu && menu.hidden;
      if (menu) menu.hidden = !open;
      sActionsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
  }
  document.addEventListener("click", (ev) => {
    const wrap = n.querySelector("#sActionsWrap");
    if (!wrap || wrap.hidden) return;
    if (!wrap.contains(ev.target)) closeSecretsActionsMenu();
  });

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

  async function fetchSecretDetailWithRetry(id, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await api("/api/secrets/" + id);
      } catch (e) {
        lastErr = e;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }
    throw lastErr || new Error("Secret-Detail nicht ladbar");
  }

  function setOfflineSyncProgress(text, show) {
    const bar = n.querySelector("#offlineSyncBar");
    if (!bar) return;
    bar.hidden = !show;
    bar.textContent = text || "";
  }

  async function syncOfflineSnapshot(opts = {}) {
    const silent = !!opts.silent;
    if (!window.TVOfflineStore?.isAvailable()) return;
    if (vault.offlineMode || !vault.sk || !vault.me) return;
    if (!offlinePolicyAllowed()) return;
    if (!TVOfflineStore.getOptIn()) return;
    if (vault.offlineSyncRunning) return;

    vault.offlineSyncRunning = true;
    try {
      if (!silent) setOfflineSyncProgress("Offline-Kopie: vorbereiten…", true);
      const keys = await api("/api/vault/keys");
      const params = vault.params || (await api("/api/vault/crypto-params"));
      await ensureAllSecretsLoaded();

      const prev = await TVOfflineStore.getSnapshotRaw(vault.me.tenant_id, vault.me.user_id);
      const plan = TVOfflineStore.planSync(vault.secretsCache, prev?.secrets || []);
      const total = plan.expectedCount;
      let done = plan.reuse.length;
      if (!silent) setOfflineSyncProgress(`Offline-Kopie: ${done}/${total}`, true);

      const fetched = [];
      for (const it of plan.toFetch) {
        const det = await fetchSecretDetailWithRetry(it.id);
        fetched.push(TVOfflineStore.buildSecretEntry(it, det));
        done += 1;
        if (!silent) setOfflineSyncProgress(`Offline-Kopie: ${done}/${total}`, true);
      }

      const secrets = TVOfflineStore.assembleSecrets(plan.reuse, fetched, plan.expectedIds);
      if (!secrets) {
        throw new Error("Snapshot unvollständig — bisherige Offline-Kopie bleibt erhalten");
      }

      const snap = TVOfflineStore.buildSnapshot({ me: vault.me, keys, params, secrets });
      await TVOfflineStore.putSnapshot(snap);
      vault.offlineSnapshot = snap;
      updateOfflineAccountUI(snap);
      if (!silent) {
        const skipped = plan.reuse.length;
        const msg = skipped
          ? `Offline-Kopie aktualisiert (${fetched.length} neu, ${skipped} unverändert).`
          : `Offline-Kopie aktualisiert (${secrets.length} Secrets).`;
        setOfflineSyncProgress(msg, true);
        setTimeout(() => setOfflineSyncProgress("", false), 4000);
      }
    } catch (e) {
      if (!silent) {
        setOfflineSyncProgress(e.message || "Offline-Sync fehlgeschlagen", true);
        setTimeout(() => setOfflineSyncProgress("", false), 6000);
      }
      throw e;
    } finally {
      vault.offlineSyncRunning = false;
    }
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
    loadUserFavoritesFromStorage();
    vault.idleMin = 15;
    bindIdleListeners();
    touchIdle();
    n.querySelector("#unlock").hidden = true;
    n.querySelector("#lockOverlay").hidden = true;
    n.querySelector("#vaultui").hidden = false;
    n.querySelector("#mpw").value = "";
    paintSessionBar(n, { snapshot: snap });
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
      loadUserFavoritesFromStorage();
      paintSessionBar(n, { me: vault.me });
    } catch (_) {}
    try {
      const pol = await api("/api/policy/client");
      vault.policy = pol;
      vault.idleMin = pol.unlock_idle_minutes || 15;
      syncAccountClientsUI();
      syncAccountAuthUI();
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
        syncAdminNavVisibility();
      }
      try { await refreshAdmin(); } catch (e) { console.warn('refreshAdmin', e); }
    }
    await refreshGroupShareUI();
    await refreshSharePickers();
    vault.secretsCache = [];
    vault.secretsOffset = 0;
    await refreshSecrets(true);
    try {
      const gaps = await api("/api/secrets/group-share-gaps");
      const nGaps = (gaps.items || []).length;
      if (nGaps) {
        announceA11y(`${nGaps} Gruppen-Freigaben ohne Envelope. Nachpflege nur nach Bestätigung der Empfängerschlüssel.`);
      }
    } catch (_) {}
    navigateTo("vault:mine");
    updateOfflineAccountUI(await TVOfflineStore.getSnapshot(vault.me?.tenant_id, vault.me?.user_id));
    maybePromptOfflineOptIn().then(() => {
      if (TVOfflineStore.getOptIn()) {
        syncOfflineSnapshot().catch((e) => console.warn("offline snapshot", e));
      }
    });
  }

  function keyDirStorageKey() {
    return "tv_keydir_" + (vault.me?.tenant_id || "");
  }
  function loadKeyDir() {
    try {
      return JSON.parse(localStorage.getItem(keyDirStorageKey()) || "{}");
    } catch (_) {
      return {};
    }
  }
  function saveKeyDir(dir) {
    localStorage.setItem(keyDirStorageKey(), JSON.stringify(dir));
  }
  async function fingerprintOfB64(b64) {
    const raw = TVCrypto.b64dec(b64);
    const hash = await crypto.subtle.digest("SHA-256", raw);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.replace(/(.{4})/g, "$1 ").trim().toUpperCase();
  }
  async function confirmRecipientKey(userId, username, publicKeyB64) {
    if (!userId || !publicKeyB64) return false;
    if (userId === vault.me?.user_id) return true;
    const fp = await fingerprintOfB64(publicKeyB64);
    const dir = loadKeyDir();
    const prev = dir[userId];
    if (prev && prev.fp === fp) return true;
    const who = username || userId;
    const msg = prev
      ? `Schlüssel von ${who} hat sich geändert.\nBisher: ${prev.fp}\nNeu: ${fp}\nTrotzdem für diesen Empfänger verschlüsseln?`
      : `Neuer Empfängerschlüssel für ${who}:\n${fp}\nBestätigen?`;
    if (!confirm(msg)) return false;
    dir[userId] = { fp, username: who, at: Date.now() };
    saveKeyDir(dir);
    return true;
  }
  function recipientPubForUser(userId, serverB64) {
    if (userId === vault.me?.user_id && vault.sk && TVCrypto.publicKeyFromSecret) {
      return TVCrypto.publicKeyFromSecret(vault.sk);
    }
    return TVCrypto.b64dec(serverB64);
  }

  /** Zero-knowledge: seal missing envelopes after explicit recipient confirmation. */
  async function sealGroupShareGaps(opts = {}) {
    if (!vault.sk || vault.offlineMode) return { sealed: 0, failed: 0, skipped: 0 };
    const q = new URLSearchParams();
    if (opts.groupId) q.set("group_id", opts.groupId);
    if (opts.userId) q.set("user_id", opts.userId);
    const qs = q.toString();
    const data = await api("/api/secrets/group-share-gaps" + (qs ? "?" + qs : ""));
    const items = data.items || [];
    let sealed = 0;
    let failed = 0;
    let skipped = 0;
    const byUser = new Map();
    for (const g of items) {
      if (!byUser.has(g.user_id)) byUser.set(g.user_id, g);
    }
    const allowed = new Set();
    for (const [uid, g] of byUser) {
      const ok = await confirmRecipientKey(uid, g.username, g.public_key_b64);
      if (ok) allowed.add(uid);
      else skipped += items.filter((x) => x.user_id === uid).length;
    }
    const byKey = new Map();
    for (const g of items) {
      if (!allowed.has(g.user_id)) continue;
      const key = g.secret_id + "\0" + g.group_id;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(g);
    }
    for (const group of byKey.values()) {
      try {
        const first = group[0];
        const dk = openDKFromEnvelope(first.envelope);
        const kv = first.key_version || first.envelope?.key_version || 1;
        const envelopes = group.map((g) =>
          TVCrypto.envelopeToAPI(
            g.user_id,
            TVCrypto.sealDataKeyForRecipient(dk, recipientPubForUser(g.user_id, g.public_key_b64), kv)
          )
        );
        dk.fill(0);
        await api("/api/secrets/" + first.secret_id + "/share-group", {
          method: "POST",
          body: JSON.stringify({ group_id: first.group_id, envelopes }),
        });
        sealed += envelopes.length;
      } catch (e) {
        console.warn("reseal group gap", e);
        failed += group.length;
      }
    }
    return { sealed, failed, skipped };
  }

  async function refreshGroupShareUI() {
    try {
      vault.groups = await api("/api/groups");
    } catch (_) {
      vault.groups = [];
    }
    const groups = vault.groups || [];
    const gWrap = n.querySelector("#screateGroupsWrap");
    const gSel = n.querySelector("#screateGroups");
    if (gWrap && gSel) {
      gWrap.hidden = !groups.length;
      if (groups.length) {
        gSel.innerHTML = groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
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
          .map((p) => `<option value="${escapeHtml(p.user_id)}">${escapeHtml(p.username)}</option>`)
          .join("");
      }
    } catch (_) {}
  }

  function setCreateVisibility(vis) {
    const v = vis === "shared" ? "shared" : "private";
    const hidden = n.querySelector("#svis");
    if (hidden) hidden.value = v;
    n.querySelectorAll("#svisTabs [data-svis]").forEach((btn) => {
      const on = btn.dataset.svis === v;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const wrap = n.querySelector("#sshareWrap");
    if (wrap) wrap.hidden = v !== "shared";
  }
  n.querySelectorAll("#svisTabs [data-svis]").forEach((btn) => {
    btn.onclick = () => setCreateVisibility(btn.dataset.svis);
  });
  setCreateVisibility("private");

  function closeSecretModal() {
    const panel = n.querySelector("#sdetail");
    if (panel) panel.hidden = true;
    if (!shareEditorOpen) document.body.classList.remove("secret-modal-open");
    const editForm = n.querySelector("#deditForm");
    const dview = n.querySelector("#dview");
    if (editForm) editForm.hidden = true;
    if (dview) dview.hidden = false;
    const editSlots = n.querySelector("#eextraSlots");
    if (editSlots) editSlots.innerHTML = "";
    if (!shareEditorOpen) {
      currentSecret = null;
      currentSecretPayload = null;
      currentSecretTitle = "";
    }
  }

  n.querySelector("#sdetailClose").onclick = closeSecretModal;
  n.querySelector("#sdetailBackdrop").onclick = closeSecretModal;
  n.querySelector("#dcancel").onclick = () => {
    n.querySelector("#deditForm").hidden = true;
    n.querySelector("#dview").hidden = false;
  };
  n.querySelector("#edpwGen").onclick = () => {
    const len = Math.min(64, Math.max(12, parseInt(n.querySelector("#edpwLen").value, 10) || 20));
    const symbols = n.querySelector("#edpwSym").checked;
    n.querySelector("#edpw").type = "text";
    n.querySelector("#edpw").value = generatePassword(len, { symbols });
  };
  n.querySelector("#edpwShow").onclick = () => {
    const inp = n.querySelector("#edpw");
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    n.querySelector("#edpwShow").innerHTML = btnLabel("eye", show ? "Verbergen" : "Anzeigen");
  };
  n.querySelector("#eextraAddBtn").onclick = () => {
    const err = n.querySelector("#derr");
    err.hidden = true;
    try {
      const type = n.querySelector("#eextraAdd").value;
      if (!type) throw new Error("Feldtyp wählen");
      addExtraSlot(n.querySelector("#eextraSlots"), type);
      n.querySelector("#eextraAdd").value = "";
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };
  n.querySelector("#dedit").onclick = () => {
    if (!currentSecret || !currentSecretPayload) return;
    n.querySelector("#edtitle").value = currentSecretTitle || "";
    n.querySelector("#eduser").value = currentSecretPayload.username || "";
    n.querySelector("#edpw").value = currentSecretPayload.password || "";
    n.querySelector("#edpw").type = "password";
    n.querySelector("#edpwShow").innerHTML = btnLabel("eye", "Anzeigen");
    n.querySelector("#edtags").value = (currentSecretPayload.tags || []).join(", ");
    n.querySelector("#eextraAdd").value = "";
    hydrateExtraSlots(n.querySelector("#eextraSlots"), currentSecretPayload);
    n.querySelector("#dview").hidden = true;
    n.querySelector("#deditForm").hidden = false;
  };
  n.querySelector("#dsave").onclick = async () => {
    const err = n.querySelector("#derr"); err.hidden = true;
    try {
      if (!currentSecret || !vault.sk) throw new Error("Kein Secret geladen");
      const title = n.querySelector("#edtitle").value.trim();
      if (!title) throw new Error("Titel erforderlich");
      const payload = normalizeSecretPayload(collectPayloadFromSlots(n.querySelector("#eextraSlots"), {
        username: n.querySelector("#eduser").value,
        password: n.querySelector("#edpw").value,
        tagsInput: n.querySelector("#edtags").value,
      }));
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

  const sortSel = n.querySelector("#ssort");
  if (sortSel) {
    sortSel.value = vault.sortMode;
    sortSel.onchange = () => {
      const v = sortSel.value;
      if (v !== "title-asc" && v !== "title-desc" && v !== "recent") return;
      vault.sortMode = v;
      try { localStorage.setItem("tv-secrets-sort", v); } catch (_) {}
      paintSecretList();
    };
  }

  n.querySelector("#ssearch").oninput = () => {
    vault.searchQuery = n.querySelector("#ssearch").value.trim().toLowerCase();
    paintSecretList();
  };

  function setTagFilters(tags) {
    vault.tagFilters = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
    paintTagFilterUI();
    paintSecretList();
  }

  function paintTagFilterUI() {
    const selected = n.querySelector("#stagSelected");
    const toggle = n.querySelector("#stagToggle");
    if (!selected || !toggle) return;
    const cur = vault.tagFilters || [];
    if (!cur.length) {
      selected.innerHTML = "";
      toggle.textContent = "Tags wählen…";
      return;
    }
    selected.innerHTML = cur.map((t) =>
      `<button type="button" class="tag tag-filter-chip" data-remove-tag="${escHtml(t)}" title="Entfernen">${escHtml(t)} ×</button>`
    ).join("");
    selected.querySelectorAll("[data-remove-tag]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        setTagFilters(vault.tagFilters.filter((x) => x !== btn.dataset.removeTag));
      };
    });
    toggle.textContent = `${cur.length} Tag${cur.length === 1 ? "" : "s"} (UND)`;
  }

  function updateTagOptions() {
    const box = n.querySelector("#stagOptions");
    if (!box) return;
    const tags = [...new Set(vault.secretsCache.flatMap((s) => s._tags || []).filter(Boolean))].sort();
    const cur = new Set(vault.tagFilters || []);
    const kept = (vault.tagFilters || []).filter((t) => tags.includes(t));
    const pruned = kept.length !== (vault.tagFilters || []).length;
    vault.tagFilters = kept;
    box.innerHTML = tags.length
      ? tags.map((t) => {
          const id = "stag_" + encodeURIComponent(t).replace(/%/g, "_");
          return `<label class="tag-filter-opt inline"><input type="checkbox" id="${id}" value="${escHtml(t)}" ${cur.has(t) && tags.includes(t) ? "checked" : ""}/> ${escHtml(t)}</label>`;
        }).join("")
      : `<p class="hint">Keine Tags in geladenen Secrets</p>`;
    box.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
      inp.onchange = () => {
        const next = [...box.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
        setTagFilters(next);
      };
    });
    paintTagFilterUI();
    if (pruned) paintSecretList();
  }

  const stagToggle = n.querySelector("#stagToggle");
  const stagMenu = n.querySelector("#stagMenu");
  if (stagToggle && stagMenu) {
    stagToggle.onclick = (ev) => {
      ev.stopPropagation();
      const open = stagMenu.hidden;
      stagMenu.hidden = !open;
      stagToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    document.addEventListener("click", (ev) => {
      const wrap = n.querySelector("#stagFilter");
      if (!wrap || !stagMenu || stagMenu.hidden) return;
      if (!wrap.contains(ev.target)) {
        stagMenu.hidden = true;
        stagToggle.setAttribute("aria-expanded", "false");
      }
    });
  }
  const stagClear = n.querySelector("#stagClear");
  if (stagClear) {
    stagClear.onclick = () => {
      setTagFilters([]);
      const menu = n.querySelector("#stagMenu");
      if (menu) menu.hidden = true;
    };
  }
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

  function addCreateSlot(type, prefill) {
    addExtraSlot(n.querySelector("#sextraSlots"), type, prefill);
  }

  function collectCreatePayload() {
    return collectPayloadFromSlots(n.querySelector("#sextraSlots"), {
      username: n.querySelector("#suser").value,
      password: n.querySelector("#spw").value,
      tagsInput: n.querySelector("#stagsIn")?.value,
    });
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
    const userSel = n.querySelector("#screateUsers");
    if (userSel) userSel.selectedIndex = -1;
    const gSel = n.querySelector("#screateGroups");
    if (gSel) gSel.selectedIndex = -1;
    setCreateVisibility("private");
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
    const shareUserIds = [];
    const shareGroupIds = [];
    const addEnv = (uid, pkB64) => {
      if (!uid || seen.has(uid) || !pkB64) return;
      envelopes.push(TVCrypto.envelopeToAPI(
        uid,
        TVCrypto.sealDataKeyForRecipient(dk, TVCrypto.b64dec(pkB64), kv)
      ));
      seen.add(uid);
    };
    addEnv(vault.me.user_id, meKeys.public_key_b64);
    const allowShare = shareOpts !== false;
    const visibility = (shareOpts && shareOpts.visibility) ||
      (n.querySelector("#svis")?.value) ||
      "private";
    const userSel = n.querySelector("#screateUsers");
    if (userSel && allowShare && visibility === "shared") {
      for (const opt of userSel.selectedOptions) {
        addEnv(opt.value, opt.dataset.pk);
        if (opt.value && opt.value !== vault.me.user_id) shareUserIds.push(opt.value);
      }
    }
    const gSel = n.querySelector("#screateGroups");
    if (gSel && allowShare && visibility === "shared") {
      for (const opt of gSel.selectedOptions) {
        shareGroupIds.push(opt.value);
        const pks = await api("/api/groups/" + encodeURIComponent(opt.value) + "/member-keys");
        for (const p of pks) addEnv(p.user_id, p.public_key_b64);
      }
    }
    if (visibility === "shared" && !shareUserIds.length && !shareGroupIds.length) {
      dk.fill(0);
      throw new Error("Geteiltes Secret: mindestens einen User oder eine Gruppe wählen");
    }
    dk.fill(0);
    const body = {
      title_ciphertext_b64: TVCrypto.b64enc(titleEnc.ciphertext),
      title_nonce_b64: TVCrypto.b64enc(titleEnc.nonce),
      ciphertext_b64: TVCrypto.b64enc(bodyEnc.ciphertext),
      nonce_b64: TVCrypto.b64enc(bodyEnc.nonce),
      key_version: kv,
      envelopes,
      visibility: visibility === "shared" ? "shared" : "private",
    };
    if (shareUserIds.length) body.share_user_ids = shareUserIds;
    if (shareGroupIds.length) body.share_group_ids = shareGroupIds;
    if (shareUserIds.length || shareGroupIds.length) {
      const capEl = n.querySelector("#screateCap");
      const cap = (shareOpts && shareOpts.capability) || (capEl && capEl.value) || "write";
      body.share_capability = normalizeShareCap(cap);
    }
    await api("/api/secrets", { method: "POST", body: JSON.stringify(body) });
    return body.visibility;
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
          }),
          { visibility: "private" }
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

  function needsSecretMeta(it) {
    return !it._metaLoaded && it.has_access;
  }

  function matchesOwnership(it) {
    if (!it.has_access) return false;
    if (vault.listScope === "favorites") return isUserFavorite(it.id);
    const vis = (it.visibility || "private") === "shared" ? "shared" : "private";
    return vault.listScope === "shared" ? vis === "shared" : vis === "private";
  }

  function sortSecretItems(items) {
    const mode = vault.sortMode;
    const out = [...items];
    const cmpTitle = (a, b) =>
      secretTitleLabel(a).localeCompare(secretTitleLabel(b), "de", { sensitivity: "base" });
    if (mode === "title-desc") out.sort((a, b) => cmpTitle(b, a));
    else if (mode === "title-asc") out.sort(cmpTitle);
    return out;
  }

  function buildOrderedSecretGroups(filtered) {
    if (vault.listScope === "favorites") {
      const items = sortSecretItems(filtered);
      return { groups: [{ label: null, items }], flat: items };
    }
    const fav = [];
    const rest = [];
    for (const it of filtered) {
      if (isUserFavorite(it.id)) fav.push(it);
      else rest.push(it);
    }
    const favSorted = sortSecretItems(fav);
    const restSorted = sortSecretItems(rest);
    const showLabels = favSorted.length > 0 && restSorted.length > 0;
    const groups = [];
    if (favSorted.length) {
      groups.push({ label: showLabels ? "Favoriten" : null, items: favSorted });
    }
    if (restSorted.length) {
      groups.push({ label: showLabels ? "Weitere Einträge" : null, items: restSorted });
    }
    return { groups, flat: [...favSorted, ...restSorted] };
  }

  function favoriteToggleButton(it) {
    if (!it.has_access || vault.offlineMode) return "";
    const on = isUserFavorite(it.id);
    return `<button type="button" class="btn-icon fav-toggle${on ? " is-fav" : ""}" data-fav-toggle="${escHtml(it.id)}" title="${on ? "Aus Favoriten entfernen" : "Als Favorit markieren"}" aria-pressed="${on ? "true" : "false"}">${icon("star", "fav-ico")}</button>`;
  }

  function bindFavoriteToggles(root) {
    if (!root) return;
    root.querySelectorAll("[data-fav-toggle]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        toggleUserFavorite(btn.dataset.favToggle);
        paintSecretList();
      };
    });
  }

  function filterVisibleSecrets() {
    const q = vault.searchQuery;
    const wantTags = vault.tagFilters || [];
    return vault.secretsCache.filter((it) => {
      if (!matchesOwnership(it)) return false;
      if (wantTags.length) {
        const have = it._tags || [];
        if (!wantTags.every((t) => have.includes(t))) return false;
      }
      if (!q) return true;
      const title = (it._title || "").toLowerCase();
      const user = (it._username || "").toLowerCase();
      const tags = (it._tags || []).join(" ").toLowerCase();
      const creator = (it.created_by_username || "").toLowerCase();
      const groups = (it.shared_groups || []).join(" ").toLowerCase();
      const shareUsers = (it.shared_users || []).join(" ").toLowerCase();
      return title.includes(q) || user.includes(q) || tags.includes(q) ||
        creator.includes(q) || groups.includes(q) || shareUsers.includes(q) ||
        (it.id || "").toLowerCase().includes(q);
    });
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function extraCopyIcon(type) {
    switch (type) {
      case "ssh_private_key":
      case "ssh_public_key":
        return "key";
      case "s3_access_key":
      case "s3_secret_key":
        return "shield";
      case "certificate":
        return "cert";
      case "totp":
        return "rotate";
      case "url":
        return "open";
      case "notes":
      case "text":
        return "clipboard";
      default:
        return "copy";
    }
  }

  function buildCopyShortcuts(payload) {
    const out = [];
    if ((payload.username || "").trim()) {
      out.push({ id: "username", label: "Benutzer", icon: "user" });
    }
    if ((payload.password || "").trim()) {
      out.push({ id: "password", label: "Passwort", icon: "lock" });
    }
    if (payload.totp_seed) {
      out.push({ id: "totp_seed", label: "TOTP-Seed", icon: "rotate" });
    }
    (payload.urls || []).forEach((url, i) => {
      if ((url || "").trim()) {
        out.push({
          id: `url:${i}`,
          label: payload.urls.length > 1 ? `Website ${i + 1}` : "Website",
          icon: "open",
        });
      }
    });
    if ((payload.notes || "").trim()) {
      out.push({ id: "notes", label: "Notizen", icon: "clipboard" });
    }
    (payload.extra || []).forEach((ex) => {
      if (!(ex.value || "").trim()) return;
      out.push({
        id: `extra:${ex.id}`,
        label: ex.label || ex.type || "Feld",
        icon: extraCopyIcon(ex.type),
      });
    });
    return out;
  }

  function payloadFieldValue(payload, fieldId) {
    if (fieldId === "username") return payload.username || "";
    if (fieldId === "password") return payload.password || "";
    if (fieldId === "totp_seed") return payload.totp_seed || "";
    if (fieldId === "notes") return payload.notes || "";
    if (fieldId.startsWith("url:")) {
      const i = parseInt(fieldId.slice(4), 10);
      return (payload.urls || [])[i] || "";
    }
    if (fieldId.startsWith("extra:")) {
      const id = fieldId.slice(6);
      const ex = (payload.extra || []).find((e) => e.id === id);
      return ex?.value || "";
    }
    return "";
  }

  async function loadSecretPayload(it) {
    if (it._payload) return it._payload;
    if (!it.has_access || !vault.sk) throw new Error("Kein Zugriff");
    let det;
    if (vault.offlineMode && vault.offlineSnapshot) {
      det = (vault.offlineSnapshot.secrets || []).find((s) => s.id === it.id);
      if (!det) throw new Error("Secret nicht in Offline-Kopie");
    } else {
      det = await api("/api/secrets/" + it.id);
    }
    const dk = openDKFromEnvelope(det.envelope);
    const kv = det.key_version || (det.envelope && det.envelope.key_version) || 1;
    const pt = await TVCrypto.decryptPayload(
      TVCrypto.b64dec(det.ciphertext_b64),
      TVCrypto.b64dec(det.nonce_b64),
      dk, kv
    );
    dk.fill(0);
    const payload = normalizeSecretPayload(JSON.parse(new TextDecoder().decode(pt)));
    it._payload = payload;
    it._copyShortcuts = buildCopyShortcuts(payload);
    return payload;
  }

  async function enrichSecretMeta(it) {
    if (it._metaLoaded) return;
    if (!it.has_access || !it.envelope || !vault.sk) return;
    try {
      const payload = await loadSecretPayload(it);
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
      it._copyShortcuts = [];
      it._metaLoaded = true;
    }
  }

  function copyShortcutButtonsHtml(it) {
    if (!it.has_access) return "";
    const shortcuts = it._copyShortcuts || [];
    if (!shortcuts.length) return "";
    return `<span class="sec-copy-actions" role="group" aria-label="Schnell kopieren">${
      shortcuts.map((s) =>
        `<button type="button" class="btn-icon btn-icon-sm sec-copy-btn" data-copy-secret="${escHtml(it.id)}" data-copy-field="${escHtml(s.id)}" title="${escHtml(s.label)} kopieren" aria-label="${escHtml(s.label)} kopieren">${icon(s.icon)}</button>`
      ).join("")
    }</span>`;
  }

  function bindSecretCopyButtons(root) {
    root.querySelectorAll("[data-copy-secret]").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const secretId = btn.dataset.copySecret;
        const fieldId = btn.dataset.copyField;
        const it = vault.secretsCache.find((s) => s.id === secretId);
        if (!it) return;
        try {
          btn.disabled = true;
          const payload = await loadSecretPayload(it);
          const val = payloadFieldValue(payload, fieldId);
          if (!val) return;
          await copyText(val);
          flashCopyIcon(btn);
        } catch (e) {
          alert(e.message || String(e));
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  function secretTitleLabel(it) {
    if (it._title) return it._title;
    return it.id + (it.has_access ? " (Titel n.v.)" : " · kein Zugriff");
  }

  function secretIsShared(it) {
    return (it && it.visibility === "shared") ||
      !!(it && ((it.shared_groups && it.shared_groups.length) || (it.shared_users && it.shared_users.length)));
  }

  function shareSummaryTitle(it) {
    const bits = [];
    if (it.created_by_username) bits.push("Angelegt: " + it.created_by_username);
    if (it.shared_users && it.shared_users.length) bits.push("User: " + it.shared_users.join(", "));
    if (it.shared_groups && it.shared_groups.length) bits.push("Gruppen: " + it.shared_groups.join(", "));
    return bits.join(" · ") || "Zugriff bearbeiten";
  }

  function shareBadgeButton(it) {
    if (!it.has_access || vault.offlineMode) return "";
    const shared = secretIsShared(it);
    const cls = shared ? "share-badge" : "share-badge share-badge-empty";
    const title = shared ? shareSummaryTitle(it) : "Als geteiltes Secret freigeben";
    const label = shared ? "Zugriff anzeigen" : "Teilen";
    return `<button type="button" class="${cls}" data-share-edit="${escHtml(it.id)}" title="${escHtml(title)}" aria-label="${escHtml(label)}">${icon("share")}</button>`;
  }

  function bindShareBadge(root) {
    root.querySelectorAll("[data-share-edit]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        openShareEditor(btn.dataset.shareEdit).catch((e) => alert(e.message));
      };
    });
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

    if ((vault.tagFilters && vault.tagFilters.length) || vault.searchQuery) {
      const pending = vault.secretsCache.filter(needsSecretMeta);
      if (pending.length) {
        enrichThenRepaint(pending);
        return;
      }
    }

    const filtered = filterVisibleSecrets();
    const { groups, flat: visible } = buildOrderedSecretGroups(filtered);

    const pendingVisible = visible.filter(needsSecretMeta);
    if (pendingVisible.length) {
      enrichThenRepaint(pendingVisible);
      return;
    }

    if (!visible.length) {
      let empty;
      if (vault.listScope === "favorites") {
        empty = "Keine Favoriten. Markieren Sie Secrets mit dem Stern in der Liste.";
      } else if (vault.listScope === "shared") {
        empty = "Keine geteilten Secrets.";
      } else {
        empty = "Noch keine privaten Secrets.";
      }
      list.innerHTML = `<p class="hint">${empty}</p>`;
    } else if (vault.viewMode === "table") {
      const sharedView = vault.listScope === "shared";
      const colSpan = sharedView ? 11 : 8;
      const head = sharedView
        ? `<th class="st-check"></th><th>Titel</th><th>Benutzer</th><th>Tags</th><th>Angelegt von</th><th>User</th><th>Gruppen</th><th class="st-share" title="Zugriff"> </th><th class="st-copy" title="Kopieren"> </th><th></th><th></th>`
        : `<th class="st-check"></th><th>Titel</th><th>Benutzer</th><th>Tags</th><th class="st-share" title="Teilen"> </th><th class="st-copy" title="Kopieren"> </th><th></th><th></th>`;
      const table = el(`<table class="secrets-table"><thead><tr>${head}</tr></thead><tbody></tbody></table>`);
      const tbody = table.querySelector("tbody");
      for (const group of groups) {
        if (group.label) {
          tbody.appendChild(el(`<tr class="secrets-group-row"><td colspan="${colSpan}">${escHtml(group.label)}</td></tr>`));
        }
        for (const it of group.items) {
        let tr;
        if (sharedView) {
          tr = el(`<tr>
            <td class="st-check"><input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} /></td>
            <td class="st-title"></td>
            <td class="st-user">${escHtml(it._username || "—")}</td>
            <td class="st-tags"></td>
            <td class="st-creator muted">${escHtml(it.created_by_username || "—")}</td>
            <td class="st-users muted">${escHtml((it.shared_users || []).join(", ") || "—")}</td>
            <td class="st-groups muted">${escHtml((it.shared_groups || []).join(", ") || "—")}</td>
            <td class="st-share">${shareBadgeButton(it)}</td>
            <td class="st-copy">${copyShortcutButtonsHtml(it)}</td>
            <td class="st-fav">${favoriteToggleButton(it)}</td>
            <td class="st-act"><button type="button" class="btn-ghost btn-with-ico btn-sm">${btnLabel("open", "Öffnen")}</button></td>
          </tr>`);
        } else {
          tr = el(`<tr>
            <td class="st-check"><input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} /></td>
            <td class="st-title"></td>
            <td class="st-user">${escHtml(it._username || "—")}</td>
            <td class="st-tags"></td>
            <td class="st-share">${shareBadgeButton(it)}</td>
            <td class="st-copy">${copyShortcutButtonsHtml(it)}</td>
            <td class="st-fav">${favoriteToggleButton(it)}</td>
            <td class="st-act"><button type="button" class="btn-ghost btn-with-ico btn-sm">${btnLabel("open", "Öffnen")}</button></td>
          </tr>`);
        }
        bindSecretCheckbox(tr.querySelector(".sec-check"), it.id);
        const titleCell = tr.querySelector(".st-title");
        titleCell.appendChild(document.createTextNode(secretTitleLabel(it)));
        const tagsCell = tr.querySelector(".st-tags");
        if (it._tags && it._tags.length) {
          tagsCell.innerHTML = `<span class="tags">${it._tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join("")}</span>`;
        } else {
          tagsCell.textContent = "—";
        }
        tr.querySelector(".st-act button").onclick = () => openSecret(it.id);
        tbody.appendChild(tr);
        }
      }
      bindShareBadge(table);
      bindSecretCopyButtons(table);
      bindFavoriteToggles(table);
      list.appendChild(table);
    } else if (vault.viewMode === "tiles") {
      const wrap = el(`<div class="secrets-tiles-wrap"></div>`);
      for (const group of groups) {
        if (group.label) {
          wrap.appendChild(el(`<h3 class="secrets-group-head">${escHtml(group.label)}</h3>`));
        }
        const grid = el(`<div class="secrets-tiles"></div>`);
        for (const it of group.items) {
        const tile = el(`<article class="secret-tile">
          <div class="secret-tile-head">
            <input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} />
            <span class="list-row-ico" aria-hidden="true">${icon("key")}</span>
            <span class="secret-tile-fav">${favoriteToggleButton(it)}</span>
            <span class="secret-tile-share">${shareBadgeButton(it)}</span>
          </div>
          <h3 class="secret-tile-title"></h3>
          <p class="secret-tile-meta hint"></p>
          <div class="secret-tile-tags"></div>
          ${copyShortcutButtonsHtml(it)}
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
        tile.querySelector("button.btn-ghost").onclick = () => openSecret(it.id);
        grid.appendChild(tile);
        }
        wrap.appendChild(grid);
      }
      bindShareBadge(wrap);
      bindSecretCopyButtons(wrap);
      bindFavoriteToggles(wrap);
      list.appendChild(wrap);
    } else {
      for (const group of groups) {
        if (group.label) {
          list.appendChild(el(`<h3 class="secrets-group-head">${escHtml(group.label)}</h3>`));
        }
        for (const it of group.items) {
        const row = el(`<div class="list-row">
          <input type="checkbox" class="sec-check" ${it.has_access ? "" : "disabled"} />
          <span class="list-row-fav">${favoriteToggleButton(it)}</span>
          <span class="list-row-main"></span>
          ${shareBadgeButton(it)}
          ${copyShortcutButtonsHtml(it)}
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
        row.querySelectorAll("button.btn-ghost.btn-with-ico").forEach((btn) => {
          if (btn.dataset.shareEdit) return;
          btn.onclick = () => openSecret(it.id);
        });
        list.appendChild(row);
        }
      }
      bindShareBadge(list);
      bindSecretCopyButtons(list);
      bindFavoriteToggles(list);
    }

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
    ["#dedit", "#sdel", "#sExportOne"].forEach((sel) => {
      const el = n.querySelector(sel);
      if (el) el.hidden = false;
    });
    const accessPanel = n.querySelector("#accessPanel");
    if (accessPanel) accessPanel.hidden = false;
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
          tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")
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
      const groupHint = (det.shared_groups || []).join(", ");
      const userHint = (det.shared_users || []).join(", ");
      n.querySelector("#drec").textContent =
        "Empfänger: " + (det.recipients || []).join(", ") +
        " · v" + kv +
        (userHint ? " · User: " + userHint : "") +
        (groupHint ? " · Gruppen: " + groupHint : "");
      const editBtn = n.querySelector("#dedit");
      const delBtn = n.querySelector("#sdel");
      const exportOne = n.querySelector("#sExportOne");
      const accessPanel = n.querySelector("#accessPanel");
      const offlineDetail = !!vault.offlineMode;
      if (exportOne) exportOne.hidden = offlineDetail;
      if (accessPanel) accessPanel.hidden = offlineDetail;
      if (offlineDetail) {
        if (editBtn) editBtn.hidden = true;
        if (delBtn) delBtn.hidden = true;
      } else {
        await renderAccessPanel("detail");
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
      const visibility = await postEncryptedSecret(title, payload);
      resetCreateForm();
      await refreshSecrets(true);
      navigateTo(visibility === "shared" ? "vault:shared" : "vault:mine");
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  };

  let accessDnDBusy = false;
  let accessFilterDetail = "";
  let accessFilterModal = "";
  let shareEditorOpen = false;
  let shareEditorPreserveDetail = false;

  function normalizeShareCap(c) {
    const v = String(c || "").toLowerCase().trim();
    if (v === "read" || v === "share" || v === "admin") return v;
    return "write";
  }

  function capLabel(c) {
    switch (normalizeShareCap(c)) {
      case "read": return "Lesen";
      case "share": return "Teilen";
      case "admin": return "Verwalten";
      default: return "Bearbeiten";
    }
  }

  function capRank(c) {
    switch (normalizeShareCap(c)) {
      case "read": return 1;
      case "write": return 2;
      case "share": return 3;
      case "admin": return 4;
      default: return 0;
    }
  }

  function capAtLeast(have, want) {
    return capRank(have) >= capRank(want);
  }

  function selectedShareCapability(kind) {
    const id = kind === "modal" ? "#smShareCap" : "#dShareCap";
    return normalizeShareCap(n.querySelector(id)?.value || "write");
  }

  function accessPanelTargets(kind) {
    if (kind === "modal") {
      return {
        kind,
        availEl: n.querySelector("#smAccessAvailable"),
        curEl: n.querySelector("#smAccessCurrent"),
        errEl: n.querySelector("#smAccessErr"),
        getFilter: () => accessFilterModal,
      };
    }
    return {
      kind,
      availEl: n.querySelector("#accessAvailable"),
      curEl: n.querySelector("#accessCurrent"),
      errEl: n.querySelector("#derr"),
      getFilter: () => accessFilterDetail,
    };
  }

  function wireAccessChip(el, kind, id, label) {
    el.draggable = true;
    el.dataset.kind = kind;
    el.dataset.id = id;
    el.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ kind, id, label }));
      ev.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  }

  function syncCacheShareMeta(secretId, access) {
    const it = vault.secretsCache.find((s) => s.id === secretId);
    if (!it || !access) return;
    it.shared_users = (access.shared_users || []).map((u) => u.username).filter(Boolean);
    it.shared_groups = (access.shared_groups || []).map((g) => g.name).filter(Boolean);
  }

  async function renderAccessPanel(kind) {
    const targets = [];
    if (!kind || kind === "detail") {
      const detailOpen = n.querySelector("#sdetail") && !n.querySelector("#sdetail").hidden;
      if (detailOpen || kind === "detail") targets.push(accessPanelTargets("detail"));
    }
    if (!kind || kind === "modal") {
      if (shareEditorOpen || kind === "modal") targets.push(accessPanelTargets("modal"));
    }
    if (!currentSecret || !targets.length) return;

    const access = await api("/api/secrets/" + currentSecret.id + "/access");
    vault.secretAccess = access;
    syncCacheShareMeta(currentSecret.id, access);

    for (const t of targets) {
      const { availEl, curEl, errEl, getFilter } = t;
      if (!availEl || !curEl) continue;
      if (errEl) { errEl.hidden = true; errEl.textContent = ""; }
      const q = (getFilter() || "").trim().toLowerCase();
      const match = (s) => !q || String(s || "").toLowerCase().includes(q);

      const availParts = [];
      (access.available_users || []).filter((u) => match(u.username)).forEach((u) => {
        availParts.push(`<div class="access-chip" data-kind="user" data-id="${escHtml(u.id)}"><span>${escHtml(u.username)} <span class="chip-meta">User</span></span></div>`);
      });
      (access.available_groups || []).filter((g) => match(g.name)).forEach((g) => {
        availParts.push(`<div class="access-chip" data-kind="group" data-id="${escHtml(g.id)}"><span>${escHtml(g.name)} <span class="chip-meta">Gruppe</span></span></div>`);
      });
      availEl.innerHTML = availParts.join("") || `<p class="hint group-drop-hint">Keine weiteren Ziele</p>`;

      const curParts = [];
      const owner = access.owner || {};
      curParts.push(`<div class="access-chip owner"><span>${escHtml(owner.username || owner.id || "Eigentümer")} <span class="chip-meta">Eigentümer</span></span></div>`);
      (access.shared_users || []).forEach((u) => {
        const cap = normalizeShareCap(u.capability || "write");
        curParts.push(`<div class="access-chip" data-kind="user" data-id="${escHtml(u.id)}"><span>${escHtml(u.username)} <span class="chip-meta">User · ${escHtml(capLabel(cap))}</span></span><button type="button" class="btn-ghost btn-sm" data-drop-user="${escHtml(u.id)}">Entfernen</button></div>`);
      });
      (access.shared_groups || []).forEach((g) => {
        const cap = normalizeShareCap(g.capability || "write");
        curParts.push(`<div class="access-chip" data-kind="group" data-id="${escHtml(g.id)}"><span>${escHtml(g.name)} <span class="chip-meta">Gruppe · ${escHtml(capLabel(cap))}</span></span><button type="button" class="btn-ghost btn-sm" data-drop-group="${escHtml(g.id)}">Entfernen</button></div>`);
      });
      curEl.innerHTML = curParts.join("");

      const myCap = access.my_capability || "";
      const canShare = capAtLeast(myCap, "share");
      const canAdmin = capAtLeast(myCap, "admin");
      availEl.querySelectorAll(".access-chip[data-kind]").forEach((el) => {
        wireAccessChip(el, el.dataset.kind, el.dataset.id, el.textContent.trim());
        el.addEventListener("click", async () => {
          if (accessDnDBusy || !canShare) return;
          try {
            if (el.dataset.kind === "user") await shareSecretWithUser(el.dataset.id, selectedShareCapability(t.kind));
            else if (el.dataset.kind === "group") await shareSecretWithGroup(el.dataset.id, selectedShareCapability(t.kind));
          } catch (e) {
            if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
          }
        });
        if (!canShare) el.classList.add("access-chip-disabled");
      });
      curEl.querySelectorAll(".access-chip[data-kind]").forEach((el) => {
        wireAccessChip(el, el.dataset.kind, el.dataset.id, el.textContent.trim());
      });
      curEl.querySelectorAll("[data-drop-user]").forEach((btn) => {
        btn.disabled = !canAdmin;
        btn.onclick = async (ev) => {
          ev.stopPropagation();
          if (!canAdmin) return;
          try { await unshareSecret({ userIds: [btn.dataset.dropUser] }); }
          catch (e) {
            if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
          }
        };
      });
      curEl.querySelectorAll("[data-drop-group]").forEach((btn) => {
        btn.disabled = !canAdmin;
        btn.onclick = async (ev) => {
          ev.stopPropagation();
          if (!canAdmin) return;
          try { await unshareSecret({ groupIds: [btn.dataset.dropGroup] }); }
          catch (e) {
            if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
          }
        };
      });

      const wireZone = (zone, onDrop) => {
        zone.ondragover = (ev) => {
          ev.preventDefault();
          zone.classList.add("drag-over");
        };
        zone.ondragleave = (ev) => {
          if (!zone.contains(ev.relatedTarget)) zone.classList.remove("drag-over");
        };
        zone.ondrop = async (ev) => {
          ev.preventDefault();
          zone.classList.remove("drag-over");
          let payload = {};
          try { payload = JSON.parse(ev.dataTransfer.getData("text/plain") || "{}"); } catch (_) {}
          if (!payload.kind || !payload.id) return;
          try { await onDrop(payload); }
          catch (e) {
            if (errEl) { errEl.hidden = false; errEl.textContent = e.message; }
          }
        };
      };
      wireZone(curEl, async (p) => {
        if (!canShare) throw new Error("Keine Teilen-Berechtigung");
        if (p.kind === "user") await shareSecretWithUser(p.id, selectedShareCapability(t.kind));
        else if (p.kind === "group") await shareSecretWithGroup(p.id, selectedShareCapability(t.kind));
      });
      wireZone(availEl, async (p) => {
        if (!canAdmin) throw new Error("Keine Verwalten-Berechtigung zum Entfernen");
        if (p.kind === "user") await unshareSecret({ userIds: [p.id] });
        else if (p.kind === "group") await unshareSecret({ groupIds: [p.id] });
      });

      const capPick = t.kind === "modal" ? n.querySelector("#smShareCap") : n.querySelector("#dShareCap");
      if (capPick) {
        capPick.disabled = !canShare;
        Array.from(capPick.options).forEach((opt) => {
          opt.disabled = !capAtLeast(myCap, opt.value);
        });
        if (capPick.selectedOptions[0]?.disabled) {
          const ok = Array.from(capPick.options).find((o) => !o.disabled);
          if (ok) capPick.value = ok.value;
        }
      }
      if (t.kind === "detail") {
        const editBtn = n.querySelector("#dedit");
        const delBtn = n.querySelector("#sdel");
        if (editBtn) editBtn.hidden = !capAtLeast(myCap, "write") || !!vault.offlineMode;
        if (delBtn) delBtn.hidden = !canAdmin || !!vault.offlineMode;
      }
    }

    const sub = n.querySelector("#shareAccessSubtitle");
    if (sub && shareEditorOpen) {
      const users = (access.shared_users || []).map((u) => u.username).filter(Boolean);
      const groups = (access.shared_groups || []).map((g) => g.name).filter(Boolean);
      const bits = [];
      if (users.length) bits.push("User: " + users.join(", "));
      if (groups.length) bits.push("Gruppen: " + groups.join(", "));
      const my = access.my_capability ? "Ihre Rechte: " + capLabel(access.my_capability) : "";
      sub.textContent = [bits.length ? bits.join(" · ") : "Noch nicht geteilt — Ziele links hinzufügen.", my].filter(Boolean).join(" · ");
    }
  }

  async function afterShareMutation() {
    const sid = currentSecret?.id;
    if (!sid) return;
    currentSecret = await api("/api/secrets/" + sid);
    const detailOpen = n.querySelector("#sdetail") && !n.querySelector("#sdetail").hidden;
    if (detailOpen) {
      const groupHint = (currentSecret.shared_groups || []).join(", ");
      const userHint = (currentSecret.shared_users || []).join(", ");
      const drec = n.querySelector("#drec");
      if (drec) {
        drec.textContent =
          "Empfänger: " + (currentSecret.recipients || []).join(", ") +
          " · v" + currentSecret.key_version +
          (userHint ? " · User: " + userHint : "") +
          (groupHint ? " · Gruppen: " + groupHint : "") +
          (currentSecret.visibility === "shared" ? " · Geteilt" : " · Privat");
      }
      await renderAccessPanel("detail");
    }
    if (shareEditorOpen) await renderAccessPanel("modal");
    await refreshSecrets(true);
    if (currentSecret.visibility === "shared" && vault.listScope === "mine") {
      navigateTo("vault:shared");
    } else if (currentSecret.visibility !== "shared" && vault.listScope === "shared") {
      navigateTo("vault:mine");
    }
  }

  async function openShareEditor(id) {
    if (vault.offlineMode) throw new Error("Offline — Teilen nicht möglich");
    const err = n.querySelector("#smAccessErr");
    if (err) { err.hidden = true; err.textContent = ""; }
    const detailOpen = n.querySelector("#sdetail") && !n.querySelector("#sdetail").hidden;
    shareEditorPreserveDetail = detailOpen && currentSecret?.id === id;
    const det = await api("/api/secrets/" + id);
    currentSecret = det;
    let title = id;
    try {
      const dk = openDKFromEnvelope(det.envelope);
      title = await TVCrypto.decryptTitle(
        TVCrypto.b64dec(det.title_ciphertext_b64),
        TVCrypto.b64dec(det.title_nonce_b64),
        dk, det.key_version
      );
      dk.fill(0);
    } catch (_) {}
    n.querySelector("#shareAccessTitle").textContent = "Zugriff: " + title;
    shareEditorOpen = true;
    const modal = n.querySelector("#shareAccessModal");
    modal.hidden = false;
    document.body.classList.add("secret-modal-open");
    await renderAccessPanel("modal");
  }

  function closeShareEditor() {
    const modal = n.querySelector("#shareAccessModal");
    if (modal) modal.hidden = true;
    shareEditorOpen = false;
    const detailOpen = n.querySelector("#sdetail") && !n.querySelector("#sdetail").hidden;
    if (!detailOpen) {
      document.body.classList.remove("secret-modal-open");
      if (!shareEditorPreserveDetail) {
        currentSecret = null;
        currentSecretPayload = null;
        currentSecretTitle = "";
      }
    }
    shareEditorPreserveDetail = false;
    paintSecretList();
  }

  async function shareSecretWithUser(userId, capability) {
    if (accessDnDBusy || !currentSecret || !userId) return;
    accessDnDBusy = true;
    try {
      const pks = await api("/api/users/public-keys");
      const pk = pks.find((p) => p.user_id === userId);
      if (!pk) throw new Error("Pubkey fehlt");
      if (!(await confirmRecipientKey(userId, pk.username, pk.public_key_b64))) return;
      const dk = openDKFromEnvelope(currentSecret.envelope);
      const env = TVCrypto.sealDataKeyForRecipient(dk, recipientPubForUser(userId, pk.public_key_b64), currentSecret.key_version);
      dk.fill(0);
      await api("/api/secrets/" + currentSecret.id + "/share", {
        method: "POST",
        body: JSON.stringify({
          capability: normalizeShareCap(capability),
          envelopes: [TVCrypto.envelopeToAPI(userId, env)],
        }),
      });
      await afterShareMutation();
    } finally {
      accessDnDBusy = false;
    }
  }

  async function shareSecretWithGroup(groupId, capability) {
    if (accessDnDBusy || !currentSecret || !groupId) return;
    accessDnDBusy = true;
    try {
      const pks = await api("/api/secrets/" + currentSecret.id + "/group-member-keys?group_id=" + encodeURIComponent(groupId));
      if (!pks.length) throw new Error("Keine onboardeten Gruppenmitglieder");
      const allowed = [];
      for (const p of pks) {
        if (await confirmRecipientKey(p.user_id, p.username, p.public_key_b64)) allowed.push(p);
      }
      if (!allowed.length) return;
      const dk = openDKFromEnvelope(currentSecret.envelope);
      const envelopes = allowed.map((p) =>
        TVCrypto.envelopeToAPI(
          p.user_id,
          TVCrypto.sealDataKeyForRecipient(dk, recipientPubForUser(p.user_id, p.public_key_b64), currentSecret.key_version)
        )
      );
      dk.fill(0);
      await api("/api/secrets/" + currentSecret.id + "/share-group", {
        method: "POST",
        body: JSON.stringify({
          group_id: groupId,
          capability: normalizeShareCap(capability),
          envelopes,
        }),
      });
      await afterShareMutation();
    } finally {
      accessDnDBusy = false;
    }
  }

  async function unshareSecret({ userIds = [], groupIds = [], dropDirect = true }) {
    if (accessDnDBusy || !currentSecret) return;
    if (!userIds.length && !groupIds.length) return;
    accessDnDBusy = true;
    try {
      const access = vault.secretAccess || await api("/api/secrets/" + currentSecret.id + "/access");
      const keepUsers = new Set();
      const ownerId = access.owner?.id || currentSecret.created_by || vault.me.user_id;
      keepUsers.add(ownerId);
      keepUsers.add(vault.me.user_id);
      (access.shared_users || []).forEach((u) => {
        if (dropDirect && userIds.includes(u.id)) return;
        keepUsers.add(u.id);
      });
      const remainingGroups = (access.shared_groups || []).filter((g) => !groupIds.includes(g.id));
      for (const g of remainingGroups) {
        const members = await api("/api/groups/" + encodeURIComponent(g.id) + "/member-keys");
        members.forEach((m) => keepUsers.add(m.user_id));
      }
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
      const byId = Object.fromEntries(pks.map((p) => [p.user_id, p]));
      const envelopes = [];
      for (const uid of keepUsers) {
        const pk = byId[uid];
        if (!pk?.public_key_b64) throw new Error("Pubkey fehlt: " + uid);
        if (!(await confirmRecipientKey(uid, pk.username, pk.public_key_b64))) {
          throw new Error("Empfängerschlüssel nicht bestätigt: " + (pk.username || uid));
        }
        envelopes.push(TVCrypto.envelopeToAPI(uid, TVCrypto.sealDataKeyForRecipient(newDk, recipientPubForUser(uid, pk.public_key_b64), newKv)));
      }
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
          drop_user_ids: dropDirect ? userIds : [],
          drop_group_ids: groupIds,
        }),
      });
      await afterShareMutation();
    } finally {
      accessDnDBusy = false;
    }
  }

  const accessSearch = n.querySelector("#accessAvailSearch");
  if (accessSearch) {
    accessSearch.oninput = () => {
      accessFilterDetail = accessSearch.value || "";
      if (currentSecret && !vault.offlineMode) renderAccessPanel("detail").catch(() => {});
    };
  }
  const smAccessSearch = n.querySelector("#smAccessSearch");
  if (smAccessSearch) {
    smAccessSearch.oninput = () => {
      accessFilterModal = smAccessSearch.value || "";
      if (currentSecret && shareEditorOpen) renderAccessPanel("modal").catch(() => {});
    };
  }
  n.querySelector("#shareAccessClose").onclick = closeShareEditor;
  n.querySelector("#shareAccessBackdrop").onclick = closeShareEditor;

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
    const id = currentSecret.id;
    await api("/api/secrets/" + id, { method: "DELETE" });
    removeUserFavorite(id);
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
    if (!r.length) return roleLabel("member");
    return r.map(roleLabel).join(", ");
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
      `${formatUserStatus(user.status)}${user.onboarded ? " · Vault eingerichtet" : ""} · ${formatAuthBackend(user.auth_backend)}`;
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
    if (vault.sk && !vault.offlineMode) {
      try {
        const r = await sealGroupShareGaps({ groupId: gid, userId: uid });
        if (r.sealed || r.failed) {
          announceA11y(
            r.failed
              ? `Gruppen-Freigaben: ${r.sealed} nachgeteilt, ${r.failed} fehlgeschlagen`
              : `Gruppen-Freigaben: ${r.sealed} an neues Mitglied nachgeteilt`
          );
        }
      } catch (e) {
        console.warn("auto reseal after member add", e);
      }
    }
  }

  async function groupsMemberRemove(gid, uid) {
    const res = await api("/api/admin/groups/" + encodeURIComponent(gid) + "/members/" + encodeURIComponent(uid), {
      method: "DELETE",
    });
    const ids = res.rotate_secret_ids || [];
    if (vault.sk && !vault.offlineMode && ids.length) {
      for (const sid of ids) {
        try {
          await rotateSecretExcludingUser(sid, uid);
        } catch (e) {
          console.warn("rotate after member remove", sid, e);
        }
      }
    }
  }

  async function rotateSecretExcludingUser(secretId, dropUserId) {
    const prev = currentSecret;
    const prevBusy = accessDnDBusy;
    try {
      currentSecret = await api("/api/secrets/" + secretId);
      accessDnDBusy = false;
      await unshareSecret({ userIds: [dropUserId], groupIds: [], dropDirect: false });
    } finally {
      currentSecret = prev;
      accessDnDBusy = prevBusy;
    }
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

  function userActionButtons(u) {
    return `<div class="row user-row-actions">
      <button class="btn-ghost btn-sm" data-edit-user="${escHtml(u.id)}" type="button">Bearbeiten</button>
      ${u.status !== "disabled" ? `<button class="btn-ghost btn-sm" data-dis="${escHtml(u.id)}" type="button">Deaktivieren</button>` : ""}
    </div>`;
  }

  function bindUserRowActions(container, users) {
    container.querySelectorAll("[data-edit-user]").forEach((btn) => {
      btn.onclick = () => {
        const u = users.find((x) => x.id === btn.dataset.editUser);
        if (u) openUserEditor(u);
      };
    });
    container.querySelectorAll("[data-dis]").forEach((btn) => {
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

  function syncUsersViewToggle() {
    n.querySelectorAll("[data-users-view]").forEach((btn) => {
      const on = btn.dataset.usersView === vault.usersViewMode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setUsersViewMode(mode) {
    if (mode !== "list" && mode !== "table" && mode !== "tiles") return;
    vault.usersViewMode = mode;
    try { localStorage.setItem("tv-users-view", mode); } catch (_) {}
    syncUsersViewToggle();
    paintUsersList(vault.adminUsers);
  }

  function paintUsersList(users) {
    vault.adminUsers = users || [];
    const list = n.querySelector("#ulist");
    if (!list) return;
    list.innerHTML = "";
    list.className = "list users-list users-view-" + vault.usersViewMode;
    if (!vault.adminUsers.length) {
      list.innerHTML = "<p class='hint'>Keine User</p>";
      return;
    }
    if (vault.usersViewMode === "table") {
      const table = el(`<table class="secrets-table users-table"><thead><tr>
        <th>Benutzername</th><th>Anzeigename</th><th>E-Mail</th><th>Status</th><th>Auth</th><th>Rollen</th><th></th>
      </tr></thead><tbody></tbody></table>`);
      const tbody = table.querySelector("tbody");
      for (const u of vault.adminUsers) {
        const tr = el(`<tr>
          <td class="st-title">${escHtml(u.username)}</td>
          <td>${escHtml(u.display_name || "—")}</td>
          <td class="muted">${escHtml(u.email || "—")}</td>
          <td>${escHtml(formatUserStatus(u.status))}${u.onboarded ? " · Vault" : ""}</td>
          <td>${escHtml(formatAuthBackend(u.auth_backend))}</td>
          <td>${escHtml(formatUserRoles(u.roles))}</td>
          <td class="st-act"></td>
        </tr>`);
        tr.querySelector(".st-act").innerHTML = userActionButtons(u);
        tbody.appendChild(tr);
      }
      list.appendChild(table);
    } else if (vault.usersViewMode === "tiles") {
      const grid = el(`<div class="users-tiles"></div>`);
      for (const u of vault.adminUsers) {
        const tile = el(`<article class="user-tile">
          <h3 class="user-tile-title">${escHtml(u.username)}</h3>
          <p class="hint user-tile-meta"></p>
          <div class="user-tile-actions"></div>
        </article>`);
        const meta = [
          u.display_name || "—",
          formatUserStatus(u.status) + (u.onboarded ? " · Vault" : ""),
          formatAuthBackend(u.auth_backend),
          formatUserRoles(u.roles),
        ];
        tile.querySelector(".user-tile-meta").textContent = meta.join(" · ");
        tile.querySelector(".user-tile-actions").innerHTML = userActionButtons(u);
        grid.appendChild(tile);
      }
      list.appendChild(grid);
    } else {
      list.innerHTML = vault.adminUsers.map((u) =>
        `<div class="list-row user-row">
          <div class="list-row-main">
            <strong>${escHtml(u.username)}</strong>
            <span class="hint">${escHtml(u.display_name || "—")} · ${escHtml(formatUserStatus(u.status))}${u.onboarded ? " · Vault" : ""} · ${escHtml(formatAuthBackend(u.auth_backend))} · ${escHtml(formatUserRoles(u.roles))}</span>
          </div>
          ${userActionButtons(u)}
        </div>`
      ).join("");
    }
    bindUserRowActions(list, vault.adminUsers);
  }

  function closeUserCreateModal() {
    const modal = n.querySelector("#userCreateModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("admin-modal-open");
  }

  function openUserCreateModal() {
    const modal = n.querySelector("#userCreateModal");
    if (!modal) return;
    n.querySelector("#nuser").value = "";
    n.querySelector("#ndisplay").value = "";
    n.querySelector("#nemail").value = "";
    n.querySelector("#npw").value = "";
    n.querySelector("#nauth").value = "local";
    const err = n.querySelector("#uc_err");
    if (err) err.hidden = true;
    syncNewUserAuthUI();
    modal.hidden = false;
    document.body.classList.add("admin-modal-open");
    n.querySelector("#nuser").focus();
  }

  n.querySelector("#uopenCreate")?.addEventListener("click", openUserCreateModal);
  n.querySelector("#userCreateClose")?.addEventListener("click", closeUserCreateModal);
  n.querySelector("#userCreateBackdrop")?.addEventListener("click", closeUserCreateModal);
  n.querySelectorAll("[data-users-view]").forEach((btn) => {
    btn.onclick = () => setUsersViewMode(btn.dataset.usersView);
  });
  syncUsersViewToggle();

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
          const pwErr = localLoginPasswordError(pw);
          if (pwErr) throw new Error(pwErr);
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

  async function paintAdminSystem(ov) {
    const box = n.querySelector("#sysOverview");
    const verEl = n.querySelector("#sysVersion");
    if (!box) return;
    try {
      const about = await loadAboutInfo();
      if (verEl) verEl.textContent = formatAboutLine(about);
    } catch (_) {
      if (verEl) verEl.textContent = "—";
    }
    if (isAuditorOnly()) {
      box.innerHTML = "<p class=\"hint\">Als Auditor haben Sie nur Lesezugriff auf das Audit-Log.</p>";
      return;
    }
    if (!ov) {
      box.innerHTML = "<p class=\"hint\">Keine Systemdaten geladen.</p>";
      return;
    }
    const storage = ov.storage || {};
    const rows = [
      ["Storage-Backend", storage.backend || "—", null],
      ["Vault", ov.vault_ok ? "OK" : "Fehler", ov.vault_ok],
      ["Vault-Detail", ov.vault_detail || "—", null],
      ["LDAP", ov.ldap_enabled ? `aktiv (${ov.ldap_host})` : "aus", ov.ldap_enabled ? true : null],
      ["SMTP", ov.mail_enabled ? "aktiv" : "aus", ov.mail_enabled ? true : null],
      ["Tenants", String(ov.tenant_count ?? "—"), null],
      ["Initialisiert", ov.initialized ? "ja" : "nein", ov.initialized ? true : null],
    ];
    box.innerHTML = rows.map(([label, value, ok]) => {
      const valCls = ok === true ? "dd-ok" : ok === false ? "dd-err" : "";
      return `<div class="system-row"><dt>${escHtml(label)}</dt><dd class="${valCls}">${escHtml(value)}</dd></div>`;
    }).join("");
  }

  async function refreshAdmin() {
    if (isAuditorOnly()) {
      try {
        const auditRaw = await api("/api/admin/audit");
        const audit = Array.isArray(auditRaw) ? auditRaw : (auditRaw.items || []);
        n.querySelector("#alist").innerHTML = audit.slice(0, 50).map((e) =>
          `<div>${escapeHtml(e.created_at)} · ${escapeHtml(e.action)} · ${escapeHtml(e.actor_id)} · ${escapeHtml(e.resource_type)}/${escapeHtml(e.resource_id)}</div>`
        ).join("") || "<p>Keine Events</p>";
      } catch (e) {
        n.querySelector("#alist").innerHTML = `<p class="hint">${escHtml(e.message)}</p>`;
      }
      await paintAdminSystem(null);
      return;
    }
    const users = await api("/api/admin/users");
    paintUsersList(users);
    const groups = await api("/api/admin/groups");
    vault.groups = groups;
    paintGroupsWorkspace(users, groups);
    await refreshGroupShareUI();

    if (isPlatformAdmin()) {
      const ov = await api("/api/admin/overview");
      vault.adminOverview = ov;
      await paintAdminSystem(ov);
      const trust = await api("/api/admin/trust");
      n.querySelector("#trust_ca_pem").value = trust.ca_cert_pem || "";
      n.querySelector("#trust_ca_file").value = "";
      paintTrustCAStatus();
      try {
        const pa = await api("/api/admin/public-access");
        n.querySelector("#pa_base").value = pa.configured_base_path || "";
        n.querySelector("#pa_url").value = pa.configured_public_url || "";
        n.querySelector("#pa_trust").checked = !!(pa.configured_trust_fwd ?? pa.trust_forwarded);
        n.querySelector("#pa_prefix").checked = !!pa.use_forwarded_prefix;
        const envOv = pa.env_overrides || {};
        const hint = n.querySelector("#pa_env_hint");
        if (hint) hint.hidden = !(envOv.base_path || envOv.trust_forwarded);
        const eff = n.querySelector("#pa_effective");
        if (eff) {
          eff.textContent = `Aktiv: ${pa.public_url || "—"} · Pfad ${pa.base_path || "/"} · Proxy-Header ${pa.trust_forwarded ? "ja" : "nein"}`;
        }
      } catch (_) {}
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
      const pol = await api("/api/admin/policy");
      n.querySelector("#totp_req").checked = !!pol.totp_required;
      n.querySelector("#admin_env_only").checked = !!pol.admin_secrets_envelope_only;
      const offlineCache = n.querySelector("#offline_cache");
      if (offlineCache) offlineCache.checked = pol.offline_cache_allowed !== false;
      const cliInt = n.querySelector("#cli_integration");
      if (cliInt) cliInt.checked = !!pol.cli_integration_enabled;
      const browserInt = n.querySelector("#browser_integration");
      if (browserInt) browserInt.checked = !!pol.browser_integration_enabled;
      const keys = await api("/api/admin/api-keys");
      n.querySelector("#klist").innerHTML = keys.map((k) => {
        const scopeLabel = k.legacy_no_scopes ? "legacy (nur read)" : (k.scopes || []).join(", ") || "?";
        return `<div class="list-row"><span>${escapeHtml(k.name)} [${escapeHtml(scopeLabel)}] ${k.revoked ? "(revoked)" : ""}</span>` +
        (!k.revoked ? `<button class="btn-ghost" data-kr="${escapeHtml(k.id)}" type="button">Revoke</button>` : "") + `</div>`;
      }).join("") || "<p class='hint'>Keine Keys</p>";
      n.querySelector("#klist").querySelectorAll("[data-kr]").forEach((btn) => {
        btn.onclick = async () => {
          await api("/api/admin/api-keys/" + btn.dataset.kr + "/revoke", { method: "POST", body: "{}" });
          await refreshAdmin();
        };
      });
      n.querySelector("#plat").hidden = false;
      const platLink = n.querySelector(".platform-link");
      if (platLink) platLink.hidden = false;
      const tenants = await api("/api/admin/tenants");
      n.querySelector("#tlist").innerHTML = tenants.map((t) =>
        `<div class="list-row"><span>${escapeHtml(t.name)} (${escapeHtml(t.slug)}) · ${escapeHtml(t.status)}</span>` +
        (t.status !== "disabled" ? `<button class="btn-ghost" data-td="${escapeHtml(t.id)}" type="button">Disable</button>` : "") + `</div>`
      ).join("");
      n.querySelector("#tlist").querySelectorAll("[data-td]").forEach((btn) => {
        btn.onclick = async () => {
          await api("/api/admin/tenants/" + btn.dataset.td + "/disable", { method: "POST", body: "{}" });
          await refreshAdmin();
        };
      });
    } else {
      await paintAdminSystem(null);
    }

    const ldap = await api("/api/admin/ldap");
    n.querySelector("#ldap_en").checked = !!ldap.enabled;
    const ldapImport = n.querySelector("#ldapUserImport");
    if (ldapImport) ldapImport.hidden = !ldap.enabled;
    n.querySelector("#ldap_host").value = ldap.host || "";
    n.querySelector("#ldap_port").value = ldap.port || "";
    const ldapPort = Number(ldap.port) || 0;
    n.querySelector("#ldap_tls").checked = !(ldap.host && ldapPort === 389 && !ldap.use_tls);
    n.querySelector("#ldap_base").value = ldap.base_dn || "";
    n.querySelector("#ldap_bind").value = ldap.bind_dn || "";
    n.querySelector("#ldap_filter").value = ldap.user_filter || "";
    n.querySelector("#ldap_skip_tls").checked = !!ldap.insecure_skip_verify;
    const th = n.querySelector("#ldap_trust_hint");
    if (th) {
      if (isPlatformAdmin()) {
        const trust = vault.adminOverview ? { present: !!vault.adminOverview.ldap_enabled } : { present: false };
        th.textContent = trust.present
          ? "Zentrale Firmen-CA aktiv."
          : "Keine zentrale Firmen-CA — LDAPS prüft gegen System-CAs. Unter Firmen-CA hinterlegen.";
      } else {
        th.textContent = "Firmen-CA und SMTP werden vom Plattform-Administrator verwaltet.";
      }
    }
    try {
      const me = vault.me;
      if (me?.recovery_mode) n.querySelector("#rec_mode").value = me.recovery_mode;
    } catch (_) {}
    const auditRaw = await api("/api/admin/audit");
    const audit = Array.isArray(auditRaw) ? auditRaw : (auditRaw.items || []);
    n.querySelector("#alist").innerHTML = audit.slice(0, 30).map((e) =>
      `<div>${escapeHtml(e.created_at)} · ${escapeHtml(e.action)} · ${escapeHtml(e.actor_id)} · ${escapeHtml(e.resource_type)}/${escapeHtml(e.resource_id)}</div>`
    ).join("") || "<p>Keine Events</p>";
    syncAdminNavVisibility();
  }

  let ldapSearchHits = [];

  function paintLDAPSearchResults(users) {
    ldapSearchHits = users || [];
    const box = n.querySelector("#ldap_user_results");
    const importBtn = n.querySelector("#ldap_user_import");
    if (!box) return;
    if (!ldapSearchHits.length) {
      box.innerHTML = "<p class='hint'>Keine Treffer</p>";
      if (importBtn) importBtn.hidden = true;
      return;
    }
    const importable = ldapSearchHits.filter((u) => !u.provisioned);
    box.innerHTML = ldapSearchHits.map((u, i) =>
      `<label class="list-row ldap-hit-row">
        <input type="checkbox" data-ldap-hit="${i}" ${u.provisioned ? "disabled" : "checked"} />
        <span><strong>${escHtml(u.username)}</strong>
          <span class="hint">${escHtml(u.display_name || "—")}${u.email ? " · " + escHtml(u.email) : ""}${u.provisioned ? " · bereits angelegt" : ""}</span>
        </span>
      </label>`
    ).join("");
    if (importBtn) importBtn.hidden = importable.length === 0;
  }

  function syncNewUserAuthUI() {
    const ldap = n.querySelector("#nauth")?.value === "ldap";
    const pwBlock = n.querySelector("#npw_block");
    if (pwBlock) pwBlock.hidden = !!ldap;
  }
  n.querySelector("#nauth")?.addEventListener("change", syncNewUserAuthUI);
  syncNewUserAuthUI();

  n.querySelector("#ldap_user_search")?.addEventListener("click", async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    const q = (n.querySelector("#ldap_user_q")?.value || "").trim();
    if (q.length < 2) {
      err.hidden = false; err.textContent = "Suchbegriff mindestens 2 Zeichen";
      return;
    }
    try {
      const res = await api("/api/admin/ldap/users?q=" + encodeURIComponent(q));
      paintLDAPSearchResults(res.users || []);
    } catch (e) {
      err.hidden = false; err.textContent = e.message;
    }
  });
  n.querySelector("#ldap_user_q")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      n.querySelector("#ldap_user_search")?.click();
    }
  });
  n.querySelector("#ldap_user_import")?.addEventListener("click", async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    const names = [];
    n.querySelectorAll("[data-ldap-hit]").forEach((cb) => {
      if (!cb.checked || cb.disabled) return;
      const hit = ldapSearchHits[Number(cb.dataset.ldapHit)];
      if (hit?.username) names.push(hit.username);
    });
    if (!names.length) return;
    try {
      const res = await api("/api/admin/ldap/users/import", {
        method: "POST",
        body: JSON.stringify({ usernames: names }),
      });
      const failed = (res.failed || []).length;
      err.hidden = false;
      err.style.color = failed ? "" : "var(--color-ok)";
      err.textContent = `Import: ${res.created || 0} neu, ${res.skipped || 0} bereits vorhanden` +
        (failed ? `, ${failed} fehlgeschlagen` : "");
      await refreshAdmin();
      if (n.querySelector("#ldap_user_q")?.value.trim().length >= 2) {
        n.querySelector("#ldap_user_search")?.click();
      }
    } catch (e) {
      err.hidden = false; err.style.color = "";
      err.textContent = e.message;
    }
  });

  n.querySelector("#ucreate").onclick = async () => {
    const err = n.querySelector("#uc_err");
    err.hidden = true;
    try {
      const authBackend = n.querySelector("#nauth")?.value || "local";
      const body = {
        username: n.querySelector("#nuser").value.trim(),
        display_name: n.querySelector("#ndisplay").value.trim(),
        email: n.querySelector("#nemail").value.trim(),
        auth_backend: authBackend,
      };
      if (authBackend === "local") {
        const pw = n.querySelector("#npw").value;
        const pwErr = localLoginPasswordError(pw);
        if (pwErr) throw new Error(pwErr);
        body.password = pw;
      }
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
      closeUserCreateModal();
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
  n.querySelector("#pa_save").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    try {
      await api("/api/admin/public-access", {
        method: "PUT",
        body: JSON.stringify({
          base_path: n.querySelector("#pa_base").value.trim(),
          public_url: n.querySelector("#pa_url").value.trim(),
          trust_forwarded: n.querySelector("#pa_trust").checked,
          use_forwarded_prefix: n.querySelector("#pa_prefix").checked,
        }),
      });
      err.hidden = false; err.style.color = "var(--color-ok)";
      err.textContent = "Zugriffseinstellungen gespeichert — bei Pfadänderung ggf. Seite neu laden.";
      await refreshAdmin();
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
          cli_integration_enabled: n.querySelector("#cli_integration").checked,
          browser_integration_enabled: n.querySelector("#browser_integration").checked,
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
      const st = await api("/api/vault/status");
      if (st.has_escrow_pubkey) {
        throw new Error("Escrow-Key ist bereits gesetzt. Ersetzen nur über die k-aus-n-Zeremonie.");
      }
      const k = Number(n.querySelector("#shamir_k").value) || 3;
      const nn = Number(n.querySelector("#shamir_n").value) || 5;
      const kp = TVCrypto.generateBoxKeyPair();
      await api("/api/admin/tenant/escrow-pubkey", {
        method: "POST",
        body: JSON.stringify({ public_key_b64: TVCrypto.b64enc(kp.publicKey) }),
      });
      showEscrowShares(out, kp, k, nn, "Escrow Public Key gespeichert.");
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  n.querySelector("#escrow_replace").onclick = async () => {
    const err = n.querySelector("#aerr"); err.hidden = true;
    const out = n.querySelector("#escrow_out");
    try {
      if (typeof secrets === "undefined" || !secrets.combine) {
        throw new Error("secrets.js fehlt — nutze tvcli escrow-combine und die Zeremonie-API.");
      }
      const rawShares = (n.querySelector("#escrow_shares").value || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^share_\d+=\s*/i, "").trim())
        .filter(Boolean);
      const begin = await api("/api/admin/tenant/escrow/replace/begin", { method: "POST", body: "{}" });
      const need = Number(begin.shamir_k) || 3;
      if (rawShares.length < need) {
        throw new Error("Mindestens " + need + " Shares erforderlich");
      }
      const hex = secrets.combine(rawShares);
      const sk = hexToU8(hex);
      const challenge = TVCrypto.openDataKeyEnvelope(
        TVCrypto.b64dec(begin.ephemeral_pub_b64),
        TVCrypto.b64dec(begin.nonce_b64),
        TVCrypto.b64dec(begin.wrapped_dk_b64),
        sk,
      );
      sk.fill(0);
      if (!challenge) throw new Error("Challenge konnte nicht geöffnet werden — Shares prüfen");
      const k = Number(n.querySelector("#shamir_k").value) || need;
      const nn = Number(n.querySelector("#shamir_n").value) || 5;
      const kp = TVCrypto.generateBoxKeyPair();
      await api("/api/admin/tenant/escrow/replace/finish", {
        method: "POST",
        body: JSON.stringify({
          challenge_b64: TVCrypto.b64enc(challenge),
          public_key_b64: TVCrypto.b64enc(kp.publicKey),
        }),
      });
      showEscrowShares(out, kp, k, nn, "Escrow Public Key ersetzt (k-aus-n bestätigt).");
      n.querySelector("#escrow_shares").value = "";
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  function hexToU8(hex) {
    const h = String(hex || "").replace(/^0x/i, "").trim();
    if (!h || h.length % 2) throw new Error("ungültiges Shamir-Secret");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function showEscrowShares(out, kp, k, nn, title) {
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
    out.innerHTML = "<strong>" + escapeHtml(title) + "</strong> Privater Key wird nicht im DOM gehalten." +
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
  }
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
      const res = await fetch(tvPath("/api/admin/backup"), { credentials: "same-origin" });
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
      const res = await fetch(tvPath("/api/admin/backup/restore?confirm=" + encodeURIComponent(confirm)), {
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
  const path = tvRelPath();
  if (!status.initialized) {
    if (path !== "/setup" && path !== "/") tvGo("/setup");
    renderWizard(app);
    paintAbout();
    return;
  }
  if (path === "/setup") {
    app.appendChild(el(`<div class="panel"><h1>Bereits eingerichtet</h1><a class="btn-accent" href="${tvPath("/login")}" style="display:inline-block;text-decoration:none;padding:.6rem 1rem;">Zum Login</a></div>`));
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

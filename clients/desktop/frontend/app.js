/* TeamVault Desktop — standalone, lean, vault-only frontend.
 * All network + crypto happens in the Go backend (window.go.main.App.*);
 * this file only renders already-decrypted data returned by those calls.
 */
(function () {
  "use strict";

  const App = () => window.go.main.App;
  const $ = (id) => document.getElementById(id);

  const screens = ["screenConnect", "screenLogin", "screenUnlock", "screenVault", "screenForm", "screenSettings"];
  function showScreen(id) {
    for (const s of screens) $(s).hidden = s !== id;
  }

  const state = {
    tenant: "",
    username: "",
    offline: false,
    secrets: [],
    filter: "all",
    folder: null,
    search: "",
    selectedId: null,
    editingId: null,
    totpTimer: null,
  };

  function setError(id, msg) {
    const el = $(id);
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function errMsg(err) {
    if (!err) return "Unbekannter Fehler";
    if (typeof err === "string") return err;
    return err.message || String(err);
  }

  async function init() {
    let settings = {};
    try {
      settings = (await App().GetSettings()) || {};
    } catch (_) {}
    $("cServer").value = settings.server_url || "";
    $("cTenant").value = settings.tenant_slug || "";
    state.tenant = settings.tenant_slug || "";
    state.username = settings.username || "";
    if (settings.server_url) {
      try {
        const has = await App().HasOfflineCache(settings.tenant_slug || "", settings.username || "");
        $("cOfflineOpen").hidden = !has;
      } catch (_) {}
    }
    showScreen("screenConnect");
  }

  // --- Connect / Login / Unlock ---------------------------------------

  $("cConnect").addEventListener("click", async () => {
    setError("cError", "");
    const url = $("cServer").value.trim();
    const tenant = $("cTenant").value.trim();
    if (!url || !tenant) {
      setError("cError", "Server-URL und Mandant sind erforderlich.");
      return;
    }
    state.tenant = tenant;
    try {
      await App().Connect(url);
      await saveSettingsPartial({ server_url: url, tenant_slug: tenant });
      $("lUser").value = state.username || "";
      showScreen("screenLogin");
    } catch (err) {
      setError("cError", errMsg(err));
    }
  });

  $("cOfflineOpen").addEventListener("click", async () => {
    setError("cError", "");
    const url = $("cServer").value.trim();
    const tenant = $("cTenant").value.trim();
    state.tenant = tenant;
    try {
      await App().Connect(url);
    } catch (_) {
      /* offline: Connect() only prepares an HTTP client, network is optional here */
    }
    showScreen("screenUnlock");
  });

  $("lBack").addEventListener("click", () => showScreen("screenConnect"));

  $("lLogin").addEventListener("click", async () => {
    setError("lError", "");
    const user = $("lUser").value.trim();
    const pass = $("lPass").value;
    const totp = $("lTotp").value.trim();
    if (!user || !pass) {
      setError("lError", "Benutzername und Passwort erforderlich.");
      return;
    }
    try {
      await App().Login(state.tenant, user, pass, totp);
      state.username = user;
      await saveSettingsPartial({ username: user });
      $("lPass").value = "";
      $("lTotp").value = "";
      showScreen("screenUnlock");
    } catch (err) {
      setError("lError", errMsg(err));
    }
  });

  $("uUnlock").addEventListener("click", async () => {
    setError("uError", "");
    const pass = $("uPass").value;
    if (!pass) {
      setError("uError", "Master-Passwort erforderlich.");
      return;
    }
    try {
      const res = await App().Unlock(pass, state.tenant, state.username);
      $("uPass").value = "";
      state.offline = !!(res && res.offline);
      $("offlineBadge").hidden = !state.offline;
      await enterVault();
    } catch (err) {
      setError("uError", errMsg(err));
    }
  });

  async function saveSettingsPartial(patch) {
    try {
      const cur = (await App().GetSettings()) || {};
      await App().SaveSettings(Object.assign({}, cur, patch));
    } catch (_) {}
  }

  // --- Vault list --------------------------------------------------------

  async function enterVault() {
    showScreen("screenVault");
    $("vDetail").hidden = true;
    state.selectedId = null;
    await reloadList();
  }

  async function reloadList() {
    try {
      state.secrets = (await App().ListSecrets()) || [];
    } catch (err) {
      state.secrets = [];
      console.error(errMsg(err));
    }
    renderFolders();
    renderList();
  }

  function renderFolders() {
    const folders = Array.from(new Set(state.secrets.map((s) => s.folder).filter(Boolean))).sort();
    const box = $("vFolders");
    box.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.className = "folder-btn" + (state.folder === null ? " active" : "");
    allBtn.textContent = "Alle Ordner";
    allBtn.addEventListener("click", () => { state.folder = null; renderFolders(); renderList(); });
    box.appendChild(allBtn);
    for (const f of folders) {
      const b = document.createElement("button");
      b.className = "folder-btn" + (state.folder === f ? " active" : "");
      b.textContent = f;
      b.addEventListener("click", () => { state.folder = f; renderFolders(); renderList(); });
      box.appendChild(b);
    }
  }

  function renderList() {
    const list = $("vList");
    list.innerHTML = "";
    const q = state.search.toLowerCase();
    const rows = state.secrets.filter((s) => {
      if (state.filter === "favorites" && !s.favorite) return false;
      if (state.folder && s.folder !== state.folder) return false;
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
    for (const s of rows) {
      const row = document.createElement("div");
      row.className = "list-item" + (s.id === state.selectedId ? " active" : "");
      row.innerHTML = `<span class="fav">${s.favorite ? "★" : ""}</span><span class="title">${escapeHtml(s.title)}</span>${s.folder ? `<span class="folder-tag">${escapeHtml(s.folder)}</span>` : ""}`;
      row.addEventListener("click", () => openDetail(s.id));
      list.appendChild(row);
    }
    if (rows.length === 0) {
      list.innerHTML = '<p class="hint" style="padding:16px;">Keine Secrets gefunden.</p>';
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  $("vSearch").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("fAll").addEventListener("click", () => setFilter("all"));
  $("fFav").addEventListener("click", () => setFilter("favorites"));
  function setFilter(f) {
    state.filter = f;
    $("fAll").classList.toggle("active", f === "all");
    $("fFav").classList.toggle("active", f === "favorites");
    renderList();
  }

  $("vLock").addEventListener("click", async () => {
    stopTotpTimer();
    await App().Lock();
    showScreen("screenUnlock");
  });
  $("vLogout").addEventListener("click", async () => {
    stopTotpTimer();
    await App().Logout();
    showScreen("screenConnect");
  });
  $("vNew").addEventListener("click", () => openForm(null));
  $("vSync").addEventListener("click", async () => {
    try {
      await App().SyncOfflineCache();
    } catch (err) {
      alert(errMsg(err));
    }
  });
  $("vSettings").addEventListener("click", openSettings);

  // --- Detail --------------------------------------------------------------

  function stopTotpTimer() {
    if (state.totpTimer) {
      clearInterval(state.totpTimer);
      state.totpTimer = null;
    }
  }

  async function openDetail(id) {
    state.selectedId = id;
    renderList();
    stopTotpTimer();
    let det;
    try {
      det = await App().GetSecret(id);
    } catch (err) {
      $("vDetail").hidden = false;
      $("vDetail").innerHTML = `<p class="error">${escapeHtml(errMsg(err))}</p>`;
      return;
    }
    renderDetail(det);
  }

  function copyBtn(value) {
    const b = document.createElement("button");
    b.className = "btn-ghost btn-sm";
    b.textContent = "Kopieren";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value || "");
        b.textContent = "Kopiert!";
        setTimeout(() => (b.textContent = "Kopieren"), 1200);
      } catch (_) {}
    });
    return b;
  }

  function revealField(labelText, value, container) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    const row = document.createElement("div");
    row.className = "field-value";
    const input = document.createElement("input");
    input.type = "password";
    input.readOnly = true;
    input.value = value || "";
    row.appendChild(input);
    const toggle = document.createElement("button");
    toggle.className = "btn-ghost btn-sm";
    toggle.textContent = "Anzeigen";
    toggle.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      toggle.textContent = input.type === "password" ? "Anzeigen" : "Verbergen";
    });
    row.appendChild(toggle);
    row.appendChild(copyBtn(value));
    wrap.appendChild(row);
    container.appendChild(wrap);
  }

  function plainField(labelText, value, container) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    const row = document.createElement("div");
    row.className = "field-value";
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = value || "";
    row.appendChild(input);
    row.appendChild(copyBtn(value));
    wrap.appendChild(row);
    container.appendChild(wrap);
  }

  function renderDetail(det) {
    const box = $("vDetail");
    box.hidden = false;
    box.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = det.title;
    box.appendChild(h);

    const body = det.body || {};
    if (body.username) plainField("Benutzername", body.username, box);
    if (body.password) revealField("Passwort", body.password, box);
    if (Array.isArray(body.urls)) {
      for (const u of body.urls) plainField("URL", u, box);
    }
    if (det.totp_code) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = `<label>TOTP</label><div class="field-value"><span class="totp-code" id="totpCodeVal">${det.totp_code}</span></div>`;
      box.appendChild(wrap);
      wrap.querySelector(".field-value").appendChild(copyBtn(det.totp_code));
      state.totpTimer = setInterval(async () => {
        try {
          const fresh = await App().GetSecret(det.id);
          const el = document.getElementById("totpCodeVal");
          if (el && fresh && fresh.totp_code) el.textContent = fresh.totp_code;
        } catch (_) {}
      }, 5000);
    }
    if (Array.isArray(body.tags) && body.tags.length) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.innerHTML = "<label>Tags</label>";
      const tagsBox = document.createElement("div");
      for (const t of body.tags) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = t;
        tagsBox.appendChild(chip);
      }
      wrap.appendChild(tagsBox);
      box.appendChild(wrap);
    }
    if (body.notes) plainField("Notizen", body.notes, box);

    const actions = document.createElement("div");
    actions.className = "detail-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn-secondary";
    editBtn.textContent = "Bearbeiten";
    editBtn.disabled = state.offline;
    editBtn.addEventListener("click", () => openForm(det));
    actions.appendChild(editBtn);
    const delBtn = document.createElement("button");
    delBtn.className = "btn-secondary";
    delBtn.textContent = "Löschen";
    delBtn.disabled = state.offline;
    delBtn.addEventListener("click", async () => {
      if (!confirm("Secret wirklich löschen?")) return;
      try {
        await App().DeleteSecret(det.id);
        stopTotpTimer();
        box.hidden = true;
        await reloadList();
      } catch (err) {
        alert(errMsg(err));
      }
    });
    actions.appendChild(delBtn);
    box.appendChild(actions);
  }

  // --- Create / Edit form --------------------------------------------------

  function openForm(det) {
    state.editingId = det ? det.id : null;
    $("formTitle").textContent = det ? "Secret bearbeiten" : "Neues Secret";
    const body = (det && det.body) || {};
    $("fTitle").value = det ? det.title : "";
    $("fUsername").value = body.username || "";
    $("fPassword").value = body.password || "";
    $("fUrls").value = Array.isArray(body.urls) ? body.urls.join("\n") : "";
    $("fTotp").value = body.totp_seed || "";
    $("fTags").value = Array.isArray(body.tags) ? body.tags.join(",") : "";
    $("fFolder").value = (det && det.folder) || "";
    $("fNotes").value = body.notes || "";
    $("fFavorite").checked = !!(det && det.favorite);
    setError("fError", "");
    showScreen("screenForm");
  }

  $("fCancel").addEventListener("click", () => showScreen("screenVault"));

  $("fSave").addEventListener("click", async () => {
    setError("fError", "");
    const title = $("fTitle").value.trim();
    if (!title) {
      setError("fError", "Titel ist erforderlich.");
      return;
    }
    const input = {
      title,
      username: $("fUsername").value,
      password: $("fPassword").value,
      urls: $("fUrls").value.split("\n").map((s) => s.trim()).filter(Boolean),
      notes: $("fNotes").value,
      totp_seed: $("fTotp").value.trim(),
      tags: $("fTags").value.split(",").map((s) => s.trim()).filter(Boolean),
      favorite: $("fFavorite").checked,
      folder: $("fFolder").value.trim(),
      extra: [],
    };
    try {
      if (state.editingId) {
        await App().UpdateSecret(state.editingId, input);
      } else {
        await App().CreateSecret(input);
      }
      showScreen("screenVault");
      await reloadList();
    } catch (err) {
      setError("fError", errMsg(err));
    }
  });

  // --- Settings --------------------------------------------------------------

  async function openSettings() {
    setError("sError", "");
    const s = (await App().GetSettings()) || {};
    $("sServer").textContent = s.server_url || "";
    $("sTenant").textContent = s.tenant_slug || "";
    $("sCloseTray").checked = !!s.close_to_tray;
    try {
      $("sAutostart").checked = !!(await App().IsAutostartEnabled());
    } catch (_) {
      $("sAutostart").checked = false;
    }
    showScreen("screenSettings");
  }

  $("sBack").addEventListener("click", () => showScreen("screenVault"));
  $("sSave").addEventListener("click", async () => {
    setError("sError", "");
    try {
      await App().SetAutostart($("sAutostart").checked);
      await saveSettingsPartial({ close_to_tray: $("sCloseTray").checked });
      showScreen("screenVault");
    } catch (err) {
      setError("sError", errMsg(err));
    }
  });
  $("sForgetOffline").addEventListener("click", async () => {
    try {
      await App().ForgetOfflineCache(state.tenant, state.username);
      alert("Offline-Kopie gelöscht.");
    } catch (err) {
      alert(errMsg(err));
    }
  });

  window.addEventListener("DOMContentLoaded", init);
})();

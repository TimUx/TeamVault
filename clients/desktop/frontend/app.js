/* TeamVault Desktop — standalone, lean, vault-only frontend.
 * All network + crypto happens in the Go backend (window.go.main.App.*);
 * this file only renders already-decrypted data returned by those calls.
 */
(function () {
  "use strict";

  const App = () => window.go.main.App;
  const $ = (id) => document.getElementById(id);

  const screens = ["screenConnect", "screenLogin", "screenUnlock", "screenVault", "screenForm", "screenSettings", "screenShare"];
  function showScreen(id) {
    for (const s of screens) $(s).hidden = s !== id;
  }

  const state = {
    tenant: "",
    username: "",
    offline: false,
    secrets: [],
    filter: "all",
    tagFilters: [],
    search: "",
    selectedId: null,
    editingId: null,
    totpTimer: null,
    shareSecretId: null,
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
    pruneTagFilters();
    renderTagFilters();
    renderList();
  }

  function allTags() {
    return Array.from(new Set(state.secrets.flatMap((s) => s.tags || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function pruneTagFilters() {
    const have = new Set(allTags());
    state.tagFilters = state.tagFilters.filter((t) => have.has(t));
  }

  function toggleTagFilter(tag) {
    const i = state.tagFilters.indexOf(tag);
    if (i === -1) state.tagFilters.push(tag);
    else state.tagFilters.splice(i, 1);
    renderTagFilters();
    renderList();
  }

  function renderTagFilters() {
    const box = $("vTags");
    box.innerHTML = "";
    const tags = allTags();
    for (const t of tags) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tag-filter-btn" + (state.tagFilters.includes(t) ? " active" : "");
      b.textContent = t;
      b.addEventListener("click", () => toggleTagFilter(t));
      box.appendChild(b);
    }
    if (tags.length === 0) {
      box.innerHTML = '<p class="hint" style="margin:4px 0;">Keine Tags vorhanden.</p>';
    }
    $("vTagsClear").hidden = state.tagFilters.length === 0;
  }

  $("vTagsClear").addEventListener("click", () => {
    state.tagFilters = [];
    renderTagFilters();
    renderList();
  });

  function renderList() {
    const list = $("vList");
    list.innerHTML = "";
    const q = state.search.toLowerCase();
    const rows = state.secrets.filter((s) => {
      if (state.filter === "favorites" && !s.favorite) return false;
      if (state.filter === "mine" && !s.is_owner) return false;
      if (state.filter === "shared" && s.is_owner) return false;
      if (state.tagFilters.length) {
        const have = s.tags || [];
        if (!state.tagFilters.every((t) => have.includes(t))) return false;
      }
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
    for (const s of rows) {
      const row = document.createElement("div");
      row.className = "list-item" + (s.id === state.selectedId ? " active" : "");
      const ownerBadge = s.is_owner
        ? ""
        : `<span class="owner-tag" title="Angelegt von ${escapeHtml(s.owner || "?")}">geteilt${s.owner ? " · " + escapeHtml(s.owner) : ""}</span>`;
      const tagsHtml = (s.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");
      row.innerHTML = `<span class="fav">${s.favorite ? "★" : ""}</span><span class="title">${escapeHtml(s.title)}</span>${ownerBadge}${tagsHtml}`;
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
  $("fMine").addEventListener("click", () => setFilter("mine"));
  $("fShared").addEventListener("click", () => setFilter("shared"));
  $("fFav").addEventListener("click", () => setFilter("favorites"));
  function setFilter(f) {
    state.filter = f;
    for (const id of ["fAll", "fMine", "fShared", "fFav"]) {
      $(id).classList.toggle("active", $(id).dataset.filter === f);
    }
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

  const COPY_ICON_SVG =
    '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
    "</svg>";

  function copyBtn(value) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-icon copy-icon-btn";
    b.innerHTML = COPY_ICON_SVG;
    b.title = "Kopieren";
    b.setAttribute("aria-label", "Kopieren");
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value || "");
        b.classList.add("copied");
        b.setAttribute("aria-label", "Kopiert");
        setTimeout(() => {
          b.classList.remove("copied");
          b.setAttribute("aria-label", "Kopieren");
        }, 1200);
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

    const ownerLine = document.createElement("p");
    ownerLine.className = "hint";
    const bits = [det.is_owner ? "Eigenes Secret" : `Geteilt von ${escapeHtml(det.owner || "?")}`];
    if (det.shared_users && det.shared_users.length) bits.push("Nutzer: " + det.shared_users.map(escapeHtml).join(", "));
    if (det.shared_groups && det.shared_groups.length) bits.push("Gruppen: " + det.shared_groups.map(escapeHtml).join(", "));
    ownerLine.innerHTML = bits.join(" · ");
    box.appendChild(ownerLine);

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
    const shareBtn = document.createElement("button");
    shareBtn.className = "btn-secondary";
    shareBtn.textContent = "Freigabe verwalten";
    shareBtn.disabled = state.offline;
    shareBtn.addEventListener("click", () => openShareScreen(det.id, det.title));
    actions.appendChild(shareBtn);
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

  // --- Sharing management ----------------------------------------------------

  const capabilityLabels = { read: "Lesen", write: "Bearbeiten", share: "Freigeben", admin: "Admin" };
  function capLabel(c) { return capabilityLabels[c] || c || ""; }

  let shareAccess = null;
  let shareGroups = [];

  async function openShareScreen(id, title) {
    state.shareSecretId = id;
    $("shTitle").textContent = title || "";
    $("shMeta").textContent = "Lade Freigaben…";
    $("shCurrent").innerHTML = "";
    $("shGaps").innerHTML = "";
    $("shGapsWrap").hidden = true;
    setError("shError", "");
    showScreen("screenShare");
    try {
      const [access, groups, gaps] = await Promise.all([
        App().GetSecretAccess(id),
        App().ListMyGroups(),
        App().ListGroupShareGaps().catch(() => []),
      ]);
      shareAccess = access;
      shareGroups = groups || [];
      renderShareMeta();
      renderShareCurrent();
      renderShareTargetOptions();
      renderShareGaps((gaps || []).filter((g) => g.secret_id === id));
    } catch (err) {
      $("shMeta").textContent = "";
      setError("shError", errMsg(err));
    }
  }

  function renderShareMeta() {
    if (!shareAccess) return;
    $("shMeta").textContent =
      `Sichtbarkeit: ${shareAccess.visibility === "shared" ? "Geteilt" : "Privat"} · Meine Rechte: ${capLabel(shareAccess.my_capability)}`;
  }

  function shareRow(labelText, capability, onRemove) {
    const row = document.createElement("div");
    row.className = "share-row";
    const label = document.createElement("span");
    label.className = "share-row-name";
    label.textContent = labelText;
    row.appendChild(label);
    const cap = document.createElement("span");
    cap.className = "share-row-cap";
    cap.textContent = capLabel(capability);
    row.appendChild(cap);
    if (onRemove) {
      const btn = document.createElement("button");
      btn.className = "btn-ghost btn-sm";
      btn.textContent = "Entfernen";
      btn.addEventListener("click", onRemove);
      row.appendChild(btn);
    }
    return row;
  }

  function renderShareCurrent() {
    const box = $("shCurrent");
    box.innerHTML = "";
    if (!shareAccess) return;
    box.appendChild(shareRow((shareAccess.owner && shareAccess.owner.username) || "Eigentümer", "admin", null));
    for (const u of shareAccess.shared_users || []) {
      box.appendChild(shareRow(u.username || u.id, u.capability, () => removeShare({ userIds: [u.id] })));
    }
    for (const g of shareAccess.shared_groups || []) {
      box.appendChild(shareRow("👥 " + (g.name || g.id), g.capability, () => removeShare({ groupIds: [g.id] })));
    }
    if (!(shareAccess.shared_users || []).length && !(shareAccess.shared_groups || []).length) {
      box.innerHTML += '<p class="hint">Noch nicht geteilt.</p>';
    }
  }

  function renderShareTargetOptions() {
    const type = $("shTargetType").value;
    const sel = $("shTarget");
    sel.innerHTML = "";
    const opts = type === "group" ? shareAvailableGroups() : (shareAccess && shareAccess.available_users) || [];
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.username || o.name || o.id;
      sel.appendChild(opt);
    }
    if (opts.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = type === "group" ? "Keine weiteren Gruppen" : "Keine weiteren Nutzer";
      sel.appendChild(opt);
    }
  }

  function shareAvailableGroups() {
    const shared = new Set((shareAccess && shareAccess.shared_groups || []).map((g) => g.id));
    return shareGroups.filter((g) => !shared.has(g.id));
  }

  $("shTargetType").addEventListener("change", renderShareTargetOptions);

  $("shAdd").addEventListener("click", async () => {
    setError("shError", "");
    const type = $("shTargetType").value;
    const targetId = $("shTarget").value;
    const capability = $("shCapability").value;
    if (!targetId) {
      setError("shError", "Kein Ziel verfügbar.");
      return;
    }
    try {
      if (type === "group") {
        await App().ShareSecretWithGroup(state.shareSecretId, targetId, capability);
      } else {
        await App().ShareSecretWithUser(state.shareSecretId, targetId, capability);
      }
      await refreshShareScreen();
    } catch (err) {
      setError("shError", errMsg(err));
    }
  });

  async function removeShare({ userIds = [], groupIds = [] }) {
    setError("shError", "");
    if (!confirm("Freigabe wirklich entfernen?")) return;
    try {
      await App().UnshareSecret(state.shareSecretId, userIds, groupIds);
      await refreshShareScreen();
    } catch (err) {
      setError("shError", errMsg(err));
    }
  }

  function renderShareGaps(gaps) {
    const box = $("shGaps");
    box.innerHTML = "";
    $("shGapsWrap").hidden = gaps.length === 0;
    for (const gap of gaps) {
      const row = document.createElement("div");
      row.className = "share-row";
      const label = document.createElement("span");
      label.className = "share-row-name";
      label.textContent = `${gap.username || gap.user_id} (Gruppe ${gap.group_id})`;
      row.appendChild(label);
      const btn = document.createElement("button");
      btn.className = "btn-secondary btn-sm";
      btn.textContent = "Nachschlüsseln";
      btn.addEventListener("click", async () => {
        setError("shError", "");
        try {
          await App().FixGroupShareGap(gap);
          await refreshShareScreen();
        } catch (err) {
          setError("shError", errMsg(err));
        }
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  async function refreshShareScreen() {
    await openShareScreen(state.shareSecretId, $("shTitle").textContent);
    await reloadList();
  }

  $("shBack").addEventListener("click", async () => {
    showScreen("screenVault");
    if (state.shareSecretId) await openDetail(state.shareSecretId);
  });

  window.addEventListener("DOMContentLoaded", init);
})();

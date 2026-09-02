(() => {
  function pathOf(href) {
    return tvHelpPath(href);
  }

  function link(href, label, active, cls) {
    const a = active ? " active" : "";
    const c = cls ? " " + cls : "";
    return `<a class="help-side-link${a}${c}" href="${pathOf(href)}">${label}</a>`;
  }

  /**
   * @param {string} active page key: overview|vault|account|cli|extension
   */
  function tvHelpNav(active) {
    const sidebar = document.getElementById("helpSidebar");
    if (!sidebar) return;

    const html = `
      <div class="help-sidebar-brand"><a href="${pathOf("/help")}">TeamVault Hilfe</a></div>
      <nav class="help-sidebar-nav" aria-label="Hilfe-Navigation">
        <div class="help-sec">
          <div class="help-sec-title">Einstieg</div>
          ${link("/help", "Übersicht", active === "overview")}
        </div>
        <div class="help-sec">
          <div class="help-sec-title">Vault</div>
          ${link("/help/vault", "Anlegen, Teilen, Import", active === "vault")}
          ${active === "vault" ? `
            <a class="help-side-link sub" href="#anlegen">Anlegen</a>
            <a class="help-side-link sub" href="#teilen">Teilen</a>
            <a class="help-side-link sub" href="#import">Import</a>
          ` : ""}
        </div>
        <div class="help-sec">
          <div class="help-sec-title">Konto</div>
          ${link("/help/account", "TOTP, Passkeys &amp; Offline", active === "account")}
          ${active === "account" ? `
            <a class="help-side-link sub" href="#totp">TOTP einrichten</a>
            <a class="help-side-link sub" href="#passkeys">Passkeys</a>
            <a class="help-side-link sub" href="#offline">Offline-Vault</a>
            <a class="help-side-link sub" href="#login">Beim Login nutzen</a>
          ` : ""}
        </div>
        <div class="help-sec">
          <div class="help-sec-title">Clients</div>
          ${link("/help/cli", "CLI (tvcli)", active === "cli")}
          ${link("/help/extension", "Browser-Extension", active === "extension")}
          ${active === "extension" ? `
            <a class="help-side-link sub" href="#install">Installation</a>
            <a class="help-side-link sub" href="#fallback">Fallback</a>
            <a class="help-side-link sub" href="#nutzen">Fill &amp; Copy</a>
          ` : ""}
          ${active === "cli" ? `
            <a class="help-side-link sub" href="#install">Installation</a>
            <a class="help-side-link sub" href="#nutzen">Befehle</a>
          ` : ""}
        </div>
        <div class="help-sec">
          <div class="help-sec-title">App</div>
          ${link("/login", "Login", false)}
          ${link("/app", "Vault öffnen", false)}
        </div>
      </nav>
      <div class="help-sidebar-foot" id="helpSideFoot"></div>
    `;
    sidebar.innerHTML = html;

    const toggle = document.getElementById("helpMenuToggle");
    const backdrop = document.getElementById("helpBackdrop");
    const close = () => {
      sidebar.classList.remove("open");
      if (backdrop) backdrop.classList.remove("open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      sidebar.classList.add("open");
      if (backdrop) backdrop.classList.add("open");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    };
    if (toggle) {
      toggle.onclick = () => (sidebar.classList.contains("open") ? close() : open());
    }
    if (backdrop) backdrop.onclick = close;
    sidebar.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) close();
      });
    });

    const foot = document.getElementById("helpSideFoot");
    const about = document.getElementById("aboutFoot");
    fetch(tvHelpPath("/api/version"))
      .then((r) => r.json())
      .then((v) => {
        let version = String(v.version || "dev");
        const commit = v.commit && v.commit !== "none" ? String(v.commit) : "";
        const semver = version.match(/^v?(\d+\.\d+\.\d+)/);
        if (semver) version = "v" + semver[1];
        else if (commit && version !== "dev") version = version + " (" + commit.slice(0, 7) + ")";
        const text =
          (v.product || "TeamVault") + " " + version +
          " · " + (v.developer || "Timo Braun");
        if (foot) foot.textContent = text;
        if (about) about.textContent = text;
      })
      .catch(() => {
        const text = "TeamVault · Timo Braun";
        if (foot) foot.textContent = text;
        if (about) about.textContent = text;
      });
  }

  window.tvHelpNav = tvHelpNav;
})();

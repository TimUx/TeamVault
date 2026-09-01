/**
 * Shared client download UI for /help/* and optional embeds.
 * Expects tvHelpOrigin() from tv-base.js.
 */
(() => {
  function fmtBytes(n) {
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function detectPlatform() {
    const ua = navigator.userAgent || "";
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || "";
    const s = (plat + " " + ua).toLowerCase();
    if (s.includes("win")) return "windows";
    if (s.includes("linux")) return "linux";
    return "linux";
  }

  function detectArch() {
    const ua = navigator.userAgent || "";
    if (/arm64|aarch64/i.test(ua)) return "arm64";
    return "amd64";
  }

  function pickCLI(cli, platform, arch) {
    return (
      cli.find((c) => c.platform === platform && c.arch === arch) ||
      cli.find((c) => c.platform === platform) ||
      cli[0]
    );
  }

  function absUrl(path) {
    if (!path) return path;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    const base = tvHelpOrigin();
    return base + (path.startsWith("/") ? path : "/" + path);
  }

  function dlBtn(artifact, label) {
    if (!artifact) return "";
    return `<a class="btn-accent" href="${absUrl(artifact.url)}" download>${label || artifact.name}</a>`;
  }

  function renderCLI(root, data) {
    if (!root) return;
    const cli = data.cli || [];
    if (!cli.length) {
      root.innerHTML = `<p class="help-note warn">CLI-Binaries sind auf diesem Server noch nicht verfügbar. Bitte Admin kontaktieren.</p>`;
      return;
    }
    const plat = detectPlatform();
    const arch = detectArch();
    const rec = pickCLI(cli, plat, arch);
    const all = cli
      .map((c) => `<li><a href="${absUrl(c.url)}" download>${c.name}</a> <span class="hint">(${fmtBytes(c.size)})</span></li>`)
      .join("");
    root.innerHTML = `
      <p class="hint">Empfohlen für Ihr Gerät (${plat}/${arch}):</p>
      <div class="help-actions">${dlBtn(rec, "tvcli herunterladen")}</div>
      <details class="help-dl-more">
        <summary>Alle Plattformen</summary>
        <ul class="help-dl-list">${all}</ul>
      </details>
      <p class="hint">Oder Installations-Einzeiler (lädt &amp; installiert automatisch):</p>
      <code class="onedliner" id="cliInstallSnippet"></code>
      <div class="help-actions">
        <button type="button" class="btn-ghost" data-copy-target="cliInstallSnippet">Einzeiler kopieren</button>
      </div>`;
    const snip = root.querySelector("#cliInstallSnippet");
    if (snip) {
      snip.textContent =
        plat === "windows" ? data.install.cli_windows : data.install.cli_unix;
    }
  }

  function renderExtension(root, data) {
    if (!root) return;
    const ext = data.extension || {};
    const crx = ext.crx;
    const plat = detectPlatform();
    if (!crx) {
      root.innerHTML = `<p class="help-note warn">Extension-Paket ist auf diesem Server noch nicht verfügbar.</p>`;
      return;
    }
    const crxUrl = absUrl(crx.url);
    const installSnippet =
      plat === "windows" ? data.install.extension_user_ps || data.install.extension_windows : data.install.extension_unix;
    root.innerHTML = `
      <div class="help-install-steps">
        <p><strong>Schritt 1</strong> — Einmalig Einrichtung (automatisch):</p>
        <div class="help-actions">
          <button type="button" class="btn-accent" id="extUserInstallBtn">Einrichtung starten</button>
          <button type="button" class="btn-ghost" data-copy-target="extInstallSnippet">Einzeiler kopieren</button>
        </div>
        <code class="onedliner" id="extInstallSnippet"></code>
        <p class="hint">IT kann alternativ <a href="#it-policy">Richtlinie für alle PCs</a> ausrollen.</p>
        <p><strong>Schritt 2</strong> — Extension installieren (wie aus dem Store):</p>
        <div class="help-actions">
          <a class="btn-accent" id="extCrxInstall" href="${crxUrl}">Extension installieren</a>
          <span class="hint">${fmtBytes(crx.size)} · ID <code>${ext.id || "—"}</code></span>
        </div>
        <p class="hint">Chrome/Edge zeigen einen Installationsdialog — kein Entwicklermodus nötig, wenn Schritt 1 ausgeführt wurde.</p>
        <details class="help-dl-more" id="it-policy">
          <summary>Für IT: Richtlinie für alle Nutzer</summary>
          <p class="hint">Einmalig als Administrator (GPO/Intune möglich):</p>
          <code class="onedliner" id="extPolicySnippet"></code>
          <div class="help-actions">
            <button type="button" class="btn-ghost" data-copy-target="extPolicySnippet">IT-Einzeiler kopieren</button>
          </div>
        </details>
        <details class="help-dl-more">
          <summary>Erweitert: ZIP / Firefox</summary>
          <p>ZIP (manuell entpacken): ${ext.zip ? `<a href="${absUrl(ext.zip.url)}" download>teamvault-extension.zip</a>` : "—"}</p>
          <p>Firefox: XPI über Unternehmensrichtlinie oder temporär über about:debugging.</p>
        </details>
      </div>`;
    const snip = root.querySelector("#extInstallSnippet");
    if (snip) snip.textContent = installSnippet || "";
    const pol = root.querySelector("#extPolicySnippet");
    if (pol) pol.textContent = data.install.extension_policy_ps || "";
    const btn = root.querySelector("#extUserInstallBtn");
    if (btn && installSnippet) {
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(installSnippet);
          btn.textContent = "Einzeiler kopiert — in PowerShell einfügen";
        } catch {
          btn.textContent = "Bitte Einzeiler manuell kopieren";
        }
      };
    }
    const crxBtn = root.querySelector("#extCrxInstall");
    if (crxBtn) {
      crxBtn.addEventListener("click", (ev) => {
        // Let browser handle .crx install when policy allows; hint if blocked.
        setTimeout(() => {
          if (!document.hidden) {
            /* user may still be on page if install blocked */
          }
        }, 500);
      });
    }
  }

  function bindCopy(root) {
    if (!root) return;
    root.querySelectorAll("[data-copy-target]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-copy-target");
        const el = root.querySelector("#" + id) || document.getElementById(id);
        if (!el) return;
        try {
          await navigator.clipboard.writeText(el.textContent);
          btn.textContent = "Kopiert";
          setTimeout(() => {
            btn.textContent = "Einzeiler kopieren";
          }, 1200);
        } catch (_) {}
      });
    });
  }

  async function tvInitClientDownloads(mode) {
    const base = tvHelpOrigin();
    let data;
    try {
      const res = await fetch(base + "/api/client-downloads");
      if (!res.ok) throw new Error("manifest");
      data = await res.json();
    } catch {
      const msg = `<p class="help-note warn">Download-Liste konnte nicht geladen werden.</p>`;
      const cliRoot = document.getElementById("clientDlCli");
      const extRoot = document.getElementById("clientDlExt");
      if (mode === "cli" && cliRoot) cliRoot.innerHTML = msg;
      if (mode === "extension" && extRoot) extRoot.innerHTML = msg;
      if (mode === "both") {
        if (cliRoot) cliRoot.innerHTML = msg;
        if (extRoot) extRoot.innerHTML = msg;
      }
      return;
    }
    if (mode === "cli" || mode === "both") {
      renderCLI(document.getElementById("clientDlCli"), data);
      bindCopy(document.getElementById("clientDlCli"));
    }
    if (mode === "extension" || mode === "both") {
      renderExtension(document.getElementById("clientDlExt"), data);
      bindCopy(document.getElementById("clientDlExt"));
    }
  }

  globalThis.tvInitClientDownloads = tvInitClientDownloads;
})();

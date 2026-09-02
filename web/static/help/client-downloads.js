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
        <p class="help-note warn"><strong>Wichtig:</strong> Chrome/Edge installieren <code>.crx</code> nur, wenn eine Browser-Richtlinie gesetzt ist (Schritt&nbsp;1). Ohne Richtlinie wird die Datei nur heruntergeladen — das ist erwartetes Browser-Verhalten, kein Fehler der Datei.</p>
        <p><strong>Schritt 1</strong> — Einmalig Einrichtung (Browser-Richtlinie):</p>
        <div class="help-actions">
          <button type="button" class="btn-accent" id="extUserInstallBtn">Einzeiler kopieren</button>
        </div>
        <code class="onedliner" id="extInstallSnippet"></code>
        <p class="hint">PowerShell öffnen, einfügen, Enter. Bei <em>Registrierungszugriff verweigert</em>: IT muss Schritt&nbsp;1 zentral ausrollen (siehe unten) oder <a href="#fallback">Entwicklermodus</a>.</p>
        <p><strong>Schritt 2</strong> — Extension installieren (nach erfolgreichem Schritt&nbsp;1 + Browser-Neustart):</p>
        <div class="help-actions">
          <a class="btn-accent" id="extCrxInstall" href="${crxUrl}">Extension installieren</a>
          <span class="hint">${fmtBytes(crx.size)} · ID <code>${ext.id || "—"}</code></span>
        </div>
        <details class="help-dl-more" id="it-policy">
          <summary>Für IT: Richtlinie für alle Nutzer (Registry/GPO)</summary>
          <p class="hint">Wenn Endanwender <code>HKCU\\Software\\Policies</code> nicht schreiben dürfen — einmalig als Administrator:</p>
          <code class="onedliner" id="extPolicySnippet"></code>
          <div class="help-actions">
            <button type="button" class="btn-ghost" data-copy-target="extPolicySnippet">IT-Einzeiler kopieren</button>
          </div>
          <p class="hint">Alternativ GPO/Intune mit JSON-Vorlagen:</p>
          <ul class="help-dl-list">
            <li><a href="${absUrl(ext.policy_url || "/downloads/extension/chrome-policy.json")}" download>chrome-policy.json</a></li>
            <li><a href="${absUrl(ext.install_sources_url || "/downloads/extension/chrome-install-sources.json")}" download>chrome-install-sources.json</a></li>
          </ul>
        </details>
        <details class="help-dl-more" id="firefox">
          <summary>Firefox</summary>
          <p>TeamVault ist nicht im Mozilla-Store. Optionen:</p>
          <ol class="help-steps-compact">
            <li><strong>Test / einzelner PC:</strong> ZIP entpacken → <code>about:debugging#/runtime/this-firefox</code> → <em>Temporäres Add-on laden</em> → <code>manifest.json</code> (bis Browser-Neustart).</li>
            <li><strong>Firma (dauerhaft):</strong> IT verteilt <a href="${ext.xpi ? absUrl(ext.xpi.url) : "#"}" ${ext.xpi ? "download" : ""}>teamvault-extension.xpi</a> per Firefox-<code>policies.json</code> (<a href="${absUrl("/downloads/extension/firefox-policy.json")}" download>Vorlage</a>, Add-on-ID <code>teamvault@local</code>).</li>
          </ol>
        </details>
        <details class="help-dl-more">
          <summary>Erweitert: ZIP / Entwicklermodus (Chrome)</summary>
          <p>ZIP (manuell entpacken): ${ext.zip ? `<a href="${absUrl(ext.zip.url)}" download>teamvault-extension.zip</a>` : "—"}</p>
          <p>Einzeiler: <code class="inline-code">extension.ps1</code> — siehe Abschnitt <a href="#fallback">Fallback</a>.</p>
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

  async function fetchClientManifest() {
    const base = tvHelpOrigin();
    const res = await fetch(base + "/api/client-downloads");
    if (!res.ok) throw new Error("manifest");
    return res.json();
  }

  function integrationFeatures(data) {
    const f = data?.features || {};
    return {
      cli: f.cli === true,
      browser_extension: f.browser_extension === true,
    };
  }

  function disabledIntegrationMsg(kind) {
    const label = kind === "cli" ? "CLI" : "Browser-Extension";
    return `<p class="help-note warn">${label}-Integration ist auf dieser Instanz deaktiviert (Plattform-Administrator). IT kann Artefakte weiterhin unter <code>/downloads/</code> bereitstellen.</p>`;
  }

  async function tvInitClientDownloads(mode) {
    const cliRoot = document.getElementById("clientDlCli");
    const extRoot = document.getElementById("clientDlExt");
    let data;
    try {
      data = await fetchClientManifest();
    } catch {
      const msg = `<p class="help-note warn">Download-Liste konnte nicht geladen werden.</p>`;
      if (mode === "cli" && cliRoot) cliRoot.innerHTML = msg;
      if (mode === "extension" && extRoot) extRoot.innerHTML = msg;
      if (mode === "both") {
        if (cliRoot) cliRoot.innerHTML = msg;
        if (extRoot) extRoot.innerHTML = msg;
      }
      return integrationFeatures(null);
    }
    const features = integrationFeatures(data);
    if (mode === "cli" || mode === "both") {
      if (!features.cli) {
        if (cliRoot) cliRoot.innerHTML = disabledIntegrationMsg("cli");
      } else {
        renderCLI(cliRoot, data);
        bindCopy(cliRoot);
      }
    }
    if (mode === "extension" || mode === "both") {
      if (!features.browser_extension) {
        if (extRoot) extRoot.innerHTML = disabledIntegrationMsg("extension");
      } else {
        renderExtension(extRoot, data);
        bindCopy(extRoot);
      }
    }
    return features;
  }

  globalThis.tvFetchClientFeatures = async function tvFetchClientFeatures() {
    try {
      return integrationFeatures(await fetchClientManifest());
    } catch {
      return { cli: false, browser_extension: false };
    }
  };

  globalThis.tvInitClientDownloads = tvInitClientDownloads;
})();

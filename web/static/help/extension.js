(async () => {
  let features = { cli: false, browser_extension: false };
  if (typeof tvHelpNav === "function") {
    features = await tvHelpNav("extension");
  }
  const main = document.getElementById("main");
  if (!features.browser_extension && main) {
    const banner = document.createElement("p");
    banner.className = "help-note warn";
    banner.textContent = "Browser-Extension-Integration ist auf dieser Instanz deaktiviert (Plattform-Administrator).";
    main.insertBefore(banner, main.firstChild?.nextSibling || main.firstChild);
  }
  const base = tvHelpOrigin();
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("baseUrl", base);
  set(
    "cmdZipWin",
    `$env:TEAMVAULT_URL='${base}'; irm "$env:TEAMVAULT_URL/help/install/extension.ps1" | iex`
  );
  set(
    "cmdZipUnix",
    `curl -fsSL "${base}/help/install/extension.sh" | TEAMVAULT_URL="${base}" bash`
  );
  if (features.browser_extension && typeof tvInitClientDownloads === "function") {
    await tvInitClientDownloads("extension");
  }
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = document.getElementById(btn.getAttribute("data-copy"));
      if (!el) return;
      try {
        await navigator.clipboard.writeText(el.textContent);
        btn.textContent = "Kopiert";
        setTimeout(() => {
          btn.textContent = "Kopieren";
        }, 1200);
      } catch (_) {}
    });
  });
})();

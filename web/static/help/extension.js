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
  const copyIcon =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9 9V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="9" width="11" height="12" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    if (btn.getAttribute("aria-label") || btn.getAttribute("title")) {
      btn.innerHTML = copyIcon;
    }
    btn.addEventListener("click", async () => {
      const el = document.getElementById(btn.getAttribute("data-copy"));
      if (!el) return;
      const idleLabel = btn.getAttribute("aria-label") || "Kopieren";
      const feedback = btn.nextElementSibling?.classList?.contains("help-copy-feedback") ? btn.nextElementSibling : null;
      try {
        await navigator.clipboard.writeText(el.textContent);
        if (btn._copyResetTimer) clearTimeout(btn._copyResetTimer);
        btn.classList.add("copied");
        btn.setAttribute("aria-label", "Kopiert");
        btn.setAttribute("title", "Kopiert");
        if (feedback) feedback.textContent = "Kopiert";
        btn._copyResetTimer = setTimeout(() => {
          btn.classList.remove("copied");
          btn.setAttribute("aria-label", idleLabel);
          btn.setAttribute("title", idleLabel);
          if (feedback) feedback.textContent = "";
          btn._copyResetTimer = null;
        }, 1200);
      } catch (_) {
        btn.setAttribute("aria-label", "Bitte manuell kopieren");
        btn.setAttribute("title", "Bitte manuell kopieren");
        if (feedback) feedback.textContent = "Bitte manuell kopieren";
        if (btn._copyResetTimer) clearTimeout(btn._copyResetTimer);
        btn._copyResetTimer = setTimeout(() => {
          btn.setAttribute("aria-label", idleLabel);
          btn.setAttribute("title", idleLabel);
          if (feedback) feedback.textContent = "";
          btn._copyResetTimer = null;
        }, 1600);
      }
    });
  });
})();

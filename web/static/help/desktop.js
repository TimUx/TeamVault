(async () => {
  let features = { cli: false, browser_extension: false, desktop: false };
  if (typeof tvHelpNav === "function") {
    features = await tvHelpNav("desktop");
  }
  const main = document.getElementById("main");
  if (!features.desktop && main) {
    const banner = document.createElement("p");
    banner.className = "help-note warn";
    banner.textContent = "Desktop-Integration ist auf dieser Instanz deaktiviert (Plattform-Administrator).";
    main.insertBefore(banner, main.firstChild?.nextSibling || main.firstChild);
  }
  const base = tvHelpOrigin();
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("baseUrl", base);
  const dlLink = document.getElementById("dlLink");
  if (dlLink) dlLink.href = base + "/downloads/";
  if (features.desktop && typeof tvInitClientDownloads === "function") {
    await tvInitClientDownloads("desktop");
  }
})();

(() => {
  const hint = document.getElementById("originHint");
  if (hint) hint.textContent = tvHelpOrigin();
  const foot = document.getElementById("aboutFoot");
  if (!foot) return;
  fetch(tvHelpPath("/api/version"))
    .then((r) => r.json())
    .then((v) => {
      let version = String(v.version || "dev");
      const commit = v.commit && v.commit !== "none" ? String(v.commit) : "";
      const semver = version.match(/^v?(\d+\.\d+\.\d+)/);
      if (semver) version = "v" + semver[1];
      else if (commit && version !== "dev") version = version + " (" + commit.slice(0, 7) + ")";
      foot.textContent =
        (v.product || "TeamVault") + " " + version +
        " · Entwickler: " + (v.developer || "Timo Braun");
    })
    .catch(() => {
      foot.textContent = "TeamVault · Entwickler: Timo Braun";
    });
})();

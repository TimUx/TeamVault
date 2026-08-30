(() => {
  const hint = document.getElementById("originHint");
  if (hint) hint.textContent = location.origin;
  const foot = document.getElementById("aboutFoot");
  if (!foot) return;
  fetch("/api/version")
    .then((r) => r.json())
    .then((v) => {
      foot.textContent =
        (v.product || "TeamVault") +
        " " +
        (v.version || "dev") +
        (v.commit && v.commit !== "none" ? " (" + v.commit + ")" : "") +
        " · Entwickler: " +
        (v.developer || "Timo Braun");
    })
    .catch(() => {
      foot.textContent = "TeamVault · Entwickler: Timo Braun";
    });
})();

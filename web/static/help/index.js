(() => {
  if (typeof tvHelpNav === "function") tvHelpNav("overview");
  const hint = document.getElementById("originHint");
  if (hint) hint.textContent = tvHelpOrigin();
  if (typeof tvInitClientDownloads === "function") tvInitClientDownloads("both");
})();

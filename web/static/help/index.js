(async () => {
  let features = { cli: false, browser_extension: false };
  if (typeof tvHelpNav === "function") {
    features = await tvHelpNav("overview");
  }
  const hint = document.getElementById("originHint");
  if (hint) hint.textContent = tvHelpOrigin();
  const clientsStep = document.querySelector(".help-step-clients");
  if (clientsStep) {
    clientsStep.hidden = !(features.cli || features.browser_extension);
  }
  if (typeof tvInitClientDownloads === "function" && (features.cli || features.browser_extension)) {
    await tvInitClientDownloads("both");
  }
})();

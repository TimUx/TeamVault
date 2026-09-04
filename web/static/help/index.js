(async () => {
  let features = { cli: false, browser_extension: false, desktop: false };
  if (typeof tvHelpNav === "function") {
    features = await tvHelpNav("overview");
  }
  const hint = document.getElementById("originHint");
  if (hint) hint.textContent = tvHelpOrigin();
  const clientsStep = document.querySelector(".help-step-clients");
  if (clientsStep) {
    clientsStep.hidden = !(features.cli || features.browser_extension || features.desktop);
  }
  if (typeof tvInitClientDownloads === "function" && (features.cli || features.browser_extension || features.desktop)) {
    await tvInitClientDownloads("both");
  }
})();

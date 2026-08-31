(() => {
  if (typeof tvHelpNav === "function") tvHelpNav("account");
  const demo =
    "otpauth://totp/TeamVault:max.mustermann?algorithm=SHA1&digits=6&issuer=TeamVault&period=30&secret=JBSWY3DPEHPK3PXP";
  const box = document.getElementById("demoQr");
  if (box && globalThis.TVQR) {
    TVQR.mount(box, demo, { size: 180 });
  }
})();

function tvHelpBase() {
  if (typeof window.__TV_BASE__ === "string") {
    return window.__TV_BASE__.replace(/\/$/, "");
  }
  const m = location.pathname.match(/^(.*)\/help(?:\/|$)/);
  return m ? m[1] : "";
}

function tvHelpOrigin() {
  return location.origin + tvHelpBase();
}

function tvHelpPath(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  const b = tvHelpBase();
  return b ? b + p : p;
}

function tvHelpBase() {
  if (typeof window.__TV_BASE__ === "string") {
    const v = window.__TV_BASE__.replace(/\/$/, "");
    if (v) return v;
  }
  try {
    const meta = (document.querySelector('meta[name="tv-base"]')?.content || "").replace(/\/$/, "");
    if (meta) return meta;
  } catch (_) {}
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

/**
 * Pure URL / origin matching + version compare helpers shared by popup.js.
 *
 * Security-relevant: origin matching MUST be exact (scheme + host + port).
 * "https://example.com" is not the same origin as "http://example.com",
 * "https://example.com:8443" or "https://evil-example.com". Host matching
 * (used only for display/sorting, never to gate autofill) additionally
 * allows subdomain relations.
 *
 * Loaded as a classic (non-module) script so it works unmodified in the
 * MV3 extension pages (popup.html) and in plain Node.js unit tests
 * (see clients/extension/tests/).
 */
(function (root) {
  "use strict";

  function originFromUrl(u) {
    try {
      const x = new URL(u);
      return x.protocol + "//" + x.host;
    } catch {
      return "";
    }
  }

  function hostFromUrl(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  }

  // Exact origin match (scheme + host + port). Used to gate autofill/copy.
  function originsMatch(a, b) {
    return !!(a && b && a.toLowerCase() === b.toLowerCase());
  }

  // Looser hostname match (subdomain-aware). Used only for list sorting /
  // "matches this site" hints — never for the actual fill/copy decision.
  function hostsMatch(a, b) {
    if (!a || !b) return false;
    a = a.replace(/^www\./, "").toLowerCase();
    b = b.replace(/^www\./, "").toLowerCase();
    return a === b || a.endsWith("." + b) || b.endsWith("." + a);
  }

  function parseVersion(v) {
    const m = String(v || "")
      .trim()
      .replace(/^v/, "")
      .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
  }

  function newerVersion(local, remote) {
    const a = parseVersion(local);
    const b = parseVersion(remote);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
      if (b[i] > a[i]) return true;
      if (b[i] < a[i]) return false;
    }
    return false;
  }

  const TVMatch = {
    originFromUrl,
    hostFromUrl,
    originsMatch,
    hostsMatch,
    parseVersion,
    newerVersion,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TVMatch;
  } else {
    root.TVMatch = TVMatch;
  }
})(typeof self !== "undefined" ? self : this);

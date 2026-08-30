(() => {
  const base = location.origin;
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("baseUrl", base);
  set(
    "cmdWin",
    `$env:TEAMVAULT_URL='${base}'; irm "$env:TEAMVAULT_URL/help/install/extension.ps1" | iex`
  );
  set(
    "cmdUnix",
    `curl -fsSL "${base}/help/install/extension.sh" | TEAMVAULT_URL="${base}" bash`
  );
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = document.getElementById(btn.getAttribute("data-copy"));
      if (!el) return;
      try {
        await navigator.clipboard.writeText(el.textContent);
        btn.textContent = "Kopiert";
        setTimeout(() => {
          btn.textContent = "Kopieren";
        }, 1200);
      } catch (_) {}
    });
  });
})();

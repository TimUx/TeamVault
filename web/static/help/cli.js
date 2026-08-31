(() => {
  if (typeof tvHelpNav === "function") tvHelpNav("cli");
  const base = tvHelpOrigin();
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("baseUrl", base);
  set(
    "cmdWin",
    `$env:TEAMVAULT_URL='${base}'; irm "$env:TEAMVAULT_URL/help/install/tvcli.ps1" | iex`
  );
  set(
    "cmdUnix",
    `curl -fsSL "${base}/help/install/tvcli.sh" | TEAMVAULT_URL="${base}" bash`
  );
  set("cmdLogin", `tvcli -base ${base} login -tenant IHR-TENANT -user IHR-USER`);
  set(
    "cmdKey",
    `# PowerShell\n$env:TEAMVAULT_API_KEY='tvk_…'\ntvcli -base ${base} whoami\n\n# Bash\nexport TEAMVAULT_API_KEY=tvk_…\ntvcli -base ${base} whoami`
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

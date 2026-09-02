# Gitea (Mirror-Remote)

TeamVault nutzt **Gitea nur als internes Git-Remote** und für Container-Registry/Releases im Firmennetz. **Keine Gitea Actions** — alle Builds laufen auf GitHub.

## Was auf Gitea liegt

| Artefakt | Quelle |
|----------|--------|
| Git (`main`, Tags) | Push von Entwickler-Clients |
| **Container-Image** `cc-3.3/teamvault` | Nach Release von **GHCR** syncen |
| **Release-Binaries** | Von **GitHub Releases** spiegeln |

## GitHub CI (einzige Build-Pipeline)

- `.github/workflows/docker.yml` — Tests + Image → `ghcr.io/timux/teamvault`
- `.github/workflows/docs.yml` — Screenshots, Online-Hilfe-Bilder, Patch-Release bei `web/static/help/`
- `.github/workflows/release.yml` — `teamvault-*` Binaries
- `.github/workflows/tvcli.yml` — `tvcli-*` Binaries

## Git-Spiegelung GitHub → Gitea (optional, automatisch)

Workflow `docs.yml` kann nach Docs-/Hilfe-Updates `main` und neue Tags nach Gitea pushen.

**GitHub Repository (TimUx/TeamVault):**

| Einstellung | Wert |
|-------------|------|
| Variable `GITEA_SYNC_ENABLED` | `true` |
| Secret `GITEA_PUSH_URL` | `https://<user>:<token>@git.example.internal/git/CC-3.3/TeamVault.git` |

Token: Gitea → Einstellungen → Zugriffstoken (Schreibzugriff auf Repo). Ohne diese Einstellungen bleibt der manuelle Push von Entwickler-Clients nötig.

## Nach jedem Release-Tag (`v*`)

1. GitHub Actions abwarten (Release, tvcli, Docker grün)
2. Release-Assets von GitHub nach Gitea kopieren
3. Image `ghcr.io/timux/teamvault:<version>` nach `git.example.internal/cc-3.3/teamvault` taggen/pushen

## Deploy

```bash
docker pull git.example.internal/cc-3.3/teamvault:1.3.26
```

## Optional: Base-Images lokal spiegeln

Nur noch relevant, wenn andere Projekte im `cc-3.3`-Namespace Images ohne Internet bauen. Für TeamVault selbst nicht nötig:

```powershell
.\scripts\mirror-oci-to-gitea.ps1
```

`vendor/` und Go-Toolchain-Packages gehören **nicht** auf Gitea.

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

## Git-Spiegelung GitHub → Gitea (lokal)

Gitea ist **nicht aus dem Internet** erreichbar — GitHub Actions können nicht direkt nach Gitea pushen. Nach CI/Release auf GitHub vom Firmennetz aus spiegeln:

```powershell
.\scripts\sync-github-to-gitea.ps1
```

Das Skript holt `main` + Tags von `github` (über CONNECT-Proxy `127.0.0.1:18081`) und pusht nach `origin` (Gitea, ohne Proxy).

Typischer Ablauf nach Docs-Workflow oder Release:

1. GitHub Actions auf `main` / neuem Tag abwarten
2. Lokal: `.\scripts\sync-github-to-gitea.ps1`
3. Optional: Container-Image und Release-Binaries wie unten

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

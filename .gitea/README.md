# Gitea Actions (act_runner)

## Build-Strategie

| Artefakt | Quelle | Gitea |
|----------|--------|-------|
| **Server-Binaries** (`teamvault-*`) | GitHub Actions `release.yml` | Release-Assets von GitHub spiegeln |
| **CLI** (`tvcli-*`) | GitHub Actions `tvcli.yml` | Release-Assets von GitHub spiegeln |
| **Container-Image** | GitHub Actions `docker.yml` → GHCR | Nach Tag: Image nach `git.example.internal/cc-3.3/teamvault` syncen |
| **Go-Module** | `go mod` / GOPROXY (GitHub CI) | **nicht** als `vendor/` im Repo |

`vendor/` und Go-Toolchain-Generic-Packages gehören **nicht** auf Gitea — spart ~270 MB Repo-/Package-Speicher.

## Workflow

- [`workflows/ci.yml`](workflows/ci.yml) — leichte Checks (cryptocore-Sync, `go test` via Docker + Module-Proxy)
- [`workflows/mirror-base-images.yml`](workflows/mirror-base-images.yml) — optionaler Runner-Spiegel für Base-Images

Kein Image-Build und kein tvcli-Build auf Gitea (benötigt `actions/*` von github.com, das der Runner nicht zuverlässig erreicht).

## Base-Images (nur für CI-Tests auf dem Runner)

Lokal mit Corp-Proxy spiegeln (kein Docker Desktop nötig):

```powershell
.\scripts\mirror-oci-to-gitea.ps1
```

| Image | Ziel |
|-------|------|
| `golang:1.23.3-bookworm` | `git.example.internal/cc-3.3/golang:1.23.3-bookworm` |
| `distroless/static-debian12:nonroot` | `…/cc-3.3/distroless-static:nonroot` |
| `aquasec/trivy:latest` | `…/cc-3.3/trivy:latest` (optional) |

## Secrets / Vars

| Name | Zweck |
|------|--------|
| `REGISTRY_TOKEN` | PAT mit `write:package` |
| `REGISTRY_USER` | Registry-Login |
| `ACT_RUN_TOKEN` | Git-Clone im Runner (Fallback: Job-Token) |
| `REGISTRY` | Registry-Hostname überschreiben |

## Deploy-Image

```bash
docker pull git.example.internal/cc-3.3/teamvault:1.3.13
```

Nach jedem Release-Tag: GHCR-Image und GitHub-Release-Assets nach Gitea synchronisieren.

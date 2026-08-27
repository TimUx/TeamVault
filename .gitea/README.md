# Gitea Actions (act_runner)

Workflows:
- [`workflows/ci.yml`](workflows/ci.yml) — Test + Docker package (nur interne Registry + `vendor/`)
- [`workflows/mirror-base-images.yml`](workflows/mirror-base-images.yml) — optionaler Runner-Spiegel (Fallback)

## Offline-Build-Artefakte (Laptop → Gitea)

Lokal mit **Windows DefaultNetworkCredentials** über `proxyits` laden und nach Gitea pushen (kein Docker Desktop nötig):

```powershell
# Container-Base-Images → Registry
.\scripts\mirror-oci-to-gitea.ps1

# Optional: Go-Tarball → Generic Package
.\scripts\publish-go-toolchain.ps1
```

| Artefakt | Quelle | Ziel in Gitea |
|----------|--------|----------------|
| Go-Toolchain Image | `golang:1.23.3-bookworm` | `git.example.internal/cc-3.3/golang:1.23.3-bookworm` |
| Runtime | `gcr.io/distroless/static-debian12:nonroot` | `…/cc-3.3/distroless-static:nonroot` |
| Trivy | `aquasec/trivy:latest` | `…/cc-3.3/trivy:latest` |
| Go-Module | Repo `vendor/` | Git (Commit) |
| Go-Tarball (optional) | `go1.23.3.linux-amd64.tar.gz` | Generic `CC-3.3/go-toolchain/1.23.3/…` |

Der **act_runner** braucht für TeamVault-CI dann **kein Internet** mehr (nur Gitea/`gitea:3000` + Registry). Ubuntu-Packages auf dem Runner-Host dürfen weiter über den freigeschalteten Proxy.

## Secrets / Vars

| Name | Art | Zweck |
|------|-----|--------|
| `REGISTRY_TOKEN` | Secret | PAT mit `write:package` (+ Pull der Base-Images) |
| `REGISTRY_USER` | Secret | Login-User zur Registry (nicht `admin`-Job-Token) |
| `ACT_RUN_TOKEN` | Secret | Interner Git-Clone (Fallback: Job-Token) |
| `REGISTRY` | Variable | Registry-Hostname überschreiben |

## Jobs (CI)

| Job | Trigger | What |
|-----|---------|------|
| **Test** | push/PR `main`, Tags `v*`, manuell | cryptocore + `docker build --target test` |
| **Docker package** | push `main` / Tags `v*` / manuell | Image bauen, Trivy, Push |

Image: `{registry}/cc-3.3/teamvault` — Tags `latest`/`main`, `sha-<7>`, bei Release `v*`/`1.0.0`.

**Wichtig:** Keine `actions/*` von github.com. Checkout über `gitea:3000`. Build nur aus internen Base-Images + `vendor/`.

```bash
docker login git.example.internal
docker pull git.example.internal/cc-3.3/teamvault:v1.0.0
```

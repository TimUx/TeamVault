# Gitea Actions (act_runner)

Workflows:
- [`workflows/ci.yml`](workflows/ci.yml) — Test + Docker package
- [`workflows/mirror-base-images.yml`](workflows/mirror-base-images.yml) — einmalig Base-Images spiegeln

## Runner

Label: `ubuntu-latest` (anpassen, falls euer Runner anders heißt).

## Einmalig: Base-Images spiegeln

Ohne Docker Hub/gcr.io im CI: Workflow **Mirror base images** manuell starten (Runner pullt über Daemon-Proxy, pusht nach Gitea):

| Image | Interner Tag |
|-------|----------------|
| `golang:1.23.3-bookworm` | `git.example.internal/cc-3.3/golang:1.23.3-bookworm` |
| `gcr.io/distroless/static-debian12:nonroot` | `…/cc-3.3/distroless-static:nonroot` |
| `aquasec/trivy:latest` | `…/cc-3.3/trivy:latest` |

Optional Go-Tarball (ohne Docker): `.\scripts\publish-go-toolchain.ps1` → Generic Package `CC-3.3/go-toolchain`.

## Jobs (CI)

| Job | Trigger | What |
|-----|---------|------|
| **Test** | push/PR `main`, Tags `v*`, manuell | cryptocore-Check + `docker build --target test` (`vendor/`) |
| **Docker package** | push `main` / Tags `v*` / manuell (nach Test) | Image → Gitea Package Registry + Trivy |

## Image

`{registry}/cc-3.3/teamvault` — Registry-Host aus `vars.REGISTRY` oder Hostname der Gitea-URL.

Tags: `latest`/`main` (Branch main), `sha-<7>`, bei Tag `v*` zusätzlich Versions-Tags.

## Secrets / Vars

| Name | Art | Zweck |
|------|-----|--------|
| `REGISTRY_TOKEN` | Secret | PAT mit `write:package` (Fallback: Job-Token) |
| `ACT_RUN_TOKEN` | Secret | Interner Git-Clone (Fallback: Job-Token) |
| `REGISTRY` | Variable | Registry-Hostname überschreiben |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Variablen | Nur noch für Mirror-Workflow / Fallback |

**Wichtig:** Keine `actions/*` von github.com. Checkout über `gitea:3000`. Build nutzt **interne** Base-Images + **`vendor/`** (kein `go mod download` über Auth-Proxy).

```bash
docker login git.example.internal
docker pull git.example.internal/cc-3.3/teamvault:latest
```

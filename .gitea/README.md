# Gitea Actions (act_runner)

Workflow: [`workflows/ci.yml`](workflows/ci.yml)

## Runner

Label: `ubuntu-latest` (anpassen, falls euer Runner anders heißt).

## Jobs

| Job | Trigger | What |
|-----|---------|------|
| **Test** | push/PR `main`, Tags `v*`, manuell | `go test`, `go vet`, Smoke-Build |
| **Docker package** | push `main` / Tags `v*` / manuell (nach Test) | Image bauen → Gitea Package Registry |

## Image

`{registry}/cc-3.3/teamvault` — Registry-Host aus `vars.REGISTRY` oder Hostname der Gitea-URL.

Tags: `latest`/`main` (Branch main), `sha-<7>`, bei Tag `v*` zusätzlich Versions-Tags.

## Secrets / Vars

| Name | Art | Zweck |
|------|-----|--------|
| `REGISTRY_TOKEN` | Secret | PAT mit `write:package` (Fallback: Job-Token) |
| `REGISTRY` | Variable | Registry-Hostname überschreiben |
| `GOPROXY` / `GOSUMDB` | Variablen | Corp Go-Proxy |

```bash
docker login git.example.internal
docker pull git.example.internal/cc-3.3/teamvault:latest
```

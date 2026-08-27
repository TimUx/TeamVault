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
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Variablen | Corp-HTTP-Proxy (Default: `proxy.example.internal:8080`) |

### Firmenproxy (GitHub + Docker)

Wie bei **storage-dashboard**: Workflow-`env` setzt `HTTP_PROXY`/`HTTPS_PROXY` auf `http://proxy.example.internal:8080` und `NO_PROXY` für interne Hosts (`gitea`, `git.example.internal`, `.example.internal`).

**Wichtig:** Keine `actions/*` von github.com (act lädt sie ohne Workflow-Proxy). Checkout intern über `gitea:3000`. Go-Test/Build über `docker build` mit Proxy-Build-Args — der Docker-Daemon spricht mit `proxyits` (curl im Job-Container bekommt sonst 407 ohne NTLM).

Optional: `secrets.ACT_RUN_TOKEN` für den internen Clone (Fallback: Job-Token).

```bash
docker login git.example.internal
docker pull git.example.internal/cc-3.3/teamvault:latest
```

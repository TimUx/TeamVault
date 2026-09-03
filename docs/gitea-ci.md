# Gitea Actions (lokal, Firmenproxy)

Workflow [`.gitea/workflows/build.yml`](../.gitea/workflows/build.yml) baut die **Binaries**
(`teamvault`, `tvcli`; Linux/Darwin/Windows, amd64/arm64) und das **Docker-Image** und pusht
das Image in die lokale Gitea-Registry.

Trigger: Push auf `main`, Tags `v*` und manuell über **Actions → Build → Run workflow**
(optional mit eigenem Image-Tag, Default `latest`).

## Voraussetzungen

- **Gitea ≥ 1.21** mit aktiviertem Actions (`[actions] ENABLED = true` in `app.ini`).
- **act_runner** (Ubuntu-Host) ist auf der Instanz registriert und liefert das Label
  `ubuntu-latest` aus (Docker-Image des Runners muss für den Job Docker-in-Docker bzw.
  Zugriff auf den Docker-Socket haben, damit `docker build`/`docker login` funktionieren).
- Die im Workflow verwendeten Actions (`actions/checkout@v4`, `actions/setup-go@v5`,
  `actions/upload-artifact@v4`) müssen erreichbar sein — entweder über den Firmenproxy
  vom Runner aus oder über einen **Actions-Mirror** in Gitea
  (`[actions] DEFAULT_ACTIONS_URL = <mirror-url>` in `app.ini`).

## Repository-Variablen (Settings → Actions → Variables)

| Variable | Beispiel | Pflicht | Bedeutung |
|----------|----------|---------|-----------|
| `REGISTRY_HOST` | `local.dom` | ja | Docker-Registry (Host ggf. mit Port) |
| `IMAGE_GROUP` | `gruppe` | ja | Namespace/Gruppe in der Registry |
| `IMAGE_NAME` | `teamvault` | nein | Default: Repository-Name |
| `PROXY_HOST` | `proxy.local.dom` | nein¹ | Firmenproxy-Host |
| `PROXY_PORT` | `8080` | nein | Default: `8080` |
| `PROXY_SCHEME` | `http` | nein | Default: `http` |
| `NO_PROXY_EXTRA` | `gitea.local.dom,git.local.dom` | nein | Zusätzliche Hosts ohne Proxy (Registry und localhost werden immer umgangen) |
| `GOPROXY` | `https://goproxy.local.dom,direct` | nein | Default: `https://proxy.golang.org,direct` (für Air-Gap auf lokalen Module-Proxy setzen) |
| `GOSUMDB` | `sum.golang.org` / `off` | nein | Default: `sum.golang.org` |
| `GO_IMAGE` | `registry.local.dom/mirror/golang:1.25.13-bookworm` | nein | Build-Image für das Dockerfile (Default: Docker Hub) |
| `RUNTIME_IMAGE` | `registry.local.dom/mirror/distroless/static-debian12:nonroot` | nein | Runtime-Image für das Dockerfile (Default: `gcr.io/distroless/...`) |

¹ Ohne `PROXY_HOST` läuft der Workflow komplett ohne Proxy (z. B. wenn der Runner
direkt am Firmennetz hängt oder alles lokal gespiegelt ist).

## Secrets (Settings → Actions → Secrets)

| Secret | Pflicht | Bedeutung |
|--------|---------|-----------|
| `REGISTRY_TOKEN` | nein² | Token/Passwort für den Registry-Push. Default: automatisches `GITEA_TOKEN` des Runs. |
| `REGISTRY_USER` | nein | Registry-Benutzer. Default: `gitea.actor` (auslösender Benutzer). |

² Für Push in die **eigene** Gitea-Paket-Registry reicht meist `GITEA_TOKEN` +
`gitea.actor`. `REGISTRY_TOKEN` wird nur benötigt, wenn eine **andere** Registry
(eigener vollqualifizierter Host in `REGISTRY_HOST`) oder ein Dienstkonto verwendet wird.

## Ergebnis-Image

```
${REGISTRY_HOST}/${IMAGE_GROUP}/${IMAGE_NAME}:${TAG}
${REGISTRY_HOST}/${IMAGE_GROUP}/${IMAGE_NAME}:${GITEA_SHA}
```

Tag-Auflösung: `workflow_dispatch`-Input `tag` → sonst Tag-Name bei `v*`-Push → sonst `latest`.

## Hinweise zum Runner

- Der Runner-Prozess selbst braucht Proxy-Env (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`),
  um die Gitea-API und ggf. den Actions-Download zu erreichen — in `config.yaml` des
  act_runner oder systemd-Unit (`Environment=`) setzen. Interne Hosts (Gitea, Registry)
  in `NO_PROXY` aufnehmen.
- Der Job setzt Proxy/NO_PROXY für die **Build-Schritte** automatisch aus den
  Repo-Variablen; beim Image-Build werden sie als `--build-arg` in den Container
  weitergereicht (Go-Modul-Download läuft dort im Build-Container).

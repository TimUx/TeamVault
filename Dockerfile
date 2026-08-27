# TeamVault server — multi-stage, static Go binary (CGO_ENABLED=0, modernc sqlite).
# Unlock key is never baked into the image; mount via TEAMVAULT_MASTER_UNLOCK_KEY_FILE.
#
# Base images come from the internal Gitea registry (mirrored via
# .gitea/workflows/mirror-base-images.yml). Modules are vendored (vendor/).

ARG BASE_REGISTRY=git.example.internal/cc-3.3
ARG GO_VERSION=1.23.3

FROM ${BASE_REGISTRY}/golang:${GO_VERSION}-bookworm AS build
WORKDIR /src

ENV CGO_ENABLED=0 GOFLAGS=-mod=vendor

COPY go.mod go.sum ./
COPY vendor/ vendor/
COPY . .

# CI target: unit tests + vet (build with: docker build --target test …)
FROM build AS test
RUN go test ./... && go vet ./...

FROM build AS bin
ARG VERSION=dev
ARG COMMIT=none
RUN go build -trimpath \
    -ldflags="-s -w -X github.com/teamvault/teamvault/internal/buildinfo.Version=${VERSION} -X github.com/teamvault/teamvault/internal/buildinfo.Commit=${COMMIT}" \
    -o /out/teamvault ./cmd/teamvault

ARG BASE_REGISTRY=git.example.internal/cc-3.3
FROM ${BASE_REGISTRY}/distroless-static:nonroot
WORKDIR /data

COPY --from=bin /out/teamvault /usr/local/bin/teamvault

ENV TEAMVAULT_ADDR=:8080 \
    TEAMVAULT_DATA_DIR=/data \
    TEAMVAULT_MASTER_UNLOCK_KEY_FILE=/run/secrets/teamvault_unlock

EXPOSE 8080
VOLUME ["/data"]

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/teamvault"]

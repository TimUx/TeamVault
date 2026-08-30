# TeamVault server — multi-stage, static Go binary (CGO_ENABLED=0, modernc sqlite).
# Unlock key is never baked into the image; mount via TEAMVAULT_MASTER_UNLOCK_KEY_FILE.
#
# Defaults: public golang + distroless (GitHub Actions / local Docker).
# Air-gapped: override GO_IMAGE and RUNTIME_IMAGE to mirrored registry tags.

ARG GO_IMAGE=golang:1.23.3-bookworm
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot

FROM ${GO_IMAGE} AS build
WORKDIR /src

ENV CGO_ENABLED=0
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ENV GOPROXY=${GOPROXY} GOSUMDB=${GOSUMDB}

COPY go.mod go.sum ./
COPY . .

# vendor/ is optional: internal clones may vendor for air-gap; GitHub uses the module proxy.
RUN if [ -f vendor/modules.txt ]; then \
      printf '%s\n' '-mod=vendor' > /tmp/goflags; \
    else \
      go mod download; \
      : > /tmp/goflags; \
    fi

FROM build AS test
RUN export GOFLAGS="$(cat /tmp/goflags)"; go test ./... && go vet ./...

FROM build AS bin
ARG VERSION=dev
ARG COMMIT=none
RUN export GOFLAGS="$(cat /tmp/goflags)"; \
    go build -trimpath \
    -ldflags="-s -w -X github.com/teamvault/teamvault/internal/buildinfo.Version=${VERSION} -X github.com/teamvault/teamvault/internal/buildinfo.Commit=${COMMIT}" \
    -o /out/teamvault ./cmd/teamvault

ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot
FROM ${RUNTIME_IMAGE}
WORKDIR /data

COPY --from=bin /out/teamvault /usr/local/bin/teamvault

ENV TEAMVAULT_ADDR=:8080 \
    TEAMVAULT_DATA_DIR=/data \
    TEAMVAULT_MASTER_UNLOCK_KEY_FILE=/run/secrets/teamvault_unlock

EXPOSE 8080
VOLUME ["/data"]

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/teamvault"]

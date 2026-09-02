# TeamVault server — multi-stage, static Go binary (CGO_ENABLED=0, modernc sqlite).
# Unlock key is never baked into the image; mount via TEAMVAULT_MASTER_UNLOCK_KEY_FILE.
#
# Defaults: public golang + distroless (GitHub Actions / local Docker).
# Air-gapped: override GO_IMAGE and RUNTIME_IMAGE to mirrored registry tags.

ARG GO_IMAGE=golang:1.25.0-bookworm
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

FROM build AS clients
ARG VERSION=dev
ARG COMMIT=none
# Official images (CI push) set REQUIRE_EXTENSION_KEY=1 and inject TV_EXTENSION_SIGNING_KEY.
# The PEM is read from a BuildKit secret into process env — never copied into a layer.
ARG REQUIRE_EXTENSION_KEY=0
RUN --mount=type=secret,id=tv_extension_pem,required=false \
    export GOFLAGS="$(cat /tmp/goflags)" CGO_ENABLED=0 && \
    mkdir -p /out/downloads && \
    build_tvcli() { \
      goos="$1"; goarch="$2"; suffix="$3"; \
      name="tvcli-${goos}-${goarch}${suffix}"; \
      GOOS="$goos" GOARCH="$goarch" go build -trimpath \
        -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
        -o "/out/downloads/${name}" ./cmd/tvcli; \
    } && \
    build_tvcli linux amd64 "" && \
    build_tvcli linux arm64 "" && \
    build_tvcli windows amd64 ".exe" && \
    build_tvcli windows arm64 ".exe" && \
    if [ -s /run/secrets/tv_extension_pem ]; then \
      export TV_EXTENSION_PEM="$(cat /run/secrets/tv_extension_pem)"; \
    fi && \
    export TV_EXTENSION_REQUIRE_KEY="${REQUIRE_EXTENSION_KEY}" && \
    go build -trimpath -o /out/pack-extension ./cmd/pack-extension && \
    TV_EXTENSION_UPDATE_BASE=https://teamvault.local /out/pack-extension && \
    cp dist/teamvault-extension.* /out/downloads/ && \
    cp -r dist/extension /out/downloads/

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
COPY --from=clients /out/downloads /opt/teamvault/bundled-downloads

ENV TEAMVAULT_ADDR=:8080 \
    TEAMVAULT_DATA_DIR=/data \
    TEAMVAULT_MASTER_UNLOCK_KEY_FILE=/run/secrets/teamvault_unlock \
    TEAMVAULT_BUNDLED_DOWNLOADS=/opt/teamvault/bundled-downloads

EXPOSE 8080
VOLUME ["/data"]

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/teamvault"]

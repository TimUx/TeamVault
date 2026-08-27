# TeamVault server — multi-stage, static Go binary (CGO_ENABLED=0, modernc sqlite).
# Unlock key is never baked into the image; mount via TEAMVAULT_MASTER_UNLOCK_KEY_FILE.

ARG GO_VERSION=1.23.3

FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src

# Corp HTTP(S) proxy (CI / docker build --build-arg), same idea as storage-dashboard
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} NO_PROXY=${NO_PROXY} \
    http_proxy=${http_proxy} https_proxy=${https_proxy} no_proxy=${no_proxy}

# Optional corp module proxy (build-arg), e.g. --build-arg GOPROXY=http://…
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ENV GOPROXY=${GOPROXY} GOSUMDB=${GOSUMDB} CGO_ENABLED=0

COPY go.mod go.sum ./
RUN go mod download

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

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /data

COPY --from=bin /out/teamvault /usr/local/bin/teamvault

ENV TEAMVAULT_ADDR=:8080 \
    TEAMVAULT_DATA_DIR=/data \
    TEAMVAULT_MASTER_UNLOCK_KEY_FILE=/run/secrets/teamvault_unlock

EXPOSE 8080
VOLUME ["/data"]

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/teamvault"]

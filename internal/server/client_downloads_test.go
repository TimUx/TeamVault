package server

import (
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/clients"
)

func TestClientDownloadsAPI(t *testing.T) {
	dir := t.TempDir()
	dl := filepath.Join(dir, "downloads")
	if err := os.MkdirAll(dl, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(dl, "tvcli-linux-amd64"), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dl, "teamvault-desktop-linux-amd64.AppImage"), []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	app, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: key})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Vault.Close()
	api := New(app)
	req := httptest.NewRequest(http.MethodGet, "/api/client-downloads", nil)
	rec := httptest.NewRecorder()
	api.handleClientDownloads(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		CLI []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"cli"`
		Desktop []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
			Kind string `json:"kind"`
		} `json:"desktop"`
		Features struct {
			CLI              bool `json:"cli"`
			BrowserExtension bool `json:"browser_extension"`
			Desktop          bool `json:"desktop"`
		} `json:"features"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.CLI) != 1 || body.CLI[0].Name != "tvcli-linux-amd64" {
		t.Fatalf("cli: %+v", body.CLI)
	}
	if len(body.Desktop) != 1 || body.Desktop[0].Name != "teamvault-desktop-linux-amd64.AppImage" || body.Desktop[0].Kind != "appimage" {
		t.Fatalf("desktop: %+v", body.Desktop)
	}
	if body.Features.CLI || body.Features.BrowserExtension || body.Features.Desktop {
		t.Fatalf("features default off: %+v", body.Features)
	}
}

func TestVersionedDesktopDownload(t *testing.T) {
	dir := t.TempDir()
	dl := filepath.Join(dir, "downloads")
	if err := os.MkdirAll(dl, 0o755); err != nil {
		t.Fatal(err)
	}
	const name = "teamvault-desktop-windows-amd64.exe"
	if err := os.WriteFile(filepath.Join(dl, name), []byte("desktop-binary"), 0o644); err != nil {
		t.Fatal(err)
	}
	app, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: make([]byte, 32)})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Vault.Close()
	api := New(app)
	for _, version := range []string{"v1.5.34", ""} {
		t.Run("version="+version, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dl, name+".version"), []byte(version), 0o644); err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			api.handleClientDownloads(rec, httptest.NewRequest(http.MethodGet, "/api/client-downloads", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("manifest status: %d", rec.Code)
			}
			var manifest clients.Manifest
			if err := json.Unmarshal(rec.Body.Bytes(), &manifest); err != nil {
				t.Fatal(err)
			}
			if len(manifest.Desktop) != 1 {
				t.Fatalf("unexpected desktop artifacts: %+v", manifest.Desktop)
			}
			artifact := manifest.Desktop[0]
			wantName := name
			if version != "" {
				wantName = "teamvault-desktop-windows-amd64-v1.5.34.exe"
			}
			if artifact.Name != wantName || artifact.URL != "/downloads/"+name {
				t.Fatalf("unexpected download: %+v", artifact)
			}
			rec = httptest.NewRecorder()
			api.handleDownloads(rec, httptest.NewRequest(http.MethodGet, artifact.URL, nil))
			if rec.Code != http.StatusOK || rec.Body.String() != "desktop-binary" {
				t.Fatalf("download status=%d body=%q", rec.Code, rec.Body.String())
			}
			header := rec.Header().Get("Content-Disposition")
			if version == "" {
				if header != "" {
					t.Fatalf("legacy download header changed: %q", header)
				}
				return
			}
			mediaType, params, err := mime.ParseMediaType(header)
			if err != nil || mediaType != "attachment" || params["filename"] != wantName {
				t.Fatalf("incorrect download filename: %q (%v)", header, err)
			}
		})
	}
}

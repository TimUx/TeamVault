package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/teamvault/teamvault/internal/clients"
)

func (a *API) handleDownloads(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, "/downloads/")
	rel = filepath.Clean(filepath.FromSlash(rel))
	if rel == "." || strings.HasPrefix(rel, "..") {
		http.NotFound(w, r)
		return
	}
	if strings.ReplaceAll(rel, "\\", "/") == "extension/updates.xml" {
		a.serveExtensionUpdates(w, r)
		return
	}
	full := filepath.Join(a.App.DataDir, "downloads", rel)
	if ct := clients.DownloadContentType(rel); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeFile(w, r, full)
}

func (a *API) serveExtensionUpdates(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(a.App.DataDir, "downloads")
	extID := readExtensionIDFile(dir)
	if extID == "" {
		http.NotFound(w, r)
		return
	}
	ver := readExtensionVersionFile(dir)
	base := strings.TrimRight(a.effectivePublicURL(r), "/")
	codebase := base + "/downloads/teamvault-extension.crx"
	w.Header().Set("Content-Type", "application/xml")
	_, _ = w.Write([]byte(`<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='` + extID + `'>
    <updatecheck codebase='` + codebase + `' version='` + ver + `' />
  </app>
</gupdate>
`))
}

func readExtensionIDFile(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "extension", "extension-id.txt"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.Split(string(b), "\n")[0])
}

func readExtensionVersionFile(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "extension", "version.txt"))
	if err != nil {
		return "0.10.0"
	}
	return strings.TrimSpace(string(b))
}

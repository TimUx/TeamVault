package web

import (
	"bytes"
	"crypto/sha512"
	"embed"
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed static/*
var staticFS embed.FS

// Handler serves static UI assets with a fixed base path (tests).
func Handler(base string) http.Handler {
	return HandlerFor(func(*http.Request) string { return base })
}

// HandlerFor serves static UI assets; base is resolved per request.
func HandlerFor(baseFn func(*http.Request) string) http.Handler {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	indexHTML, _ := fs.ReadFile(sub, "index.html")
	sri := buildScriptSRI(sub)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		base := NormalizeBasePath(baseFn(r))
		path := r.URL.Path
		switch path {
		case "/manifest.webmanifest":
			serveManifest(w, base)
			return
		case "/", "/setup", "/login", "/onboard", "/app":
			serveIndex(w, indexHTML, base, sri)
			return
		case "/help", "/help/":
			serveHelp(w, sub, "help/index.html", base)
			return
		case "/help/cli", "/help/cli/":
			serveHelp(w, sub, "help/cli.html", base)
			return
		case "/help/extension", "/help/extension/":
			serveHelp(w, sub, "help/extension.html", base)
			return
		case "/help/desktop", "/help/desktop/":
			serveHelp(w, sub, "help/desktop.html", base)
			return
		case "/help/vault", "/help/vault/":
			serveHelp(w, sub, "help/vault.html", base)
			return
		case "/help/account", "/help/account/":
			serveHelp(w, sub, "help/account.html", base)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func serveIndex(w http.ResponseWriter, indexHTML []byte, base string, sri map[string]string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	out := InjectBase(indexHTML, base)
	out = injectScriptIntegrity(out, sri)
	_, _ = w.Write(out)
}

// buildScriptSRI computes sha384 Subresource Integrity hashes for critical same-origin scripts (OQ-22).
func buildScriptSRI(sub fs.FS) map[string]string {
	out := map[string]string{}
	for _, name := range []string{"cryptocore.js", "app.js", "vault-io.js", "offline-store.js"} {
		raw, err := fs.ReadFile(sub, name)
		if err != nil {
			continue
		}
		sum := sha512.Sum384(raw)
		out[name] = "sha384-" + base64.StdEncoding.EncodeToString(sum[:])
	}
	return out
}

func injectScriptIntegrity(html []byte, sri map[string]string) []byte {
	if len(sri) == 0 {
		return html
	}
	s := string(html)
	for name, hash := range sri {
		token := `/` + name + `"`
		var b strings.Builder
		rest := s
		for {
			i := strings.Index(rest, token)
			if i < 0 {
				b.WriteString(rest)
				break
			}
			start := strings.LastIndex(rest[:i], "src=")
			if start < 0 || i-start > 96 {
				b.WriteString(rest[:i+len(token)])
				rest = rest[i+len(token):]
				continue
			}
			chunk := rest[start : i+len(token)]
			if strings.Contains(chunk, "integrity=") {
				b.WriteString(rest[:i+len(token)])
				rest = rest[i+len(token):]
				continue
			}
			b.WriteString(rest[:start])
			// chunk is like src="/cryptocore.js" — insert integrity before closing quote of src value end.
			b.WriteString(chunk[:len(chunk)-1])
			b.WriteString(`" integrity="` + hash + `" crossorigin="anonymous"`)
			rest = rest[i+len(token):]
		}
		s = b.String()
	}
	return []byte(s)
}

func serveHelp(w http.ResponseWriter, sub fs.FS, name, base string) {
	raw, err := fs.ReadFile(sub, name)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(HelpBaseRewrite(raw, base))
}

func serveManifest(w http.ResponseWriter, base string) {
	start := "/app"
	icon := "/icons/icon.svg"
	scope := "/"
	if base != "" {
		start = base + start
		icon = base + icon
		scope = base + "/"
	}
	body, _ := json.Marshal(map[string]any{
		"name":             "TeamVault",
		"short_name":       "TeamVault",
		"description":      "Interner Zero-Knowledge Passwortmanager",
		"start_url":        start,
		"scope":            scope,
		"display":          "standalone",
		"background_color": "#F4F5F7",
		"theme_color":      "#A70240",
		"lang":             "de",
		"icons": []map[string]string{
			{"src": icon, "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
		},
	})
	w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	_, _ = w.Write(body)
}

// ReadStaticFile returns a static asset (used by tests).
func ReadStaticFile(name string) ([]byte, error) {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		return nil, err
	}
	return fs.ReadFile(sub, name)
}

// IndexHTMLForTest returns index.html with base injected.
func IndexHTMLForTest(base string) ([]byte, error) {
	raw, err := ReadStaticFile("index.html")
	if err != nil {
		return nil, err
	}
	return InjectBase(raw, base), nil
}

// ManifestJSONForTest returns manifest bytes for a base path.
func ManifestJSONForTest(base string) []byte {
	var buf bytes.Buffer
	w := &bytesRecorder{&buf}
	serveManifest(w, NormalizeBasePath(base))
	return buf.Bytes()
}

type bytesRecorder struct {
	b *bytes.Buffer
}

func (b *bytesRecorder) Header() http.Header         { return http.Header{} }
func (b *bytesRecorder) Write(p []byte) (int, error) { return b.b.Write(p) }
func (b *bytesRecorder) WriteHeader(int)               {}

// HelpBaseRewrite adjusts root-absolute help links when UI is under a subpath.
func HelpBaseRewrite(html []byte, base string) []byte {
	base = NormalizeBasePath(base)
	if base == "" {
		return html
	}
	s := string(html)
	inject := `<meta name="tv-base" content="` + base + `" />`
	s = strings.Replace(s, "<head>", "<head>\n  "+inject, 1)
	s = strings.ReplaceAll(s, `href="/`, `href="`+base+`/`)
	s = strings.ReplaceAll(s, `src="/`, `src="`+base+`/`)
	return []byte(s)
}

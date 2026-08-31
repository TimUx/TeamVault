package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeBasePath(t *testing.T) {
	if NormalizeBasePath("") != "" {
		t.Fatal("empty")
	}
	if NormalizeBasePath("/") != "" {
		t.Fatal("slash")
	}
	if NormalizeBasePath("/vault/") != "/vault" {
		t.Fatal("trim")
	}
	if NormalizeBasePath("vault") != "/vault" {
		t.Fatal("prefix")
	}
}

func TestInjectBase(t *testing.T) {
	in := []byte(`<a href="__TV_BASE__/app">x</a>`)
	out := string(InjectBase(in, "/vault"))
	if !strings.Contains(out, `href="/vault/app"`) {
		t.Fatalf("got %q", out)
	}
	outRoot := string(InjectBase(in, ""))
	if !strings.Contains(outRoot, `href="/app"`) {
		t.Fatalf("root got %q", outRoot)
	}
}

func TestStripBasePath(t *testing.T) {
	var got string
	h := StripBasePath("/vault", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Path
	}))
	req := httptest.NewRequest(http.MethodGet, "/vault/api/me", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || got != "/api/me" {
		t.Fatalf("code=%d path=%q", rr.Code, got)
	}
	req2 := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusNotFound {
		t.Fatalf("want 404 for unprefixed, got %d", rr2.Code)
	}
}

func TestHelpBaseRewrite(t *testing.T) {
	raw := []byte(`<head><link href="/styles.css" /><a href="/app">x</a><script src="/help/index.js"></script></head>`)
	out := string(HelpBaseRewrite(raw, "/vault"))
	if !strings.Contains(out, `href="/vault/app"`) || !strings.Contains(out, `src="/vault/help/index.js"`) {
		t.Fatalf("got %q", out)
	}
	if !strings.Contains(out, `window.__TV_BASE__="/vault"`) {
		t.Fatal("missing tv base inject")
	}
}

func TestManifestScope(t *testing.T) {
	body := ManifestJSONForTest("/vault")
	if !strings.Contains(string(body), `"/vault/app"`) || !strings.Contains(string(body), `"/vault/"`) {
		t.Fatalf("manifest: %s", body)
	}
}

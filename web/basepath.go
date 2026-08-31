package web

import (
	"net/http"
	"strings"
)

// NormalizeBasePath returns a URL path prefix without trailing slash (e.g. "/vault").
// Empty input means root deployment.
func NormalizeBasePath(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" || s == "/" {
		return ""
	}
	if !strings.HasPrefix(s, "/") {
		s = "/" + s
	}
	return strings.TrimSuffix(s, "/")
}

// StripBasePath removes the configured prefix before routing (reverse-proxy subpath).
func StripBasePath(base string, next http.Handler) http.Handler {
	base = NormalizeBasePath(base)
	if base == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == base {
			r2 := cloneWithPath(r, "/")
			next.ServeHTTP(w, r2)
			return
		}
		if strings.HasPrefix(p, base+"/") {
			r2 := cloneWithPath(r, strings.TrimPrefix(p, base))
			if r2.URL.Path == "" {
				r2.URL.Path = "/"
			}
			next.ServeHTTP(w, r2)
			return
		}
		http.NotFound(w, r)
	})
}

// DynamicStripBasePath resolves the prefix per request (admin/env/proxy headers).
func DynamicStripBasePath(baseFn func(*http.Request) string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		StripBasePath(baseFn(r), next).ServeHTTP(w, r)
	})
}

func cloneWithPath(r *http.Request, path string) *http.Request {
	r2 := r.Clone(r.Context())
	r2.URL.Path = path
	return r2
}

// InjectBase replaces __TV_BASE__ placeholders in HTML (empty base → root paths).
func InjectBase(html []byte, base string) []byte {
	base = NormalizeBasePath(base)
	return []byte(strings.ReplaceAll(string(html), "__TV_BASE__", base))
}

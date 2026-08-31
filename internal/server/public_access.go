package server

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/teamvault/teamvault/internal/instcfg"
	"github.com/teamvault/teamvault/internal/store"
	"github.com/teamvault/teamvault/web"
)

func envBasePathOverride() string {
	raw := strings.TrimSpace(os.Getenv("TEAMVAULT_BASE_PATH"))
	if raw == "" || raw == "/" {
		return ""
	}
	return web.NormalizeBasePath(raw)
}

func envTrustForwardedOverride() (bool, bool) {
	raw := strings.TrimSpace(os.Getenv("TEAMVAULT_TRUST_FORWARDED"))
	if raw == "" {
		return false, false
	}
	return trustForwardedValue(raw), true
}

func (a *API) resolveBasePath(r *http.Request) string {
	if bp := envBasePathOverride(); bp != "" {
		return bp
	}
	pa := a.bundle().PublicAccess
	if bp := web.NormalizeBasePath(pa.BasePath); bp != "" {
		return bp
	}
	if pa.UseForwardedPrefix && a.trustForwarded(r) {
		if p := strings.TrimSpace(r.Header.Get("X-Forwarded-Prefix")); p != "" {
			return web.NormalizeBasePath(p)
		}
	}
	return ""
}

func (a *API) trustForwarded(r *http.Request) bool {
	if v, ok := envTrustForwardedOverride(); ok {
		return v
	}
	if pa := a.bundle().PublicAccess.TrustForwarded; pa != nil {
		return *pa
	}
	return false
}

func (a *API) requestHost(r *http.Request) string {
	host := r.Host
	if a.trustForwarded(r) {
		if fh := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); fh != "" {
			host = strings.TrimSpace(strings.Split(fh, ",")[0])
		}
	}
	return host
}

func (a *API) requestSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if !a.trustForwarded(r) {
		return false
	}
	proto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	return proto == "https"
}

func (a *API) effectivePublicURL(r *http.Request) string {
	if u := strings.TrimSpace(a.bundle().PublicAccess.PublicURL); u != "" {
		return strings.TrimSuffix(u, "/")
	}
	scheme := "http"
	if a.requestSecure(r) {
		scheme = "https"
	}
	return scheme + "://" + a.requestHost(r) + a.resolveBasePath(r)
}

func normalizePublicURLInput(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", errInvalidPublicURL
	}
	u.Fragment = ""
	u.RawQuery = ""
	u.Path = strings.TrimSuffix(u.Path, "/")
	if u.Path == "/" {
		u.Path = ""
	}
	out := strings.TrimSuffix(u.String(), "/")
	return out, nil
}

var errInvalidPublicURL = &publicAccessError{"public_url must be an absolute URL (scheme + host), e.g. https://vault.example.com/vault"}

type publicAccessError struct{ msg string }

func (e *publicAccessError) Error() string { return e.msg }

func (a *API) publicAccessView(r *http.Request) map[string]any {
	envBP := envBasePathOverride() != ""
	envTF, envTFSet := envTrustForwardedOverride()
	effective := a.bundle().PublicAccess
	return map[string]any{
		"base_path":              a.resolveBasePath(r),
		"public_url":             a.effectivePublicURL(r),
		"trust_forwarded":        a.trustForwarded(r),
		"use_forwarded_prefix":   effective.UseForwardedPrefix,
		"configured_base_path":   web.NormalizeBasePath(effective.BasePath),
		"configured_public_url":  strings.TrimSpace(effective.PublicURL),
		"configured_trust_fwd":   effective.TrustForwarded,
		"env_overrides": map[string]bool{
			"base_path":       envBP,
			"trust_forwarded": envTFSet,
		},
		"env_trust_forwarded": envTF,
	}
}

func (a *API) registerPublicAccess(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/public/config", a.handlePublicConfig)
	mux.HandleFunc("GET /api/admin/public-access", a.requireAuth(a.requirePlatformAdmin(a.handleGetPublicAccess)))
	mux.HandleFunc("PUT /api/admin/public-access", a.requireAuth(a.requirePlatformAdmin(a.handlePutPublicAccess)))
}

func (a *API) handlePublicConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.publicAccessView(r))
}

func (a *API) handleGetPublicAccess(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.publicAccessView(r))
}

func (a *API) handlePutPublicAccess(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body instcfg.PublicAccess
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	pubURL, err := normalizePublicURLInput(body.PublicURL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	body.BasePath = web.NormalizeBasePath(body.BasePath)
	body.PublicURL = pubURL
	b := a.bundle()
	b.PublicAccess = body
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.public_access.update", ResourceType: "config", ResourceID: "public_access",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, a.publicAccessView(r))
}

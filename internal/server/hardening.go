package server

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/teamvault/teamvault/internal/auth/session"
	"github.com/teamvault/teamvault/internal/auth/totp"
)

// requestSecure reports whether the client connection should be treated as HTTPS
// (direct TLS or reverse-proxy X-Forwarded-Proto).
func requestSecure(r *http.Request, trustForwarded bool) bool {
	if r.TLS != nil {
		return true
	}
	if !trustForwarded {
		return false
	}
	proto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	return proto == "https"
}

func trustForwarded() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("TEAMVAULT_TRUST_FORWARDED")))
	return trustForwardedValue(v)
}

func trustForwardedValue(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// TrustForwardedEnabled reports whether forwarded headers are trusted (for startup warnings).
func TrustForwardedEnabled() bool {
	return trustForwarded()
}

func (a *API) cookiePath(r *http.Request) string {
	if bp := a.resolveBasePath(r); bp != "" {
		return bp
	}
	return "/"
}

func (a *API) setSessionCookie(w http.ResponseWriter, r *http.Request, sess session.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     "tv_session",
		Value:    sess.ID,
		Path:     a.cookiePath(r),
		HttpOnly: true,
		Secure:   a.requestSecure(r),
		SameSite: http.SameSiteLaxMode,
		Expires:  sess.ExpiresAt,
	})
}

func (a *API) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: "tv_session", Value: "", Path: a.cookiePath(r), MaxAge: -1,
		HttpOnly: true, Secure: a.requestSecure(r), SameSite: http.SameSiteLaxMode,
	})
}

func (a *API) sealTOTP(plain string) ([]byte, error) {
	return totp.SealWith(a.App.ConfigStore, plain)
}

func (a *API) openTOTP(enc []byte) (string, error) {
	return totp.OpenWith(a.App.ConfigStore, enc)
}

// withSecurity wraps the mux: security headers + Origin check for cookie-auth mutating requests.
func (a *API) withSecurity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if a.requestSecure(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		if isMutating(r.Method) && strings.HasPrefix(r.URL.Path, "/api/") {
			if !a.originOK(r) {
				writeErr(w, http.StatusForbidden, "origin check failed")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func (a *API) originOK(r *http.Request) bool {
	if ah := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(ah), "bearer ") {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		if _, err := r.Cookie("tv_session"); err != nil {
			return true // no cookie session (e.g. unauthenticated) — other checks apply
		}
		ref := r.Header.Get("Referer")
		if ref == "" {
			return false // cookie + mutating without Origin/Referer
		}
		return a.sameHost(r, ref)
	}
	return a.sameHost(r, origin)
}

func (a *API) sameHost(r *http.Request, raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	return strings.EqualFold(u.Host, a.requestHost(r))
}

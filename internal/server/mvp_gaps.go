package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/teamvault/teamvault/internal/auth/ldapauth"
	"github.com/teamvault/teamvault/internal/auth/password"
	"github.com/teamvault/teamvault/internal/instcfg"
	"github.com/teamvault/teamvault/internal/mailer"
	"github.com/teamvault/teamvault/internal/store"
)

func (a *API) registerMVPGaps(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/ldap/connections", a.requireAuth(a.requireAdmin(a.handleListLDAPConns)))
	mux.HandleFunc("POST /api/admin/ldap/connections", a.requireAuth(a.requireAdmin(a.handlePutLDAPConn)))
	mux.HandleFunc("DELETE /api/admin/ldap/connections/{id}", a.requireAuth(a.requireAdmin(a.handleDeleteLDAPConn)))
	mux.HandleFunc("POST /api/admin/ldap/sync", a.requireAuth(a.requireAdmin(a.handleLDAPSync)))
	mux.HandleFunc("GET /api/admin/mail/templates", a.requireAuth(a.requireAdmin(a.handleGetMailTemplates)))
	mux.HandleFunc("PUT /api/admin/mail/templates", a.requireAuth(a.requireAdmin(a.handlePutMailTemplates)))
	mux.HandleFunc("POST /api/admin/users/{id}/password", a.requireAuth(a.requireAdmin(a.handleResetPassword)))
	mux.HandleFunc("POST /api/admin/users/{id}/roles", a.requireAuth(a.requireAdmin(a.handleSetRoles)))
	mux.HandleFunc("GET /api/policy/client", a.requireAuth(a.handleClientPolicy))
}

func (a *API) handleClientPolicy(w http.ResponseWriter, r *http.Request) {
	p := a.bundle().Policy
	writeJSON(w, http.StatusOK, map[string]any{
		"session_hours":        p.SessionHours,
		"unlock_idle_minutes":  p.UnlockIdleMinutes,
		"totp_required":        p.TOTPRequired,
		"escrow_shamir_k":      p.EscrowShamirK,
		"escrow_shamir_n":      p.EscrowShamirN,
	})
}

func (a *API) handleListLDAPConns(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	b := a.bundle()
	out := []instcfg.LDAPConnection{}
	for _, c := range b.LDAPConnections {
		if c.TenantID == string(sess.TenantID) || hasRole(sess.Roles, "platform_admin") {
			out = append(out, instcfg.RedactLDAPConn(c))
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handlePutLDAPConn(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body instcfg.LDAPConnection
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.TenantID == "" {
		body.TenantID = string(sess.TenantID)
	}
	if !hasRole(sess.Roles, "platform_admin") && body.TenantID != string(sess.TenantID) {
		writeErr(w, http.StatusForbidden, "tenant mismatch")
		return
	}
	b := a.bundle()
	if body.ID == "" {
		body.ID = newID("ldap")
	}
	if body.BindPassword == "***" || body.BindPassword == "" {
		for _, existing := range b.LDAPConnections {
			if existing.ID == body.ID {
				body.BindPassword = existing.BindPassword
				break
			}
		}
	}
	found := false
	for i := range b.LDAPConnections {
		if b.LDAPConnections[i].ID == body.ID {
			b.LDAPConnections[i] = body
			found = true
			break
		}
	}
	if !found {
		b.LDAPConnections = append(b.LDAPConnections, body)
	}
	// Keep legacy field in sync for primary tenant convenience.
	if body.TenantID == string(sess.TenantID) {
		b.LDAP = body.Config
	}
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, instcfg.RedactLDAPConn(body))
}

func (a *API) handleDeleteLDAPConn(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	b := a.bundle()
	next := b.LDAPConnections[:0]
	for _, c := range b.LDAPConnections {
		if c.ID != id {
			next = append(next, c)
		}
	}
	b.LDAPConnections = next
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *API) handleLDAPSync(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	cfg := a.ldapConfigFor(sess.TenantID)
	if !cfg.Enabled {
		writeErr(w, http.StatusBadRequest, "ldap disabled")
		return
	}
	users, err := a.App.Vault.ListUsers(r.Context(), sess.TenantID, store.UserQuery{Limit: 5000})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	disabled := 0
	checked := 0
	for _, u := range users {
		if u.AuthBackend != "ldap" || u.Status == "disabled" {
			continue
		}
		checked++
		ok, err := ldapauth.UserExists(cfg, u.Username)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "ldap sync error: "+err.Error())
			return
		}
		if ok {
			continue
		}
		u.Status = "disabled"
		if err := a.App.Vault.UpsertUser(r.Context(), u); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		disabled++
		if !a.appendAuditStrict(w, r, store.AuditEvent{
			TenantID: sess.TenantID, ActorID: string(sess.UserID),
			Action: "admin.ldap.sync_disable", ResourceType: "user", ResourceID: string(u.ID),
		}) {
			return
		}
		a.maybeMailDisabled(u, sess.TenantID)
	}
	b := a.bundle()
	now := time.Now().UTC()
	b.LastLDAPSyncAt = &now
	_ = a.saveBundle(b)
	writeJSON(w, http.StatusOK, map[string]any{
		"checked": checked, "disabled": disabled, "note": "rotation of secrets remains client-side after revoke (Prinzip 7)",
	})
}

func (a *API) handleGetMailTemplates(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.bundle().MailTemplates)
}

func (a *API) handlePutMailTemplates(w http.ResponseWriter, r *http.Request) {
	var t instcfg.MailTemplates
	if err := readJSON(r, &t); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	b := a.bundle()
	b.MailTemplates = t
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil || len(body.Password) < 12 {
		writeErr(w, http.StatusBadRequest, "password min 12 chars")
		return
	}
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, store.UserID(r.PathValue("id")))
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if u.AuthBackend != "local" {
		writeErr(w, http.StatusBadRequest, "only local users")
		return
	}
	hash, err := password.Hash(body.Password, password.Default)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u.LocalPasswordHash = hash
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) handleSetRoles(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Roles []string `json:"roles"`
	}
	if err := readJSON(r, &body); err != nil || len(body.Roles) == 0 {
		writeErr(w, http.StatusBadRequest, "roles required")
		return
	}
	for _, role := range body.Roles {
		switch role {
		case "member", "tenant_admin", "platform_admin":
		default:
			writeErr(w, http.StatusBadRequest, "invalid role")
			return
		}
		if role == "platform_admin" && !hasRole(sess.Roles, "platform_admin") {
			writeErr(w, http.StatusForbidden, "cannot grant platform_admin")
			return
		}
	}
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, store.UserID(r.PathValue("id")))
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	raw, _ := json.Marshal(body.Roles)
	u.RolesJSON = string(raw)
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"roles": body.Roles})
}

func (a *API) maybeMailInvite(u store.UserRecord, tenant store.TenantID) {
	b := a.bundle()
	if !b.Mail.Enabled || u.Email == "" {
		return
	}
	ten, _ := a.App.Vault.GetTenant(context.Background(), tenant)
	slug := string(tenant)
	if ten != nil {
		slug = ten.Slug
	}
	_ = mailer.Send(b.Mail, u.Email,
		mailer.Render(b.MailTemplates.InviteSubject, u.Username, slug),
		mailer.Render(b.MailTemplates.InviteBody, u.Username, slug),
	)
}

func (a *API) maybeMailDisabled(u store.UserRecord, tenant store.TenantID) {
	b := a.bundle()
	if !b.Mail.Enabled || u.Email == "" {
		return
	}
	ten, _ := a.App.Vault.GetTenant(context.Background(), tenant)
	slug := string(tenant)
	if ten != nil {
		slug = ten.Slug
	}
	_ = mailer.Send(b.Mail, u.Email,
		mailer.Render(b.MailTemplates.DisabledSubject, u.Username, slug),
		mailer.Render(b.MailTemplates.DisabledBody, u.Username, slug),
	)
}

func (a *API) ldapConfigFor(tenant store.TenantID) ldapauth.Config {
	return a.bundle().LDAPForTenant(string(tenant))
}

// --- login rate limit (in-memory; Prinzip: no secrets in logs) ---

type rateLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{hits: map[string][]time.Time{}}
}

func (rl *rateLimiter) allow(key string, max int, window time.Duration) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cut := now.Add(-window)
	arr := rl.hits[key]
	n := arr[:0]
	for _, t := range arr {
		if t.After(cut) {
			n = append(n, t)
		}
	}
	if len(n) >= max {
		rl.hits[key] = n
		return false
	}
	rl.hits[key] = append(n, now)
	return true
}

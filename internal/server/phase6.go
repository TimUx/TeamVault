package server

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/smtp"
	"path/filepath"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/auth/ldapauth"
	"github.com/teamvault/teamvault/internal/auth/session"
	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/configstore"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/instcfg"
	"github.com/teamvault/teamvault/internal/store"
	"github.com/teamvault/teamvault/internal/tlsutil"
)

func (a *API) registerPhase6(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/overview", a.requireAuth(a.requirePlatformAdmin(a.handleAdminOverview)))
	mux.HandleFunc("GET /api/admin/ldap", a.requireAuth(a.requireAdmin(a.handleGetLDAP)))
	mux.HandleFunc("PUT /api/admin/ldap", a.requireAuth(a.requireAdmin(a.handlePutLDAP)))
	mux.HandleFunc("POST /api/admin/ldap/test", a.requireAuth(a.requireAdmin(a.handleTestLDAP)))
	mux.HandleFunc("GET /api/admin/ldap/users", a.requireAuth(a.requireAdmin(a.handleLDAPSearchUsers)))
	mux.HandleFunc("POST /api/admin/ldap/users/import", a.requireAuth(a.requireAdmin(a.handleLDAPImportUsers)))
	mux.HandleFunc("GET /api/admin/trust", a.requireAuth(a.requirePlatformAdmin(a.handleGetTrust)))
	mux.HandleFunc("PUT /api/admin/trust", a.requireAuth(a.requirePlatformAdmin(a.handlePutTrust)))
	mux.HandleFunc("GET /api/admin/mail", a.requireAuth(a.requirePlatformAdmin(a.handleGetMail)))
	mux.HandleFunc("PUT /api/admin/mail", a.requireAuth(a.requirePlatformAdmin(a.handlePutMail)))
	mux.HandleFunc("POST /api/admin/mail/test", a.requireAuth(a.requirePlatformAdmin(a.handleTestMail)))
	mux.HandleFunc("GET /api/admin/crypto", a.requireAuth(a.requirePlatformAdmin(a.handleGetCrypto)))
	mux.HandleFunc("PUT /api/admin/crypto", a.requireAuth(a.requirePlatformAdmin(a.handlePutCrypto)))
	mux.HandleFunc("GET /api/admin/policy", a.requireAuth(a.requirePlatformAdmin(a.handleGetPolicy)))
	mux.HandleFunc("PUT /api/admin/policy", a.requireAuth(a.requirePlatformAdmin(a.handlePutPolicy)))
	mux.HandleFunc("GET /api/admin/tenants", a.requireAuth(a.requirePlatformAdmin(a.handleListTenants)))
	mux.HandleFunc("POST /api/admin/tenants", a.requireAuth(a.requirePlatformAdmin(a.handleCreateTenant)))
	mux.HandleFunc("POST /api/admin/tenants/{id}/disable", a.requireAuth(a.requirePlatformAdmin(a.handleDisableTenant)))
	mux.HandleFunc("GET /api/admin/audit", a.requireAuth(a.requireAdminOrAuditor(a.handleListAudit)))
	mux.HandleFunc("GET /api/admin/api-keys", a.requireAuth(a.requirePlatformAdmin(a.handleListAPIKeys)))
	mux.HandleFunc("POST /api/admin/api-keys", a.requireAuth(a.requirePlatformAdmin(a.handleCreateAPIKey)))
	mux.HandleFunc("POST /api/admin/api-keys/{id}/revoke", a.requireAuth(a.requirePlatformAdmin(a.handleRevokeAPIKey)))
	mux.HandleFunc("GET /api/admin/storage", a.requireAuth(a.requirePlatformAdmin(a.handleGetStorage)))
	mux.HandleFunc("POST /api/admin/storage/migrate", a.requireAuth(a.requirePlatformAdmin(a.handleMigrateStorage)))
	mux.HandleFunc("GET /api/admin/backup", a.requireAuth(a.requirePlatformAdmin(a.handleBackupExport)))
	mux.HandleFunc("POST /api/admin/backup/restore", a.requireAuth(a.requirePlatformAdmin(a.handleBackupRestore)))
	mux.HandleFunc("GET /api/admin/tenant/settings", a.requireAuth(a.requireAdmin(a.handleGetTenantSettings)))
	mux.HandleFunc("GET /api/vault/escrow-pubkey", a.requireAuth(a.handleEscrowPubKeyGet))
}

func (a *API) requirePlatformAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, _ := a.sessionFrom(r)
		if !hasRole(sess.Roles, "platform_admin") {
			writeErr(w, http.StatusForbidden, "platform_admin required")
			return
		}
		next(w, r)
	}
}

func (a *API) bundle() instcfg.Bundle {
	return instcfg.Load(a.App.Config)
}

func (a *API) saveBundle(b instcfg.Bundle) error {
	return instcfg.Save(a.App.Config, a.App.ConfigStore, b)
}

func (a *API) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	h, err := a.App.Vault.Health(r.Context())
	b := a.bundle()
	tenants, _ := a.App.Vault.ListTenants(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"initialized":  a.App.Config.Initialized,
		"storage":      a.App.Config.Storage,
		"vault_ok":     err == nil && h.OK,
		"vault_detail": h.Detail,
		"ldap_enabled": b.LDAP.Enabled,
		"ldap_host":    b.LDAP.Host,
		"mail_enabled": b.Mail.Enabled,
		"tenant_count": len(tenants),
		"policy":       b.Policy,
		"argon2":       b.Argon2,
	})
}

func (a *API) handleGetLDAP(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	b := a.bundle()
	if hasRole(sess.Roles, "platform_admin") {
		writeJSON(w, http.StatusOK, instcfg.RedactLDAP(b.LDAP))
		return
	}
	cfg := b.WithTrust(b.LDAPForTenant(string(sess.TenantID)))
	writeJSON(w, http.StatusOK, instcfg.RedactLDAP(cfg))
}

func (a *API) handlePutLDAP(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var cfg ldapauth.Config
	if err := readJSON(r, &cfg); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if hasRole(sess.Roles, "platform_admin") {
		a.putGlobalLDAP(w, r, sess, cfg)
		return
	}
	a.putTenantLDAP(w, r, sess, cfg)
}

func (a *API) putGlobalLDAP(w http.ResponseWriter, r *http.Request, sess session.Session, cfg ldapauth.Config) {
	b := a.bundle()
	if cfg.BindPassword == "***" || cfg.BindPassword == "" {
		cfg.BindPassword = b.LDAP.BindPassword
	}
	cfg.CACertPEM = ""
	if err := ldapauth.ValidateTLS(cfg); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	b.LDAP = cfg
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.ldap.update", ResourceType: "config", ResourceID: "ldap",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, instcfg.RedactLDAP(cfg))
}

func (a *API) putTenantLDAP(w http.ResponseWriter, r *http.Request, sess session.Session, cfg ldapauth.Config) {
	b := a.bundle()
	tid := string(sess.TenantID)
	var connID, existingPwd string
	for _, c := range b.LDAPConnections {
		if c.TenantID == tid {
			connID = c.ID
			existingPwd = c.BindPassword
			break
		}
	}
	if cfg.BindPassword == "***" || cfg.BindPassword == "" {
		if existingPwd != "" {
			cfg.BindPassword = existingPwd
		}
	}
	cfg.CACertPEM = ""
	if err := ldapauth.ValidateTLS(cfg); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if connID == "" {
		connID = newID("ldap")
	}
	conn := instcfg.LDAPConnection{
		ID:       connID,
		TenantID: tid,
		Name:     "default",
		Config:   cfg,
	}
	found := false
	for i := range b.LDAPConnections {
		if b.LDAPConnections[i].ID == connID {
			b.LDAPConnections[i] = conn
			found = true
			break
		}
	}
	if !found {
		b.LDAPConnections = append(b.LDAPConnections, conn)
	}
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.ldap.update", ResourceType: "config", ResourceID: "ldap",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, instcfg.RedactLDAP(cfg))
}

func (a *API) handleGetTrust(w http.ResponseWriter, r *http.Request) {
	pem := strings.TrimSpace(a.bundle().CACertPEM)
	writeJSON(w, http.StatusOK, map[string]any{
		"ca_cert_pem": pem,
		"present":     pem != "",
		"cert_count":  tlsutil.CertCount(pem),
	})
}

func (a *API) handlePutTrust(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		CACertPEM string `json:"ca_cert_pem"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := tlsutil.ValidatePEM(body.CACertPEM); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	b := a.bundle()
	b.CACertPEM = strings.TrimSpace(body.CACertPEM)
	b.LDAP.CACertPEM = ""
	for i := range b.LDAPConnections {
		b.LDAPConnections[i].CACertPEM = ""
	}
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.trust.update", ResourceType: "config", ResourceID: "ca",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ca_cert_pem": b.CACertPEM,
		"present":     b.CACertPEM != "",
		"cert_count":  tlsutil.CertCount(b.CACertPEM),
	})
}

func (a *API) handleTestLDAP(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	stored := a.ldapConfigFor(sess.TenantID)
	cfg := stored
	var override ldapauth.Config
	if err := readJSON(r, &override); err == nil && strings.TrimSpace(override.Host) != "" {
		if ldapTargetChanged(override, stored) && (override.BindPassword == "" || override.BindPassword == "***") {
			writeErr(w, http.StatusBadRequest, "bind password required when testing a different LDAP host")
			return
		}
		if override.BindPassword == "***" || override.BindPassword == "" {
			override.BindPassword = stored.BindPassword
		}
		if strings.TrimSpace(override.BindDN) == "" {
			override.BindDN = stored.BindDN
		}
		cfg = override
	}
	cfg = a.bundle().WithTrust(cfg)
	if err := ldapauth.ValidateTLS(cfg); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := ldapauth.TestServiceBind(cfg); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func ldapTargetChanged(override, stored ldapauth.Config) bool {
	if !strings.EqualFold(strings.TrimSpace(override.Host), strings.TrimSpace(stored.Host)) {
		return true
	}
	if override.Port != 0 && stored.Port != 0 && override.Port != stored.Port {
		return true
	}
	if strings.TrimSpace(override.BindDN) != "" &&
		!strings.EqualFold(strings.TrimSpace(override.BindDN), strings.TrimSpace(stored.BindDN)) {
		return true
	}
	return false
}

func (a *API) handleGetMail(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, instcfg.RedactMail(a.bundle().Mail))
}

func (a *API) handlePutMail(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var cfg instcfg.MailConfig
	if err := readJSON(r, &cfg); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	b := a.bundle()
	if cfg.Password == "***" || cfg.Password == "" {
		cfg.Password = b.Mail.Password
	}
	b.Mail = cfg
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.mail.update", ResourceType: "config", ResourceID: "mail",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, instcfg.RedactMail(cfg))
}

func (a *API) handleTestMail(w http.ResponseWriter, r *http.Request) {
	cfg := a.bundle().Mail
	if cfg.Host == "" {
		writeErr(w, http.StatusBadRequest, "mail host not configured")
		return
	}
	port := cfg.Port
	if port == 0 {
		port = 587
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "smtp dial: "+err.Error())
		return
	}
	_ = conn.Close()
	// Optional STARTTLS probe when credentials present (no message body with secrets).
	if cfg.Username != "" && cfg.Password != "" && cfg.Password != "***" {
		var auth smtp.Auth
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		if cfg.UseTLS {
			tlsCfg, err := tlsutil.ClientConfig(cfg.Host, a.bundle().CACertPEM, false)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			c, err := smtp.Dial(addr)
			if err == nil {
				_ = c.StartTLS(tlsCfg)
				_ = c.Auth(auth)
				_ = c.Quit()
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "note": "tcp reachable"})
}

func (a *API) handleGetCrypto(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.bundle().Argon2)
}

func (a *API) handlePutCrypto(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var p cryptocore.Argon2Params
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if p.Memory < 8192 || p.Time < 1 || p.KeyLen != 32 {
		writeErr(w, http.StatusBadRequest, "invalid argon2 params (min memory 8192, key_len 32)")
		return
	}
	b := a.bundle()
	b.Argon2 = p
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.crypto.update", ResourceType: "config", ResourceID: "argon2",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.bundle().Policy)
}

func (a *API) handlePutPolicy(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var p instcfg.Policy
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if p.SessionHours <= 0 {
		p.SessionHours = 8
	}
	if p.UnlockIdleMinutes <= 0 {
		p.UnlockIdleMinutes = 15
	}
	if p.EscrowShamirK < 2 {
		p.EscrowShamirK = 3
	}
	if p.EscrowShamirN < p.EscrowShamirK {
		p.EscrowShamirN = 5
	}
	b := a.bundle()
	b.Policy = p
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.Sessions.SetTTL(time.Duration(p.SessionHours) * time.Hour)
	a.Sessions.SetIdle(time.Duration(p.UnlockIdleMinutes) * time.Minute)
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.policy.update", ResourceType: "config", ResourceID: "policy",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) handleListTenants(w http.ResponseWriter, r *http.Request) {
	list, err := a.App.Vault.ListTenants(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type row struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Slug         string `json:"slug"`
		Status       string `json:"status"`
		RecoveryMode string `json:"recovery_mode"`
	}
	out := make([]row, 0, len(list))
	for _, t := range list {
		out = append(out, row{ID: string(t.ID), Name: t.Name, Slug: t.Slug, Status: t.Status, RecoveryMode: t.RecoveryMode})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleCreateTenant(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Name         string `json:"name"`
		Slug         string `json:"slug"`
		RecoveryMode string `json:"recovery_mode"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Slug) == "" {
		writeErr(w, http.StatusBadRequest, "name and slug required")
		return
	}
	if body.RecoveryMode == "" {
		body.RecoveryMode = "user_kit"
	}
	t := store.Tenant{
		ID: store.TenantID(newID("ten")), Name: body.Name, Slug: strings.ToLower(body.Slug),
		RecoveryMode: body.RecoveryMode, EscrowAllowed: body.RecoveryMode == "admin_escrow", Status: "active",
	}
	if err := a.App.Vault.PutTenant(r.Context(), t); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.tenant.create", ResourceType: "tenant", ResourceID: string(t.ID),
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": string(t.ID), "slug": t.Slug})
}

func (a *API) handleDisableTenant(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.TenantID(r.PathValue("id"))
	t, err := a.App.Vault.GetTenant(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "tenant not found")
		return
	}
	t.Status = "disabled"
	if err := a.App.Vault.PutTenant(r.Context(), *t); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.Sessions.DeleteByTenant(id)
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.tenant.disable", ResourceType: "tenant", ResourceID: string(id),
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (a *API) handleGetTenantSettings(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	t, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "tenant not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": t.ID, "name": t.Name, "slug": t.Slug, "status": t.Status,
		"recovery_mode": t.RecoveryMode, "escrow_allowed": t.EscrowAllowed,
		"has_escrow_pubkey": len(t.EscrowPublicKey) > 0,
	})
}

func (a *API) handleListAudit(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	limit, offset := parseLimitOffset(r, 100, 0)
	q := store.AuditQuery{
		ActionContains: r.URL.Query().Get("action"),
		ActorID:        r.URL.Query().Get("actor"),
		Limit:          limit + offset,
	}
	events, err := a.App.Vault.ListAudit(r.Context(), sess.TenantID, q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type row struct {
		ID           string    `json:"id"`
		ActorID      string    `json:"actor_id"`
		Action       string    `json:"action"`
		ResourceType string    `json:"resource_type"`
		ResourceID   string    `json:"resource_id"`
		CreatedAt    time.Time `json:"created_at"`
	}
	total := len(events)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := events[offset:end]
	out := make([]row, 0, len(page))
	for _, e := range page {
		out = append(out, row{e.ID, e.ActorID, e.Action, e.ResourceType, e.ResourceID, e.CreatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "limit": limit, "offset": offset})
}

func (a *API) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	b := a.bundle()
	type row struct {
		ID             string     `json:"id"`
		Name           string     `json:"name"`
		Scopes         []string   `json:"scopes"`
		LegacyNoScopes bool       `json:"legacy_no_scopes"`
		CreatedAt      time.Time  `json:"created_at"`
		ExpiresAt      *time.Time `json:"expires_at,omitempty"`
		Revoked        bool       `json:"revoked"`
	}
	out := make([]row, 0, len(b.APIKeys))
	for _, k := range b.APIKeys {
		out = append(out, row{k.ID, k.Name, k.Scopes, len(k.Scopes) == 0, k.CreatedAt, k.ExpiresAt, k.Revoked})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name required")
		return
	}
	scopes, err := normalizeAPIKeyScopes(body.Scopes)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	plain, rec, err := instcfg.NewAPIKey(body.Name, scopes, string(sess.UserID), string(sess.TenantID))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	b := a.bundle()
	b.APIKeys = append(b.APIKeys, rec)
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.apikey.create", ResourceType: "api_key", ResourceID: rec.ID,
	}) {
		return
	}
	// Klartext nur einmal — nie in Logs.
	writeJSON(w, http.StatusOK, map[string]any{
		"id": rec.ID, "name": rec.Name, "token": plain, "note": "store token now; not shown again",
	})
}

func (a *API) handleRevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := r.PathValue("id")
	b := a.bundle()
	found := false
	for i := range b.APIKeys {
		if b.APIKeys[i].ID == id {
			b.APIKeys[i].Revoked = true
			found = true
			break
		}
	}
	if !found {
		writeErr(w, http.StatusNotFound, "api key not found")
		return
	}
	if err := a.saveBundle(b); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.apikey.revoke", ResourceType: "api_key", ResourceID: id,
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (a *API) handleGetStorage(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.App.Config.Storage)
}

func (a *API) handleMigrateStorage(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Backend string `json:"backend"`
		DSN     string `json:"dsn"`
		Confirm string `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Confirm != "MIGRATE" {
		writeErr(w, http.StatusBadRequest, `confirm must be exactly "MIGRATE"`)
		return
	}
	switch body.Backend {
	case "sqlite", "json", "jsonfile":
	default:
		writeErr(w, http.StatusBadRequest, "backend must be sqlite or json")
		return
	}
	if strings.TrimSpace(body.DSN) == "" {
		if body.Backend == "sqlite" {
			body.DSN = filepath.Join(a.App.DataDir, "vault-migrated.db")
		} else {
			body.DSN = filepath.Join(a.App.DataDir, "vault-migrated.json")
		}
	}
	// Export all ciphertext + metadata (never plaintext vault secrets).
	snap, err := a.App.Vault.ExportSnapshot(r.Context(), nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "export: "+err.Error())
		return
	}
	target := configstore.StorageConfig{Backend: body.Backend, DSN: body.DSN}
	dst, err := bootstrap.OpenVault(target)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "open target: "+err.Error())
		return
	}
	if err := dst.ImportSnapshot(r.Context(), *snap, store.ImportReplace); err != nil {
		_ = dst.Close()
		writeErr(w, http.StatusInternalServerError, "import: "+err.Error())
		return
	}
	_ = dst.Close()
	a.App.Config.Storage = target
	if err := a.App.ConfigStore.Save(a.App.Config); err != nil {
		writeErr(w, http.StatusInternalServerError, "save config: "+err.Error())
		return
	}
	if err := a.App.ReopenVault(); err != nil {
		writeErr(w, http.StatusInternalServerError, "reopen: "+err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.storage.migrate", ResourceType: "storage", ResourceID: body.Backend,
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "storage": target})
}

func (a *API) handleEscrowPubKeyGet(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	ten, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil || len(ten.EscrowPublicKey) != 32 {
		writeErr(w, http.StatusNotFound, "escrow public key not configured")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"public_key_b64": base64.StdEncoding.EncodeToString(ten.EscrowPublicKey),
	})
}

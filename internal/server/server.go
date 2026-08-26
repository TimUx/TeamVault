package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/auth/ldapauth"
	"github.com/teamvault/teamvault/internal/auth/passkey"
	"github.com/teamvault/teamvault/internal/auth/password"
	"github.com/teamvault/teamvault/internal/auth/session"
	"github.com/teamvault/teamvault/internal/auth/totp"
	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/instcfg"
	"github.com/teamvault/teamvault/internal/setup"
	"github.com/teamvault/teamvault/internal/store"
	"github.com/teamvault/teamvault/web"
)

type API struct {
	App      *bootstrap.Result
	Sessions *session.Store
	Passkeys *passkey.Manager
	loginRL  *rateLimiter
}

func New(app *bootstrap.Result) *API {
	ttl := 8 * time.Hour
	sessPath := filepath.Join(app.DataDir, "sessions.json")
	api := &API{
		App: app, Sessions: session.NewPersistent(sessPath, ttl),
		Passkeys: passkey.NewManager(), loginRL: newRateLimiter(),
	}
	go api.ldapSyncLoop()
	return api
}

func (a *API) ldapSyncLoop() {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		b := a.bundle()
		if b.Policy.LDAPSyncHours <= 0 {
			continue
		}
		if b.LastLDAPSyncAt != nil && time.Since(*b.LastLDAPSyncAt) < time.Duration(b.Policy.LDAPSyncHours)*time.Hour {
			continue
		}
		tenants, err := a.App.Vault.ListTenants(context.Background())
		if err != nil {
			continue
		}
		for _, t := range tenants {
			cfg := a.ldapConfigFor(t.ID)
			if !cfg.Enabled {
				continue
			}
			users, err := a.App.Vault.ListUsers(context.Background(), t.ID, store.UserQuery{Limit: 5000})
			if err != nil {
				continue
			}
			for _, u := range users {
				if u.AuthBackend != "ldap" || u.Status == "disabled" {
					continue
				}
				ok, err := ldapauth.UserExists(cfg, u.Username)
				if err != nil || ok {
					continue
				}
				u.Status = "disabled"
				_ = a.App.Vault.UpsertUser(context.Background(), u)
				a.maybeMailDisabled(u, t.ID)
			}
		}
		now := time.Now().UTC()
		b.LastLDAPSyncAt = &now
		_ = a.saveBundle(b)
	}
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.handleHealth)
	mux.HandleFunc("GET /openapi.yaml", a.handleOpenAPI)
	mux.HandleFunc("GET /api/openapi.yaml", a.handleOpenAPI)
	mux.HandleFunc("GET /api/setup/status", a.handleSetupStatus)
	mux.HandleFunc("POST /api/setup/commit", a.handleSetupCommit)
	mux.HandleFunc("POST /api/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", a.handleLogout)
	mux.HandleFunc("GET /api/me", a.handleMe)
	mux.HandleFunc("GET /api/vault/status", a.requireAuth(a.handleVaultStatus))
	mux.HandleFunc("GET /api/vault/crypto-params", a.requireAuth(a.handleCryptoParams))
	mux.HandleFunc("POST /api/vault/onboard", a.requireAuth(a.handleVaultOnboard))
	mux.HandleFunc("GET /api/vault/keys", a.requireAuth(a.handleVaultKeys))
	mux.HandleFunc("POST /api/totp/setup", a.requireAuth(a.handleTOTPSetup))
	mux.HandleFunc("POST /api/totp/enable", a.requireAuth(a.handleTOTPEnable))
	mux.HandleFunc("POST /api/admin/tenant/recovery", a.requireAuth(a.handleAdminRecovery))
	mux.HandleFunc("POST /api/admin/tenant/escrow-pubkey", a.requireAuth(a.handleEscrowPubKey))
	a.registerPhase5(mux)
	a.registerPhase6(mux)
	a.registerMVPGaps(mux)
	a.registerPhase7(mux)
	a.registerPhase12(mux)
	mux.Handle("GET /{$}", web.Handler())
	mux.Handle("GET /setup", web.Handler())
	mux.Handle("GET /login", web.Handler())
	mux.Handle("GET /onboard", web.Handler())
	mux.Handle("GET /app", web.Handler())
	mux.Handle("GET /vendor/", web.Handler())
	mux.Handle("GET /styles.css", web.Handler())
	mux.Handle("GET /app.js", web.Handler())
	mux.Handle("GET /import-parse.js", web.Handler())
	mux.Handle("GET /cryptocore.js", web.Handler())
	mux.Handle("GET /index.html", web.Handler())
	return a.withSecurity(mux)
}

func (a *API) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := a.sessionFrom(r); !ok {
			writeErr(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		next(w, r)
	}
}

func (a *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	h, err := a.App.Vault.Health(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": err == nil && h.OK, "initialized": a.App.Config.Initialized, "storage": a.App.Config.Storage.Backend,
	})
}

func (a *API) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"initialized": a.App.Config.Initialized, "storage": a.App.Config.Storage, "data_dir": a.App.DataDir,
	})
}

func (a *API) handleSetupCommit(w http.ResponseWriter, r *http.Request) {
	if a.App.Config.Initialized {
		writeErr(w, http.StatusConflict, "already initialized")
		return
	}
	var req setup.CommitRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := setup.Commit(r.Context(), a.App, req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

type loginReq struct {
	TenantSlug string `json:"tenant_slug"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	TOTPCode   string `json:"totp_code"`
}

func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !a.App.Config.Initialized {
		writeErr(w, http.StatusConflict, "setup not completed")
		return
	}
	ip := r.RemoteAddr
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	if !a.loginRL.allow("login:"+ip, 20, time.Minute) {
		writeErr(w, http.StatusTooManyRequests, "too many login attempts")
		return
	}
	var req loginReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tenant, err := a.App.Vault.GetTenantBySlug(r.Context(), req.TenantSlug)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if tenant.Status == "disabled" {
		writeErr(w, http.StatusForbidden, "tenant disabled")
		return
	}
	user, err := a.App.Vault.GetUserByUsername(r.Context(), tenant.ID, req.Username)
	ldapCfg := a.ldapConfigFor(tenant.ID)
	if err != nil {
		// JIT LDAP provision on first successful bind
		if !ldapCfg.Enabled {
			writeErr(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		dn, lerr := ldapauth.Authenticate(ldapCfg, req.Username, req.Password)
		if lerr != nil {
			writeErr(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		uid := store.UserID("usr_" + strings.ReplaceAll(base64.RawURLEncoding.EncodeToString([]byte(dn))[:12], "/", "_"))
		roles, _ := json.Marshal([]string{"member"})
		u := store.UserRecord{
			ID: uid, TenantID: tenant.ID, Username: req.Username, DisplayName: req.Username,
			AuthBackend: "ldap", Status: "pending_onboarding", RolesJSON: string(roles),
		}
		if err := a.App.Vault.UpsertUser(r.Context(), u); err != nil {
			writeErr(w, http.StatusInternalServerError, "provision failed")
			return
		}
		user = &u
	} else {
		switch user.AuthBackend {
		case "local":
			ok, verr := password.Verify(req.Password, user.LocalPasswordHash)
			if verr != nil || !ok {
				writeErr(w, http.StatusUnauthorized, "invalid credentials")
				return
			}
		case "ldap":
			if !ldapCfg.Enabled {
				writeErr(w, http.StatusUnauthorized, "ldap unavailable")
				return
			}
			if _, lerr := ldapauth.Authenticate(ldapCfg, req.Username, req.Password); lerr != nil {
				writeErr(w, http.StatusUnauthorized, "invalid credentials")
				return
			}
		default:
			writeErr(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
	}
	if user.Status == "disabled" {
		writeErr(w, http.StatusForbidden, "account disabled")
		return
	}
	if user.TotpEnabled {
		sec, oerr := a.openTOTP(user.TotpSecretEnc)
		if oerr != nil || !totp.Validate(req.TOTPCode, sec) {
			writeErr(w, http.StatusUnauthorized, "invalid totp")
			return
		}
	}
	var roles []string
	_ = json.Unmarshal([]byte(user.RolesJSON), &roles)
	sess := a.Sessions.Create(user.ID, tenant.ID, user.Username, roles)
	a.setSessionCookie(w, r, sess)
	writeJSON(w, http.StatusOK, map[string]any{
		"username": user.Username, "tenant_id": tenant.ID, "roles": roles, "status": user.Status,
		"needs_vault_onboard": user.OnboardedAt == nil, "totp_enabled": user.TotpEnabled,
		"needs_totp_setup": a.bundle().Policy.TOTPRequired && !user.TotpEnabled,
		"recovery_mode":    tenant.RecoveryMode,
	})
}

func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("tv_session"); err == nil {
		a.Sessions.Delete(c.Value)
	}
	a.clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.sessionFrom(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "user missing")
		return
	}
	ten, _ := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id": sess.UserID, "tenant_id": sess.TenantID, "username": sess.Username, "roles": sess.Roles,
		"needs_vault_onboard": u.OnboardedAt == nil, "totp_enabled": u.TotpEnabled,
		"passkey_count": func() int {
			creds, _ := a.App.Vault.ListWebAuthnCredentials(r.Context(), sess.TenantID, sess.UserID)
			return len(creds)
		}(),
		"recovery_mode": func() string {
			if ten != nil {
				return ten.RecoveryMode
			}
			return ""
		}(),
	})
}

func (a *API) handleVaultStatus(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ten, _ := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	writeJSON(w, http.StatusOK, map[string]any{
		"onboarded": u.OnboardedAt != nil, "recovery_mode": ten.RecoveryMode,
		"escrow_allowed": ten.EscrowAllowed, "has_escrow_pubkey": len(ten.EscrowPublicKey) > 0,
	})
}

func (a *API) handleCryptoParams(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.bundle().Argon2)
}

type onboardReq struct {
	PublicKey                   string `json:"public_key_b64"`
	EncryptedPrivateKey         string `json:"encrypted_private_key_b64"`
	EncryptedPrivateKeyNonce    string `json:"encrypted_private_key_nonce_b64"`
	Salt                        string `json:"salt_b64"`
	EncryptedPrivateKeyRecovery string `json:"encrypted_private_key_recovery_b64"`
	RecoveryNonce               string `json:"recovery_nonce_b64"`
	RecoverySalt                string `json:"recovery_salt_b64"`
	EscrowEnvelope              string `json:"escrow_envelope_b64"`
	Argon2                      cryptocore.Argon2Params `json:"argon2"`
}

func (a *API) handleVaultOnboard(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if u.OnboardedAt != nil {
		writeErr(w, http.StatusConflict, "already onboarded")
		return
	}
	ten, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var req onboardReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	pub, err := b64(req.PublicKey)
	if err != nil || len(pub) != 32 {
		writeErr(w, http.StatusBadRequest, "invalid public key")
		return
	}
	ct, err := b64(req.EncryptedPrivateKey)
	nonce, err2 := b64(req.EncryptedPrivateKeyNonce)
	salt, err3 := b64(req.Salt)
	if err != nil || err2 != nil || err3 != nil || len(nonce) != 24 || len(salt) != 16 {
		writeErr(w, http.StatusBadRequest, "invalid sealed private key")
		return
	}
	// Pack sealed key as salt|nonce|ciphertext for storage simplicity
	sealed := append(append(append([]byte{}, salt...), nonce...), ct...)
	u.PublicKey = pub
	u.EncryptedPrivateKey = sealed

	switch ten.RecoveryMode {
	case "user_kit", "":
		rct, e1 := b64(req.EncryptedPrivateKeyRecovery)
		rn, e2 := b64(req.RecoveryNonce)
		rs, e3 := b64(req.RecoverySalt)
		if e1 != nil || e2 != nil || e3 != nil {
			writeErr(w, http.StatusBadRequest, "recovery kit material required")
			return
		}
		u.EncryptedPrivateKeyRecovery = append(append(append([]byte{}, rs...), rn...), rct...)
	case "admin_escrow":
		if len(ten.EscrowPublicKey) == 0 {
			writeErr(w, http.StatusConflict, "tenant escrow public key not configured")
			return
		}
		env, e := b64(req.EscrowEnvelope)
		if e != nil || len(env) == 0 {
			writeErr(w, http.StatusBadRequest, "escrow envelope required")
			return
		}
		u.EscrowEnvelope = env
	}
	now := time.Now().UTC()
	u.OnboardedAt = &now
	u.Status = "active"
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: "aud_onboard_" + string(u.ID), TenantID: u.TenantID, ActorID: string(u.ID),
		Action: "vault.onboard", ResourceType: "user", ResourceID: string(u.ID), CreatedAt: now,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) handleVaultKeys(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
	if err != nil || u.OnboardedAt == nil {
		writeErr(w, http.StatusForbidden, "vault onboarding required")
		return
	}
	if len(u.EncryptedPrivateKey) < 16+24 {
		writeErr(w, http.StatusInternalServerError, "corrupt key blob")
		return
	}
	salt, nonce, ct := u.EncryptedPrivateKey[:16], u.EncryptedPrivateKey[16:40], u.EncryptedPrivateKey[40:]
	writeJSON(w, http.StatusOK, map[string]any{
		"public_key_b64":                 base64.StdEncoding.EncodeToString(u.PublicKey),
		"salt_b64":                       base64.StdEncoding.EncodeToString(salt),
		"encrypted_private_key_nonce_b64": base64.StdEncoding.EncodeToString(nonce),
		"encrypted_private_key_b64":      base64.StdEncoding.EncodeToString(ct),
	})
}

func (a *API) handleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	key, err := totp.GenerateSecret("teamVault", u.Username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	sealed, err := a.sealTOTP(key.Secret())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u.TotpSecretEnc = sealed
	u.TotpEnabled = false
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"secret": key.Secret(), "otpauth_url": key.URL(),
	})
}

func (a *API) handleTOTPEnable(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Code string `json:"code"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	sec, err := a.openTOTP(u.TotpSecretEnc)
	if err != nil || !totp.Validate(body.Code, sec) {
		writeErr(w, http.StatusBadRequest, "invalid totp code")
		return
	}
	u.TotpEnabled = true
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "enabled"})
}

func (a *API) handleAdminRecovery(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	if !hasRole(sess.Roles, "tenant_admin") && !hasRole(sess.Roles, "platform_admin") {
		writeErr(w, http.StatusForbidden, "admin required")
		return
	}
	var body struct {
		RecoveryMode  string `json:"recovery_mode"`
		EscrowAllowed bool   `json:"escrow_allowed"`
		Confirm       string `json:"confirm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ten, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.RecoveryMode != "user_kit" && body.RecoveryMode != "admin_escrow" {
		writeErr(w, http.StatusBadRequest, "invalid mode")
		return
	}
	modeChanged := ten.RecoveryMode != body.RecoveryMode
	if modeChanged && body.Confirm != "REONBOARD" {
		writeErr(w, http.StatusBadRequest, "confirm must be REONBOARD when changing recovery mode")
		return
	}
	ten.RecoveryMode = body.RecoveryMode
	ten.EscrowAllowed = body.EscrowAllowed
	if body.RecoveryMode == "admin_escrow" {
		ten.EscrowAllowed = true
	}
	if err := a.App.Vault.PutTenant(r.Context(), *ten); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	reOnboarded := 0
	if modeChanged {
		users, _ := a.App.Vault.ListUsers(r.Context(), ten.ID, store.UserQuery{Limit: 10000})
		for _, u := range users {
			u.OnboardedAt = nil
			u.Status = "pending_onboarding"
			u.PublicKey = nil
			u.EncryptedPrivateKey = nil
			u.EncryptedPrivateKeyRecovery = nil
			u.EscrowEnvelope = nil
			_ = a.App.Vault.UpsertUser(r.Context(), u)
			reOnboarded++
		}
		_ = a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
			ID: newID("aud"), TenantID: ten.ID, ActorID: string(sess.UserID),
			Action: "tenant.recovery_mode_change", ResourceType: "tenant", ResourceID: string(ten.ID),
			CreatedAt: time.Now().UTC(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "re_onboarded": reOnboarded})
}

func (a *API) handleEscrowPubKey(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	if !hasRole(sess.Roles, "tenant_admin") && !hasRole(sess.Roles, "platform_admin") {
		writeErr(w, http.StatusForbidden, "admin required")
		return
	}
	var body struct {
		PublicKeyB64 string `json:"public_key_b64"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	pub, err := b64(body.PublicKeyB64)
	if err != nil || len(pub) != 32 {
		writeErr(w, http.StatusBadRequest, "invalid public key")
		return
	}
	ten, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ten.EscrowPublicKey = pub
	if err := a.App.Vault.PutTenant(r.Context(), *ten); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) ldapConfig() ldapauth.Config {
	return a.bundle().LDAP
}

func (a *API) sessionFrom(r *http.Request) (session.Session, bool) {
	if c, err := r.Cookie("tv_session"); err == nil {
		if sess, ok := a.Sessions.Get(c.Value); ok {
			return sess, true
		}
	}
	// CLI / Extension machine auth: Bearer tvk_… (hashed in sealed config).
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if sess, ok := a.sessionFromAPIKey(r, token); ok {
			return sess, true
		}
	}
	return session.Session{}, false
}

func (a *API) sessionFromAPIKey(r *http.Request, token string) (session.Session, bool) {
	if !strings.HasPrefix(token, "tvk_") {
		return session.Session{}, false
	}
	want := instcfg.HashAPIKey(token)
	b := a.bundle()
	var rec *instcfg.APIKeyRecord
	for i := range b.APIKeys {
		k := &b.APIKeys[i]
		if k.Revoked || k.HashHex != want {
			continue
		}
		if k.ExpiresAt != nil && time.Now().UTC().After(*k.ExpiresAt) {
			continue
		}
		rec = k
		break
	}
	if rec == nil || rec.UserID == "" || rec.TenantID == "" {
		return session.Session{}, false
	}
	u, err := a.App.Vault.GetUser(r.Context(), store.TenantID(rec.TenantID), store.UserID(rec.UserID))
	if err != nil || u.Status == "disabled" {
		return session.Session{}, false
	}
	var roles []string
	_ = json.Unmarshal([]byte(u.RolesJSON), &roles)
	return session.Session{
		ID: "apk:" + rec.ID, UserID: u.ID, TenantID: u.TenantID, Username: u.Username, Roles: roles,
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
	}, true
}

func hasRole(roles []string, want string) bool {
	for _, r := range roles {
		if r == want {
			return true
		}
	}
	return false
}

func b64(s string) ([]byte, error) {
	if s == "" {
		return nil, errors.New("empty")
	}
	return base64.StdEncoding.DecodeString(s)
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dst)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
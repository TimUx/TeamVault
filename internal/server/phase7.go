package server

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/auth/passkey"
	"github.com/teamvault/teamvault/internal/auth/totp"
	"github.com/teamvault/teamvault/internal/store"
)

func (a *API) registerPhase7(mux *http.ServeMux) {
	if a.Passkeys == nil {
		a.Passkeys = passkey.NewManager()
	}
	mux.HandleFunc("POST /api/webauthn/register/begin", a.requireAuth(a.handleWARegisterBegin))
	mux.HandleFunc("POST /api/webauthn/register/finish", a.requireAuth(a.handleWARegisterFinish))
	mux.HandleFunc("GET /api/webauthn/credentials", a.requireAuth(a.handleWAList))
	mux.HandleFunc("DELETE /api/webauthn/credentials/{id}", a.requireAuth(a.handleWADelete))
	mux.HandleFunc("POST /api/webauthn/login/begin", a.handleWALoginBegin)
	mux.HandleFunc("POST /api/webauthn/login/finish", a.handleWALoginFinish)
}

func (a *API) rpFromRequest(r *http.Request) (rpID string, origins []string) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Same-origin fetch fallback.
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		origin = scheme + "://" + r.Host
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return "localhost", []string{"http://localhost:8080", "http://127.0.0.1:8080"}
	}
	rpID = u.Hostname()
	origins = []string{origin}
	// Allow both localhost forms in dev.
	if rpID == "localhost" || rpID == "127.0.0.1" {
		origins = []string{"http://localhost:8080", "http://127.0.0.1:8080", origin}
		rpID = "localhost"
	}
	return rpID, origins
}

func (a *API) loadPasskeyUser(r *http.Request, tenant store.TenantID, userID store.UserID) (*passkey.User, error) {
	u, err := a.App.Vault.GetUser(r.Context(), tenant, userID)
	if err != nil {
		return nil, err
	}
	creds, err := a.App.Vault.ListWebAuthnCredentials(r.Context(), tenant, userID)
	if err != nil {
		return nil, err
	}
	return &passkey.User{Record: *u, Credentials: passkey.ToWebAuthnCreds(creds)}, nil
}

func (a *API) handleWARegisterBegin(w http.ResponseWriter, r *http.Request) {
	// Passkeys are login-only — never vault unlock.
	sess, _ := a.sessionFrom(r)
	user, err := a.loadPasskeyUser(r, sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	rpID, origins := a.rpFromRequest(r)
	creation, key, err := a.Passkeys.BeginRegistration(rpID, origins, user)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"publicKey":     creation.Response,
		"challenge_key": key,
		"note":          "passkey is login-only; vault still requires master password",
	})
}

func (a *API) handleWARegisterFinish(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		ChallengeKey string          `json:"challenge_key"`
		Name         string          `json:"name"`
		Credential   json.RawMessage `json:"credential"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	user, err := a.loadPasskeyUser(r, sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	rpID, origins := a.rpFromRequest(r)
	cred, err := a.Passkeys.FinishRegistration(rpID, origins, user, body.ChallengeKey, body.Credential)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Passkey"
	}
	rec := passkey.FromWebAuthnCred(sess.TenantID, sess.UserID, newID("wak"), name, cred)
	if err := a.App.Vault.PutWebAuthnCredential(r.Context(), rec); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "webauthn.register", ResourceType: "webauthn", ResourceID: rec.ID, CreatedAt: time.Now().UTC(),
	})
	writeJSON(w, http.StatusOK, map[string]string{"id": rec.ID, "name": rec.Name})
}

func (a *API) handleWAList(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	creds, err := a.App.Vault.ListWebAuthnCredentials(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type row struct {
		ID        string    `json:"id"`
		Name      string    `json:"name"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := make([]row, 0, len(creds))
	for _, c := range creds {
		out = append(out, row{c.ID, c.Name, c.CreatedAt})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleWADelete(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := r.PathValue("id")
	if err := a.App.Vault.DeleteWebAuthnCredential(r.Context(), sess.TenantID, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *API) handleWALoginBegin(w http.ResponseWriter, r *http.Request) {
	if !a.App.Config.Initialized {
		writeErr(w, http.StatusConflict, "setup not completed")
		return
	}
	ip := r.RemoteAddr
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	if !a.loginRL.allow("wa:"+ip, 20, time.Minute) {
		writeErr(w, http.StatusTooManyRequests, "too many login attempts")
		return
	}
	var body struct {
		TenantSlug string `json:"tenant_slug"`
		Username   string `json:"username"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tenant, err := a.App.Vault.GetTenantBySlug(r.Context(), body.TenantSlug)
	if err != nil || tenant.Status == "disabled" {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	u, err := a.App.Vault.GetUserByUsername(r.Context(), tenant.ID, body.Username)
	if err != nil || u.Status == "disabled" {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	user, err := a.loadPasskeyUser(r, tenant.ID, u.ID)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	rpID, origins := a.rpFromRequest(r)
	assertion, key, err := a.Passkeys.BeginLogin(rpID, origins, user)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"publicKey": assertion.Response, "challenge_key": key,
	})
}

func (a *API) handleWALoginFinish(w http.ResponseWriter, r *http.Request) {
	if !a.App.Config.Initialized {
		writeErr(w, http.StatusConflict, "setup not completed")
		return
	}
	var body struct {
		TenantSlug   string          `json:"tenant_slug"`
		Username     string          `json:"username"`
		ChallengeKey string          `json:"challenge_key"`
		Credential   json.RawMessage `json:"credential"`
		TOTPCode     string          `json:"totp_code"`
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	r.Body.Close()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := json.Unmarshal(b, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tenant, err := a.App.Vault.GetTenantBySlug(r.Context(), body.TenantSlug)
	if err != nil || tenant.Status == "disabled" {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	u, err := a.App.Vault.GetUserByUsername(r.Context(), tenant.ID, body.Username)
	if err != nil || u.Status == "disabled" {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	user, err := a.loadPasskeyUser(r, tenant.ID, u.ID)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	rpID, origins := a.rpFromRequest(r)
	cred, err := a.Passkeys.FinishLogin(rpID, origins, user, body.ChallengeKey, body.Credential)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "passkey verification failed")
		return
	}
	// Update sign count if we can map credential.
	for _, stored := range user.Credentials {
		if string(stored.ID) == string(cred.ID) {
			break
		}
	}
	creds, _ := a.App.Vault.ListWebAuthnCredentials(r.Context(), tenant.ID, u.ID)
	for _, c := range creds {
		if string(c.CredentialID) == string(cred.ID) {
			_ = a.App.Vault.UpdateWebAuthnSignCount(r.Context(), tenant.ID, c.ID, cred.Authenticator.SignCount)
			break
		}
	}
	if u.TotpEnabled {
		sec, oerr := a.openTOTP(u.TotpSecretEnc)
		if oerr != nil || !totp.Validate(body.TOTPCode, sec) {
			writeErr(w, http.StatusUnauthorized, "invalid totp")
			return
		}
	}
	var roles []string
	_ = json.Unmarshal([]byte(u.RolesJSON), &roles)
	sess := a.Sessions.Create(u.ID, tenant.ID, u.Username, roles)
	a.setSessionCookie(w, r, sess)
	_ = a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: tenant.ID, ActorID: string(u.ID),
		Action: "webauthn.login", ResourceType: "user", ResourceID: string(u.ID), CreatedAt: time.Now().UTC(),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"username": u.Username, "tenant_id": tenant.ID, "roles": roles,
		"needs_vault_onboard": u.OnboardedAt == nil, "totp_enabled": u.TotpEnabled,
		"auth": "passkey",
		"note": "vault unlock still requires master password",
	})
}

package server

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/auth/password"
	"github.com/teamvault/teamvault/internal/store"
)

func (a *API) registerPhase5(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/users", a.requireAuth(a.requireAdmin(a.handleListUsers)))
	mux.HandleFunc("POST /api/admin/users", a.requireAuth(a.requireAdmin(a.handleCreateUser)))
	mux.HandleFunc("PUT /api/admin/users/{id}", a.requireAuth(a.requireAdmin(a.handleUpdateUser)))
	mux.HandleFunc("POST /api/admin/users/{id}/disable", a.requireAuth(a.requireAdmin(a.handleDisableUser)))
	mux.HandleFunc("GET /api/admin/users/{id}/accessible-secrets", a.requireAuth(a.requireAdmin(a.handleUserAccessibleSecrets)))
	mux.HandleFunc("GET /api/admin/groups", a.requireAuth(a.requireAdmin(a.handleListGroups)))
	mux.HandleFunc("POST /api/admin/groups", a.requireAuth(a.requireAdmin(a.handleCreateGroup)))
	mux.HandleFunc("PUT /api/admin/groups/{id}", a.requireAuth(a.requireAdmin(a.handleUpdateGroup)))
	mux.HandleFunc("DELETE /api/admin/groups/{id}", a.requireAuth(a.requireAdmin(a.handleDeleteGroup)))
	mux.HandleFunc("POST /api/admin/groups/{id}/members", a.requireAuth(a.requireAdmin(a.handleAddMember)))
	mux.HandleFunc("DELETE /api/admin/groups/{id}/members/{userId}", a.requireAuth(a.requireAdmin(a.handleRemoveMember)))
	mux.HandleFunc("GET /api/users/public-keys", a.requireAuth(a.handleListPublicKeys))
	mux.HandleFunc("GET /api/groups", a.requireAuth(a.requireOnboarded(a.handleMyGroups)))

	mux.HandleFunc("GET /api/secrets", a.requireAuth(a.requireOnboarded(a.handleListSecrets)))
	mux.HandleFunc("POST /api/secrets", a.requireAuth(a.requireOnboarded(a.handleCreateSecret)))
	mux.HandleFunc("GET /api/secrets/{id}", a.requireAuth(a.requireOnboarded(a.handleGetSecret)))
	mux.HandleFunc("PUT /api/secrets/{id}", a.requireAuth(a.requireOnboarded(a.handleUpdateSecret)))
	mux.HandleFunc("POST /api/secrets/{id}/share", a.requireAuth(a.requireOnboarded(a.handleShareSecret)))
	mux.HandleFunc("POST /api/secrets/{id}/rotate", a.requireAuth(a.requireOnboarded(a.handleRotateSecret)))
	mux.HandleFunc("DELETE /api/secrets/{id}", a.requireAuth(a.requireOnboarded(a.handleDeleteSecret)))
}

func (a *API) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, _ := a.sessionFrom(r)
		if !hasRole(sess.Roles, "tenant_admin") && !hasRole(sess.Roles, "platform_admin") {
			writeErr(w, http.StatusForbidden, "admin required")
			return
		}
		next(w, r)
	}
}

func (a *API) requireAdminOrAuditor(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, _ := a.sessionFrom(r)
		if hasRole(sess.Roles, "tenant_admin") || hasRole(sess.Roles, "platform_admin") || hasRole(sess.Roles, "auditor") {
			next(w, r)
			return
		}
		writeErr(w, http.StatusForbidden, "admin or auditor required")
	}
}

func (a *API) requireOnboarded(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, _ := a.sessionFrom(r)
		u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, sess.UserID)
		if err != nil || u.OnboardedAt == nil {
			writeErr(w, http.StatusForbidden, "vault onboarding required")
			return
		}
		next(w, r)
	}
}

func (a *API) handleListUsers(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	users, err := a.App.Vault.ListUsers(r.Context(), sess.TenantID, store.UserQuery{Limit: 1000})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type row struct {
		ID          string `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Email       string `json:"email"`
		AuthBackend string `json:"auth_backend"`
		Status      string `json:"status"`
		Onboarded   bool   `json:"onboarded"`
		Roles       string `json:"roles"`
	}
	out := make([]row, 0, len(users))
	for _, u := range users {
		out = append(out, row{
			ID: string(u.ID), Username: u.Username, DisplayName: u.DisplayName, Email: u.Email,
			AuthBackend: u.AuthBackend, Status: u.Status, Onboarded: u.OnboardedAt != nil, Roles: u.RolesJSON,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Email       string `json:"email"`
		Password    string `json:"password"`
		AuthBackend string `json:"auth_backend"` // local default
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(body.Username) == "" {
		writeErr(w, http.StatusBadRequest, "username required")
		return
	}
	backend := body.AuthBackend
	if backend == "" {
		backend = "local"
	}
	if backend != "local" && backend != "ldap" {
		writeErr(w, http.StatusBadRequest, "auth_backend must be local or ldap")
		return
	}
	var hash string
	if backend == "local" {
		if len(body.Password) < 12 {
			writeErr(w, http.StatusBadRequest, "password min 12 chars")
			return
		}
		var err error
		hash, err = password.Hash(body.Password, password.Default)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	roles, _ := json.Marshal([]string{"member"})
	u := store.UserRecord{
		ID: store.UserID(newID("usr")), TenantID: sess.TenantID,
		Username: strings.TrimSpace(body.Username), DisplayName: body.DisplayName, Email: body.Email,
		AuthBackend: backend, LocalPasswordHash: hash, Status: "pending_onboarding", RolesJSON: string(roles),
	}
	if err := a.App.Vault.UpsertUser(r.Context(), u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.maybeMailInvite(u, sess.TenantID)
	writeJSON(w, http.StatusOK, map[string]string{"id": string(u.ID)})
}

func (a *API) handleDisableUser(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.UserID(r.PathValue("id"))
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	u.Status = "disabled"
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.maybeMailDisabled(*u, sess.TenantID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (a *API) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.UserID(r.PathValue("id"))
	u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	var body struct {
		DisplayName string   `json:"display_name"`
		Email       string   `json:"email"`
		Password    string   `json:"password"`
		Roles       []string `json:"roles"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u.DisplayName = strings.TrimSpace(body.DisplayName)
	u.Email = strings.TrimSpace(body.Email)
	if body.Password != "" {
		if u.AuthBackend != "local" {
			writeErr(w, http.StatusBadRequest, "only local users can reset password here")
			return
		}
		if len(body.Password) < 12 {
			writeErr(w, http.StatusBadRequest, "password min 12 chars")
			return
		}
		hash, err := password.Hash(body.Password, password.Default)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		u.LocalPasswordHash = hash
	}
	if body.Roles != nil {
		if len(body.Roles) == 0 {
			writeErr(w, http.StatusBadRequest, "roles required")
			return
		}
		for _, role := range body.Roles {
			switch role {
			case "member", "tenant_admin", "platform_admin", "auditor":
			default:
				writeErr(w, http.StatusBadRequest, "invalid role")
				return
			}
			if role == "platform_admin" && !hasRole(sess.Roles, "platform_admin") {
				writeErr(w, http.StatusForbidden, "cannot grant platform_admin")
				return
			}
		}
		raw, _ := json.Marshal(body.Roles)
		u.RolesJSON = string(raw)
	}
	if err := a.App.Vault.UpsertUser(r.Context(), *u); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleUserAccessibleSecrets lists secret IDs where the user still has a key envelope (meta only).
// After disable, admins must rotate those secrets client-side (Zero-Knowledge — no auto-rotate).
func (a *API) handleUserAccessibleSecrets(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	uid := store.UserID(r.PathValue("id"))
	if _, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, uid); err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	metas, err := a.App.Vault.ListSecretMetas(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	allEnvs, err := a.App.Vault.ListKeyEnvelopesByTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	bySecret := make(map[store.SecretID][]store.KeyEnvelope)
	for i := range allEnvs {
		e := allEnvs[i]
		bySecret[e.SecretID] = append(bySecret[e.SecretID], e)
	}
	versions, err := a.App.Vault.ListSecretKeyVersions(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type row struct {
		ID         string `json:"id"`
		KeyVersion uint32 `json:"key_version"`
	}
	out := make([]row, 0)
	for _, m := range metas {
		for _, e := range bySecret[m.ID] {
			if e.UserID == uid {
				kv := versions[m.ID]
				if kv == 0 {
					kv = e.KeyVersion
				}
				out = append(out, row{ID: string(m.ID), KeyVersion: kv})
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleListGroups(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	groups, err := a.App.Vault.ListGroups(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type memberRow struct {
		UserID   string `json:"user_id"`
		Username string `json:"username"`
	}
	type g struct {
		ID          string      `json:"id"`
		Name        string      `json:"name"`
		Description string      `json:"description"`
		Members     []memberRow `json:"members"`
	}
	out := make([]g, 0, len(groups))
	for _, gr := range groups {
		mem, _ := a.App.Vault.ListGroupMembers(r.Context(), sess.TenantID, gr.ID)
		ms := make([]memberRow, 0, len(mem))
		for _, uid := range mem {
			row := memberRow{UserID: string(uid), Username: string(uid)}
			if u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, uid); err == nil {
				row.Username = u.Username
			}
			ms = append(ms, row)
		}
		out = append(out, g{ID: string(gr.ID), Name: gr.Name, Description: gr.Description, Members: ms})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleMyGroups returns groups the caller belongs to (id + name only) for share UI.
func (a *API) handleMyGroups(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	ids, err := a.App.Vault.ListUserGroups(r.Context(), sess.TenantID, sess.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	all, err := a.App.Vault.ListGroups(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	want := map[store.GroupID]bool{}
	for _, id := range ids {
		want[id] = true
	}
	type g struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	out := make([]g, 0, len(ids))
	for _, gr := range all {
		if want[gr.ID] {
			out = append(out, g{ID: string(gr.ID), Name: gr.Name})
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name required")
		return
	}
	g := store.Group{ID: store.GroupID(newID("grp")), TenantID: sess.TenantID, Name: body.Name, Description: body.Description}
	if err := a.App.Vault.PutGroup(r.Context(), g); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": string(g.ID)})
}

func (a *API) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	gid := store.GroupID(r.PathValue("id"))
	groups, err := a.App.Vault.ListGroups(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var g *store.Group
	for i := range groups {
		if groups[i].ID == gid {
			g = &groups[i]
			break
		}
	}
	if g == nil {
		writeErr(w, http.StatusNotFound, "group not found")
		return
	}
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeErr(w, http.StatusBadRequest, "name required")
		return
	}
	g.Name = strings.TrimSpace(body.Name)
	g.Description = strings.TrimSpace(body.Description)
	if err := a.App.Vault.PutGroup(r.Context(), *g); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": string(g.ID)})
}

func (a *API) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	gid := store.GroupID(r.PathValue("id"))
	if err := a.App.Vault.DeleteGroup(r.Context(), sess.TenantID, gid); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (a *API) handleAddMember(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var body struct {
		UserID string `json:"user_id"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	err := a.App.Vault.AddGroupMember(r.Context(), store.GroupMember{
		TenantID: sess.TenantID, GroupID: store.GroupID(r.PathValue("id")), UserID: store.UserID(body.UserID),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	err := a.App.Vault.RemoveGroupMember(r.Context(), sess.TenantID, store.GroupID(r.PathValue("id")), store.UserID(r.PathValue("userId")))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) handleListPublicKeys(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	users, err := a.App.Vault.ListUsers(r.Context(), sess.TenantID, store.UserQuery{Limit: 1000})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	type pk struct {
		UserID     string `json:"user_id"`
		Username   string `json:"username"`
		PublicKey  string `json:"public_key_b64"`
		Onboarded  bool   `json:"onboarded"`
	}
	var out []pk
	for _, u := range users {
		if u.OnboardedAt == nil || len(u.PublicKey) == 0 || u.Status == "disabled" {
			continue
		}
		out = append(out, pk{
			UserID: string(u.ID), Username: u.Username,
			PublicKey: base64.StdEncoding.EncodeToString(u.PublicKey), Onboarded: true,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type envelopeIn struct {
	UserID            string `json:"user_id"`
	KeyVersion        uint32 `json:"key_version"`
	WrappedDKB64      string `json:"wrapped_dk_b64"`
	EphemeralPubB64   string `json:"ephemeral_pub_b64"`
	NonceB64          string `json:"nonce_b64"`
}

type createSecretReq struct {
	TitleCiphertextB64 string       `json:"title_ciphertext_b64"`
	TitleNonceB64      string       `json:"title_nonce_b64"`
	CiphertextB64      string       `json:"ciphertext_b64"`
	NonceB64           string       `json:"nonce_b64"`
	KeyVersion         uint32       `json:"key_version"`
	CollectionID       string       `json:"collection_id"`
	Envelopes          []envelopeIn `json:"envelopes"`
}

func packEnvelope(e envelopeIn) ([]byte, error) {
	// packed: eph(32) | nonce(24) | ct
	eph, err := base64.StdEncoding.DecodeString(e.EphemeralPubB64)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(e.NonceB64)
	if err != nil {
		return nil, err
	}
	ct, err := base64.StdEncoding.DecodeString(e.WrappedDKB64)
	if err != nil {
		return nil, err
	}
	out := append(append(append([]byte{}, eph...), nonce...), ct...)
	return out, nil
}

func (a *API) handleCreateSecret(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	var req createSecretReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	titleCT, err := base64.StdEncoding.DecodeString(req.TitleCiphertextB64)
	titleN, err2 := base64.StdEncoding.DecodeString(req.TitleNonceB64)
	ct, err3 := base64.StdEncoding.DecodeString(req.CiphertextB64)
	nonce, err4 := base64.StdEncoding.DecodeString(req.NonceB64)
	if err != nil || err2 != nil || err3 != nil || err4 != nil {
		writeErr(w, http.StatusBadRequest, "invalid ciphertext")
		return
	}
	if req.KeyVersion == 0 {
		req.KeyVersion = 1
	}
	if len(req.Envelopes) == 0 {
		writeErr(w, http.StatusBadRequest, "envelopes required")
		return
	}
	id := store.SecretID(newID("sec"))
	meta := store.SecretMeta{
		ID: id, TenantID: sess.TenantID, CollectionID: req.CollectionID,
		TitleCiphertext: titleCT, TitleNonce: titleN, CreatedBy: sess.UserID,
	}
	envs := make([]store.KeyEnvelope, 0, len(req.Envelopes))
	for _, e := range req.Envelopes {
		packed, err := packEnvelope(e)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid envelope")
			return
		}
		kv := e.KeyVersion
		if kv == 0 {
			kv = req.KeyVersion
		}
		envs = append(envs, store.KeyEnvelope{
			SecretID: id, TenantID: sess.TenantID, UserID: store.UserID(e.UserID),
			KeyVersion: kv, WrappedDK: packed,
		})
	}
	if err := a.App.Vault.CreateSecret(r.Context(), meta, store.CiphertextBlob{
		Ciphertext: ct, Nonce: nonce, KeyVersion: req.KeyVersion, ContentType: "application/octet-stream",
	}, envs); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.create", ResourceType: "secret", ResourceID: string(id),
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "key_version": req.KeyVersion})
}

func (a *API) handleListSecrets(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	metas, err := a.App.Vault.ListSecretMetas(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	allEnvs, err := a.App.Vault.ListKeyEnvelopesByTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	envsBySecret := make(map[store.SecretID][]store.KeyEnvelope, len(metas))
	for i := range allEnvs {
		e := allEnvs[i]
		envsBySecret[e.SecretID] = append(envsBySecret[e.SecretID], e)
	}
	versions, err := a.App.Vault.ListSecretKeyVersions(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	limit, offset := parseLimitOffset(r, 200, 0)
	adminSeeAll := !a.bundle().Policy.AdminSecretsEnvelopeOnly
	type envOut struct {
		EphemeralPubB64 string `json:"ephemeral_pub_b64"`
		NonceB64        string `json:"nonce_b64"`
		WrappedDKB64    string `json:"wrapped_dk_b64"`
		KeyVersion      uint32 `json:"key_version"`
	}
	type item struct {
		ID                 string  `json:"id"`
		TitleCiphertextB64 string  `json:"title_ciphertext_b64"`
		TitleNonceB64      string  `json:"title_nonce_b64"`
		CreatedBy          string  `json:"created_by"`
		HasAccess          bool    `json:"has_access"`
		KeyVersion         uint32  `json:"key_version"`
		CollectionID       string  `json:"collection_id,omitempty"`
		Envelope           *envOut `json:"envelope,omitempty"`
	}
	var filtered []item
	for _, m := range metas {
		envs := envsBySecret[m.ID]
		access := false
		var mine *store.KeyEnvelope
		for i := range envs {
			if envs[i].UserID == sess.UserID {
				access = true
				mine = &envs[i]
				break
			}
		}
		if !access {
			if adminSeeAll && (hasRole(sess.Roles, "tenant_admin") || hasRole(sess.Roles, "platform_admin")) {
				// Admin inventory (title ciphertext only — no envelope in response).
			} else {
				continue
			}
		}
		kv := versions[m.ID]
		it := item{
			ID: string(m.ID), TitleCiphertextB64: base64.StdEncoding.EncodeToString(m.TitleCiphertext),
			TitleNonceB64: base64.StdEncoding.EncodeToString(m.TitleNonce), CreatedBy: string(m.CreatedBy),
			HasAccess: access, KeyVersion: kv, CollectionID: m.CollectionID,
		}
		if mine != nil && len(mine.WrappedDK) >= 32+24 {
			eph, nonce, ct := mine.WrappedDK[:32], mine.WrappedDK[32:56], mine.WrappedDK[56:]
			it.Envelope = &envOut{
				EphemeralPubB64: base64.StdEncoding.EncodeToString(eph),
				NonceB64:        base64.StdEncoding.EncodeToString(nonce),
				WrappedDKB64:    base64.StdEncoding.EncodeToString(ct),
				KeyVersion:      mine.KeyVersion,
			}
		}
		filtered = append(filtered, it)
	}
	total := len(filtered)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := filtered[offset:end]
	writeJSON(w, http.StatusOK, map[string]any{
		"items": page, "total": total, "limit": limit, "offset": offset,
	})
}

func (a *API) handleGetSecret(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	meta, err := a.App.Vault.GetSecretMeta(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	blob, err := a.App.Vault.GetSecretCiphertext(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "missing ciphertext")
		return
	}
	envs, _ := a.App.Vault.ListKeyEnvelopes(r.Context(), sess.TenantID, id)
	var mine *store.KeyEnvelope
	recipients := []string{}
	for i := range envs {
		recipients = append(recipients, string(envs[i].UserID))
		if envs[i].UserID == sess.UserID {
			mine = &envs[i]
		}
	}
	if mine == nil {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	if len(mine.WrappedDK) < 32+24 {
		writeErr(w, http.StatusInternalServerError, "corrupt envelope")
		return
	}
	eph, nonce, ct := mine.WrappedDK[:32], mine.WrappedDK[32:56], mine.WrappedDK[56:]
	writeJSON(w, http.StatusOK, map[string]any{
		"id": meta.ID,
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(meta.TitleCiphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(meta.TitleNonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(blob.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(blob.Nonce),
		"key_version":          blob.KeyVersion,
		"envelope": map[string]any{
			"ephemeral_pub_b64": base64.StdEncoding.EncodeToString(eph),
			"nonce_b64":         base64.StdEncoding.EncodeToString(nonce),
			"wrapped_dk_b64":    base64.StdEncoding.EncodeToString(ct),
			"key_version":       mine.KeyVersion,
		},
		"recipients": recipients,
	})
}

func (a *API) callerHasEnvelope(r *http.Request, tenant store.TenantID, secret store.SecretID, user store.UserID) bool {
	envs, err := a.App.Vault.ListKeyEnvelopes(r.Context(), tenant, secret)
	if err != nil {
		return false
	}
	for _, e := range envs {
		if e.UserID == user {
			return true
		}
	}
	return false
}

func (a *API) handleShareSecret(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	if !a.callerHasEnvelope(r, sess.TenantID, id, sess.UserID) {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	var body struct {
		Envelopes []envelopeIn `json:"envelopes"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	blob, err := a.App.Vault.GetSecretCiphertext(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "secret not found")
		return
	}
	for _, e := range body.Envelopes {
		if !a.recipientShareable(r, sess.TenantID, store.UserID(e.UserID)) {
			writeErr(w, http.StatusBadRequest, "recipient must be onboarded user in tenant")
			return
		}
		packed, err := packEnvelope(e)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid envelope")
			return
		}
		kv := e.KeyVersion
		if kv == 0 {
			kv = 1
		}
		if kv != blob.KeyVersion {
			writeErr(w, http.StatusBadRequest, "key_version must match current secret version")
			return
		}
		if err := a.App.Vault.PutKeyEnvelope(r.Context(), store.KeyEnvelope{
			SecretID: id, TenantID: sess.TenantID, UserID: store.UserID(e.UserID),
			KeyVersion: kv, WrappedDK: packed,
		}); err != nil {
			if errors.Is(err, store.ErrRevokedEnvelope) {
				writeErr(w, http.StatusConflict, "cannot revive revoked envelope")
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.share", ResourceType: "secret", ResourceID: string(id), CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) recipientShareable(r *http.Request, tenant store.TenantID, uid store.UserID) bool {
	u, err := a.App.Vault.GetUser(r.Context(), tenant, uid)
	if err != nil || u.OnboardedAt == nil || len(u.PublicKey) == 0 || u.Status == "disabled" {
		return false
	}
	return true
}

func (a *API) handleUpdateSecret(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	if !a.callerHasEnvelope(r, sess.TenantID, id, sess.UserID) {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	var req struct {
		TitleCiphertextB64 string `json:"title_ciphertext_b64"`
		TitleNonceB64      string `json:"title_nonce_b64"`
		CiphertextB64      string `json:"ciphertext_b64"`
		NonceB64           string `json:"nonce_b64"`
		KeyVersion         uint32 `json:"key_version"`
		CollectionID       string `json:"collection_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	oldBlob, err := a.App.Vault.GetSecretCiphertext(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "secret not found")
		return
	}
	if req.KeyVersion == 0 {
		req.KeyVersion = oldBlob.KeyVersion
	}
	if req.KeyVersion != oldBlob.KeyVersion {
		writeErr(w, http.StatusBadRequest, "key_version must match current secret version")
		return
	}
	titleCT, err := base64.StdEncoding.DecodeString(req.TitleCiphertextB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid title ciphertext")
		return
	}
	titleN, err := base64.StdEncoding.DecodeString(req.TitleNonceB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid title nonce")
		return
	}
	ct, err := base64.StdEncoding.DecodeString(req.CiphertextB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid ciphertext")
		return
	}
	nonce, err := base64.StdEncoding.DecodeString(req.NonceB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid nonce")
		return
	}
	meta, err := a.App.Vault.GetSecretMeta(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "meta missing")
		return
	}
	meta.TitleCiphertext, meta.TitleNonce = titleCT, titleN
	meta.CollectionID = req.CollectionID
	if err := a.App.Vault.PutSecretMeta(r.Context(), *meta); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.App.Vault.PutSecretCiphertext(r.Context(), sess.TenantID, id, store.CiphertextBlob{
		Ciphertext: ct, Nonce: nonce, KeyVersion: req.KeyVersion, ContentType: "application/octet-stream",
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.update", ResourceType: "secret", ResourceID: string(id), CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "key_version": req.KeyVersion})
}

func (a *API) handleRotateSecret(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	if !a.callerHasEnvelope(r, sess.TenantID, id, sess.UserID) {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	var req createSecretReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Envelopes) == 0 {
		writeErr(w, http.StatusBadRequest, "envelopes required")
		return
	}
	oldBlob, err := a.App.Vault.GetSecretCiphertext(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "secret not found")
		return
	}
	if req.KeyVersion <= oldBlob.KeyVersion {
		writeErr(w, http.StatusBadRequest, "key_version must increase")
		return
	}

	titleCT, err := base64.StdEncoding.DecodeString(req.TitleCiphertextB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid title ciphertext")
		return
	}
	titleN, err := base64.StdEncoding.DecodeString(req.TitleNonceB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid title nonce")
		return
	}
	ct, err := base64.StdEncoding.DecodeString(req.CiphertextB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid ciphertext")
		return
	}
	nonce, err := base64.StdEncoding.DecodeString(req.NonceB64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid nonce")
		return
	}
	meta, err := a.App.Vault.GetSecretMeta(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "meta missing")
		return
	}
	meta.TitleCiphertext, meta.TitleNonce = titleCT, titleN

	envs := make([]store.KeyEnvelope, 0, len(req.Envelopes))
	for _, e := range req.Envelopes {
		packed, err := packEnvelope(e)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid envelope")
			return
		}
		envs = append(envs, store.KeyEnvelope{
			SecretID: id, TenantID: sess.TenantID, UserID: store.UserID(e.UserID),
			KeyVersion: req.KeyVersion, WrappedDK: packed,
		})
	}

	if err := a.App.Vault.RotateSecret(r.Context(), sess.TenantID, id, oldBlob.KeyVersion, *meta, store.CiphertextBlob{
		Ciphertext: ct, Nonce: nonce, KeyVersion: req.KeyVersion,
	}, envs); err != nil {
		if errors.Is(err, store.ErrRevokedEnvelope) {
			writeErr(w, http.StatusConflict, "cannot revive revoked envelope")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.key_rotated", ResourceType: "secret", ResourceID: string(id), CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "key_version": req.KeyVersion})
}

func (a *API) handleDeleteSecret(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	if !a.callerHasEnvelope(r, sess.TenantID, id, sess.UserID) {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	if err := a.App.Vault.DeleteSecret(r.Context(), sess.TenantID, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.delete", ResourceType: "secret", ResourceID: string(id), CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

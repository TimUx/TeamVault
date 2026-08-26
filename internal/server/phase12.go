package server

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

func (a *API) registerPhase12(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crypto/presets", a.requireAuth(a.handleCryptoPresets))
	mux.HandleFunc("GET /api/admin/groups/{id}/members/public-keys", a.requireAuth(a.requireTenantAdminOrAuditor(a.handleGroupMemberPublicKeys)))
	mux.HandleFunc("POST /api/secrets/{id}/share-group", a.requireAuth(a.requireOnboarded(a.handleShareGroup)))
}

func parseLimitOffset(r *http.Request, defLimit, defOffset int) (limit, offset int) {
	limit, offset = defLimit, defOffset
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 500 {
		limit = 500
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

func (a *API) requireTenantAdminOrAuditor(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, ok := a.sessionFrom(r)
		if !ok {
			writeErr(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		if hasRole(sess.Roles, "tenant_admin") || hasRole(sess.Roles, "platform_admin") || hasRole(sess.Roles, "auditor") {
			next(w, r)
			return
		}
		writeErr(w, http.StatusForbidden, "admin or auditor required")
	}
}

func (a *API) handleCryptoPresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"presets": []map[string]any{
			{"id": "fast", "label": "Schnell", "time": 2, "memory_kib": 32768, "threads": 1, "key_len": 32},
			{"id": "recommended", "label": "Empfohlen", "time": 3, "memory_kib": 65536, "threads": 1, "key_len": 32},
			{"id": "strong", "label": "Stark", "time": 4, "memory_kib": 131072, "threads": 2, "key_len": 32},
		},
	})
}

func (a *API) handleGroupMemberPublicKeys(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	gid := store.GroupID(r.PathValue("id"))
	members, err := a.App.Vault.ListGroupMembers(r.Context(), sess.TenantID, gid)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	type pk struct {
		UserID    string `json:"user_id"`
		Username  string `json:"username"`
		PublicKey string `json:"public_key_b64"`
	}
	var out []pk
	for _, uid := range members {
		u, err := a.App.Vault.GetUser(r.Context(), sess.TenantID, uid)
		if err != nil || u.OnboardedAt == nil || len(u.PublicKey) == 0 || u.Status == "disabled" {
			continue
		}
		out = append(out, pk{
			UserID: string(u.ID), Username: u.Username,
			PublicKey: base64.StdEncoding.EncodeToString(u.PublicKey),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleShareGroup(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	if !a.callerHasEnvelope(r, sess.TenantID, id, sess.UserID) {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	var body struct {
		GroupID   string       `json:"group_id"`
		Envelopes []envelopeIn `json:"envelopes"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	members, err := a.App.Vault.ListGroupMembers(r.Context(), sess.TenantID, store.GroupID(body.GroupID))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	allowed := map[string]bool{}
	for _, m := range members {
		allowed[string(m)] = true
	}
	for _, e := range body.Envelopes {
		if !allowed[e.UserID] {
			writeErr(w, http.StatusBadRequest, "envelope user not in group")
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
		if err := a.App.Vault.PutKeyEnvelope(r.Context(), store.KeyEnvelope{
			SecretID: id, TenantID: sess.TenantID, UserID: store.UserID(e.UserID),
			KeyVersion: kv, WrappedDK: packed,
		}); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	meta, _ := json.Marshal(map[string]string{"group_id": body.GroupID})
	_ = a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.share_group", ResourceType: "secret", ResourceID: string(id),
		Metadata: meta, CreatedAt: time.Now().UTC(),
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "shared": len(body.Envelopes)})
}

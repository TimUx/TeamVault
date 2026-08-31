package server

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

func (a *API) registerPhase12(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/crypto/presets", a.requireAuth(a.handleCryptoPresets))
	mux.HandleFunc("GET /api/admin/groups/{id}/members/public-keys", a.requireAuth(a.requireTenantAdminOrAuditor(a.handleGroupMemberPublicKeys)))
	mux.HandleFunc("GET /api/groups/{id}/member-keys", a.requireAuth(a.requireOnboarded(a.handleGroupMemberKeysForShare)))
	mux.HandleFunc("GET /api/secrets/{id}/group-member-keys", a.requireAuth(a.requireOnboarded(a.handleSecretGroupMemberKeys)))
	mux.HandleFunc("GET /api/secrets/group-share-gaps", a.requireAuth(a.requireOnboarded(a.handleGroupShareGaps)))
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
	a.writeGroupMemberPublicKeys(w, r, sess.TenantID, store.GroupID(r.PathValue("id")))
}

func (a *API) handleGroupMemberKeysForShare(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	gid := store.GroupID(r.PathValue("id"))
	if isAdmin := hasRole(sess.Roles, "tenant_admin") || hasRole(sess.Roles, "platform_admin"); !isAdmin {
		memberOf, err := a.App.Vault.ListUserGroups(r.Context(), sess.TenantID, sess.UserID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		allowed := false
		for _, id := range memberOf {
			if id == gid {
				allowed = true
				break
			}
		}
		if !allowed {
			writeErr(w, http.StatusForbidden, "not a group member")
			return
		}
	}
	a.writeGroupMemberPublicKeys(w, r, sess.TenantID, gid)
}

// handleSecretGroupMemberKeys returns onboarded group member public keys for sharing.
// Requires an access envelope on the secret (not an admin role).
func (a *API) handleSecretGroupMemberKeys(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	id := store.SecretID(r.PathValue("id"))
	if !a.callerHasEnvelope(r, sess.TenantID, id, sess.UserID) {
		writeErr(w, http.StatusForbidden, "no access envelope")
		return
	}
	gid := strings.TrimSpace(r.URL.Query().Get("group_id"))
	if gid == "" {
		writeErr(w, http.StatusBadRequest, "group_id required")
		return
	}
	a.writeGroupMemberPublicKeys(w, r, sess.TenantID, store.GroupID(gid))
}

func (a *API) writeGroupMemberPublicKeys(w http.ResponseWriter, r *http.Request, tenant store.TenantID, gid store.GroupID) {
	members, err := a.App.Vault.ListGroupMembers(r.Context(), tenant, gid)
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
		u, err := a.App.Vault.GetUser(r.Context(), tenant, uid)
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

// handleGroupShareGaps lists secrets the caller can open that are shared with a group
// whose member still lacks an envelope. Client seals envelopes (zero-knowledge).
// Optional query: group_id, user_id.
func (a *API) handleGroupShareGaps(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	filterGroup := store.GroupID(strings.TrimSpace(r.URL.Query().Get("group_id")))
	filterUser := store.UserID(strings.TrimSpace(r.URL.Query().Get("user_id")))

	var shares []store.SecretGroupShare
	var err error
	if filterGroup != "" {
		shares, err = a.App.Vault.ListSecretGroupSharesByGroup(r.Context(), sess.TenantID, filterGroup)
	} else {
		shares, err = a.App.Vault.ListSecretGroupSharesByTenant(r.Context(), sess.TenantID)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(shares) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
		return
	}

	allEnvs, err := a.App.Vault.ListKeyEnvelopesByTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	envsBySecret := map[store.SecretID][]store.KeyEnvelope{}
	for i := range allEnvs {
		e := allEnvs[i]
		envsBySecret[e.SecretID] = append(envsBySecret[e.SecretID], e)
	}
	versions, err := a.App.Vault.ListSecretKeyVersions(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type envOut struct {
		EphemeralPubB64 string `json:"ephemeral_pub_b64"`
		NonceB64        string `json:"nonce_b64"`
		WrappedDKB64    string `json:"wrapped_dk_b64"`
		KeyVersion      uint32 `json:"key_version"`
	}
	type gap struct {
		SecretID       string  `json:"secret_id"`
		GroupID        string  `json:"group_id"`
		UserID         string  `json:"user_id"`
		Username       string  `json:"username"`
		PublicKeyB64   string  `json:"public_key_b64"`
		KeyVersion     uint32  `json:"key_version"`
		Envelope       *envOut `json:"envelope"`
	}

	membersCache := map[store.GroupID][]store.UserID{}
	userCache := map[store.UserID]*store.UserRecord{}
	var items []gap

	for _, sh := range shares {
		envs := envsBySecret[sh.SecretID]
		var mine *store.KeyEnvelope
		hasUser := map[store.UserID]bool{}
		for i := range envs {
			hasUser[envs[i].UserID] = true
			if envs[i].UserID == sess.UserID {
				mine = &envs[i]
			}
		}
		if mine == nil || len(mine.WrappedDK) < 32+24 {
			continue
		}
		members, ok := membersCache[sh.GroupID]
		if !ok {
			members, err = a.App.Vault.ListGroupMembers(r.Context(), sess.TenantID, sh.GroupID)
			if err != nil {
				continue
			}
			membersCache[sh.GroupID] = members
		}
		kv := versions[sh.SecretID]
		if kv == 0 {
			kv = mine.KeyVersion
		}
		eph, nonce, ct := mine.WrappedDK[:32], mine.WrappedDK[32:56], mine.WrappedDK[56:]
		callerEnv := &envOut{
			EphemeralPubB64: base64.StdEncoding.EncodeToString(eph),
			NonceB64:        base64.StdEncoding.EncodeToString(nonce),
			WrappedDKB64:    base64.StdEncoding.EncodeToString(ct),
			KeyVersion:      mine.KeyVersion,
		}
		for _, mid := range members {
			if filterUser != "" && mid != filterUser {
				continue
			}
			if hasUser[mid] {
				continue
			}
			u, ok := userCache[mid]
			if !ok {
				u, err = a.App.Vault.GetUser(r.Context(), sess.TenantID, mid)
				if err != nil {
					userCache[mid] = nil
					continue
				}
				userCache[mid] = u
			}
			if u == nil || u.OnboardedAt == nil || len(u.PublicKey) == 0 || u.Status == "disabled" {
				continue
			}
			items = append(items, gap{
				SecretID: string(sh.SecretID), GroupID: string(sh.GroupID),
				UserID: string(mid), Username: u.Username,
				PublicKeyB64: base64.StdEncoding.EncodeToString(u.PublicKey),
				KeyVersion: kv, Envelope: callerEnv,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
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
	blob, err := a.App.Vault.GetSecretCiphertext(r.Context(), sess.TenantID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "secret not found")
		return
	}
	for _, e := range body.Envelopes {
		if !allowed[e.UserID] {
			writeErr(w, http.StatusBadRequest, "envelope user not in group")
			return
		}
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
	if body.GroupID != "" {
		if err := a.App.Vault.PutSecretGroupShare(r.Context(), store.SecretGroupShare{
			TenantID: sess.TenantID, SecretID: id, GroupID: store.GroupID(body.GroupID),
		}); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	meta, _ := json.Marshal(map[string]string{"group_id": body.GroupID})
	if err := a.App.Vault.AppendAudit(r.Context(), store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "secret.share_group", ResourceType: "secret", ResourceID: string(id),
		Metadata: meta, CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "shared": len(body.Envelopes)})
}

package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"io"
	"net/http"
	"time"

	"github.com/teamvault/teamvault/internal/auth/session"
	"github.com/teamvault/teamvault/internal/cryptocore"
)

const escrowReplaceTTL = 15 * time.Minute

type escrowReplacePending struct {
	Challenge []byte
	Expires   time.Time
}

func (a *API) requireTenantAdmin(w http.ResponseWriter, r *http.Request) (session.Session, bool) {
	sess, ok := a.sessionFrom(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return session.Session{}, false
	}
	if !hasRole(sess.Roles, "tenant_admin") && !hasRole(sess.Roles, "platform_admin") {
		writeErr(w, http.StatusForbidden, "admin required")
		return session.Session{}, false
	}
	return sess, true
}

func (a *API) handleEscrowReplaceBegin(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.requireTenantAdmin(w, r)
	if !ok {
		return
	}
	ten, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(ten.EscrowPublicKey) != 32 {
		writeErr(w, http.StatusConflict, "no escrow public key to replace")
		return
	}
	challenge := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, challenge); err != nil {
		writeErr(w, http.StatusInternalServerError, "challenge")
		return
	}
	env, err := cryptocore.SealDataKeyForRecipient(challenge, ten.EscrowPublicKey, 1)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.escrowMu.Lock()
	a.escrowReplace[sess.TenantID] = escrowReplacePending{Challenge: challenge, Expires: time.Now().Add(escrowReplaceTTL)}
	a.escrowMu.Unlock()
	k := a.bundle().Policy.EscrowShamirK
	if k < 2 {
		k = 3
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ephemeral_pub_b64": base64.StdEncoding.EncodeToString(env.EphemeralPub),
		"nonce_b64":         base64.StdEncoding.EncodeToString(env.Nonce),
		"wrapped_dk_b64":    base64.StdEncoding.EncodeToString(env.Ciphertext),
		"key_version":       env.KeyVersion,
		"shamir_k":          k,
		"expires_at":        time.Now().Add(escrowReplaceTTL).UTC().Format(time.RFC3339),
	})
}

func (a *API) handleEscrowReplaceFinish(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.requireTenantAdmin(w, r)
	if !ok {
		return
	}
	var body struct {
		ChallengeB64 string `json:"challenge_b64"`
		PublicKeyB64 string `json:"public_key_b64"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	opened, err := base64.StdEncoding.DecodeString(body.ChallengeB64)
	if err != nil || len(opened) != 32 {
		writeErr(w, http.StatusBadRequest, "invalid challenge")
		return
	}
	pub, err := b64(body.PublicKeyB64)
	if err != nil || len(pub) != 32 {
		writeErr(w, http.StatusBadRequest, "invalid public key")
		return
	}
	a.escrowMu.Lock()
	pending, ok := a.escrowReplace[sess.TenantID]
	if ok && time.Now().After(pending.Expires) {
		delete(a.escrowReplace, sess.TenantID)
		ok = false
	}
	a.escrowMu.Unlock()
	if !ok || len(pending.Challenge) != 32 {
		writeErr(w, http.StatusConflict, "no active replace ceremony")
		return
	}
	if subtle.ConstantTimeCompare(opened, pending.Challenge) != 1 {
		writeErr(w, http.StatusForbidden, "challenge mismatch")
		return
	}
	ten, err := a.App.Vault.GetTenant(r.Context(), sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(ten.EscrowPublicKey) == 0 {
		writeErr(w, http.StatusConflict, "no escrow public key to replace")
		return
	}
	ten.EscrowPublicKey = pub
	if err := a.App.Vault.PutTenant(r.Context(), *ten); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.escrowMu.Lock()
	delete(a.escrowReplace, sess.TenantID)
	a.escrowMu.Unlock()
	_ = a.App.Vault.AppendAudit(r.Context(), a.mutationAudit(r, sess, "escrow.pubkey_replaced", "tenant", string(sess.TenantID)))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

package server

import (
	"net/http"
	"time"

	"github.com/teamvault/teamvault/internal/auth/session"
	"github.com/teamvault/teamvault/internal/store"
)

// appendAuditStrict writes an audit event and returns false after writing a 500 response on failure.
func (a *API) appendAuditStrict(w http.ResponseWriter, r *http.Request, e store.AuditEvent) bool {
	if e.ID == "" {
		e.ID = newID("aud")
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	if err := a.App.Vault.AppendAudit(r.Context(), e); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit: "+err.Error())
		return false
	}
	return true
}

func (a *API) mutationAudit(r *http.Request, sess session.Session, action, resourceType, resourceID string) store.AuditEvent {
	return store.AuditEvent{
		ID: newID("aud"), TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: action, ResourceType: resourceType, ResourceID: resourceID,
		CreatedAt: time.Now().UTC(),
	}
}

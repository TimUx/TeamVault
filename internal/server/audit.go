package server

import (
	"net/http"
	"time"

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

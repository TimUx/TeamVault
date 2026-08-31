package server

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

const backupRestoreMaxBytes = 64 << 20 // 64 MiB ciphertext snapshot

func (a *API) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	snap, err := a.App.Vault.ExportSnapshot(r.Context(), nil)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "export: "+err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.backup.export", ResourceType: "storage", ResourceID: "snapshot",
	}) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="teamvault-backup.json"`)
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(snap)
}

func (a *API) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, backupRestoreMaxBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(raw) > backupRestoreMaxBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "snapshot too large")
		return
	}
	confirm := r.URL.Query().Get("confirm")
	var snap store.StoreSnapshot
	var wrapped struct {
		Confirm  string              `json:"confirm"`
		Snapshot store.StoreSnapshot `json:"snapshot"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && (wrapped.Confirm != "" || len(wrapped.Snapshot.Records) > 0) {
		if wrapped.Confirm != "" {
			confirm = wrapped.Confirm
		}
		if len(wrapped.Snapshot.Records) > 0 {
			snap = wrapped.Snapshot
		}
	}
	if len(snap.Records) == 0 {
		if err := json.Unmarshal(raw, &snap); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid snapshot json")
			return
		}
	}
	if confirm != "RESTORE" {
		writeErr(w, http.StatusBadRequest, `confirm must be exactly "RESTORE"`)
		return
	}
	if snap.FormatVersion == 0 || len(snap.Records) == 0 {
		writeErr(w, http.StatusBadRequest, "snapshot missing records")
		return
	}
	if err := a.App.Vault.ImportSnapshot(r.Context(), snap, store.ImportReplace); err != nil {
		writeErr(w, http.StatusInternalServerError, "import: "+err.Error())
		return
	}
	if !a.appendAuditStrict(w, r, store.AuditEvent{
		TenantID: sess.TenantID, ActorID: string(sess.UserID),
		Action: "admin.backup.restore", ResourceType: "storage", ResourceID: "snapshot",
	}) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"exported_at": snap.ExportedAt.Format(time.RFC3339),
	})
}

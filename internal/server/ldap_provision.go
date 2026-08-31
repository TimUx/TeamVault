package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/teamvault/teamvault/internal/auth/ldapauth"
	"github.com/teamvault/teamvault/internal/store"
)

func (a *API) ldapConfigReady(tenantID store.TenantID) (ldapauth.Config, error) {
	cfg := a.ldapConfigFor(tenantID)
	if !cfg.Enabled {
		return cfg, errors.New("ldap disabled")
	}
	if cfg.Host == "" || cfg.BaseDN == "" {
		return cfg, errors.New("ldap host and base_dn required")
	}
	return cfg, nil
}

func (a *API) provisionLDAPUser(ctx context.Context, tenantID store.TenantID, du ldapauth.DirectoryUser) (created bool, err error) {
	username := strings.TrimSpace(du.Username)
	if username == "" {
		return false, errors.New("username required")
	}
	if _, err := a.App.Vault.GetUserByUsername(ctx, tenantID, username); err == nil {
		return false, nil
	}
	roles, _ := json.Marshal([]string{"member"})
	display := strings.TrimSpace(du.DisplayName)
	if display == "" {
		display = username
	}
	u := store.UserRecord{
		ID:          store.UserID(ldapauth.UserIDFromDN(du.DN)),
		TenantID:    tenantID,
		Username:    username,
		DisplayName: display,
		Email:       strings.TrimSpace(du.Email),
		AuthBackend: "ldap",
		Status:      "pending_onboarding",
		RolesJSON:   string(roles),
	}
	if err := a.App.Vault.UpsertUser(ctx, u); err != nil {
		return false, err
	}
	a.maybeMailInvite(u, tenantID)
	return true, nil
}

func (a *API) handleLDAPSearchUsers(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	cfg, err := a.ldapConfigReady(sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	found, err := ldapauth.SearchUsers(cfg, q, limit)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "ldap search: "+err.Error())
		return
	}
	local, err := a.App.Vault.ListUsers(r.Context(), sess.TenantID, store.UserQuery{Limit: 10000})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	byName := make(map[string]store.UserRecord, len(local))
	for _, u := range local {
		byName[strings.ToLower(u.Username)] = u
	}
	out := make([]map[string]any, 0, len(found))
	for _, du := range found {
		item := map[string]any{
			"username":     du.Username,
			"dn":           du.DN,
			"display_name": du.DisplayName,
			"email":        du.Email,
			"provisioned":  false,
		}
		if lu, ok := byName[strings.ToLower(du.Username)]; ok {
			item["provisioned"] = true
			item["local_id"] = string(lu.ID)
			item["local_status"] = lu.Status
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (a *API) handleLDAPImportUsers(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.sessionFrom(r)
	cfg, err := a.ldapConfigReady(sess.TenantID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var body struct {
		Usernames []string `json:"usernames"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(body.Usernames) == 0 {
		writeErr(w, http.StatusBadRequest, "usernames required")
		return
	}
	if len(body.Usernames) > 100 {
		writeErr(w, http.StatusBadRequest, "max 100 usernames per import")
		return
	}
	created := 0
	skipped := 0
	failed := make([]map[string]string, 0)
	for _, name := range body.Usernames {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		du, err := ldapauth.LookupUser(cfg, name)
		if err != nil {
			failed = append(failed, map[string]string{"username": name, "error": err.Error()})
			continue
		}
		ok, err := a.provisionLDAPUser(r.Context(), sess.TenantID, du)
		if err != nil {
			failed = append(failed, map[string]string{"username": name, "error": err.Error()})
			continue
		}
		if ok {
			created++
		} else {
			skipped++
		}
	}
	if created > 0 {
		if !a.appendAuditStrict(w, r, store.AuditEvent{
			TenantID: sess.TenantID, ActorID: string(sess.UserID),
			Action: "admin.ldap.import", ResourceType: "user", ResourceID: "batch",
		}) {
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"created": created, "skipped": skipped, "failed": failed,
	})
}

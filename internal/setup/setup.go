package setup

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/auth/password"
	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/configstore"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/store"
)

var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// CommitRequest is the atomic wizard payload (OQ-05).
type CommitRequest struct {
	Storage struct {
		Backend string `json:"backend"`
		DSN     string `json:"dsn"`
	} `json:"storage"`
	Tenant struct {
		Name          string `json:"name"`
		Slug          string `json:"slug"`
		RecoveryMode  string `json:"recovery_mode"`
		EscrowAllowed bool   `json:"escrow_allowed"`
	} `json:"tenant"`
	Admin struct {
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Email       string `json:"email"`
		Password    string `json:"password"`
	} `json:"admin"`
	Argon2 cryptocore.Argon2Params `json:"argon2"`
	LDAP   json.RawMessage         `json:"ldap,omitempty"`
	Mail   json.RawMessage         `json:"mail,omitempty"`
}

type CommitResult struct {
	TenantID store.TenantID `json:"tenant_id"`
	UserID   store.UserID   `json:"user_id"`
}

func Commit(ctx context.Context, app *bootstrap.Result, req CommitRequest) (*CommitResult, error) {
	if app.Config.Initialized {
		return nil, errors.New("already initialized")
	}
	if err := validate(req); err != nil {
		return nil, err
	}

	backend := req.Storage.Backend
	if backend == "" {
		backend = "sqlite"
	}
	dsn := req.Storage.DSN
	if dsn == "" {
		switch backend {
		case "json", "jsonfile":
			dsn = filepath.Join(app.DataDir, "vault.json")
		default:
			dsn = filepath.Join(app.DataDir, "vault.db")
			backend = "sqlite"
		}
	}

	argon := req.Argon2
	if argon.Time == 0 {
		argon = cryptocore.DefaultArgon2
	}

	tid := store.TenantID(newID("ten"))
	uid := store.UserID(newID("usr"))
	slug := strings.TrimSpace(req.Tenant.Slug)

	app.Config.Storage = configstore.StorageConfig{Backend: backend, DSN: dsn}
	if err := app.ConfigStore.Save(app.Config); err != nil {
		return nil, err
	}
	if err := app.ReopenVault(); err != nil {
		return nil, fmt.Errorf("reopen store: %w", err)
	}

	hash, err := password.Hash(req.Admin.Password, password.Default)
	if err != nil {
		return nil, err
	}

	recMode := req.Tenant.RecoveryMode
	if recMode == "" {
		recMode = "user_kit"
	}
	escrow := req.Tenant.EscrowAllowed
	if recMode == "admin_escrow" {
		escrow = true
	}

	if err := app.Vault.PutTenant(ctx, store.Tenant{
		ID: tid, Name: strings.TrimSpace(req.Tenant.Name), Slug: slug,
		RecoveryMode: recMode, EscrowAllowed: escrow, Status: "active",
	}); err != nil {
		return nil, err
	}

	roles, _ := json.Marshal([]string{"platform_admin", "tenant_admin"})
	if err := app.Vault.UpsertUser(ctx, store.UserRecord{
		ID: uid, TenantID: tid,
		Username:    strings.TrimSpace(req.Admin.Username),
		DisplayName: strings.TrimSpace(req.Admin.DisplayName),
		Email:       strings.TrimSpace(req.Admin.Email),
		AuthBackend: "local", LocalPasswordHash: hash, Status: "pending_onboarding",
		RolesJSON: string(roles),
	}); err != nil {
		return nil, err
	}

	_ = app.Vault.AppendAudit(ctx, store.AuditEvent{
		ID: newID("aud"), TenantID: tid, ActorID: string(uid),
		Action: "setup.commit", ResourceType: "tenant", ResourceID: string(tid),
		CreatedAt: time.Now().UTC(),
	})

	extra, err := json.Marshal(map[string]any{
		"argon2":              argon,
		"ldap":                req.LDAP,
		"mail":                req.Mail,
		"primary_tenant_id":   string(tid),
		"primary_tenant_slug": slug,
	})
	if err != nil {
		return nil, err
	}
	app.Config.Extra = extra
	app.Config.Initialized = true
	if err := app.ConfigStore.Save(app.Config); err != nil {
		return nil, err
	}
	return &CommitResult{TenantID: tid, UserID: uid}, nil
}

func validate(req CommitRequest) error {
	if strings.TrimSpace(req.Tenant.Name) == "" {
		return errors.New("tenant name required")
	}
	if !slugRe.MatchString(strings.TrimSpace(req.Tenant.Slug)) {
		return errors.New("tenant slug must be lowercase alphanumeric with hyphens")
	}
	if strings.TrimSpace(req.Admin.Username) == "" {
		return errors.New("admin username required")
	}
	if len(req.Admin.Password) < 12 {
		return errors.New("admin login password must be at least 12 characters")
	}
	switch req.Tenant.RecoveryMode {
	case "", "user_kit", "admin_escrow":
	default:
		return errors.New("invalid recovery_mode")
	}
	switch req.Storage.Backend {
	case "", "sqlite", "json", "jsonfile":
	default:
		return fmt.Errorf("unsupported storage backend %q", req.Storage.Backend)
	}
	return nil
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

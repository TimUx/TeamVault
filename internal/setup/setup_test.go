package setup_test

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/auth/password"
	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/setup"
	"github.com/teamvault/teamvault/internal/store"
)

func TestCommitAndLoginHash(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte("k"), 32)
	app, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: key})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Vault.Close() })

	var req setup.CommitRequest
	req.Storage.Backend = "sqlite"
	req.Storage.DSN = filepath.Join(dir, "vault.db")
	req.Tenant.Name = "Acme"
	req.Tenant.Slug = "acme"
	req.Tenant.RecoveryMode = "user_kit"
	req.Admin.Username = "admin"
	req.Admin.Password = "super-secret-1"
	req.Admin.DisplayName = "Admin"

	ctx := context.Background()
	res, err := setup.Commit(ctx, app, req)
	if err != nil {
		t.Fatal(err)
	}
	if !app.Config.Initialized {
		t.Fatal("expected initialized")
	}
	u, err := app.Vault.GetUser(ctx, res.TenantID, res.UserID)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := password.Verify("super-secret-1", u.LocalPasswordHash)
	if err != nil || !ok {
		t.Fatal("hash verify failed")
	}
	if u.Status != "pending_onboarding" {
		t.Fatalf("status=%s", u.Status)
	}
	ten, err := app.Vault.GetTenant(ctx, store.TenantID(res.TenantID))
	if err != nil || ten.Slug != "acme" {
		t.Fatalf("tenant: %v %+v", err, ten)
	}

	_, err = setup.Commit(ctx, app, req)
	if err == nil {
		t.Fatal("second commit should fail")
	}
	_ = app.Vault.Close()
}

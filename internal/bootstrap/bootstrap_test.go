package bootstrap_test

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/store"
)

func TestBootstrapFirstRunAndReload(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte("k"), 32)

	r1, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: key})
	if err != nil {
		t.Fatal(err)
	}
	defer r1.Vault.Close()
	if !r1.FirstRun {
		t.Fatal("expected first run")
	}
	if r1.Config.Initialized {
		t.Fatal("wizard not done yet")
	}
	if r1.Config.Storage.Backend != "sqlite" {
		t.Fatalf("backend=%s", r1.Config.Storage.Backend)
	}

	ctx := context.Background()
	tid := store.TenantID("t1")
	if err := r1.Vault.PutTenant(ctx, store.Tenant{
		ID: tid, Name: "T", Slug: "t", RecoveryMode: "user_kit", Status: "active",
	}); err != nil {
		t.Fatal(err)
	}
	_ = r1.Vault.Close()

	r2, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: key})
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Vault.Close()
	if r2.FirstRun {
		t.Fatal("expected existing config")
	}
	got, err := r2.Vault.GetTenant(ctx, tid)
	if err != nil {
		t.Fatal(err)
	}
	if got.Slug != "t" {
		t.Fatalf("slug=%s", got.Slug)
	}

	// Wrong key must not open config.
	_, err = bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: bytes.Repeat([]byte("x"), 32)})
	if err == nil {
		t.Fatal("expected wrong-key failure")
	}
}

func TestDefaultSqlitePathUnderDataDir(t *testing.T) {
	dir := t.TempDir()
	r, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: bytes.Repeat([]byte("a"), 32)})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Vault.Close()
	want := filepath.Join(dir, "vault.db")
	if r.Config.Storage.DSN != want {
		t.Fatalf("dsn=%s want=%s", r.Config.Storage.DSN, want)
	}
}

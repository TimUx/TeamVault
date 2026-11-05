package server

import (
	"bytes"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/instcfg"
)

func TestStaleBundleDoesNotOverwriteOfflinePolicy(t *testing.T) {
	app, err := bootstrap.Run(bootstrap.Options{DataDir: t.TempDir(), UnlockKey: bytes.Repeat([]byte("s"), 32)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Vault.Close() })
	api := New(app)
	stale := api.bundle()
	requirement := "HARDWARE"
	allowed := false
	if _, err := api.savePolicy(instcfg.Policy{
		OfflineCacheAllowed: &allowed, OfflineKeyRequirement: &requirement,
	}); err != nil {
		t.Fatal(err)
	}
	stale.Mail.Host = "smtp.example.test"
	if err := api.saveBundle(stale); err != nil {
		t.Fatal(err)
	}
	policy := api.bundle().Policy
	if policy.OfflineCacheEnabled() || policy.OfflineKeyRequirementValue() != "HARDWARE" {
		t.Fatalf("stale config overwrote offline policy: %+v", policy)
	}
	if _, err := api.savePolicy(instcfg.Policy{}); err != nil {
		t.Fatal(err)
	}
	policy = api.bundle().Policy
	if policy.OfflineCacheEnabled() || policy.OfflineKeyRequirementValue() != "HARDWARE" {
		t.Fatalf("legacy policy update overwrote offline policy: %+v", policy)
	}
}

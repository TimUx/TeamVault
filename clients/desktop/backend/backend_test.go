package backend

import (
	"testing"
	"time"
)

func TestSettingsRoundTrip(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	in := Settings{ServerURL: "https://vault.example.test", TenantSlug: "acme", Username: "alice", AutostartOn: true, CloseToTray: true, Theme: "dark"}
	if err := SaveSettings(in); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	out, err := LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}
	if out != in {
		t.Fatalf("roundtrip mismatch: got %+v want %+v", out, in)
	}
}

func TestOfflineSnapshotRoundTripAndTTL(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	snap := OfflineSnapshot{
		Version:    1,
		TenantID:   "t1",
		TenantSlug: "acme",
		UserID:     "u1",
		Username:   "alice",
		SyncedAt:   time.Now().UTC(),
		Keys:       OfflineKeys{SaltB64: "c2FsdA==", PublicKeyB64: "cHVi"},
		Secrets:    []OfflineSecret{{ID: "sec_1", HasAccess: true}},
	}
	if err := SaveOfflineSnapshot(snap); err != nil {
		t.Fatalf("SaveOfflineSnapshot: %v", err)
	}
	loaded, ok, err := LoadOfflineSnapshot("acme", "alice")
	if err != nil || !ok {
		t.Fatalf("LoadOfflineSnapshot: ok=%v err=%v", ok, err)
	}
	if loaded.Expired() {
		t.Fatal("fresh snapshot should not be expired")
	}
	if len(loaded.Secrets) != 1 || loaded.Secrets[0].ID != "sec_1" {
		t.Fatalf("unexpected secrets: %+v", loaded.Secrets)
	}

	stale := snap
	stale.SyncedAt = time.Now().UTC().Add(-31 * 24 * time.Hour)
	if !stale.Expired() {
		t.Fatal("31-day-old snapshot should be expired")
	}

	if err := DeleteOfflineSnapshot("acme", "alice"); err != nil {
		t.Fatalf("DeleteOfflineSnapshot: %v", err)
	}
	if _, ok, err := LoadOfflineSnapshot("acme", "alice"); err != nil || ok {
		t.Fatalf("expected no snapshot after delete: ok=%v err=%v", ok, err)
	}
}

func TestBuildBodyDefaultsToEmptySlices(t *testing.T) {
	body := buildBody(SecretInput{Title: "x"})
	if body["urls"] == nil || body["tags"] == nil || body["extra"] == nil {
		t.Fatalf("expected non-nil default slices, got %+v", body)
	}
}

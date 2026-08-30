package jsonfile_test

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/teamvault/teamvault/internal/store"
	"github.com/teamvault/teamvault/internal/store/jsonfile"
)

func TestTenantIsolationRequiresTenantID(t *testing.T) {
	s := openTestStore(t)
	defer s.Close()
	ctx := context.Background()
	if _, err := s.ListUsers(ctx, "", store.UserQuery{}); err != store.ErrTenantRequired {
		t.Fatalf("got %v", err)
	}
}

func TestOpaqueSecretRoundTripAndSnapshot(t *testing.T) {
	s := openTestStore(t)
	defer s.Close()
	ctx := context.Background()

	tid := store.TenantID("tenant-a")
	if err := s.PutTenant(ctx, store.Tenant{
		ID: tid, Name: "A", Slug: "a", RecoveryMode: "user_kit", EscrowAllowed: true, Status: "active",
	}); err != nil {
		t.Fatal(err)
	}
	uid := store.UserID("user-1")
	if err := s.UpsertUser(ctx, store.UserRecord{
		ID: uid, TenantID: tid, Username: "alice", AuthBackend: "local", Status: "active",
		RolesJSON: `["tenant_admin"]`, PublicKey: []byte{1, 2, 3},
		EncryptedPrivateKey: []byte{9, 9, 9},
	}); err != nil {
		t.Fatal(err)
	}

	sid := store.SecretID("sec-1")
	titleCT := []byte{0xde, 0xad}
	titleNonce := []byte{0xbe, 0xef}
	if err := s.PutSecretMeta(ctx, store.SecretMeta{
		ID: sid, TenantID: tid, TitleCiphertext: titleCT, TitleNonce: titleNonce, CreatedBy: uid,
	}); err != nil {
		t.Fatal(err)
	}
	blob := store.CiphertextBlob{
		Ciphertext: []byte{0xca, 0xfe}, Nonce: []byte{0xba, 0xbe}, KeyVersion: 1, ContentType: "application/octet-stream",
	}
	if err := s.PutSecretCiphertext(ctx, tid, sid, blob); err != nil {
		t.Fatal(err)
	}
	if err := s.PutKeyEnvelope(ctx, store.KeyEnvelope{
		SecretID: sid, TenantID: tid, UserID: uid, KeyVersion: 1, WrappedDK: []byte{0x11, 0x22},
	}); err != nil {
		t.Fatal(err)
	}

	gotMeta, err := s.GetSecretMeta(ctx, tid, sid)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(gotMeta.TitleCiphertext, titleCT) {
		t.Fatal("title ciphertext mismatch")
	}

	if err := s.InvalidateKeyVersion(ctx, tid, sid, 1); err != nil {
		t.Fatal(err)
	}
	envs, err := s.ListKeyEnvelopes(ctx, tid, sid)
	if err != nil {
		t.Fatal(err)
	}
	if len(envs) != 0 {
		t.Fatalf("expected revoked envelopes hidden, got %d", len(envs))
	}

	snap, err := s.ExportSnapshot(ctx, &tid)
	if err != nil {
		t.Fatal(err)
	}
	s2 := openTestStore(t)
	defer s2.Close()
	if err := s2.ImportSnapshot(ctx, *snap, store.ImportMerge); err != nil {
		t.Fatal(err)
	}
	u, err := s2.GetUser(ctx, tid, uid)
	if err != nil {
		t.Fatal(err)
	}
	if u.Username != "alice" {
		t.Fatalf("username=%s", u.Username)
	}
}

func TestForeignTenantCannotSeeSecret(t *testing.T) {
	s := openTestStore(t)
	defer s.Close()
	ctx := context.Background()
	a, b := store.TenantID("t-a"), store.TenantID("t-b")
	_ = s.PutTenant(ctx, store.Tenant{ID: a, Name: "A", Slug: "ta", RecoveryMode: "user_kit", Status: "active"})
	_ = s.PutTenant(ctx, store.Tenant{ID: b, Name: "B", Slug: "tb", RecoveryMode: "user_kit", Status: "active"})
	sid := store.SecretID("s")
	_ = s.PutSecretMeta(ctx, store.SecretMeta{
		ID: sid, TenantID: a, TitleCiphertext: []byte{1}, TitleNonce: []byte{2}, CreatedBy: "u",
	})
	if _, err := s.GetSecretMeta(ctx, b, sid); err != store.ErrNotFound {
		t.Fatalf("expected not found across tenant, got %v", err)
	}
}

func TestHealthAndAudit(t *testing.T) {
	s := openTestStore(t)
	defer s.Close()
	ctx := context.Background()
	h, err := s.Health(ctx)
	if err != nil || !h.OK {
		t.Fatalf("health=%+v err=%v", h, err)
	}
	tid := store.TenantID("t1")
	_ = s.PutTenant(ctx, store.Tenant{ID: tid, Name: "T", Slug: "t1", RecoveryMode: "user_kit", Status: "active"})
	if err := s.AppendAudit(ctx, store.AuditEvent{
		ID: "evt-1", TenantID: tid, ActorID: "u", Action: "test", ResourceType: "system", ResourceID: "-",
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
}

func openTestStore(t *testing.T) *jsonfile.Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "vault.json")
	s, err := jsonfile.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

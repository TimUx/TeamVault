package sqlite_test

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/teamvault/teamvault/internal/store"
	"github.com/teamvault/teamvault/internal/store/sqlite"
)

func TestTenantIsolationAndOpaqueRoundTrip(t *testing.T) {
	s := open(t)
	defer s.Close()
	ctx := context.Background()
	if _, err := s.ListUsers(ctx, "", store.UserQuery{}); err != store.ErrTenantRequired {
		t.Fatalf("got %v", err)
	}

	tid := store.TenantID("tenant-a")
	if err := s.PutTenant(ctx, store.Tenant{
		ID: tid, Name: "A", Slug: "a", RecoveryMode: "user_kit", EscrowAllowed: true, Status: "active",
	}); err != nil {
		t.Fatal(err)
	}
	uid := store.UserID("user-1")
	if err := s.UpsertUser(ctx, store.UserRecord{
		ID: uid, TenantID: tid, Username: "alice", AuthBackend: "local", Status: "active",
		RolesJSON: `["tenant_admin"]`, PublicKey: []byte{1, 2, 3}, EncryptedPrivateKey: []byte{9, 9, 9},
	}); err != nil {
		t.Fatal(err)
	}
	sid := store.SecretID("sec-1")
	titleCT := []byte{0xde, 0xad}
	if err := s.PutSecretMeta(ctx, store.SecretMeta{
		ID: sid, TenantID: tid, TitleCiphertext: titleCT, TitleNonce: []byte{1}, CreatedBy: uid,
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutSecretCiphertext(ctx, tid, sid, store.CiphertextBlob{
		Ciphertext: []byte{0xca}, Nonce: []byte{0xfe}, KeyVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutKeyEnvelope(ctx, store.KeyEnvelope{
		SecretID: sid, TenantID: tid, UserID: uid, KeyVersion: 1, WrappedDK: []byte{0x11},
	}); err != nil {
		t.Fatal(err)
	}
	meta, err := s.GetSecretMeta(ctx, tid, sid)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(meta.TitleCiphertext, titleCT) {
		t.Fatal("ciphertext mismatch")
	}
	_ = s.InvalidateKeyVersion(ctx, tid, sid, 1)
	envs, _ := s.ListKeyEnvelopes(ctx, tid, sid)
	if len(envs) != 0 {
		t.Fatalf("revoked still listed: %d", len(envs))
	}

	other := store.TenantID("t-b")
	_ = s.PutTenant(ctx, store.Tenant{ID: other, Name: "B", Slug: "b", RecoveryMode: "user_kit", Status: "active"})
	if _, err := s.GetSecretMeta(ctx, other, sid); err != store.ErrNotFound {
		t.Fatalf("cross-tenant: %v", err)
	}

	snap, err := s.ExportSnapshot(ctx, &tid)
	if err != nil {
		t.Fatal(err)
	}
	s2 := open(t)
	defer s2.Close()
	if err := s2.ImportSnapshot(ctx, *snap, store.ImportMerge); err != nil {
		t.Fatal(err)
	}
	u, err := s2.GetUser(ctx, tid, uid)
	if err != nil || u.Username != "alice" {
		t.Fatalf("import user: %v %+v", err, u)
	}
	h, err := s.Health(ctx)
	if err != nil || !h.OK {
		t.Fatal(h, err)
	}
	_ = s.AppendAudit(ctx, store.AuditEvent{
		ID: "a1", TenantID: tid, ActorID: "u", Action: "test", ResourceType: "x", ResourceID: "y",
		CreatedAt: time.Now().UTC(),
	})
}

func open(t *testing.T) *sqlite.Store {
	t.Helper()
	s, err := sqlite.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

package jsonfile_test

import (
	"context"
	"testing"

	"github.com/teamvault/teamvault/internal/store"
)

func TestCreateSecretAuditFailureRollsBack(t *testing.T) {
	s := openTestStore(t)
	defer s.Close()
	ctx := context.Background()
	tid := store.TenantID("tenant-a")
	if err := s.PutTenant(ctx, store.Tenant{
		ID: tid, Name: "A", Slug: "a", RecoveryMode: "user_kit", Status: "active",
	}); err != nil {
		t.Fatal(err)
	}
	sid := store.SecretID("sec-audit")
	meta := store.SecretMeta{
		ID: sid, TenantID: tid, TitleCiphertext: []byte{1}, TitleNonce: []byte{2}, CreatedBy: "u1",
	}
	blob := store.CiphertextBlob{Ciphertext: []byte{3}, Nonce: []byte{4}, KeyVersion: 1}
	envs := []store.KeyEnvelope{{
		SecretID: sid, TenantID: tid, UserID: "u1", KeyVersion: 1, WrappedDK: []byte{5},
	}}
	err := s.CreateSecret(ctx, meta, blob, envs, &store.AuditEvent{Action: "secret.create"})
	if err == nil {
		t.Fatal("expected audit validation error")
	}
	if _, err := s.GetSecretMeta(ctx, tid, sid); err != store.ErrNotFound {
		t.Fatalf("secret row after failed audit: %v", err)
	}

	okAudit := &store.AuditEvent{
		ID: "aud-ok", TenantID: tid, ActorID: "u1",
		Action: "secret.create", ResourceType: "secret", ResourceID: string(sid),
	}
	if err := s.CreateSecret(ctx, meta, blob, envs, okAudit); err != nil {
		t.Fatal(err)
	}
	events, err := s.ListAudit(ctx, tid, store.AuditQuery{Limit: 10})
	if err != nil || len(events) != 1 || events[0].Action != "secret.create" {
		t.Fatalf("audit: %v %+v", err, events)
	}

	rotMeta := meta
	rotBlob := store.CiphertextBlob{Ciphertext: []byte{9}, Nonce: []byte{8}, KeyVersion: 2}
	rotEnvs := []store.KeyEnvelope{{
		SecretID: sid, TenantID: tid, UserID: "u1", KeyVersion: 2, WrappedDK: []byte{7},
	}}
	if err := s.RotateSecret(ctx, tid, sid, 1, rotMeta, rotBlob, rotEnvs, &store.AuditEvent{TenantID: tid, Action: "x"}); err == nil {
		t.Fatal("expected rotate audit error")
	}
	cur, err := s.GetSecretCiphertext(ctx, tid, sid)
	if err != nil || cur.KeyVersion != 1 {
		t.Fatalf("rotate rolled back? %v %+v", err, cur)
	}
}

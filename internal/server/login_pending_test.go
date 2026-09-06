package server

import (
	"testing"

	"github.com/teamvault/teamvault/internal/store"
)

func TestPendingLoginSelection(t *testing.T) {
	s := newPendingLoginStore()
	token := s.issueSelection([]pendingCandidate{
		{UserID: "u1", TenantID: "t1", Slug: "one", Name: "One"},
		{UserID: "u2", TenantID: "t2", Slug: "two", Name: "Two"},
	})

	p, ok := s.consumeSelection(token, "two")
	if !ok || p.UserID != store.UserID("u2") || p.TenantID != store.TenantID("t2") {
		t.Fatalf("selection returned %#v, ok=%v", p, ok)
	}
	if _, ok := s.consumeSelection(token, "two"); ok {
		t.Fatal("selection token was reusable")
	}
}

package session

import (
	"testing"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

func TestDeleteByUserAndTenant(t *testing.T) {
	s := New(time.Hour)
	a := s.Create("usr_a", "ten_1", "alice", []string{"member"})
	b := s.Create("usr_b", "ten_1", "bob", []string{"member"})
	c := s.Create("usr_c", "ten_2", "cara", []string{"member"})
	if _, ok := s.Get(a.ID); !ok {
		t.Fatal("alice session missing")
	}
	s.DeleteByUser(store.UserID("usr_a"))
	if _, ok := s.Get(a.ID); ok {
		t.Fatal("alice session should be revoked")
	}
	if _, ok := s.Get(b.ID); !ok {
		t.Fatal("bob session should remain")
	}
	s.DeleteByTenant(store.TenantID("ten_1"))
	if _, ok := s.Get(b.ID); ok {
		t.Fatal("bob session should be revoked with tenant")
	}
	if _, ok := s.Get(c.ID); !ok {
		t.Fatal("cara in other tenant should remain")
	}
}

func TestIdleTimeout(t *testing.T) {
	s := New(time.Hour)
	s.SetIdle(50 * time.Millisecond)
	sess := s.Create("usr_a", "ten_1", "alice", []string{"member"})
	if _, ok := s.Get(sess.ID); !ok {
		t.Fatal("fresh session should be valid")
	}
	time.Sleep(80 * time.Millisecond)
	if _, ok := s.Get(sess.ID); ok {
		t.Fatal("idle session should expire")
	}
}


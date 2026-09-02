package server

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

const pendingLoginTTL = 5 * time.Minute

type pendingLogin struct {
	UserID   store.UserID
	TenantID store.TenantID
	Expires  time.Time
}

type pendingLoginStore struct {
	mu sync.Mutex
	m  map[string]pendingLogin
}

func newPendingLoginStore() *pendingLoginStore {
	return &pendingLoginStore{m: map[string]pendingLogin{}}
}

func (s *pendingLoginStore) issue(userID store.UserID, tenantID store.TenantID) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(time.Now().UTC())
	s.m[token] = pendingLogin{
		UserID: userID, TenantID: tenantID,
		Expires: time.Now().UTC().Add(pendingLoginTTL),
	}
	return token
}

func (s *pendingLoginStore) consume(token string) (pendingLogin, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(time.Now().UTC())
	p, ok := s.m[token]
	if !ok || time.Now().UTC().After(p.Expires) {
		delete(s.m, token)
		return pendingLogin{}, false
	}
	delete(s.m, token)
	return p, true
}

func (s *pendingLoginStore) pruneLocked(now time.Time) {
	for k, p := range s.m {
		if now.After(p.Expires) {
			delete(s.m, k)
		}
	}
}

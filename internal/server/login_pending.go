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
	UserID     store.UserID
	TenantID   store.TenantID
	Expires    time.Time
	Candidates []pendingCandidate
}

type pendingCandidate struct {
	UserID   store.UserID
	TenantID store.TenantID
	Slug     string
	Name     string
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

func (s *pendingLoginStore) issueSelection(candidates []pendingCandidate) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(time.Now().UTC())
	s.m[token] = pendingLogin{Candidates: candidates, Expires: time.Now().UTC().Add(pendingLoginTTL)}
	return token
}

func (s *pendingLoginStore) consumeSelection(token, slug string) (pendingLogin, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(time.Now().UTC())
	p, ok := s.m[token]
	if !ok || time.Now().UTC().After(p.Expires) || len(p.Candidates) == 0 {
		delete(s.m, token)
		return pendingLogin{}, false
	}
	for _, c := range p.Candidates {
		if c.Slug == slug {
			delete(s.m, token)
			return pendingLogin{UserID: c.UserID, TenantID: c.TenantID}, true
		}
	}
	return pendingLogin{}, false
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

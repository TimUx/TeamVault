package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

type Session struct {
	ID         string
	UserID     store.UserID
	TenantID   store.TenantID
	Username   string
	Roles      []string
	Scopes     []string // API-key scopes; empty = unrestricted (cookie sessions)
	ExpiresAt  time.Time
	LastSeenAt time.Time
}

// Store holds sessions in memory and optionally persists to a JSON file (Phase 9.5).
// Single-node: file survives process restart. Multi-replica: sticky sessions or shared store required
// (documented in admin guide — in-memory rate limits similarly do not sync across nodes).
type Store struct {
	mu       sync.Mutex
	sessions map[string]Session
	ttl      time.Duration
	idle     time.Duration // 0 = no idle expiry (absolute TTL only)
	path     string
}

func New(ttl time.Duration) *Store {
	return NewPersistent("", ttl)
}

// NewPersistent loads/saves sessions from path when non-empty (e.g. data/sessions.json).
func NewPersistent(path string, ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 8 * time.Hour
	}
	s := &Store{sessions: map[string]Session{}, ttl: ttl, path: path}
	if path != "" {
		_ = s.load()
	}
	return s
}

func (s *Store) Create(userID store.UserID, tenantID store.TenantID, username string, roles []string) Session {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	now := time.Now().UTC()
	s.mu.Lock()
	ttl := s.ttl
	s.mu.Unlock()
	sess := Session{
		ID: id, UserID: userID, TenantID: tenantID, Username: username, Roles: roles,
		ExpiresAt: now.Add(ttl), LastSeenAt: now,
	}
	s.mu.Lock()
	s.sessions[id] = sess
	s.mu.Unlock()
	s.persist()
	return sess
}

// SetTTL updates the absolute TTL used for newly created sessions.
func (s *Store) SetTTL(ttl time.Duration) {
	if ttl <= 0 {
		ttl = 8 * time.Hour
	}
	s.mu.Lock()
	s.ttl = ttl
	s.mu.Unlock()
}

// SetIdle updates the idle timeout. Zero disables idle expiry (absolute TTL only).
func (s *Store) SetIdle(idle time.Duration) {
	if idle < 0 {
		idle = 0
	}
	s.mu.Lock()
	s.idle = idle
	s.mu.Unlock()
}

func (s *Store) Get(id string) (Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	now := time.Now().UTC()
	if !ok || now.After(sess.ExpiresAt) {
		delete(s.sessions, id)
		return Session{}, false
	}
	if s.idle > 0 && !sess.LastSeenAt.IsZero() && now.Sub(sess.LastSeenAt) > s.idle {
		delete(s.sessions, id)
		return Session{}, false
	}
	sess.LastSeenAt = now
	s.sessions[id] = sess
	return sess, true
}

func (s *Store) Delete(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
	s.persist()
}

// DeleteByUser drops all cookie sessions for userID (API-key sessions are not stored here).
func (s *Store) DeleteByUser(userID store.UserID) {
	s.mu.Lock()
	for id, sess := range s.sessions {
		if sess.UserID == userID {
			delete(s.sessions, id)
		}
	}
	s.mu.Unlock()
	s.persist()
}

// DeleteByTenant drops all cookie sessions for tenantID.
func (s *Store) DeleteByTenant(tenantID store.TenantID) {
	s.mu.Lock()
	for id, sess := range s.sessions {
		if sess.TenantID == tenantID {
			delete(s.sessions, id)
		}
	}
	s.mu.Unlock()
	s.persist()
}

func (s *Store) persist() {
	if s.path == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	alive := make(map[string]Session, len(s.sessions))
	for k, v := range s.sessions {
		if v.ExpiresAt.After(now) {
			alive[k] = v
		}
	}
	s.sessions = alive
	raw, err := json.Marshal(alive)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(s.path), 0o700)
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var m map[string]Session
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range m {
		if v.ExpiresAt.After(now) {
			s.sessions[k] = v
		}
	}
	return nil
}

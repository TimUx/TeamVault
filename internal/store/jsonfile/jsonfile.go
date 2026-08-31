// Package jsonfile is a Phase-1 vault backend using atomic JSON snapshots.
//
// Security decision (Prinzip 8): only opaque ciphertext blobs are persisted.
//
// Why not SQLite yet: corporate network blocks proxy.golang.org, so
// modernc.org/sqlite cannot be fetched. The VaultStore interface stays stable;
// swap-in SQLite when modules are available (see docs/planning/storage-abstraction.md).
package jsonfile

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

type envelopeRec struct {
	store.KeyEnvelope
	Revoked bool `json:"revoked"`
}

type persistence struct {
	Tenants      map[string]store.Tenant         `json:"tenants"`
	Users        map[string]store.UserRecord     `json:"users"`
	Secrets      map[string]store.SecretMeta     `json:"secrets"`
	Blobs        map[string]store.CiphertextBlob `json:"blobs"`
	Envelopes    []envelopeRec                   `json:"envelopes"`
	Audit        []store.AuditEvent              `json:"audit"`
	Groups       map[string]store.Group          `json:"groups"`
	Members      []store.GroupMember             `json:"members"`
	WebAuthn     []store.WebAuthnCredential      `json:"webauthn"`
	DirectShares []store.SecretDirectShare       `json:"direct_shares"`
	GroupShares  []store.SecretGroupShare        `json:"group_shares"`
}

type Store struct {
	path string
	mu   sync.Mutex
	data persistence
}

func Open(path string) (*Store, error) {
	dir := filepath.Dir(path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, err
		}
	}
	s := &Store{path: path, data: empty()}
	if _, err := os.Stat(path); err == nil {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &s.data); err != nil {
			return nil, err
		}
		normalize(&s.data)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func empty() persistence {
	return persistence{
		Tenants: map[string]store.Tenant{},
		Users:   map[string]store.UserRecord{},
		Secrets: map[string]store.SecretMeta{},
		Blobs:   map[string]store.CiphertextBlob{},
		Groups:  map[string]store.Group{},
	}
}

func normalize(p *persistence) {
	if p.Tenants == nil {
		p.Tenants = map[string]store.Tenant{}
	}
	if p.Users == nil {
		p.Users = map[string]store.UserRecord{}
	}
	if p.Secrets == nil {
		p.Secrets = map[string]store.SecretMeta{}
	}
	if p.Blobs == nil {
		p.Blobs = map[string]store.CiphertextBlob{}
	}
	if p.Groups == nil {
		p.Groups = map[string]store.Group{}
	}
	if p.DirectShares == nil {
		p.DirectShares = []store.SecretDirectShare{}
	}
	if p.GroupShares == nil {
		p.GroupShares = []store.SecretGroupShare{}
	}
}

func (s *Store) flush() error {
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	_ = os.Remove(s.path) // Windows: rename fails if dest exists
	return os.Rename(tmp, s.path)
}

func (s *Store) Close() error { return nil }

func requireTenant(id store.TenantID) error {
	if id == "" {
		return store.ErrTenantRequired
	}
	return nil
}

func userKey(t store.TenantID, u store.UserID) string {
	return string(t) + "/" + string(u)
}

func secretKey(t store.TenantID, id store.SecretID) string {
	return string(t) + "/" + string(id)
}

func (s *Store) PutTenant(_ context.Context, t store.Tenant) error {
	if t.ID == "" {
		return store.ErrTenantRequired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	if t.CreatedAt.IsZero() {
		if old, ok := s.data.Tenants[string(t.ID)]; ok {
			t.CreatedAt = old.CreatedAt
		} else {
			t.CreatedAt = now
		}
	}
	t.UpdatedAt = now
	s.data.Tenants[string(t.ID)] = t
	return s.flush()
}

func (s *Store) GetTenant(_ context.Context, id store.TenantID) (*store.Tenant, error) {
	if err := requireTenant(id); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.data.Tenants[string(id)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := t
	return &cp, nil
}

func (s *Store) GetTenantBySlug(_ context.Context, slug string) (*store.Tenant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.data.Tenants {
		if t.Slug == slug {
			cp := t
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) ListTenants(_ context.Context) ([]store.Tenant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]store.Tenant, 0, len(s.data.Tenants))
	for _, t := range s.data.Tenants {
		out = append(out, t)
	}
	return out, nil
}

func (s *Store) UpsertUser(_ context.Context, u store.UserRecord) error {
	if err := requireTenant(u.TenantID); err != nil {
		return err
	}
	if u.ID == "" {
		return fmt.Errorf("user id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	key := userKey(u.TenantID, u.ID)
	if u.CreatedAt.IsZero() {
		if old, ok := s.data.Users[key]; ok {
			u.CreatedAt = old.CreatedAt
		} else {
			u.CreatedAt = now
		}
	}
	u.UpdatedAt = now
	s.data.Users[key] = u
	return s.flush()
}

func (s *Store) GetUser(_ context.Context, tenant store.TenantID, id store.UserID) (*store.UserRecord, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.data.Users[userKey(tenant, id)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := u
	return &cp, nil
}

func (s *Store) GetUserByUsername(_ context.Context, tenant store.TenantID, username string) (*store.UserRecord, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.data.Users {
		if u.TenantID == tenant && strings.EqualFold(u.Username, username) {
			cp := u
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) ListUsers(_ context.Context, tenant store.TenantID, q store.UserQuery) ([]store.UserRecord, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	var out []store.UserRecord
	for _, u := range s.data.Users {
		if u.TenantID != tenant {
			continue
		}
		out = append(out, u)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *Store) PutWebAuthnCredential(_ context.Context, c store.WebAuthnCredential) error {
	if err := requireTenant(c.TenantID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.CreatedAt.IsZero() {
		c.CreatedAt = time.Now().UTC()
	}
	found := false
	for i := range s.data.WebAuthn {
		if s.data.WebAuthn[i].TenantID == c.TenantID && s.data.WebAuthn[i].ID == c.ID {
			s.data.WebAuthn[i] = c
			found = true
			break
		}
	}
	if !found {
		s.data.WebAuthn = append(s.data.WebAuthn, c)
	}
	return s.flush()
}

func (s *Store) ListWebAuthnCredentials(_ context.Context, tenant store.TenantID, user store.UserID) ([]store.WebAuthnCredential, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.WebAuthnCredential
	for _, c := range s.data.WebAuthn {
		if c.TenantID == tenant && c.UserID == user {
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *Store) GetWebAuthnCredentialByCredID(_ context.Context, tenant store.TenantID, credentialID []byte) (*store.WebAuthnCredential, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.data.WebAuthn {
		if c.TenantID == tenant && bytes.Equal(c.CredentialID, credentialID) {
			cp := c
			return &cp, nil
		}
	}
	return nil, store.ErrNotFound
}

func (s *Store) DeleteWebAuthnCredential(_ context.Context, tenant store.TenantID, id string) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.data.WebAuthn[:0]
	for _, c := range s.data.WebAuthn {
		if !(c.TenantID == tenant && c.ID == id) {
			next = append(next, c)
		}
	}
	s.data.WebAuthn = next
	return s.flush()
}

func (s *Store) UpdateWebAuthnSignCount(_ context.Context, tenant store.TenantID, id string, signCount uint32) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.WebAuthn {
		if s.data.WebAuthn[i].TenantID == tenant && s.data.WebAuthn[i].ID == id {
			s.data.WebAuthn[i].SignCount = signCount
			return s.flush()
		}
	}
	return store.ErrNotFound
}

func groupKey(t store.TenantID, id store.GroupID) string {
	return string(t) + "/" + string(id)
}

func (s *Store) PutGroup(_ context.Context, g store.Group) error {
	if err := requireTenant(g.TenantID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	if g.CreatedAt.IsZero() {
		if old, ok := s.data.Groups[groupKey(g.TenantID, g.ID)]; ok {
			g.CreatedAt = old.CreatedAt
		} else {
			g.CreatedAt = now
		}
	}
	g.UpdatedAt = now
	s.data.Groups[groupKey(g.TenantID, g.ID)] = g
	return s.flush()
}

func (s *Store) ListGroups(_ context.Context, tenant store.TenantID) ([]store.Group, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.Group
	for _, g := range s.data.Groups {
		if g.TenantID == tenant {
			out = append(out, g)
		}
	}
	return out, nil
}

func (s *Store) DeleteGroup(_ context.Context, tenant store.TenantID, id store.GroupID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data.Groups, groupKey(tenant, id))
	var mem []store.GroupMember
	for _, m := range s.data.Members {
		if !(m.TenantID == tenant && m.GroupID == id) {
			mem = append(mem, m)
		}
	}
	s.data.Members = mem
	var gs []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if !(sh.TenantID == tenant && sh.GroupID == id) {
			gs = append(gs, sh)
		}
	}
	s.data.GroupShares = gs
	return s.flush()
}

func (s *Store) AddGroupMember(_ context.Context, m store.GroupMember) error {
	if err := requireTenant(m.TenantID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, x := range s.data.Members {
		if x == m {
			return nil
		}
	}
	s.data.Members = append(s.data.Members, m)
	return s.flush()
}

func (s *Store) RemoveGroupMember(_ context.Context, tenant store.TenantID, group store.GroupID, user store.UserID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var mem []store.GroupMember
	for _, m := range s.data.Members {
		if !(m.TenantID == tenant && m.GroupID == group && m.UserID == user) {
			mem = append(mem, m)
		}
	}
	s.data.Members = mem
	return s.flush()
}

func (s *Store) ListGroupMembers(_ context.Context, tenant store.TenantID, group store.GroupID) ([]store.UserID, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.UserID
	for _, m := range s.data.Members {
		if m.TenantID == tenant && m.GroupID == group {
			out = append(out, m.UserID)
		}
	}
	return out, nil
}

func (s *Store) ListUserGroups(_ context.Context, tenant store.TenantID, user store.UserID) ([]store.GroupID, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.GroupID
	for _, m := range s.data.Members {
		if m.TenantID == tenant && m.UserID == user {
			out = append(out, m.GroupID)
		}
	}
	return out, nil
}

func (s *Store) ListSecretMetas(_ context.Context, tenant store.TenantID) ([]store.SecretMeta, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretMeta
	for _, m := range s.data.Secrets {
		if m.TenantID == tenant {
			out = append(out, m)
		}
	}
	return out, nil
}

func (s *Store) DeleteSecret(_ context.Context, tenant store.TenantID, id store.SecretID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := secretKey(tenant, id)
	delete(s.data.Secrets, key)
	delete(s.data.Blobs, key)
	var envs []envelopeRec
	for _, e := range s.data.Envelopes {
		if !(e.TenantID == tenant && e.SecretID == id) {
			envs = append(envs, e)
		}
	}
	s.data.Envelopes = envs
	var ds []store.SecretDirectShare
	for _, sh := range s.data.DirectShares {
		if !(sh.TenantID == tenant && sh.SecretID == id) {
			ds = append(ds, sh)
		}
	}
	s.data.DirectShares = ds
	var gs []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if !(sh.TenantID == tenant && sh.SecretID == id) {
			gs = append(gs, sh)
		}
	}
	s.data.GroupShares = gs
	return s.flush()
}

func (s *Store) PutSecretMeta(_ context.Context, meta store.SecretMeta) error {
	if err := requireTenant(meta.TenantID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	key := secretKey(meta.TenantID, meta.ID)
	if meta.CreatedAt.IsZero() {
		if old, ok := s.data.Secrets[key]; ok {
			meta.CreatedAt = old.CreatedAt
		} else {
			meta.CreatedAt = now
		}
	}
	meta.UpdatedAt = now
	s.data.Secrets[key] = meta
	return s.flush()
}

func (s *Store) GetSecretMeta(_ context.Context, tenant store.TenantID, id store.SecretID) (*store.SecretMeta, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.data.Secrets[secretKey(tenant, id)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := m
	return &cp, nil
}

func (s *Store) PutSecretCiphertext(_ context.Context, tenant store.TenantID, id store.SecretID, blob store.CiphertextBlob) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Blobs[secretKey(tenant, id)] = blob
	return s.flush()
}

func (s *Store) GetSecretCiphertext(_ context.Context, tenant store.TenantID, id store.SecretID) (*store.CiphertextBlob, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.data.Blobs[secretKey(tenant, id)]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := b
	return &cp, nil
}

func (s *Store) PutKeyEnvelope(_ context.Context, env store.KeyEnvelope) error {
	if err := requireTenant(env.TenantID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.data.Envelopes {
		if e.TenantID == env.TenantID && e.SecretID == env.SecretID && e.UserID == env.UserID && e.KeyVersion == env.KeyVersion {
			if e.Revoked {
				return store.ErrRevokedEnvelope
			}
			s.data.Envelopes[i] = envelopeRec{KeyEnvelope: env, Revoked: false}
			return s.flush()
		}
	}
	s.data.Envelopes = append(s.data.Envelopes, envelopeRec{KeyEnvelope: env})
	return s.flush()
}

func (s *Store) ListKeyEnvelopes(_ context.Context, tenant store.TenantID, secret store.SecretID) ([]store.KeyEnvelope, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.KeyEnvelope
	for _, e := range s.data.Envelopes {
		if e.TenantID == tenant && e.SecretID == secret && !e.Revoked {
			out = append(out, e.KeyEnvelope)
		}
	}
	return out, nil
}

func (s *Store) ListKeyEnvelopesByTenant(_ context.Context, tenant store.TenantID) ([]store.KeyEnvelope, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.KeyEnvelope
	for _, e := range s.data.Envelopes {
		if e.TenantID == tenant && !e.Revoked {
			out = append(out, e.KeyEnvelope)
		}
	}
	return out, nil
}

func (s *Store) ListSecretKeyVersions(_ context.Context, tenant store.TenantID) (map[store.SecretID]uint32, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	prefix := string(tenant) + "/"
	out := make(map[store.SecretID]uint32)
	for key, b := range s.data.Blobs {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		out[store.SecretID(strings.TrimPrefix(key, prefix))] = b.KeyVersion
	}
	return out, nil
}

func (s *Store) InvalidateKeyVersion(_ context.Context, tenant store.TenantID, secret store.SecretID, version uint32) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.data.Envelopes {
		if e.TenantID == tenant && e.SecretID == secret && e.KeyVersion == version {
			s.data.Envelopes[i].Revoked = true
		}
	}
	return s.flush()
}

func (s *Store) RotateSecret(_ context.Context, tenant store.TenantID, id store.SecretID, oldKeyVersion uint32, meta store.SecretMeta, blob store.CiphertextBlob, envelopes []store.KeyEnvelope) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	if meta.TenantID != tenant || meta.ID != id {
		return store.ErrConflict
	}
	if len(envelopes) == 0 {
		return errors.New("envelopes required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, e := range s.data.Envelopes {
		if e.TenantID == tenant && e.SecretID == id && e.KeyVersion == oldKeyVersion {
			s.data.Envelopes[i].Revoked = true
		}
	}

	now := time.Now().UTC()
	if meta.CreatedAt.IsZero() {
		if old, ok := s.data.Secrets[secretKey(meta.TenantID, meta.ID)]; ok {
			meta.CreatedAt = old.CreatedAt
		} else {
			meta.CreatedAt = now
		}
	}
	meta.UpdatedAt = now
	s.data.Secrets[secretKey(meta.TenantID, meta.ID)] = meta
	s.data.Blobs[secretKey(tenant, id)] = blob

	for _, env := range envelopes {
		if env.TenantID != tenant || env.SecretID != id {
			return store.ErrConflict
		}
		replaced := false
		for i, e := range s.data.Envelopes {
			if e.TenantID == env.TenantID && e.SecretID == env.SecretID && e.UserID == env.UserID && e.KeyVersion == env.KeyVersion {
				if e.Revoked {
					return store.ErrRevokedEnvelope
				}
				s.data.Envelopes[i] = envelopeRec{KeyEnvelope: env, Revoked: false}
				replaced = true
				break
			}
		}
		if !replaced {
			s.data.Envelopes = append(s.data.Envelopes, envelopeRec{KeyEnvelope: env})
		}
	}
	return s.flush()
}

func (s *Store) CreateSecret(_ context.Context, meta store.SecretMeta, blob store.CiphertextBlob, envelopes []store.KeyEnvelope) error {
	if err := requireTenant(meta.TenantID); err != nil {
		return err
	}
	if len(envelopes) == 0 {
		return errors.New("envelopes required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	s.data.Secrets[secretKey(meta.TenantID, meta.ID)] = meta
	s.data.Blobs[secretKey(meta.TenantID, meta.ID)] = blob

	for _, env := range envelopes {
		if env.TenantID != meta.TenantID || env.SecretID != meta.ID {
			return store.ErrConflict
		}
		s.data.Envelopes = append(s.data.Envelopes, envelopeRec{KeyEnvelope: env})
	}
	return s.flush()
}

func (s *Store) PutSecretDirectShare(_ context.Context, share store.SecretDirectShare) error {
	if err := requireTenant(share.TenantID); err != nil {
		return err
	}
	if share.SecretID == "" || share.UserID == "" {
		return errors.New("secret_id and user_id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sh := range s.data.DirectShares {
		if sh.TenantID == share.TenantID && sh.SecretID == share.SecretID && sh.UserID == share.UserID {
			return nil
		}
	}
	s.data.DirectShares = append(s.data.DirectShares, share)
	return s.flush()
}

func (s *Store) DeleteSecretDirectShare(_ context.Context, tenant store.TenantID, secret store.SecretID, user store.UserID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretDirectShare
	for _, sh := range s.data.DirectShares {
		if !(sh.TenantID == tenant && sh.SecretID == secret && sh.UserID == user) {
			out = append(out, sh)
		}
	}
	s.data.DirectShares = out
	return s.flush()
}

func (s *Store) ListSecretDirectShares(_ context.Context, tenant store.TenantID, secret store.SecretID) ([]store.SecretDirectShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretDirectShare
	for _, sh := range s.data.DirectShares {
		if sh.TenantID == tenant && sh.SecretID == secret {
			out = append(out, sh)
		}
	}
	return out, nil
}

func (s *Store) ListSecretDirectSharesByTenant(_ context.Context, tenant store.TenantID) ([]store.SecretDirectShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretDirectShare
	for _, sh := range s.data.DirectShares {
		if sh.TenantID == tenant {
			out = append(out, sh)
		}
	}
	return out, nil
}

func (s *Store) PutSecretGroupShare(_ context.Context, share store.SecretGroupShare) error {
	if err := requireTenant(share.TenantID); err != nil {
		return err
	}
	if share.SecretID == "" || share.GroupID == "" {
		return errors.New("secret_id and group_id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sh := range s.data.GroupShares {
		if sh.TenantID == share.TenantID && sh.SecretID == share.SecretID && sh.GroupID == share.GroupID {
			return nil
		}
	}
	s.data.GroupShares = append(s.data.GroupShares, share)
	return s.flush()
}

func (s *Store) DeleteSecretGroupShare(_ context.Context, tenant store.TenantID, secret store.SecretID, group store.GroupID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if !(sh.TenantID == tenant && sh.SecretID == secret && sh.GroupID == group) {
			out = append(out, sh)
		}
	}
	s.data.GroupShares = out
	return s.flush()
}

func (s *Store) ListSecretGroupShares(_ context.Context, tenant store.TenantID, secret store.SecretID) ([]store.SecretGroupShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if sh.TenantID == tenant && sh.SecretID == secret {
			out = append(out, sh)
		}
	}
	return out, nil
}

func (s *Store) ListSecretGroupSharesByTenant(_ context.Context, tenant store.TenantID) ([]store.SecretGroupShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if sh.TenantID == tenant {
			out = append(out, sh)
		}
	}
	return out, nil
}

func (s *Store) ListSecretGroupSharesByGroup(_ context.Context, tenant store.TenantID, group store.GroupID) ([]store.SecretGroupShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if sh.TenantID == tenant && sh.GroupID == group {
			out = append(out, sh)
		}
	}
	return out, nil
}

func (s *Store) AppendAudit(_ context.Context, e store.AuditEvent) error {
	if err := requireTenant(e.TenantID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	s.data.Audit = append(s.data.Audit, e)
	return s.flush()
}

func (s *Store) ListAudit(_ context.Context, tenant store.TenantID, q store.AuditQuery) ([]store.AuditEvent, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []store.AuditEvent
	for i := len(s.data.Audit) - 1; i >= 0 && len(out) < limit; i-- {
		e := s.data.Audit[i]
		if e.TenantID != tenant {
			continue
		}
		if q.ActionContains != "" && !strings.Contains(strings.ToLower(e.Action), strings.ToLower(q.ActionContains)) {
			continue
		}
		if q.ActorID != "" && e.ActorID != q.ActorID {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

func (s *Store) Health(_ context.Context) (store.Health, error) {
	return store.Health{Backend: "json", OK: true, Detail: "ok"}, nil
}

func (s *Store) ExportSnapshot(_ context.Context, tenant *store.TenantID) (*store.StoreSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var rec store.SnapshotRecords
	var tids []store.TenantID
	if tenant != nil {
		if err := requireTenant(*tenant); err != nil {
			return nil, err
		}
		if _, ok := s.data.Tenants[string(*tenant)]; !ok {
			return nil, store.ErrNotFound
		}
		tids = []store.TenantID{*tenant}
	} else {
		for id := range s.data.Tenants {
			tids = append(tids, store.TenantID(id))
		}
	}
	for _, tid := range tids {
		s.appendTenantSnapshotLocked(&rec, tid)
	}
	raw, err := json.Marshal(rec)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	return &store.StoreSnapshot{
		FormatVersion:  1,
		ExportedAt:     time.Now().UTC(),
		TenantFilter:   tenant,
		Records:        raw,
		ChecksumSHA256: hex.EncodeToString(sum[:]),
	}, nil
}

func (s *Store) appendTenantSnapshotLocked(rec *store.SnapshotRecords, tid store.TenantID) {
	t := s.data.Tenants[string(tid)]
	rec.Tenants = append(rec.Tenants, t)
	for _, u := range s.data.Users {
		if u.TenantID == tid {
			rec.Users = append(rec.Users, u)
		}
	}
	for _, g := range s.data.Groups {
		if g.TenantID == tid {
			rec.Groups = append(rec.Groups, g)
		}
	}
	for _, m := range s.data.Members {
		if m.TenantID == tid {
			rec.Members = append(rec.Members, m)
		}
	}
	for _, c := range s.data.WebAuthn {
		if c.TenantID == tid {
			rec.WebAuthn = append(rec.WebAuthn, c)
		}
	}
	for _, meta := range s.data.Secrets {
		if meta.TenantID != tid {
			continue
		}
		var blobPtr *store.CiphertextBlob
		if b, ok := s.data.Blobs[secretKey(meta.TenantID, meta.ID)]; ok {
			bb := b
			blobPtr = &bb
		}
		var envs []store.KeyEnvelope
		for _, e := range s.data.Envelopes {
			if e.TenantID == meta.TenantID && e.SecretID == meta.ID && !e.Revoked {
				envs = append(envs, e.KeyEnvelope)
			}
		}
		rec.Secrets = append(rec.Secrets, store.SnapshotSecret{Meta: meta, Blob: blobPtr, Envs: envs})
	}
	for _, sh := range s.data.DirectShares {
		if sh.TenantID == tid {
			rec.DirectShares = append(rec.DirectShares, sh)
		}
	}
	for _, sh := range s.data.GroupShares {
		if sh.TenantID == tid {
			rec.GroupShares = append(rec.GroupShares, sh)
		}
	}
}

func (s *Store) wipeTenantLocked(tid store.TenantID) {
	delete(s.data.Tenants, string(tid))
	for k, u := range s.data.Users {
		if u.TenantID == tid {
			delete(s.data.Users, k)
		}
	}
	for k, meta := range s.data.Secrets {
		if meta.TenantID == tid {
			delete(s.data.Secrets, k)
			delete(s.data.Blobs, k)
		}
	}
	var envs []envelopeRec
	for _, e := range s.data.Envelopes {
		if e.TenantID != tid {
			envs = append(envs, e)
		}
	}
	s.data.Envelopes = envs
	for k, g := range s.data.Groups {
		if g.TenantID == tid {
			delete(s.data.Groups, k)
		}
	}
	var mem []store.GroupMember
	for _, m := range s.data.Members {
		if m.TenantID != tid {
			mem = append(mem, m)
		}
	}
	s.data.Members = mem
	var wa []store.WebAuthnCredential
	for _, c := range s.data.WebAuthn {
		if c.TenantID != tid {
			wa = append(wa, c)
		}
	}
	s.data.WebAuthn = wa
	var ds []store.SecretDirectShare
	for _, sh := range s.data.DirectShares {
		if sh.TenantID != tid {
			ds = append(ds, sh)
		}
	}
	s.data.DirectShares = ds
	var gs []store.SecretGroupShare
	for _, sh := range s.data.GroupShares {
		if sh.TenantID != tid {
			gs = append(gs, sh)
		}
	}
	s.data.GroupShares = gs
	var audit []store.AuditEvent
	for _, e := range s.data.Audit {
		if e.TenantID != tid {
			audit = append(audit, e)
		}
	}
	s.data.Audit = audit
}

func (s *Store) ImportSnapshot(_ context.Context, snap store.StoreSnapshot, mode store.ImportMode) error {
	sum := sha256.Sum256(snap.Records)
	if hex.EncodeToString(sum[:]) != snap.ChecksumSHA256 {
		return errors.New("snapshot checksum mismatch")
	}
	var rec store.SnapshotRecords
	if err := json.Unmarshal(snap.Records, &rec); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if mode == store.ImportReplace {
		if snap.TenantFilter != nil {
			s.wipeTenantLocked(*snap.TenantFilter)
		} else {
			s.data = empty()
		}
	}
	for _, t := range rec.Tenants {
		s.data.Tenants[string(t.ID)] = t
	}
	for _, u := range rec.Users {
		s.data.Users[userKey(u.TenantID, u.ID)] = u
	}
	for _, g := range rec.Groups {
		s.data.Groups[groupKey(g.TenantID, g.ID)] = g
	}
	for _, m := range rec.Members {
		s.data.Members = append(s.data.Members, m)
	}
	for _, c := range rec.WebAuthn {
		s.data.WebAuthn = append(s.data.WebAuthn, c)
	}
	for _, sec := range rec.Secrets {
		s.data.Secrets[secretKey(sec.Meta.TenantID, sec.Meta.ID)] = sec.Meta
		if sec.Blob != nil {
			s.data.Blobs[secretKey(sec.Meta.TenantID, sec.Meta.ID)] = *sec.Blob
		}
		for _, env := range sec.Envs {
			s.data.Envelopes = append(s.data.Envelopes, envelopeRec{KeyEnvelope: env})
		}
	}
	for _, sh := range rec.DirectShares {
		s.data.DirectShares = append(s.data.DirectShares, sh)
	}
	for _, sh := range rec.GroupShares {
		s.data.GroupShares = append(s.data.GroupShares, sh)
	}
	return s.flush()
}

var _ store.VaultStore = (*Store)(nil)

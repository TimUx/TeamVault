package jsonfile

import (
	"context"
	"errors"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

func (s *Store) putEnvelopeLocked(env store.KeyEnvelope) error {
	if err := requireTenant(env.TenantID); err != nil {
		return err
	}
	for i, e := range s.data.Envelopes {
		if e.TenantID == env.TenantID && e.SecretID == env.SecretID && e.UserID == env.UserID && e.KeyVersion == env.KeyVersion {
			if e.Revoked {
				return store.ErrRevokedEnvelope
			}
			s.data.Envelopes[i] = envelopeRec{KeyEnvelope: env, Revoked: false}
			return nil
		}
	}
	s.data.Envelopes = append(s.data.Envelopes, envelopeRec{KeyEnvelope: env})
	return nil
}

func (s *Store) appendAuditLocked(e *store.AuditEvent) {
	if e == nil {
		return
	}
	ev := *e
	if ev.CreatedAt.IsZero() {
		ev.CreatedAt = time.Now().UTC()
	}
	s.data.Audit = append(s.data.Audit, ev)
}

func (s *Store) ShareSecret(_ context.Context, envelopes []store.KeyEnvelope, directs []store.SecretDirectShare, audit *store.AuditEvent) error {
	if err := store.ValidateAudit(audit); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, env := range envelopes {
		if err := s.putEnvelopeLocked(env); err != nil {
			return err
		}
	}
	for _, share := range directs {
		if err := requireTenant(share.TenantID); err != nil {
			return err
		}
		if share.SecretID == "" || share.UserID == "" {
			return errors.New("secret_id and user_id required")
		}
		exists := false
		for _, sh := range s.data.DirectShares {
			if sh.TenantID == share.TenantID && sh.SecretID == share.SecretID && sh.UserID == share.UserID {
				exists = true
				break
			}
		}
		if !exists {
			s.data.DirectShares = append(s.data.DirectShares, share)
		}
	}
	s.appendAuditLocked(audit)
	return s.flush()
}

func (s *Store) ShareSecretGroup(_ context.Context, envelopes []store.KeyEnvelope, group store.SecretGroupShare, audit *store.AuditEvent) error {
	if err := store.ValidateAudit(audit); err != nil {
		return err
	}
	if err := requireTenant(group.TenantID); err != nil {
		return err
	}
	if group.SecretID == "" || group.GroupID == "" {
		return errors.New("secret_id and group_id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, env := range envelopes {
		if err := s.putEnvelopeLocked(env); err != nil {
			return err
		}
	}
	exists := false
	for _, sh := range s.data.GroupShares {
		if sh.TenantID == group.TenantID && sh.SecretID == group.SecretID && sh.GroupID == group.GroupID {
			exists = true
			break
		}
	}
	if !exists {
		s.data.GroupShares = append(s.data.GroupShares, group)
	}
	s.appendAuditLocked(audit)
	return s.flush()
}

func (s *Store) RemoveGroupMemberWithRevoke(_ context.Context, tenant store.TenantID, group store.GroupID, user store.UserID, audit *store.AuditEvent) ([]store.SecretID, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	if err := store.ValidateAudit(audit); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	var rotate []store.SecretID
	seen := map[store.SecretID]bool{}
	for _, sh := range s.data.GroupShares {
		if sh.TenantID != tenant || sh.GroupID != group {
			continue
		}
		if seen[sh.SecretID] {
			continue
		}
		seen[sh.SecretID] = true
		keep := false
		for _, d := range s.data.DirectShares {
			if d.TenantID == tenant && d.SecretID == sh.SecretID && d.UserID == user {
				keep = true
				break
			}
		}
		if keep {
			continue
		}
		for i, e := range s.data.Envelopes {
			if e.TenantID == tenant && e.SecretID == sh.SecretID && e.UserID == user && !e.Revoked {
				s.data.Envelopes[i].Revoked = true
			}
		}
		rotate = append(rotate, sh.SecretID)
	}
	var mem []store.GroupMember
	for _, m := range s.data.Members {
		if !(m.TenantID == tenant && m.GroupID == group && m.UserID == user) {
			mem = append(mem, m)
		}
	}
	s.data.Members = mem
	s.appendAuditLocked(audit)
	if err := s.flush(); err != nil {
		return nil, err
	}
	return rotate, nil
}

package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/teamvault/teamvault/internal/store"
)

func insertAuditTx(ctx context.Context, tx *sql.Tx, e *store.AuditEvent) error {
	if e == nil {
		return nil
	}
	if err := store.ValidateAudit(e); err != nil {
		return err
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	meta := e.Metadata
	if len(meta) == 0 {
		meta = json.RawMessage(`{}`)
	}
	_, err := tx.ExecContext(ctx, `
INSERT INTO audit_events(id, tenant_id, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, created_at)
VALUES(?,?,?,?,?,?,?,?,?,?)`, e.ID, e.TenantID, e.ActorID, e.Action, e.ResourceType, e.ResourceID,
		e.IP, e.UserAgent, string(meta), e.CreatedAt.Format(time.RFC3339Nano))
	return err
}

func putKeyEnvelopeTx(ctx context.Context, tx *sql.Tx, env store.KeyEnvelope) error {
	if err := requireTenant(env.TenantID); err != nil {
		return err
	}
	var revoked int
	err := tx.QueryRowContext(ctx, `
SELECT revoked FROM key_envelopes
WHERE tenant_id = ? AND secret_id = ? AND user_id = ? AND key_version = ?`,
		env.TenantID, env.SecretID, env.UserID, env.KeyVersion).Scan(&revoked)
	if err == nil && revoked != 0 {
		return store.ErrRevokedEnvelope
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO key_envelopes(secret_id, tenant_id, user_id, key_version, wrapped_dk, revoked)
VALUES(?,?,?,?,?,0)
ON CONFLICT(tenant_id, secret_id, user_id, key_version) DO UPDATE SET
  wrapped_dk=excluded.wrapped_dk
WHERE key_envelopes.revoked = 0
`, env.SecretID, env.TenantID, env.UserID, env.KeyVersion, env.WrappedDK)
	return err
}

func (s *Store) ShareSecret(ctx context.Context, envelopes []store.KeyEnvelope, directs []store.SecretDirectShare, audit *store.AuditEvent) error {
	if err := store.ValidateAudit(audit); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, env := range envelopes {
		if err := putKeyEnvelopeTx(ctx, tx, env); err != nil {
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
		cap := store.NormalizeCapability(share.Capability)
		if _, err := tx.ExecContext(ctx, `
INSERT INTO secret_direct_shares(tenant_id, secret_id, user_id, capability) VALUES(?,?,?,?)
ON CONFLICT(tenant_id, secret_id, user_id) DO UPDATE SET capability=excluded.capability`,
			share.TenantID, share.SecretID, share.UserID, cap); err != nil {
			return err
		}
	}
	if err := insertAuditTx(ctx, tx, audit); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ShareSecretGroup(ctx context.Context, envelopes []store.KeyEnvelope, group store.SecretGroupShare, audit *store.AuditEvent) error {
	if err := store.ValidateAudit(audit); err != nil {
		return err
	}
	if err := requireTenant(group.TenantID); err != nil {
		return err
	}
	if group.SecretID == "" || group.GroupID == "" {
		return errors.New("secret_id and group_id required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, env := range envelopes {
		if err := putKeyEnvelopeTx(ctx, tx, env); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO secret_group_shares(tenant_id, secret_id, group_id, capability) VALUES(?,?,?,?)
ON CONFLICT(tenant_id, secret_id, group_id) DO UPDATE SET capability=excluded.capability`,
		group.TenantID, group.SecretID, group.GroupID, store.NormalizeCapability(group.Capability)); err != nil {
		return err
	}
	if err := insertAuditTx(ctx, tx, audit); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) RemoveGroupMemberWithRevoke(ctx context.Context, tenant store.TenantID, group store.GroupID, user store.UserID, audit *store.AuditEvent) ([]store.SecretID, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	if err := store.ValidateAudit(audit); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx,
		`SELECT secret_id FROM secret_group_shares WHERE tenant_id = ? AND group_id = ?`,
		tenant, group)
	if err != nil {
		return nil, err
	}
	var secrets []store.SecretID
	for rows.Next() {
		var id store.SecretID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		secrets = append(secrets, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	var rotate []store.SecretID
	seen := map[store.SecretID]bool{}
	for _, sid := range secrets {
		if seen[sid] {
			continue
		}
		seen[sid] = true
		var n int
		err := tx.QueryRowContext(ctx, `
SELECT COUNT(*) FROM secret_direct_shares
WHERE tenant_id = ? AND secret_id = ? AND user_id = ?`, tenant, sid, user).Scan(&n)
		if err != nil {
			return nil, err
		}
		if n > 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE key_envelopes SET revoked = 1
WHERE tenant_id = ? AND secret_id = ? AND user_id = ? AND revoked = 0`, tenant, sid, user); err != nil {
			return nil, err
		}
		rotate = append(rotate, sid)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE tenant_id = ? AND group_id = ? AND user_id = ?`, tenant, group, user); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, audit); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rotate, nil
}

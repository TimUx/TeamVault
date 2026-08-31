package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/store"

	_ "modernc.org/sqlite"
)

const schemaVersion = 6

type Store struct {
	db *sql.DB
}

func Open(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  recovery_mode TEXT NOT NULL,
  escrow_allowed INTEGER NOT NULL DEFAULT 1,
  escrow_public_key BLOB,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  auth_backend TEXT NOT NULL,
  local_password_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  public_key BLOB,
  encrypted_private_key BLOB,
  encrypted_private_key_recovery BLOB,
  escrow_envelope BLOB,
  totp_secret_enc BLOB,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  onboarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, username)
);
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  collection_id TEXT NOT NULL DEFAULT '',
  title_ciphertext BLOB NOT NULL,
  title_nonce BLOB NOT NULL,
  created_by TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS secret_ciphertext (
  secret_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, secret_id)
);
CREATE TABLE IF NOT EXISTS key_envelopes (
  secret_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  wrapped_dk BLOB NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, secret_id, user_id, key_version)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS group_members (
  tenant_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, group_id, user_id)
);
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credential_id BLOB NOT NULL,
  public_key BLOB NOT NULL,
  attestation TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL DEFAULT '[]',
  sign_count INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  aaguid BLOB,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_cred ON webauthn_credentials(tenant_id, credential_id);
CREATE TABLE IF NOT EXISTS secret_direct_shares (
  tenant_id TEXT NOT NULL,
  secret_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, secret_id, user_id)
);
CREATE TABLE IF NOT EXISTS secret_group_shares (
  tenant_id TEXT NOT NULL,
  secret_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, secret_id, group_id)
);
`)
	if err != nil {
		return err
	}
	// Best-effort upgrades from v1…v5.
	for _, q := range []string{
		`ALTER TABLE tenants ADD COLUMN escrow_public_key BLOB`,
		`ALTER TABLE users ADD COLUMN escrow_envelope BLOB`,
		`ALTER TABLE users ADD COLUMN totp_secret_enc BLOB`,
		`ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`,
		`CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
  credential_id BLOB NOT NULL, public_key BLOB NOT NULL,
  attestation TEXT NOT NULL DEFAULT '', transport TEXT NOT NULL DEFAULT '[]',
  sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '',
  aaguid BLOB, created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_cred ON webauthn_credentials(tenant_id, credential_id)`,
		`CREATE TABLE IF NOT EXISTS secret_direct_shares (
  tenant_id TEXT NOT NULL, secret_id TEXT NOT NULL, user_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, secret_id, user_id)
)`,
		`CREATE TABLE IF NOT EXISTS secret_group_shares (
  tenant_id TEXT NOT NULL, secret_id TEXT NOT NULL, group_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, secret_id, group_id)
)`,
		`ALTER TABLE secrets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`,
	} {
		_, _ = s.db.Exec(q)
	}
	// v6: mark existing shared secrets (explicit shares or extra envelopes).
	_, _ = s.db.Exec(`
UPDATE secrets SET visibility = 'shared'
WHERE visibility = 'private' AND (
  EXISTS (
    SELECT 1 FROM secret_direct_shares d
    WHERE d.tenant_id = secrets.tenant_id AND d.secret_id = secrets.id
  )
  OR EXISTS (
    SELECT 1 FROM secret_group_shares g
    WHERE g.tenant_id = secrets.tenant_id AND g.secret_id = secrets.id
  )
  OR EXISTS (
    SELECT 1 FROM key_envelopes e
    WHERE e.tenant_id = secrets.tenant_id AND e.secret_id = secrets.id
      AND e.revoked = 0 AND e.user_id != secrets.created_by
  )
)`)
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, schemaVersion).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		_, err = s.db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`,
			schemaVersion, time.Now().UTC().Format(time.RFC3339Nano))
	}
	return err
}

func requireTenant(id store.TenantID) error {
	if id == "" {
		return store.ErrTenantRequired
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *Store) PutTenant(ctx context.Context, t store.Tenant) error {
	if t.ID == "" {
		return store.ErrTenantRequired
	}
	now := time.Now().UTC()
	if t.CreatedAt.IsZero() {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `
INSERT INTO tenants(id, name, slug, recovery_mode, escrow_allowed, escrow_public_key, status, created_at, updated_at)
VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, slug=excluded.slug, recovery_mode=excluded.recovery_mode,
  escrow_allowed=excluded.escrow_allowed, escrow_public_key=excluded.escrow_public_key,
  status=excluded.status, updated_at=excluded.updated_at
`, t.ID, t.Name, t.Slug, t.RecoveryMode, boolToInt(t.EscrowAllowed), t.EscrowPublicKey, t.Status,
		t.CreatedAt.Format(time.RFC3339Nano), t.UpdatedAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) GetTenant(ctx context.Context, id store.TenantID) (*store.Tenant, error) {
	if err := requireTenant(id); err != nil {
		return nil, err
	}
	return s.scanTenant(s.db.QueryRowContext(ctx, `
SELECT id, name, slug, recovery_mode, escrow_allowed, escrow_public_key, status, created_at, updated_at
FROM tenants WHERE id = ?`, id))
}

func (s *Store) GetTenantBySlug(ctx context.Context, slug string) (*store.Tenant, error) {
	return s.scanTenant(s.db.QueryRowContext(ctx, `
SELECT id, name, slug, recovery_mode, escrow_allowed, escrow_public_key, status, created_at, updated_at
FROM tenants WHERE slug = ?`, slug))
}

func (s *Store) ListTenants(ctx context.Context) ([]store.Tenant, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, name, slug, recovery_mode, escrow_allowed, escrow_public_key, status, created_at, updated_at
FROM tenants ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Tenant
	for rows.Next() {
		t, err := s.scanTenant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (s *Store) scanTenant(row scanner) (*store.Tenant, error) {
	var t store.Tenant
	var escrow int
	var cAt, uAt string
	if err := row.Scan(&t.ID, &t.Name, &t.Slug, &t.RecoveryMode, &escrow, &t.EscrowPublicKey, &t.Status, &cAt, &uAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrNotFound
		}
		return nil, err
	}
	t.EscrowAllowed = escrow == 1
	t.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
	t.UpdatedAt, _ = time.Parse(time.RFC3339Nano, uAt)
	return &t, nil
}

func (s *Store) UpsertUser(ctx context.Context, u store.UserRecord) error {
	if err := requireTenant(u.TenantID); err != nil {
		return err
	}
	if u.ID == "" {
		return fmt.Errorf("user id required")
	}
	now := time.Now().UTC()
	if u.CreatedAt.IsZero() {
		u.CreatedAt = now
	}
	u.UpdatedAt = now
	var onboarded any
	if u.OnboardedAt != nil {
		onboarded = u.OnboardedAt.UTC().Format(time.RFC3339Nano)
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO users(id, tenant_id, username, display_name, email, auth_backend, local_password_hash,
  status, roles_json, public_key, encrypted_private_key, encrypted_private_key_recovery,
  escrow_envelope, totp_secret_enc, totp_enabled, onboarded_at, created_at, updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(tenant_id, id) DO UPDATE SET
  username=excluded.username, display_name=excluded.display_name, email=excluded.email,
  auth_backend=excluded.auth_backend, local_password_hash=excluded.local_password_hash,
  status=excluded.status, roles_json=excluded.roles_json, public_key=excluded.public_key,
  encrypted_private_key=excluded.encrypted_private_key,
  encrypted_private_key_recovery=excluded.encrypted_private_key_recovery,
  escrow_envelope=excluded.escrow_envelope, totp_secret_enc=excluded.totp_secret_enc,
  totp_enabled=excluded.totp_enabled, onboarded_at=excluded.onboarded_at, updated_at=excluded.updated_at
`, u.ID, u.TenantID, u.Username, u.DisplayName, u.Email, u.AuthBackend, u.LocalPasswordHash,
		u.Status, u.RolesJSON, u.PublicKey, u.EncryptedPrivateKey, u.EncryptedPrivateKeyRecovery,
		u.EscrowEnvelope, u.TotpSecretEnc, boolToInt(u.TotpEnabled),
		onboarded, u.CreatedAt.Format(time.RFC3339Nano), u.UpdatedAt.Format(time.RFC3339Nano))
	return err
}

type scanner interface{ Scan(dest ...any) error }

func scanUser(row scanner) (*store.UserRecord, error) {
	var u store.UserRecord
	var onboarded, cAt, uAt sql.NullString
	var totpEnabled int
	if err := row.Scan(&u.ID, &u.TenantID, &u.Username, &u.DisplayName, &u.Email, &u.AuthBackend,
		&u.LocalPasswordHash, &u.Status, &u.RolesJSON, &u.PublicKey, &u.EncryptedPrivateKey,
		&u.EncryptedPrivateKeyRecovery, &u.EscrowEnvelope, &u.TotpSecretEnc, &totpEnabled,
		&onboarded, &cAt, &uAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrNotFound
		}
		return nil, err
	}
	u.TotpEnabled = totpEnabled == 1
	if onboarded.Valid {
		t, _ := time.Parse(time.RFC3339Nano, onboarded.String)
		u.OnboardedAt = &t
	}
	u.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt.String)
	u.UpdatedAt, _ = time.Parse(time.RFC3339Nano, uAt.String)
	return &u, nil
}

func (s *Store) GetUser(ctx context.Context, tenant store.TenantID, id store.UserID) (*store.UserRecord, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	row := s.db.QueryRowContext(ctx, `
SELECT id, tenant_id, username, display_name, email, auth_backend, local_password_hash, status, roles_json,
  public_key, encrypted_private_key, encrypted_private_key_recovery, escrow_envelope, totp_secret_enc, totp_enabled,
  onboarded_at, created_at, updated_at
FROM users WHERE tenant_id = ? AND id = ?`, tenant, id)
	return scanUser(row)
}

func (s *Store) GetUserByUsername(ctx context.Context, tenant store.TenantID, username string) (*store.UserRecord, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	row := s.db.QueryRowContext(ctx, `
SELECT id, tenant_id, username, display_name, email, auth_backend, local_password_hash, status, roles_json,
  public_key, encrypted_private_key, encrypted_private_key_recovery, escrow_envelope, totp_secret_enc, totp_enabled,
  onboarded_at, created_at, updated_at
FROM users WHERE tenant_id = ? AND lower(username) = lower(?)`, tenant, username)
	return scanUser(row)
}

func (s *Store) ListUsers(ctx context.Context, tenant store.TenantID, q store.UserQuery) ([]store.UserRecord, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, tenant_id, username, display_name, email, auth_backend, local_password_hash, status, roles_json,
  public_key, encrypted_private_key, encrypted_private_key_recovery, escrow_envelope, totp_secret_enc, totp_enabled,
  onboarded_at, created_at, updated_at
FROM users WHERE tenant_id = ?
ORDER BY username LIMIT ?`, tenant, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.UserRecord
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (s *Store) PutWebAuthnCredential(ctx context.Context, c store.WebAuthnCredential) error {
	if err := requireTenant(c.TenantID); err != nil {
		return err
	}
	if c.ID == "" || c.UserID == "" || len(c.CredentialID) == 0 {
		return fmt.Errorf("webauthn credential incomplete")
	}
	if c.CreatedAt.IsZero() {
		c.CreatedAt = time.Now().UTC()
	}
	if c.Transport == "" {
		c.Transport = "[]"
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO webauthn_credentials(id, tenant_id, user_id, credential_id, public_key, attestation, transport, sign_count, name, aaguid, created_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(tenant_id, id) DO UPDATE SET
  credential_id=excluded.credential_id, public_key=excluded.public_key, attestation=excluded.attestation,
  transport=excluded.transport, sign_count=excluded.sign_count, name=excluded.name, aaguid=excluded.aaguid
`, c.ID, c.TenantID, c.UserID, c.CredentialID, c.PublicKey, c.Attestation, c.Transport, c.SignCount, c.Name, c.AAGUID,
		c.CreatedAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) ListWebAuthnCredentials(ctx context.Context, tenant store.TenantID, user store.UserID) ([]store.WebAuthnCredential, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, tenant_id, user_id, credential_id, public_key, attestation, transport, sign_count, name, aaguid, created_at
FROM webauthn_credentials WHERE tenant_id = ? AND user_id = ?`, tenant, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.WebAuthnCredential
	for rows.Next() {
		var c store.WebAuthnCredential
		var cAt string
		if err := rows.Scan(&c.ID, &c.TenantID, &c.UserID, &c.CredentialID, &c.PublicKey, &c.Attestation, &c.Transport,
			&c.SignCount, &c.Name, &c.AAGUID, &cAt); err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetWebAuthnCredentialByCredID(ctx context.Context, tenant store.TenantID, credentialID []byte) (*store.WebAuthnCredential, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	row := s.db.QueryRowContext(ctx, `
SELECT id, tenant_id, user_id, credential_id, public_key, attestation, transport, sign_count, name, aaguid, created_at
FROM webauthn_credentials WHERE tenant_id = ? AND credential_id = ?`, tenant, credentialID)
	var c store.WebAuthnCredential
	var cAt string
	if err := row.Scan(&c.ID, &c.TenantID, &c.UserID, &c.CredentialID, &c.PublicKey, &c.Attestation, &c.Transport,
		&c.SignCount, &c.Name, &c.AAGUID, &cAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrNotFound
		}
		return nil, err
	}
	c.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
	return &c, nil
}

func (s *Store) DeleteWebAuthnCredential(ctx context.Context, tenant store.TenantID, id string) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM webauthn_credentials WHERE tenant_id = ? AND id = ?`, tenant, id)
	return err
}

func (s *Store) UpdateWebAuthnSignCount(ctx context.Context, tenant store.TenantID, id string, signCount uint32) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE webauthn_credentials SET sign_count = ? WHERE tenant_id = ? AND id = ?`, signCount, tenant, id)
	return err
}

func (s *Store) PutSecretMeta(ctx context.Context, meta store.SecretMeta) error {
	if err := requireTenant(meta.TenantID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	meta.Visibility = store.NormalizeVisibility(meta.Visibility)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO secrets(id, tenant_id, collection_id, title_ciphertext, title_nonce, created_by, visibility, created_at, updated_at)
VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(tenant_id, id) DO UPDATE SET
  collection_id=excluded.collection_id, title_ciphertext=excluded.title_ciphertext,
  title_nonce=excluded.title_nonce, visibility=excluded.visibility, updated_at=excluded.updated_at
`, meta.ID, meta.TenantID, meta.CollectionID, meta.TitleCiphertext, meta.TitleNonce, meta.CreatedBy, string(meta.Visibility),
		meta.CreatedAt.Format(time.RFC3339Nano), meta.UpdatedAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) GetSecretMeta(ctx context.Context, tenant store.TenantID, id store.SecretID) (*store.SecretMeta, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	row := s.db.QueryRowContext(ctx, `
SELECT id, tenant_id, collection_id, title_ciphertext, title_nonce, created_by, COALESCE(visibility,'private'), created_at, updated_at
FROM secrets WHERE tenant_id = ? AND id = ?`, tenant, id)
	var m store.SecretMeta
	var cAt, uAt, vis string
	if err := row.Scan(&m.ID, &m.TenantID, &m.CollectionID, &m.TitleCiphertext, &m.TitleNonce, &m.CreatedBy, &vis, &cAt, &uAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrNotFound
		}
		return nil, err
	}
	m.Visibility = store.NormalizeVisibility(store.SecretVisibility(vis))
	m.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
	m.UpdatedAt, _ = time.Parse(time.RFC3339Nano, uAt)
	return &m, nil
}

func (s *Store) ListSecretMetas(ctx context.Context, tenant store.TenantID) ([]store.SecretMeta, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, tenant_id, collection_id, title_ciphertext, title_nonce, created_by, COALESCE(visibility,'private'), created_at, updated_at
FROM secrets WHERE tenant_id = ? ORDER BY updated_at DESC`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SecretMeta
	for rows.Next() {
		var m store.SecretMeta
		var cAt, uAt, vis string
		if err := rows.Scan(&m.ID, &m.TenantID, &m.CollectionID, &m.TitleCiphertext, &m.TitleNonce, &m.CreatedBy, &vis, &cAt, &uAt); err != nil {
			return nil, err
		}
		m.Visibility = store.NormalizeVisibility(store.SecretVisibility(vis))
		m.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
		m.UpdatedAt, _ = time.Parse(time.RFC3339Nano, uAt)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) DeleteSecret(ctx context.Context, tenant store.TenantID, id store.SecretID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, q := range []string{
		`DELETE FROM secret_direct_shares WHERE tenant_id = ? AND secret_id = ?`,
		`DELETE FROM secret_group_shares WHERE tenant_id = ? AND secret_id = ?`,
		`DELETE FROM key_envelopes WHERE tenant_id = ? AND secret_id = ?`,
		`DELETE FROM secret_ciphertext WHERE tenant_id = ? AND secret_id = ?`,
		`DELETE FROM secrets WHERE tenant_id = ? AND id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, tenant, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) PutGroup(ctx context.Context, g store.Group) error {
	if err := requireTenant(g.TenantID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if g.CreatedAt.IsZero() {
		g.CreatedAt = now
	}
	g.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `
INSERT INTO groups(id, tenant_id, name, description, created_at, updated_at)
VALUES(?,?,?,?,?,?)
ON CONFLICT(tenant_id, id) DO UPDATE SET name=excluded.name, description=excluded.description, updated_at=excluded.updated_at
`, g.ID, g.TenantID, g.Name, g.Description, g.CreatedAt.Format(time.RFC3339Nano), g.UpdatedAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) ListGroups(ctx context.Context, tenant store.TenantID) ([]store.Group, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, tenant_id, name, description, created_at, updated_at FROM groups WHERE tenant_id = ? ORDER BY name`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Group
	for rows.Next() {
		var g store.Group
		var cAt, uAt string
		if err := rows.Scan(&g.ID, &g.TenantID, &g.Name, &g.Description, &cAt, &uAt); err != nil {
			return nil, err
		}
		g.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
		g.UpdatedAt, _ = time.Parse(time.RFC3339Nano, uAt)
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Store) DeleteGroup(ctx context.Context, tenant store.TenantID, id store.GroupID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_members WHERE tenant_id = ? AND group_id = ?`, tenant, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM secret_group_shares WHERE tenant_id = ? AND group_id = ?`, tenant, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM groups WHERE tenant_id = ? AND id = ?`, tenant, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) AddGroupMember(ctx context.Context, m store.GroupMember) error {
	if err := requireTenant(m.TenantID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO group_members(tenant_id, group_id, user_id) VALUES(?,?,?)
ON CONFLICT(tenant_id, group_id, user_id) DO NOTHING`, m.TenantID, m.GroupID, m.UserID)
	return err
}

func (s *Store) RemoveGroupMember(ctx context.Context, tenant store.TenantID, group store.GroupID, user store.UserID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM group_members WHERE tenant_id = ? AND group_id = ? AND user_id = ?`, tenant, group, user)
	return err
}

func (s *Store) ListGroupMembers(ctx context.Context, tenant store.TenantID, group store.GroupID) ([]store.UserID, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT user_id FROM group_members WHERE tenant_id = ? AND group_id = ?`, tenant, group)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.UserID
	for rows.Next() {
		var id store.UserID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) ListUserGroups(ctx context.Context, tenant store.TenantID, user store.UserID) ([]store.GroupID, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT group_id FROM group_members WHERE tenant_id = ? AND user_id = ?`, tenant, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.GroupID
	for rows.Next() {
		var id store.GroupID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) PutSecretCiphertext(ctx context.Context, tenant store.TenantID, id store.SecretID, blob store.CiphertextBlob) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO secret_ciphertext(secret_id, tenant_id, ciphertext, nonce, key_version, content_type)
VALUES(?,?,?,?,?,?)
ON CONFLICT(tenant_id, secret_id) DO UPDATE SET
  ciphertext=excluded.ciphertext, nonce=excluded.nonce, key_version=excluded.key_version,
  content_type=excluded.content_type
`, id, tenant, blob.Ciphertext, blob.Nonce, blob.KeyVersion, blob.ContentType)
	return err
}

func (s *Store) GetSecretCiphertext(ctx context.Context, tenant store.TenantID, id store.SecretID) (*store.CiphertextBlob, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	row := s.db.QueryRowContext(ctx, `
SELECT ciphertext, nonce, key_version, content_type FROM secret_ciphertext
WHERE tenant_id = ? AND secret_id = ?`, tenant, id)
	var b store.CiphertextBlob
	if err := row.Scan(&b.Ciphertext, &b.Nonce, &b.KeyVersion, &b.ContentType); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, store.ErrNotFound
		}
		return nil, err
	}
	return &b, nil
}

func (s *Store) PutKeyEnvelope(ctx context.Context, env store.KeyEnvelope) error {
	if err := requireTenant(env.TenantID); err != nil {
		return err
	}
	var revoked int
	err := s.db.QueryRowContext(ctx, `
SELECT revoked FROM key_envelopes
WHERE tenant_id = ? AND secret_id = ? AND user_id = ? AND key_version = ?`,
		env.TenantID, env.SecretID, env.UserID, env.KeyVersion).Scan(&revoked)
	if err == nil && revoked != 0 {
		return store.ErrRevokedEnvelope
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO key_envelopes(secret_id, tenant_id, user_id, key_version, wrapped_dk, revoked)
VALUES(?,?,?,?,?,0)
ON CONFLICT(tenant_id, secret_id, user_id, key_version) DO UPDATE SET
  wrapped_dk=excluded.wrapped_dk
WHERE key_envelopes.revoked = 0
`, env.SecretID, env.TenantID, env.UserID, env.KeyVersion, env.WrappedDK)
	return err
}

func (s *Store) ListKeyEnvelopes(ctx context.Context, tenant store.TenantID, secret store.SecretID) ([]store.KeyEnvelope, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT secret_id, tenant_id, user_id, key_version, wrapped_dk FROM key_envelopes
WHERE tenant_id = ? AND secret_id = ? AND revoked = 0`, tenant, secret)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.KeyEnvelope
	for rows.Next() {
		var e store.KeyEnvelope
		if err := rows.Scan(&e.SecretID, &e.TenantID, &e.UserID, &e.KeyVersion, &e.WrappedDK); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) ListKeyEnvelopesByTenant(ctx context.Context, tenant store.TenantID) ([]store.KeyEnvelope, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT secret_id, tenant_id, user_id, key_version, wrapped_dk FROM key_envelopes
WHERE tenant_id = ? AND revoked = 0`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.KeyEnvelope
	for rows.Next() {
		var e store.KeyEnvelope
		if err := rows.Scan(&e.SecretID, &e.TenantID, &e.UserID, &e.KeyVersion, &e.WrappedDK); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) ListSecretKeyVersions(ctx context.Context, tenant store.TenantID) (map[store.SecretID]uint32, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT secret_id, key_version FROM secret_ciphertext WHERE tenant_id = ?`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[store.SecretID]uint32)
	for rows.Next() {
		var id store.SecretID
		var kv uint32
		if err := rows.Scan(&id, &kv); err != nil {
			return nil, err
		}
		out[id] = kv
	}
	return out, rows.Err()
}

func (s *Store) InvalidateKeyVersion(ctx context.Context, tenant store.TenantID, secret store.SecretID, version uint32) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
UPDATE key_envelopes SET revoked = 1
WHERE tenant_id = ? AND secret_id = ? AND key_version = ?`, tenant, secret, version)
	return err
}

func (s *Store) RotateSecret(ctx context.Context, tenant store.TenantID, id store.SecretID, oldKeyVersion uint32, meta store.SecretMeta, blob store.CiphertextBlob, envelopes []store.KeyEnvelope) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	if meta.TenantID != tenant || meta.ID != id {
		return store.ErrConflict
	}
	if len(envelopes) == 0 {
		return errors.New("envelopes required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
UPDATE key_envelopes SET revoked = 1
WHERE tenant_id = ? AND secret_id = ? AND key_version = ?`, tenant, id, oldKeyVersion); err != nil {
		return err
	}

	now := time.Now().UTC()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	meta.Visibility = store.NormalizeVisibility(meta.Visibility)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO secrets(id, tenant_id, collection_id, title_ciphertext, title_nonce, created_by, visibility, created_at, updated_at)
VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(tenant_id, id) DO UPDATE SET
  collection_id=excluded.collection_id, title_ciphertext=excluded.title_ciphertext,
  title_nonce=excluded.title_nonce, visibility=excluded.visibility, updated_at=excluded.updated_at
`, meta.ID, meta.TenantID, meta.CollectionID, meta.TitleCiphertext, meta.TitleNonce, meta.CreatedBy, string(meta.Visibility),
		meta.CreatedAt.Format(time.RFC3339Nano), meta.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO secret_ciphertext(secret_id, tenant_id, ciphertext, nonce, key_version, content_type)
VALUES(?,?,?,?,?,?)
ON CONFLICT(tenant_id, secret_id) DO UPDATE SET
  ciphertext=excluded.ciphertext, nonce=excluded.nonce, key_version=excluded.key_version,
  content_type=excluded.content_type
`, id, tenant, blob.Ciphertext, blob.Nonce, blob.KeyVersion, blob.ContentType); err != nil {
		return err
	}

	for _, env := range envelopes {
		if env.TenantID != tenant || env.SecretID != id {
			return store.ErrConflict
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
		if _, err := tx.ExecContext(ctx, `
INSERT INTO key_envelopes(secret_id, tenant_id, user_id, key_version, wrapped_dk, revoked)
VALUES(?,?,?,?,?,0)
ON CONFLICT(tenant_id, secret_id, user_id, key_version) DO UPDATE SET
  wrapped_dk=excluded.wrapped_dk
WHERE key_envelopes.revoked = 0
`, env.SecretID, env.TenantID, env.UserID, env.KeyVersion, env.WrappedDK); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) CreateSecret(ctx context.Context, meta store.SecretMeta, blob store.CiphertextBlob, envelopes []store.KeyEnvelope) error {
	if err := requireTenant(meta.TenantID); err != nil {
		return err
	}
	if len(envelopes) == 0 {
		return errors.New("envelopes required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now
	meta.Visibility = store.NormalizeVisibility(meta.Visibility)
	if _, err := tx.ExecContext(ctx, `
INSERT INTO secrets(id, tenant_id, collection_id, title_ciphertext, title_nonce, created_by, visibility, created_at, updated_at)
VALUES(?,?,?,?,?,?,?,?,?)
`, meta.ID, meta.TenantID, meta.CollectionID, meta.TitleCiphertext, meta.TitleNonce, meta.CreatedBy, string(meta.Visibility),
		meta.CreatedAt.Format(time.RFC3339Nano), meta.UpdatedAt.Format(time.RFC3339Nano)); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO secret_ciphertext(secret_id, tenant_id, ciphertext, nonce, key_version, content_type)
VALUES(?,?,?,?,?,?)
`, meta.ID, meta.TenantID, blob.Ciphertext, blob.Nonce, blob.KeyVersion, blob.ContentType); err != nil {
		return err
	}

	for _, env := range envelopes {
		if env.TenantID != meta.TenantID || env.SecretID != meta.ID {
			return store.ErrConflict
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO key_envelopes(secret_id, tenant_id, user_id, key_version, wrapped_dk, revoked)
VALUES(?,?,?,?,?,0)
`, env.SecretID, env.TenantID, env.UserID, env.KeyVersion, env.WrappedDK); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) PutSecretDirectShare(ctx context.Context, share store.SecretDirectShare) error {
	if err := requireTenant(share.TenantID); err != nil {
		return err
	}
	if share.SecretID == "" || share.UserID == "" {
		return errors.New("secret_id and user_id required")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO secret_direct_shares(tenant_id, secret_id, user_id) VALUES(?,?,?)
ON CONFLICT(tenant_id, secret_id, user_id) DO NOTHING`,
		share.TenantID, share.SecretID, share.UserID)
	return err
}

func (s *Store) DeleteSecretDirectShare(ctx context.Context, tenant store.TenantID, secret store.SecretID, user store.UserID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM secret_direct_shares WHERE tenant_id = ? AND secret_id = ? AND user_id = ?`,
		tenant, secret, user)
	return err
}

func (s *Store) ListSecretDirectShares(ctx context.Context, tenant store.TenantID, secret store.SecretID) ([]store.SecretDirectShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT tenant_id, secret_id, user_id FROM secret_direct_shares WHERE tenant_id = ? AND secret_id = ? ORDER BY user_id`,
		tenant, secret)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SecretDirectShare
	for rows.Next() {
		var sh store.SecretDirectShare
		if err := rows.Scan(&sh.TenantID, &sh.SecretID, &sh.UserID); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) ListSecretDirectSharesByTenant(ctx context.Context, tenant store.TenantID) ([]store.SecretDirectShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT tenant_id, secret_id, user_id FROM secret_direct_shares WHERE tenant_id = ?`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SecretDirectShare
	for rows.Next() {
		var sh store.SecretDirectShare
		if err := rows.Scan(&sh.TenantID, &sh.SecretID, &sh.UserID); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) PutSecretGroupShare(ctx context.Context, share store.SecretGroupShare) error {
	if err := requireTenant(share.TenantID); err != nil {
		return err
	}
	if share.SecretID == "" || share.GroupID == "" {
		return errors.New("secret_id and group_id required")
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO secret_group_shares(tenant_id, secret_id, group_id) VALUES(?,?,?)
ON CONFLICT(tenant_id, secret_id, group_id) DO NOTHING`,
		share.TenantID, share.SecretID, share.GroupID)
	return err
}

func (s *Store) DeleteSecretGroupShare(ctx context.Context, tenant store.TenantID, secret store.SecretID, group store.GroupID) error {
	if err := requireTenant(tenant); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM secret_group_shares WHERE tenant_id = ? AND secret_id = ? AND group_id = ?`,
		tenant, secret, group)
	return err
}

func (s *Store) ListSecretGroupShares(ctx context.Context, tenant store.TenantID, secret store.SecretID) ([]store.SecretGroupShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT tenant_id, secret_id, group_id FROM secret_group_shares WHERE tenant_id = ? AND secret_id = ? ORDER BY group_id`,
		tenant, secret)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SecretGroupShare
	for rows.Next() {
		var sh store.SecretGroupShare
		if err := rows.Scan(&sh.TenantID, &sh.SecretID, &sh.GroupID); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) ListSecretGroupSharesByTenant(ctx context.Context, tenant store.TenantID) ([]store.SecretGroupShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT tenant_id, secret_id, group_id FROM secret_group_shares WHERE tenant_id = ?`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SecretGroupShare
	for rows.Next() {
		var sh store.SecretGroupShare
		if err := rows.Scan(&sh.TenantID, &sh.SecretID, &sh.GroupID); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) ListSecretGroupSharesByGroup(ctx context.Context, tenant store.TenantID, group store.GroupID) ([]store.SecretGroupShare, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT tenant_id, secret_id, group_id FROM secret_group_shares WHERE tenant_id = ? AND group_id = ?`,
		tenant, group)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.SecretGroupShare
	for rows.Next() {
		var sh store.SecretGroupShare
		if err := rows.Scan(&sh.TenantID, &sh.SecretID, &sh.GroupID); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) AppendAudit(ctx context.Context, e store.AuditEvent) error {
	if err := requireTenant(e.TenantID); err != nil {
		return err
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	meta := e.Metadata
	if len(meta) == 0 {
		meta = json.RawMessage(`{}`)
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO audit_events(id, tenant_id, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, created_at)
VALUES(?,?,?,?,?,?,?,?,?,?)`, e.ID, e.TenantID, e.ActorID, e.Action, e.ResourceType, e.ResourceID,
		e.IP, e.UserAgent, string(meta), e.CreatedAt.Format(time.RFC3339Nano))
	return err
}

func (s *Store) ListAudit(ctx context.Context, tenant store.TenantID, q store.AuditQuery) ([]store.AuditEvent, error) {
	if err := requireTenant(tenant); err != nil {
		return nil, err
	}
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, tenant_id, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, created_at
FROM audit_events WHERE tenant_id = ?
ORDER BY created_at DESC LIMIT ?`, tenant, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.AuditEvent
	for rows.Next() {
		var e store.AuditEvent
		var meta, cAt string
		if err := rows.Scan(&e.ID, &e.TenantID, &e.ActorID, &e.Action, &e.ResourceType, &e.ResourceID,
			&e.IP, &e.UserAgent, &meta, &cAt); err != nil {
			return nil, err
		}
		e.Metadata = json.RawMessage(meta)
		e.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
		if q.ActionContains != "" && !strings.Contains(strings.ToLower(e.Action), strings.ToLower(q.ActionContains)) {
			continue
		}
		if q.ActorID != "" && e.ActorID != q.ActorID {
			continue
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) Health(ctx context.Context) (store.Health, error) {
	var one int
	if err := s.db.QueryRowContext(ctx, `SELECT 1`).Scan(&one); err != nil {
		return store.Health{Backend: "sqlite", OK: false, Detail: err.Error()}, err
	}
	return store.Health{Backend: "sqlite", OK: true, Detail: "ok"}, nil
}

func (s *Store) ExportSnapshot(ctx context.Context, tenant *store.TenantID) (*store.StoreSnapshot, error) {
	var rec store.SnapshotRecords
	var tenants []store.Tenant
	if tenant != nil {
		if err := requireTenant(*tenant); err != nil {
			return nil, err
		}
		t, err := s.GetTenant(ctx, *tenant)
		if err != nil {
			return nil, err
		}
		tenants = []store.Tenant{*t}
	} else {
		all, err := s.ListTenants(ctx)
		if err != nil {
			return nil, err
		}
		tenants = all
	}
	for i := range tenants {
		if err := s.appendTenantSnapshot(ctx, &rec, tenants[i]); err != nil {
			return nil, err
		}
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

func (s *Store) appendTenantSnapshot(ctx context.Context, rec *store.SnapshotRecords, t store.Tenant) error {
	tid := t.ID
	rec.Tenants = append(rec.Tenants, t)
	users, err := s.ListUsers(ctx, tid, store.UserQuery{Limit: 100000})
	if err != nil {
		return err
	}
	rec.Users = append(rec.Users, users...)

	groups, err := s.ListGroups(ctx, tid)
	if err != nil {
		return err
	}
	rec.Groups = append(rec.Groups, groups...)
	for _, g := range groups {
		uids, err := s.ListGroupMembers(ctx, tid, g.ID)
		if err != nil {
			return err
		}
		for _, uid := range uids {
			rec.Members = append(rec.Members, store.GroupMember{TenantID: tid, GroupID: g.ID, UserID: uid})
		}
	}

	wa, err := s.listWebAuthnByTenant(ctx, tid)
	if err != nil {
		return err
	}
	rec.WebAuthn = append(rec.WebAuthn, wa...)

	metas, err := s.ListSecretMetas(ctx, tid)
	if err != nil {
		return err
	}
	for _, meta := range metas {
		blob, _ := s.GetSecretCiphertext(ctx, tid, meta.ID)
		envs, err := s.ListKeyEnvelopes(ctx, tid, meta.ID)
		if err != nil {
			return err
		}
		sec := store.SnapshotSecret{Meta: meta, Envs: envs}
		if blob != nil {
			b := *blob
			sec.Blob = &b
		}
		rec.Secrets = append(rec.Secrets, sec)
	}
	ds, err := s.ListSecretDirectSharesByTenant(ctx, tid)
	if err != nil {
		return err
	}
	rec.DirectShares = append(rec.DirectShares, ds...)
	gs, err := s.ListSecretGroupSharesByTenant(ctx, tid)
	if err != nil {
		return err
	}
	rec.GroupShares = append(rec.GroupShares, gs...)
	return nil
}

func (s *Store) listWebAuthnByTenant(ctx context.Context, tenant store.TenantID) ([]store.WebAuthnCredential, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, tenant_id, user_id, credential_id, public_key, attestation, transport, sign_count, name, aaguid, created_at
FROM webauthn_credentials WHERE tenant_id = ?`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.WebAuthnCredential
	for rows.Next() {
		var c store.WebAuthnCredential
		var cAt string
		if err := rows.Scan(&c.ID, &c.TenantID, &c.UserID, &c.CredentialID, &c.PublicKey, &c.Attestation, &c.Transport,
			&c.SignCount, &c.Name, &c.AAGUID, &cAt); err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(time.RFC3339Nano, cAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) wipeTenant(ctx context.Context, tid store.TenantID) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, q := range []string{
		`DELETE FROM secret_direct_shares WHERE tenant_id = ?`,
		`DELETE FROM secret_group_shares WHERE tenant_id = ?`,
		`DELETE FROM group_members WHERE tenant_id = ?`,
		`DELETE FROM groups WHERE tenant_id = ?`,
		`DELETE FROM webauthn_credentials WHERE tenant_id = ?`,
		`DELETE FROM key_envelopes WHERE tenant_id = ?`,
		`DELETE FROM secret_ciphertext WHERE tenant_id = ?`,
		`DELETE FROM secrets WHERE tenant_id = ?`,
		`DELETE FROM audit_events WHERE tenant_id = ?`,
		`DELETE FROM users WHERE tenant_id = ?`,
		`DELETE FROM tenants WHERE id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, tid); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) wipeAll(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, q := range []string{
		`DELETE FROM secret_direct_shares`,
		`DELETE FROM secret_group_shares`,
		`DELETE FROM group_members`,
		`DELETE FROM groups`,
		`DELETE FROM webauthn_credentials`,
		`DELETE FROM key_envelopes`,
		`DELETE FROM secret_ciphertext`,
		`DELETE FROM secrets`,
		`DELETE FROM audit_events`,
		`DELETE FROM users`,
		`DELETE FROM tenants`,
	} {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ImportSnapshot(ctx context.Context, snap store.StoreSnapshot, mode store.ImportMode) error {
	sum := sha256.Sum256(snap.Records)
	if hex.EncodeToString(sum[:]) != snap.ChecksumSHA256 {
		return errors.New("snapshot checksum mismatch")
	}
	var rec store.SnapshotRecords
	if err := json.Unmarshal(snap.Records, &rec); err != nil {
		return err
	}
	if mode == store.ImportReplace {
		if snap.TenantFilter != nil {
			if err := s.wipeTenant(ctx, *snap.TenantFilter); err != nil {
				return err
			}
		} else {
			if err := s.wipeAll(ctx); err != nil {
				return err
			}
		}
	}
	for _, t := range rec.Tenants {
		if err := s.PutTenant(ctx, t); err != nil {
			return err
		}
	}
	for _, u := range rec.Users {
		if err := s.UpsertUser(ctx, u); err != nil {
			return err
		}
	}
	for _, g := range rec.Groups {
		if err := s.PutGroup(ctx, g); err != nil {
			return err
		}
	}
	for _, m := range rec.Members {
		if err := s.AddGroupMember(ctx, m); err != nil {
			return err
		}
	}
	for _, c := range rec.WebAuthn {
		if err := s.PutWebAuthnCredential(ctx, c); err != nil {
			return err
		}
	}
	for _, sec := range rec.Secrets {
		if err := s.PutSecretMeta(ctx, sec.Meta); err != nil {
			return err
		}
		if sec.Blob != nil {
			if err := s.PutSecretCiphertext(ctx, sec.Meta.TenantID, sec.Meta.ID, *sec.Blob); err != nil {
				return err
			}
		}
		for _, env := range sec.Envs {
			if err := s.PutKeyEnvelope(ctx, env); err != nil {
				return err
			}
		}
	}
	for _, sh := range rec.DirectShares {
		if err := s.PutSecretDirectShare(ctx, sh); err != nil {
			return err
		}
	}
	for _, sh := range rec.GroupShares {
		if err := s.PutSecretGroupShare(ctx, sh); err != nil {
			return err
		}
	}
	return nil
}

var _ store.VaultStore = (*Store)(nil)

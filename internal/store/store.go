// Package store defines the vault persistence contract.
//
// Security decision (Prinzip 8): implementations must treat secret payloads as
// opaque ciphertext. No backend may decrypt vault data or accept plaintext
// secret bodies. Titles are also ciphertext (OQ-12).
package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

type TenantID string
type UserID string
type SecretID string

type Tenant struct {
	ID              TenantID
	Name            string
	Slug            string
	RecoveryMode    string // user_kit | admin_escrow
	EscrowAllowed   bool
	EscrowPublicKey []byte // X25519 pub for admin escrow envelopes
	Status          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type UserRecord struct {
	ID                          UserID
	TenantID                    TenantID
	Username                    string
	DisplayName                 string
	Email                       string
	AuthBackend                 string // local | ldap
	LocalPasswordHash           string // empty for ldap; never a vault master password
	Status                      string
	RolesJSON                   string // JSON array of roles
	PublicKey                   []byte
	EncryptedPrivateKey         []byte
	EncryptedPrivateKeyRecovery []byte
	EscrowEnvelope              []byte // SK sealed to tenant escrow pub (opaque)
	TotpSecretEnc               []byte // server-at-rest sealed TOTP secret (config-key later; Phase4: opaque blob)
	TotpEnabled                 bool
	OnboardedAt                 *time.Time
	CreatedAt                   time.Time
	UpdatedAt                   time.Time
}

// WebAuthnCredential is a login-only passkey (OQ-04): never used for vault unlock.
type WebAuthnCredential struct {
	ID           string
	TenantID     TenantID
	UserID       UserID
	CredentialID []byte
	PublicKey    []byte
	Attestation  string
	Transport    string // JSON array of transports
	SignCount    uint32
	Name         string
	AAGUID       []byte
	CreatedAt    time.Time
}

type UserQuery struct {
	UsernameContains string
	Status           string
	Limit            int
}

// SecretMeta holds non-decryptable identifiers. Title is ciphertext (OQ-12).
type SecretMeta struct {
	ID               SecretID
	TenantID         TenantID
	CollectionID     string
	TitleCiphertext  []byte
	TitleNonce       []byte
	CreatedBy        UserID
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type CiphertextBlob struct {
	Ciphertext  []byte
	Nonce       []byte
	KeyVersion  uint32
	ContentType string
}

type KeyEnvelope struct {
	SecretID   SecretID
	TenantID   TenantID
	UserID     UserID
	KeyVersion uint32
	WrappedDK  []byte
}

type AuditEvent struct {
	ID           string
	TenantID     TenantID
	ActorID      string
	Action       string
	ResourceType string
	ResourceID   string
	IP           string
	UserAgent    string
	Metadata     json.RawMessage
	CreatedAt    time.Time
}

type AuditQuery struct {
	ActionContains string
	ActorID        string
	Limit          int
}

type Health struct {
	Backend string
	OK      bool
	Detail  string
}

type GroupID string

type Group struct {
	ID          GroupID
	TenantID    TenantID
	Name        string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type GroupMember struct {
	TenantID TenantID
	GroupID  GroupID
	UserID   UserID
}

type ImportMode string

const (
	ImportReplace ImportMode = "replace"
	ImportMerge   ImportMode = "merge"
)

// StoreSnapshot is a backend-neutral export (JSON + base64 blobs in records).
type StoreSnapshot struct {
	FormatVersion int             `json:"format_version"`
	ExportedAt    time.Time       `json:"exported_at"`
	TenantFilter  *TenantID       `json:"tenant_filter,omitempty"`
	Records       json.RawMessage `json:"records"`
	ChecksumSHA256 string         `json:"checksum_sha256"`
}

var (
	ErrNotFound      = errors.New("not found")
	ErrTenantRequired = errors.New("tenant_id required")
	ErrConflict      = errors.New("conflict")
)

// VaultStore is implemented by SQLite (Phase 1), later Postgres and JSON.
type VaultStore interface {
	Close() error

	PutTenant(ctx context.Context, t Tenant) error
	GetTenant(ctx context.Context, id TenantID) (*Tenant, error)
	GetTenantBySlug(ctx context.Context, slug string) (*Tenant, error)
	ListTenants(ctx context.Context) ([]Tenant, error)

	UpsertUser(ctx context.Context, u UserRecord) error
	GetUser(ctx context.Context, tenant TenantID, id UserID) (*UserRecord, error)
	GetUserByUsername(ctx context.Context, tenant TenantID, username string) (*UserRecord, error)
	ListUsers(ctx context.Context, tenant TenantID, q UserQuery) ([]UserRecord, error)

	PutWebAuthnCredential(ctx context.Context, c WebAuthnCredential) error
	ListWebAuthnCredentials(ctx context.Context, tenant TenantID, user UserID) ([]WebAuthnCredential, error)
	GetWebAuthnCredentialByCredID(ctx context.Context, tenant TenantID, credentialID []byte) (*WebAuthnCredential, error)
	DeleteWebAuthnCredential(ctx context.Context, tenant TenantID, id string) error
	UpdateWebAuthnSignCount(ctx context.Context, tenant TenantID, id string, signCount uint32) error

	PutGroup(ctx context.Context, g Group) error
	ListGroups(ctx context.Context, tenant TenantID) ([]Group, error)
	DeleteGroup(ctx context.Context, tenant TenantID, id GroupID) error
	AddGroupMember(ctx context.Context, m GroupMember) error
	RemoveGroupMember(ctx context.Context, tenant TenantID, group GroupID, user UserID) error
	ListGroupMembers(ctx context.Context, tenant TenantID, group GroupID) ([]UserID, error)
	ListUserGroups(ctx context.Context, tenant TenantID, user UserID) ([]GroupID, error)

	PutSecretMeta(ctx context.Context, meta SecretMeta) error
	GetSecretMeta(ctx context.Context, tenant TenantID, id SecretID) (*SecretMeta, error)
	ListSecretMetas(ctx context.Context, tenant TenantID) ([]SecretMeta, error)
	DeleteSecret(ctx context.Context, tenant TenantID, id SecretID) error
	PutSecretCiphertext(ctx context.Context, tenant TenantID, id SecretID, blob CiphertextBlob) error
	GetSecretCiphertext(ctx context.Context, tenant TenantID, id SecretID) (*CiphertextBlob, error)

	PutKeyEnvelope(ctx context.Context, env KeyEnvelope) error
	ListKeyEnvelopes(ctx context.Context, tenant TenantID, secret SecretID) ([]KeyEnvelope, error)
	InvalidateKeyVersion(ctx context.Context, tenant TenantID, secret SecretID, version uint32) error

	AppendAudit(ctx context.Context, e AuditEvent) error
	ListAudit(ctx context.Context, tenant TenantID, q AuditQuery) ([]AuditEvent, error)

	Health(ctx context.Context) (Health, error)
	ExportSnapshot(ctx context.Context, tenant *TenantID) (*StoreSnapshot, error)
	ImportSnapshot(ctx context.Context, snap StoreSnapshot, mode ImportMode) error
}

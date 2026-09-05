package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// OfflineTTL mirrors the browser offline-vault cache (docs/planning/offline-vault.md):
// a cached ciphertext snapshot is only used for up to 30 days.
const OfflineTTL = 30 * 24 * time.Hour

// OfflineKeys is the sealed identity blob needed to unlock offline (same
// fields as GET /api/vault/keys) — ciphertext only, never plaintext.
type OfflineKeys struct {
	SaltB64                     string `json:"salt_b64"`
	EncryptedPrivateKeyNonceB64 string `json:"encrypted_private_key_nonce_b64"`
	EncryptedPrivateKeyB64      string `json:"encrypted_private_key_b64"`
	PublicKeyB64                string `json:"public_key_b64"`
}

// OfflineSecret is a cached ciphertext row (same shape as GET /api/secrets/{id}).
type OfflineSecret struct {
	ID                 string         `json:"id"`
	TitleCiphertextB64 string         `json:"title_ciphertext_b64"`
	TitleNonceB64      string         `json:"title_nonce_b64"`
	CiphertextB64      string         `json:"ciphertext_b64"`
	NonceB64           string         `json:"nonce_b64"`
	KeyVersion         uint32         `json:"key_version"`
	Envelope           map[string]any `json:"envelope"`
	Visibility         string         `json:"visibility,omitempty"`
	HasAccess          bool           `json:"has_access"`
	CreatedBy          string         `json:"created_by,omitempty"`
	CreatedByUsername  string         `json:"created_by_username,omitempty"`
	SharedUsers        []string       `json:"shared_users,omitempty"`
	SharedGroups       []string       `json:"shared_groups,omitempty"`
}

// OfflineSnapshot is a full, ciphertext-only vault snapshot cached to disk
// so the desktop app keeps working without a server connection. Same
// zero-knowledge contract as web/static/offline-store.js.
type OfflineSnapshot struct {
	Version      int             `json:"version"`
	TenantID     string          `json:"tenant_id"`
	TenantSlug   string          `json:"tenant_slug"`
	UserID       string          `json:"user_id"`
	Username     string          `json:"username"`
	SyncedAt     time.Time       `json:"synced_at"`
	Keys         OfflineKeys     `json:"keys"`
	CryptoParams map[string]any  `json:"crypto_params"`
	Secrets      []OfflineSecret `json:"secrets"`
}

// Expired reports whether the snapshot is older than OfflineTTL.
func (s OfflineSnapshot) Expired() bool {
	if s.SyncedAt.IsZero() {
		return true
	}
	return time.Since(s.SyncedAt) > OfflineTTL
}

func offlineSnapshotPath(tenantSlug, username string) (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	safe := func(s string) string {
		if s == "" {
			return "_"
		}
		return s
	}
	name := "offline-" + safe(tenantSlug) + "-" + safe(username) + ".json"
	return filepath.Join(dir, name), nil
}

// LoadOfflineSnapshot returns the cached snapshot for tenant/user, or
// (zero, false, nil) if none exists.
func LoadOfflineSnapshot(tenantSlug, username string) (OfflineSnapshot, bool, error) {
	var snap OfflineSnapshot
	p, err := offlineSnapshotPath(tenantSlug, username)
	if err != nil {
		return snap, false, err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return snap, false, nil
		}
		return snap, false, err
	}
	if err := json.Unmarshal(raw, &snap); err != nil {
		return OfflineSnapshot{}, false, err
	}
	return snap, true, nil
}

// SaveOfflineSnapshot persists (replaces) the ciphertext-only snapshot for
// tenant/user, 0600 user-only permissions.
func SaveOfflineSnapshot(snap OfflineSnapshot) error {
	p, err := offlineSnapshotPath(snap.TenantSlug, snap.Username)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0o600)
}

// DeleteOfflineSnapshot removes a cached snapshot (e.g. on explicit logout
// with "forget this device").
func DeleteOfflineSnapshot(tenantSlug, username string) error {
	p, err := offlineSnapshotPath(tenantSlug, username)
	if err != nil {
		return err
	}
	err = os.Remove(p)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

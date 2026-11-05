package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
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
	TenantName   string          `json:"tenant_name,omitempty"`
	UserID       string          `json:"user_id"`
	Username     string          `json:"username"`
	SyncedAt     time.Time       `json:"synced_at"`
	Keys         OfflineKeys     `json:"keys"`
	CryptoParams map[string]any  `json:"crypto_params"`
	Secrets      []OfflineSecret `json:"secrets"`
}

// OfflineCacheEnvelope contains only encrypted snapshot data and the metadata
// required to bind it to a user, tenant, origin, and security profile.
type OfflineCacheEnvelope struct {
	Format             string   `json:"format"`
	Version            int      `json:"version"`
	Profile            string   `json:"profile"`
	TenantID           string   `json:"tenant_id"`
	TenantSlug         string   `json:"tenant_slug"`
	TenantName         string   `json:"tenant_name,omitempty"`
	UserID             string   `json:"user_id"`
	Username           string   `json:"username"`
	Origin             string   `json:"origin"`
	CreatedAt          string   `json:"created_at"`
	ExpiresAt          string   `json:"expires_at"`
	PolicyVersion      int      `json:"policy_version"`
	EffectivePolicy    string   `json:"effective_policy"`
	ServerRequirement  string   `json:"server_requirement,omitempty"`
	RequiredFactors    []string `json:"required_factors"`
	KeyslotID          string   `json:"keyslot_id"`
	KeyslotKind        string   `json:"keyslot_kind"`
	KeyslotVersion     int      `json:"keyslot_version"`
	KDF                string   `json:"kdf"`
	SnapshotAlgorithm  string   `json:"snapshot_algorithm"`
	SaltB64            string   `json:"salt_b64"`
	WrappedDEKNonceB64 string   `json:"wrapped_dek_nonce_b64"`
	WrappedDEKB64      string   `json:"wrapped_dek_b64"`
	SnapshotNonceB64   string   `json:"snapshot_nonce_b64"`
	CiphertextB64      string   `json:"ciphertext_b64"`
	SecretCount        int      `json:"secret_count"`
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
		return strings.Map(func(r rune) rune {
			if r == '/' || r == '\\' || r == ':' || unicode.IsControl(r) || strings.ContainsRune(`*?"<>|`, r) {
				return '_'
			}
			return r
		}, s)
	}
	name := "offline-" + safe(tenantSlug) + "-" + safe(username) + ".json"
	return filepath.Join(dir, name), nil
}

// LoadOfflineCache returns the protected cache envelope for tenant/user.
func LoadOfflineCache(tenantSlug, username string) (OfflineCacheEnvelope, bool, error) {
	var cache OfflineCacheEnvelope
	p, err := offlineSnapshotPath(tenantSlug, username)
	if err != nil {
		return cache, false, err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return cache, false, nil
		}
		return cache, false, err
	}
	if err := json.Unmarshal(raw, &cache); err != nil {
		return OfflineCacheEnvelope{}, false, err
	}
	return cache, true, nil
}

// SaveOfflineCache persists the encrypted cache envelope with user-only
// permissions, replacing any previous format for this tenant/user.
func SaveOfflineCache(cache OfflineCacheEnvelope) error {
	p, err := offlineSnapshotPath(cache.TenantSlug, cache.Username)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".offline-cache-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, p)
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

package backend

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/hkdf"

	"github.com/teamvault/teamvault/internal/offlinepolicy"
)

const (
	offlineCacheFormat     = "teamvault-offline"
	offlineCacheVersion    = 2
	offlineCacheProfile    = "STANDARD"
	offlineCacheKDF        = "HKDF-SHA-256"
	offlineCacheAlgorithm  = "AES-256-GCM"
	offlineCacheKeyslotID  = "software-key-v1"
	offlineCachePolicy     = 2
	offlineLegacyPolicy    = 1
	offlineEffectivePolicy = "offline_cache_allowed=true;profile=STANDARD;required_factors=master_password,software_key"
)

var offlineRequiredFactors = []string{"master_password", "software_key"}

// GenerateOfflineSoftwareKey creates a 256-bit client-side software key.
func GenerateOfflineSoftwareKey() ([]byte, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("offline key generation failed: %w", err)
	}
	return key, nil
}

// DecodeOfflineSoftwareKey validates the standard-base64 representation used
// in the portable software-key file and manual-entry field.
func DecodeOfflineSoftwareKey(encoded string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(key) != 32 || base64.StdEncoding.EncodeToString(key) != strings.TrimSpace(encoded) {
		zeroBytes(key)
		return nil, errors.New("invalid software key; expected a canonical 256-bit TeamVault key")
	}
	return key, nil
}

// OfflineOrigin returns the scheme and authority used to bind a cache to a
// specific server origin, excluding the instance's optional base path.
func OfflineOrigin(serverURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(serverURL))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		return "", errors.New("invalid server URL for offline cache")
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return scheme + "://" + host, nil
}

// SealOfflineSnapshot encrypts the complete ciphertext-only snapshot under a
// random DEK, then wraps that DEK with a key derived from the software key.
func SealOfflineSnapshot(snap OfflineSnapshot, softwareKey []byte, origin, serverRequirement string) (OfflineCacheEnvelope, error) {
	if len(softwareKey) != 32 {
		return OfflineCacheEnvelope{}, errors.New("software key must contain exactly 32 bytes")
	}
	allowed, err := offlinepolicy.Allows(serverRequirement, offlineCacheProfile)
	if err != nil || !allowed {
		return OfflineCacheEnvelope{}, errors.New("offline security profile does not satisfy the administrator policy")
	}
	if snap.TenantID == "" || snap.TenantSlug == "" || snap.UserID == "" || snap.Username == "" || origin == "" {
		return OfflineCacheEnvelope{}, errors.New("offline cache identity is incomplete")
	}
	if snap.SyncedAt.IsZero() {
		snap.SyncedAt = time.Now().UTC()
	}
	snap.SyncedAt = snap.SyncedAt.UTC().Truncate(time.Millisecond)
	snap.Version = offlineCacheVersion
	plain, err := json.Marshal(snap)
	if err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("encode offline snapshot: %w", err)
	}
	defer zeroBytes(plain)

	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("generate offline data key: %w", err)
	}
	defer zeroBytes(dek)
	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("generate offline key salt: %w", err)
	}
	wrapNonce := make([]byte, 12)
	snapshotNonce := make([]byte, 12)
	if _, err := rand.Read(wrapNonce); err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("generate offline wrapping nonce: %w", err)
	}
	if _, err := rand.Read(snapshotNonce); err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("generate offline snapshot nonce: %w", err)
	}

	created := snap.SyncedAt
	cache := OfflineCacheEnvelope{
		Format:             offlineCacheFormat,
		Version:            offlineCacheVersion,
		Profile:            offlineCacheProfile,
		TenantID:           snap.TenantID,
		TenantSlug:         snap.TenantSlug,
		TenantName:         snap.TenantName,
		UserID:             snap.UserID,
		Username:           snap.Username,
		Origin:             origin,
		CreatedAt:          created.Format("2006-01-02T15:04:05.000Z"),
		ExpiresAt:          created.Add(OfflineTTL).Format("2006-01-02T15:04:05.000Z"),
		PolicyVersion:      offlineCachePolicy,
		EffectivePolicy:    offlineEffectivePolicy,
		ServerRequirement:  serverRequirement,
		RequiredFactors:    append([]string(nil), offlineRequiredFactors...),
		KeyslotID:          offlineCacheKeyslotID,
		KeyslotKind:        "software",
		KeyslotVersion:     1,
		KDF:                offlineCacheKDF,
		SnapshotAlgorithm:  offlineCacheAlgorithm,
		SaltB64:            base64.StdEncoding.EncodeToString(salt),
		WrappedDEKNonceB64: base64.StdEncoding.EncodeToString(wrapNonce),
		SnapshotNonceB64:   base64.StdEncoding.EncodeToString(snapshotNonce),
		SecretCount:        len(snap.Secrets),
	}
	aad := offlineCacheAAD(cache)
	kek, err := deriveOfflineKEK(softwareKey, salt, cache)
	if err != nil {
		return OfflineCacheEnvelope{}, err
	}
	defer zeroBytes(kek)

	cache.WrappedDEKB64, err = encryptOfflineData(kek, wrapNonce, dek, aad)
	if err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("wrap offline data key: %w", err)
	}
	cache.CiphertextB64, err = encryptOfflineData(dek, snapshotNonce, plain, aad)
	if err != nil {
		return OfflineCacheEnvelope{}, fmt.Errorf("encrypt offline snapshot: %w", err)
	}
	return cache, nil
}

// OpenOfflineSnapshot verifies the authenticated scope and decrypts the cache.
func OpenOfflineSnapshot(cache OfflineCacheEnvelope, softwareKey []byte, origin, tenantID, userID string) (OfflineSnapshot, error) {
	if len(softwareKey) != 32 {
		return OfflineSnapshot{}, errors.New("software key must contain exactly 32 bytes")
	}
	policyValid := cache.PolicyVersion == offlineLegacyPolicy && cache.ServerRequirement == ""
	if cache.PolicyVersion == offlineCachePolicy {
		allowed, err := offlinepolicy.Allows(cache.ServerRequirement, offlineCacheProfile)
		policyValid = err == nil && allowed
	}
	if cache.Format != offlineCacheFormat || cache.Version != offlineCacheVersion ||
		cache.Profile != offlineCacheProfile || !policyValid ||
		cache.EffectivePolicy != offlineEffectivePolicy ||
		cache.RequiredFactors == nil || !equalStrings(cache.RequiredFactors, offlineRequiredFactors) ||
		cache.KeyslotID != offlineCacheKeyslotID || cache.KeyslotKind != "software" ||
		cache.KeyslotVersion != 1 || cache.KDF != offlineCacheKDF ||
		cache.SnapshotAlgorithm != offlineCacheAlgorithm {
		return OfflineSnapshot{}, errors.New("unsupported or insecure offline cache format")
	}
	if cache.Origin != origin || cache.TenantID != tenantID || cache.UserID != userID {
		return OfflineSnapshot{}, errors.New("offline cache belongs to a different account or server")
	}
	if !cacheExpiryValid(cache) {
		return OfflineSnapshot{}, errors.New("offline copy expired or has invalid timestamps")
	}

	salt, err := base64.StdEncoding.DecodeString(cache.SaltB64)
	if err != nil || len(salt) != 32 {
		return OfflineSnapshot{}, errors.New("invalid offline key salt")
	}
	wrapNonce, err := base64.StdEncoding.DecodeString(cache.WrappedDEKNonceB64)
	if err != nil || len(wrapNonce) != 12 {
		return OfflineSnapshot{}, errors.New("invalid offline key-wrap nonce")
	}
	snapshotNonce, err := base64.StdEncoding.DecodeString(cache.SnapshotNonceB64)
	if err != nil || len(snapshotNonce) != 12 {
		return OfflineSnapshot{}, errors.New("invalid offline snapshot nonce")
	}

	kek, err := deriveOfflineKEK(softwareKey, salt, cache)
	if err != nil {
		return OfflineSnapshot{}, err
	}
	defer zeroBytes(kek)
	aad := offlineCacheAAD(cache)
	wrappedDEK, err := base64.StdEncoding.DecodeString(cache.WrappedDEKB64)
	if err != nil {
		return OfflineSnapshot{}, errors.New("invalid wrapped offline key")
	}
	dek, err := decryptOfflineData(kek, wrapNonce, wrappedDEK, aad)
	if err != nil {
		return OfflineSnapshot{}, errors.New("software key did not unlock this offline copy")
	}
	if len(dek) != 32 {
		zeroBytes(dek)
		return OfflineSnapshot{}, errors.New("software key did not unlock this offline copy")
	}
	defer zeroBytes(dek)
	encrypted, err := base64.StdEncoding.DecodeString(cache.CiphertextB64)
	if err != nil {
		return OfflineSnapshot{}, errors.New("invalid encrypted offline snapshot")
	}
	plain, err := decryptOfflineData(dek, snapshotNonce, encrypted, aad)
	if err != nil {
		return OfflineSnapshot{}, errors.New("offline snapshot authentication failed")
	}
	defer zeroBytes(plain)
	var snap OfflineSnapshot
	if err := json.Unmarshal(plain, &snap); err != nil {
		return OfflineSnapshot{}, errors.New("offline snapshot payload is invalid")
	}
	if snap.Version != offlineCacheVersion || snap.TenantID != cache.TenantID ||
		snap.TenantSlug != cache.TenantSlug || snap.TenantName != cache.TenantName ||
		snap.UserID != cache.UserID || snap.Username != cache.Username ||
		snap.SyncedAt.UTC().Format("2006-01-02T15:04:05.000Z") != cache.CreatedAt ||
		len(snap.Secrets) != cache.SecretCount {
		return OfflineSnapshot{}, errors.New("offline snapshot metadata does not match its authenticated envelope")
	}
	return snap, nil
}

func cacheExpiryValid(cache OfflineCacheEnvelope) bool {
	created, err := time.Parse(time.RFC3339Nano, cache.CreatedAt)
	if err != nil {
		return false
	}
	expires, err := time.Parse(time.RFC3339Nano, cache.ExpiresAt)
	if err != nil {
		return false
	}
	if expires.Sub(created) != OfflineTTL || time.Now().After(expires) {
		return false
	}
	return true
}

// Expired reports whether the cache is outside its authenticated TTL window.
func (cache OfflineCacheEnvelope) Expired() bool {
	return !cacheExpiryValid(cache)
}

func deriveOfflineKEK(softwareKey, salt []byte, cache OfflineCacheEnvelope) ([]byte, error) {
	reader := hkdf.New(sha256.New, softwareKey, salt, offlineKEKInfo(cache))
	kek := make([]byte, 32)
	if _, err := io.ReadFull(reader, kek); err != nil {
		zeroBytes(kek)
		return nil, fmt.Errorf("derive offline key-encryption key: %w", err)
	}
	return kek, nil
}

func offlineKEKInfo(cache OfflineCacheEnvelope) []byte {
	fields := []string{
		cache.Format,
		fmt.Sprint(cache.Version),
		cache.Profile,
		cache.TenantID,
		cache.UserID,
		cache.Origin,
		cache.KeyslotID,
		fmt.Sprint(cache.KeyslotVersion),
	}
	var info bytes.Buffer
	info.WriteString("TVOSK2\x00")
	for _, field := range fields {
		fmt.Fprintf(&info, "%d:", len([]byte(field)))
		info.WriteString(field)
	}
	return info.Bytes()
}

func encryptOfflineData(key, nonce, plain, aad []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(aead.Seal(nil, nonce, plain, aad)), nil
}

func decryptOfflineData(key, nonce, ciphertext, aad []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ciphertext, aad)
}

func offlineCacheAAD(cache OfflineCacheEnvelope) []byte {
	fields := []string{
		cache.Format,
		fmt.Sprint(cache.Version),
		cache.Profile,
		cache.TenantID,
		cache.TenantSlug,
		cache.TenantName,
		cache.UserID,
		cache.Username,
		cache.Origin,
		cache.CreatedAt,
		cache.ExpiresAt,
		fmt.Sprint(cache.PolicyVersion),
		cache.EffectivePolicy,
		strings.Join(cache.RequiredFactors, ","),
		cache.KeyslotID,
		cache.KeyslotKind,
		fmt.Sprint(cache.KeyslotVersion),
		cache.KDF,
		cache.SnapshotAlgorithm,
		cache.SaltB64,
		cache.WrappedDEKNonceB64,
		cache.SnapshotNonceB64,
		fmt.Sprint(cache.SecretCount),
	}
	if cache.PolicyVersion == offlineCachePolicy {
		fields = append(fields, cache.ServerRequirement)
	}
	var aad bytes.Buffer
	aad.WriteString("TVOSV2\x00")
	for _, field := range fields {
		fmt.Fprintf(&aad, "%d:", len([]byte(field)))
		aad.WriteString(field)
	}
	return aad.Bytes()
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

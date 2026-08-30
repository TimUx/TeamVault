// Package configstore persists instance configuration as an AES-256-GCM sealed blob.
//
// Security decision: Config encryption is orthogonal to vault Zero-Knowledge.
// The server may hold LDAP/SMTP secrets after unlock; it must never hold vault
// plaintext. Key derivation uses HKDF-SHA256 because MASTER_UNLOCK_KEY is a
// high-entropy keyfile (not a user password) — Argon2id is reserved for vault
// master-password KDF on the client (Prinzip 4).
package configstore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"os"
	"path/filepath"
	"time"
)

const (
	fileName   = "config.sealed"
	nonceSize  = 12
	currentVer = 1
	hkdfInfo   = "teamvault-config-v1"
)

// Data is the plaintext configuration held only in process memory after unlock.
type Data struct {
	Version     int           `json:"version"`
	Initialized bool          `json:"initialized"`
	UpdatedAt   time.Time     `json:"updated_at"`
	Storage     StorageConfig `json:"storage"`
	// Extra holds future wizard fields (LDAP, mail, …) without schema churn.
	Extra json.RawMessage `json:"extra,omitempty"`
}

type StorageConfig struct {
	Backend string `json:"backend"` // sqlite | postgres | json
	DSN     string `json:"dsn"`
}

type Store struct {
	path string
	aead cipher.AEAD
}

// Open derives the AEAD key from unlockKey and prepares the store at dir.
func Open(dir string, unlockKey []byte) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	key, err := deriveKey(unlockKey)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Store{path: filepath.Join(dir, fileName), aead: aead}, nil
}

func deriveKey(unlockKey []byte) ([]byte, error) {
	return hkdfSHA256(unlockKey, nil, []byte(hkdfInfo), 32)
}

// hkdfSHA256 implements RFC 5869 using stdlib HMAC-SHA256 (not a custom primitive).
func hkdfSHA256(secret, salt, info []byte, length int) ([]byte, error) {
	if length > 255*sha256.Size {
		return nil, errors.New("hkdf length too large")
	}
	if salt == nil {
		salt = make([]byte, sha256.Size)
	}
	prk := hkdfExtract(sha256.New, secret, salt)
	return hkdfExpand(sha256.New, prk, info, length)
}

func hkdfExtract(hash func() hash.Hash, secret, salt []byte) []byte {
	m := hmac.New(hash, salt)
	_, _ = m.Write(secret)
	return m.Sum(nil)
}

func hkdfExpand(hash func() hash.Hash, prk, info []byte, length int) ([]byte, error) {
	hashLen := hash().Size()
	n := (length + hashLen - 1) / hashLen
	var out, t []byte
	for i := 1; i <= n; i++ {
		m := hmac.New(hash, prk)
		_, _ = m.Write(t)
		_, _ = m.Write(info)
		_, _ = m.Write([]byte{byte(i)})
		t = m.Sum(nil)
		out = append(out, t...)
	}
	return out[:length], nil
}

func (s *Store) Exists() bool {
	_, err := os.Stat(s.path)
	return err == nil
}

// Load decrypts and returns config. ErrNotExist if first run.
func (s *Store) Load() (*Data, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotExist
		}
		return nil, err
	}
	if len(raw) < nonceSize {
		return nil, errors.New("config blob truncated")
	}
	nonce, ct := raw[:nonceSize], raw[nonceSize:]
	pt, err := s.aead.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("config decrypt failed (wrong unlock key or corrupt file): %w", err)
	}
	var d Data
	if err := json.Unmarshal(pt, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// Save encrypts and atomically replaces the sealed config file.
func (s *Store) Save(d *Data) error {
	d.Version = currentVer
	d.UpdatedAt = time.Now().UTC()
	pt, err := json.Marshal(d)
	if err != nil {
		return err
	}
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	ct := s.aead.Seal(nil, nonce, pt, nil)
	out := append(append([]byte{}, nonce...), ct...)
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o600); err != nil {
		return err
	}
	// Windows: replace may fail if the destination is briefly locked.
	var err2 error
	for i := 0; i < 8; i++ {
		_ = os.Remove(s.path)
		err2 = os.Rename(tmp, s.path)
		if err2 == nil {
			return nil
		}
		time.Sleep(time.Duration(20*(i+1)) * time.Millisecond)
	}
	return err2
}

var ErrNotExist = errors.New("config store does not exist")

const blobAAD = "teamvault-blob-v1"

// SealBlob encrypts arbitrary small secrets (e.g. TOTP) with the same unlock-derived AEAD.
// Output: version byte (1) || nonce || ciphertext.
func (s *Store) SealBlob(plain []byte) ([]byte, error) {
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := s.aead.Seal(nil, nonce, plain, []byte(blobAAD))
	out := make([]byte, 1+nonceSize+len(ct))
	out[0] = 1
	copy(out[1:], nonce)
	copy(out[1+nonceSize:], ct)
	return out, nil
}

// OpenBlob decrypts a SealBlob payload. Returns error if corrupt or wrong key.
func (s *Store) OpenBlob(blob []byte) ([]byte, error) {
	if len(blob) < 1+nonceSize+16 {
		return nil, errors.New("blob truncated")
	}
	if blob[0] != 1 {
		return nil, errors.New("unsupported blob version")
	}
	nonce := blob[1 : 1+nonceSize]
	ct := blob[1+nonceSize:]
	return s.aead.Open(nil, nonce, ct, []byte(blobAAD))
}

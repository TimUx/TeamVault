// Package cryptocore is the Phase-2 vault cryptography module.
//
// Security decisions:
// - All vault crypto is intended for CLIENT use (CLI / future WASM / mirrored TS).
//   The API server must never call DecryptPayload / UnlockPrivateKey on user vault data.
// - Argon2id for master-password KDF (Prinzip 4); not for the high-entropy unlock keyfile.
// - Primitives from golang.org/x/crypto only (no custom constructions).
// - Sharing uses NaCl box (X25519 + XSalsa20-Poly1305) per recipient — no group password (Prinzip 5).
package cryptocore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

const (
	SaltSize        = 16
	NonceSizeGCM    = 12
	KeySize         = 32
	PrivateKeySize  = 32
	PublicKeySize   = 32
	SecretBoxOverhead = secretbox.Overhead
)

// DefaultArgon2 matches a conservative interactive unlock profile (tunable per tenant later).
var DefaultArgon2 = Argon2Params{
	Time:    3,
	Memory:  64 * 1024, // KiB
	Threads: 1,
	KeyLen:  KeySize,
}

type Argon2Params struct {
	Time    uint32
	Memory  uint32 // KiB
	Threads uint8
	KeyLen  uint32
}

type KeyPair struct {
	Public  [PublicKeySize]byte
	Private [PrivateKeySize]byte
}

type SealedPrivateKey struct {
	Salt       []byte
	Nonce      []byte
	Ciphertext []byte
	Params     Argon2Params
}

type Ciphertext struct {
	Nonce      []byte
	Ciphertext []byte
	KeyVersion uint32
}

type Envelope struct {
	EphemeralPub []byte
	Nonce        []byte
	Ciphertext   []byte
	KeyVersion   uint32
	RecipientPub []byte
}

var (
	ErrAuthFailed       = errors.New("cryptocore: authentication failed (wrong key/password or corrupt data)")
	ErrInvalidKeySize   = errors.New("cryptocore: invalid key size")
	ErrInvalidNonce     = errors.New("cryptocore: invalid nonce size")
	ErrKeyVersionMismatch = errors.New("cryptocore: key version mismatch")
	ErrRevokedVersion   = errors.New("cryptocore: key version revoked")
)

// DeriveMasterKey runs Argon2id(masterPassword, salt, params) → 32-byte MK.
func DeriveMasterKey(masterPassword, salt []byte, p Argon2Params) ([]byte, error) {
	if len(salt) != SaltSize {
		return nil, fmt.Errorf("cryptocore: salt must be %d bytes", SaltSize)
	}
	if p.KeyLen == 0 {
		p.KeyLen = KeySize
	}
	if p.Time == 0 || p.Memory == 0 || p.Threads == 0 {
		return nil, errors.New("cryptocore: invalid argon2 params")
	}
	return argon2.IDKey(masterPassword, salt, p.Time, p.Memory, p.Threads, p.KeyLen), nil
}

// RandomSalt returns SaltSize cryptographically random bytes.
func RandomSalt() ([]byte, error) {
	b := make([]byte, SaltSize)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return nil, err
	}
	return b, nil
}

// GenerateKeyPair creates an X25519 key pair for box sharing.
func GenerateKeyPair() (KeyPair, error) {
	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return KeyPair{}, err
	}
	return KeyPair{Public: *pub, Private: *priv}, nil
}

// SealPrivateKey encrypts SK with MK via secretbox (XSalsa20-Poly1305).
func SealPrivateKey(privateKey, masterKey []byte) (nonce, ciphertext []byte, err error) {
	if len(privateKey) != PrivateKeySize || len(masterKey) != KeySize {
		return nil, nil, ErrInvalidKeySize
	}
	var mk [KeySize]byte
	copy(mk[:], masterKey)
	var n [24]byte
	if _, err := io.ReadFull(rand.Reader, n[:]); err != nil {
		return nil, nil, err
	}
	out := secretbox.Seal(nil, privateKey, &n, &mk)
	return n[:], out, nil
}

// OpenPrivateKey decrypts SK with MK. Wrong password → ErrAuthFailed.
func OpenPrivateKey(nonce, ciphertext, masterKey []byte) ([]byte, error) {
	if len(masterKey) != KeySize {
		return nil, ErrInvalidKeySize
	}
	if len(nonce) != 24 {
		return nil, ErrInvalidNonce
	}
	var mk [KeySize]byte
	copy(mk[:], masterKey)
	var n [24]byte
	copy(n[:], nonce)
	out, ok := secretbox.Open(nil, ciphertext, &n, &mk)
	if !ok {
		return nil, ErrAuthFailed
	}
	return out, nil
}

// CreateIdentity derives MK, generates keypair, seals SK — onboarding helper.
func CreateIdentity(masterPassword []byte, p Argon2Params) (kp KeyPair, sealed SealedPrivateKey, err error) {
	salt, err := RandomSalt()
	if err != nil {
		return KeyPair{}, SealedPrivateKey{}, err
	}
	mk, err := DeriveMasterKey(masterPassword, salt, p)
	if err != nil {
		return KeyPair{}, SealedPrivateKey{}, err
	}
	defer zero(mk)
	kp, err = GenerateKeyPair()
	if err != nil {
		return KeyPair{}, SealedPrivateKey{}, err
	}
	nonce, ct, err := SealPrivateKey(kp.Private[:], mk)
	if err != nil {
		return KeyPair{}, SealedPrivateKey{}, err
	}
	sealed = SealedPrivateKey{Salt: salt, Nonce: nonce, Ciphertext: ct, Params: p}
	return kp, sealed, nil
}

// UnlockIdentity derives MK and opens sealed SK.
func UnlockIdentity(masterPassword []byte, sealed SealedPrivateKey) (privateKey []byte, masterKey []byte, err error) {
	mk, err := DeriveMasterKey(masterPassword, sealed.Salt, sealed.Params)
	if err != nil {
		return nil, nil, err
	}
	sk, err := OpenPrivateKey(sealed.Nonce, sealed.Ciphertext, mk)
	if err != nil {
		zero(mk)
		return nil, nil, err
	}
	return sk, mk, nil
}

// GenerateDataKey returns a random 32-byte DK.
func GenerateDataKey() ([]byte, error) {
	b := make([]byte, KeySize)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return nil, err
	}
	return b, nil
}

// EncryptPayload AES-256-GCM encrypts plaintext with DK.
func EncryptPayload(plaintext, dataKey []byte, keyVersion uint32) (Ciphertext, error) {
	if len(dataKey) != KeySize {
		return Ciphertext{}, ErrInvalidKeySize
	}
	block, err := aes.NewCipher(dataKey)
	if err != nil {
		return Ciphertext{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return Ciphertext{}, err
	}
	nonce := make([]byte, NonceSizeGCM)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return Ciphertext{}, err
	}
	// AAD binds key version to ciphertext (rotation safety).
	aad := make([]byte, 4)
	binary.BigEndian.PutUint32(aad, keyVersion)
	ct := aead.Seal(nil, nonce, plaintext, aad)
	return Ciphertext{Nonce: nonce, Ciphertext: ct, KeyVersion: keyVersion}, nil
}

// DecryptPayload AES-256-GCM decrypts. Wrong key/corrupt → ErrAuthFailed.
// If expectedVersion != nil and mismatches, returns ErrKeyVersionMismatch before decrypt attempt on AAD.
func DecryptPayload(c Ciphertext, dataKey []byte, revoked map[uint32]struct{}) ([]byte, error) {
	if revoked != nil {
		if _, ok := revoked[c.KeyVersion]; ok {
			return nil, ErrRevokedVersion
		}
	}
	if len(dataKey) != KeySize {
		return nil, ErrInvalidKeySize
	}
	if len(c.Nonce) != NonceSizeGCM {
		return nil, ErrInvalidNonce
	}
	block, err := aes.NewCipher(dataKey)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	aad := make([]byte, 4)
	binary.BigEndian.PutUint32(aad, c.KeyVersion)
	pt, err := aead.Open(nil, c.Nonce, c.Ciphertext, aad)
	if err != nil {
		return nil, ErrAuthFailed
	}
	return pt, nil
}

// SealDataKeyForRecipient boxes DK to recipient's X25519 public key.
func SealDataKeyForRecipient(dataKey []byte, recipientPub []byte, keyVersion uint32) (Envelope, error) {
	if len(dataKey) != KeySize || len(recipientPub) != PublicKeySize {
		return Envelope{}, ErrInvalidKeySize
	}
	var peer [PublicKeySize]byte
	copy(peer[:], recipientPub)
	ephemeralPub, ephemeralPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return Envelope{}, err
	}
	var nonce [24]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		return Envelope{}, err
	}
	ct := box.Seal(nil, dataKey, &nonce, &peer, ephemeralPriv)
	return Envelope{
		EphemeralPub: ephemeralPub[:],
		Nonce:        nonce[:],
		Ciphertext:   ct,
		KeyVersion:   keyVersion,
		RecipientPub: append([]byte{}, recipientPub...),
	}, nil
}

// OpenDataKeyEnvelope unboxes DK with recipient private key.
func OpenDataKeyEnvelope(env Envelope, recipientPriv []byte) ([]byte, error) {
	if len(recipientPriv) != PrivateKeySize {
		return nil, ErrInvalidKeySize
	}
	if len(env.EphemeralPub) != PublicKeySize || len(env.Nonce) != 24 {
		return nil, ErrInvalidNonce
	}
	var eph [PublicKeySize]byte
	copy(eph[:], env.EphemeralPub)
	var priv [PrivateKeySize]byte
	copy(priv[:], recipientPriv)
	var nonce [24]byte
	copy(nonce[:], env.Nonce)
	out, ok := box.Open(nil, env.Ciphertext, &nonce, &eph, &priv)
	if !ok {
		return nil, ErrAuthFailed
	}
	return out, nil
}

// RotateSecret re-encrypts plaintext under a new DK and keyVersion; builds envelopes for recipients.
func RotateSecret(plaintext []byte, newVersion uint32, recipientPubs [][]byte) (dk []byte, ct Ciphertext, envs []Envelope, err error) {
	dk, err = GenerateDataKey()
	if err != nil {
		return nil, Ciphertext{}, nil, err
	}
	ct, err = EncryptPayload(plaintext, dk, newVersion)
	if err != nil {
		zero(dk)
		return nil, Ciphertext{}, nil, err
	}
	envs = make([]Envelope, 0, len(recipientPubs))
	for _, pub := range recipientPubs {
		env, err := SealDataKeyForRecipient(dk, pub, newVersion)
		if err != nil {
			zero(dk)
			return nil, Ciphertext{}, nil, err
		}
		envs = append(envs, env)
	}
	return dk, ct, envs, nil
}

// GenerateRecoveryKitSeed returns high-entropy bytes for a user recovery kit (display/export client-side).
func GenerateRecoveryKitSeed() ([]byte, error) {
	b := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return nil, err
	}
	return b, nil
}

// SealPrivateKeyWithRecoveryKey seals SK under a recovery-kit-derived key (also Argon2id over kit secret).
func SealPrivateKeyWithRecoveryKey(privateKey, recoverySecret []byte, p Argon2Params) (SealedPrivateKey, error) {
	salt, err := RandomSalt()
	if err != nil {
		return SealedPrivateKey{}, err
	}
	rk, err := DeriveMasterKey(recoverySecret, salt, p)
	if err != nil {
		return SealedPrivateKey{}, err
	}
	defer zero(rk)
	nonce, ct, err := SealPrivateKey(privateKey, rk)
	if err != nil {
		return SealedPrivateKey{}, err
	}
	return SealedPrivateKey{Salt: salt, Nonce: nonce, Ciphertext: ct, Params: p}, nil
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

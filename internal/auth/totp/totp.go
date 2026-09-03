package totp

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"time"
	"unicode"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// GenerateSecret creates a new TOTP key for issuer/account.
func GenerateSecret(issuer, account string) (*otp.Key, error) {
	return totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: account,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
}

// NormalizeCode strips spaces and non-digits (authenticator paste quirks).
func NormalizeCode(code string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(code) {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func Validate(code, secret string) bool {
	_, ok := ValidateCounter(code, secret, time.Now().UTC())
	return ok
}

// ValidateCounter validates a code and returns the accepted time-step.
// Checking individual steps lets callers reject replayed codes.
func ValidateCounter(code, secret string, now time.Time) (int64, bool) {
	code = NormalizeCode(code)
	secret = strings.TrimSpace(secret)
	if code == "" || secret == "" {
		return 0, false
	}
	const period = int64(30)
	current := now.Unix() / period
	for offset := int64(-2); offset <= 2; offset++ {
		ok, err := totp.ValidateCustom(code, secret, time.Unix((current+offset)*period, 0).UTC(), totp.ValidateOpts{
			Period:    uint(period),
			Skew:      0,
			Digits:    otp.DigitsSix,
			Algorithm: otp.AlgorithmSHA1,
		})
		if err == nil && ok {
			return current + offset, true
		}
	}
	return 0, false
}

// LegacySeal encodes the TOTP shared secret as base64 (Phase 4; migrate via SealWith).
func LegacySeal(plain string) []byte {
	return []byte(base64.StdEncoding.EncodeToString([]byte(plain)))
}

// LegacyOpen decodes a LegacySeal blob.
func LegacyOpen(enc []byte) (string, error) {
	b, err := base64.StdEncoding.DecodeString(string(enc))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Sealer encrypts small blobs with the instance unlock AEAD (configstore).
type Sealer interface {
	SealBlob(plain []byte) ([]byte, error)
	OpenBlob(blob []byte) ([]byte, error)
}

// SealWith encrypts the TOTP secret with the config unlock key.
func SealWith(s Sealer, plain string) ([]byte, error) {
	return s.SealBlob([]byte(plain))
}

// OpenWith decrypts SealWith output; falls back to LegacyOpen for pre-Phase-9 rows.
func OpenWith(s Sealer, enc []byte) (string, error) {
	if len(enc) > 0 && enc[0] == 1 {
		pt, err := s.OpenBlob(enc)
		if err != nil {
			return "", err
		}
		return string(pt), nil
	}
	// Heuristic: legacy base64 (printable, no version byte 1 as sole indicator —
	// versioned blobs start with 0x01 which is not valid start of std base64 alphabet often,
	// but 'A' etc. Legacy path for anything that fails AEAD or looks like base64.
	if s != nil && len(enc) >= 1+12+16 {
		if pt, err := s.OpenBlob(enc); err == nil {
			return string(pt), nil
		}
	}
	return LegacyOpen(enc)
}

// IsLegacyEncoding reports whether enc looks like Phase-4 base64 (not versioned AEAD).
func IsLegacyEncoding(enc []byte) bool {
	if len(enc) == 0 {
		return false
	}
	if enc[0] == 1 {
		return false
	}
	_, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(enc)))
	return err == nil
}

// RandomRecoveryCodes returns n one-time backup codes (not vault recovery kit).
func RandomRecoveryCodes(n int) ([]string, error) {
	out := make([]string, n)
	for i := 0; i < n; i++ {
		b := make([]byte, 5)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		out[i] = base64.RawStdEncoding.EncodeToString(b)
	}
	return out, nil
}

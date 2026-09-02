package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/store"
)

func argonParamsJSON(p cryptocore.Argon2Params) string {
	if p.Time == 0 || p.Memory == 0 {
		return ""
	}
	if p.KeyLen == 0 {
		p.KeyLen = 32
	}
	b, err := json.Marshal(p)
	if err != nil {
		return ""
	}
	return string(b)
}

func parseArgonParamsJSON(s string) (cryptocore.Argon2Params, bool) {
	var p cryptocore.Argon2Params
	if strings.TrimSpace(s) == "" {
		return cryptocore.Argon2Params{}, false
	}
	if err := json.Unmarshal([]byte(s), &p); err != nil || p.Time == 0 || p.Memory == 0 {
		return cryptocore.Argon2Params{}, false
	}
	if p.KeyLen == 0 {
		p.KeyLen = 32
	}
	return p, true
}

func userArgonParams(u store.UserRecord, fallback cryptocore.Argon2Params) (cryptocore.Argon2Params, bool) {
	if p, ok := parseArgonParamsJSON(u.KdfParamsJSON); ok {
		return p, true
	}
	return fallback, false
}

func publicKeyFingerprint(pub []byte) string {
	if len(pub) == 0 {
		return ""
	}
	sum := sha256.Sum256(pub)
	h := hex.EncodeToString(sum[:])
	var b strings.Builder
	for i := 0; i < len(h); i += 4 {
		if i > 0 {
			b.WriteByte(' ')
		}
		end := i + 4
		if end > len(h) {
			end = len(h)
		}
		b.WriteString(strings.ToUpper(h[i:end]))
	}
	return b.String()
}

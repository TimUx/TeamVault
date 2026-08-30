// Package unlock loads the single external bootstrap secret (MASTER_UNLOCK_KEY).
//
// Security decision (OQ-14, Prinzip Config): Prod prefers a mounted keyfile;
// env var is Dev/Test fallback only. The key unlocks the encrypted config store
// only — it never decrypts vault payloads (those stay client-side / ZK).
package unlock

import (
	"fmt"
	"os"
	"strings"
)

const (
	EnvKey     = "TEAMVAULT_MASTER_UNLOCK_KEY"
	EnvKeyFile = "TEAMVAULT_MASTER_UNLOCK_KEY_FILE"
	// Legacy alias from planning docs
	EnvKeyLegacy = "MASTER_UNLOCK_KEY"
)

// MinKeyBytes: unlock material must be high-entropy (random keyfile), not a password.
const MinKeyBytes = 32

// Load reads the unlock key: keyfile first, then env. Returns raw key bytes.
func Load() ([]byte, error) {
	if path := strings.TrimSpace(os.Getenv(EnvKeyFile)); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read unlock key file: %w", err)
		}
		b = trimKeyMaterial(b)
		if err := validate(b); err != nil {
			return nil, err
		}
		return b, nil
	}

	for _, name := range []string{EnvKey, EnvKeyLegacy} {
		if v := os.Getenv(name); v != "" {
			b := trimKeyMaterial([]byte(v))
			if err := validate(b); err != nil {
				return nil, err
			}
			return b, nil
		}
	}

	return nil, fmt.Errorf("missing unlock key: set %s (preferred) or %s", EnvKeyFile, EnvKey)
}

func trimKeyMaterial(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

func validate(b []byte) error {
	if len(b) < MinKeyBytes {
		return fmt.Errorf("unlock key too short: need >= %d bytes of high-entropy material (use a random keyfile)", MinKeyBytes)
	}
	return nil
}

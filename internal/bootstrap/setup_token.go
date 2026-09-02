package bootstrap

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// SetupTokenFile is the basename of the one-time first-run token (0600).
const SetupTokenFile = "setup.token"

// SetupTokenHeader is required on POST /api/setup/commit until the instance is initialized.
const SetupTokenHeader = "X-TeamVault-Setup-Token"

func setupTokenPath(dataDir string) string {
	return filepath.Join(dataDir, SetupTokenFile)
}

// EnsureSetupToken writes a random token if none exists. Prints it to stderr once created.
func EnsureSetupToken(dataDir string) (string, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	path := setupTokenPath(dataDir)
	if b, err := os.ReadFile(path); err == nil {
		tok := strings.TrimSpace(string(b))
		if len(tok) >= 32 {
			return tok, nil
		}
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	tok := hex.EncodeToString(raw)
	if err := os.WriteFile(path, []byte(tok+"\n"), 0o600); err != nil {
		return "", err
	}
	fmt.Fprintf(os.Stderr, "TeamVault setup token (header %s):\n%s\nwritten to %s\n", SetupTokenHeader, tok, path)
	return tok, nil
}

// LoadSetupToken reads the token file. Empty/missing is not an error for callers that check Valid.
func LoadSetupToken(dataDir string) (string, error) {
	b, err := os.ReadFile(setupTokenPath(dataDir))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// ClearSetupToken removes the token after a successful setup commit.
func ClearSetupToken(dataDir string) {
	_ = os.Remove(setupTokenPath(dataDir))
}

// SetupTokenValid is a constant-time compare of the provided token against the file.
func SetupTokenValid(dataDir, provided string) bool {
	want, err := LoadSetupToken(dataDir)
	provided = strings.TrimSpace(provided)
	if err != nil || want == "" || provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(want), []byte(provided)) == 1
}

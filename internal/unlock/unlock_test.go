package unlock_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/unlock"
)

func TestLoadFromKeyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "unlock.key")
	key := []byte("0123456789abcdef0123456789abcdef") // 32 bytes
	if err := os.WriteFile(path, key, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(unlock.EnvKeyFile, path)
	t.Setenv(unlock.EnvKey, "")
	t.Setenv(unlock.EnvKeyLegacy, "")

	got, err := unlock.Load()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(key) {
		t.Fatalf("key mismatch")
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv(unlock.EnvKeyFile, "")
	t.Setenv(unlock.EnvKey, "0123456789abcdef0123456789abcdef")
	t.Setenv(unlock.EnvKeyLegacy, "")

	got, err := unlock.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 32 {
		t.Fatalf("len=%d", len(got))
	}
}

func TestLoadMissing(t *testing.T) {
	t.Setenv(unlock.EnvKeyFile, "")
	t.Setenv(unlock.EnvKey, "")
	t.Setenv(unlock.EnvKeyLegacy, "")
	if _, err := unlock.Load(); err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadTooShort(t *testing.T) {
	t.Setenv(unlock.EnvKeyFile, "")
	t.Setenv(unlock.EnvKey, "tooshort")
	t.Setenv(unlock.EnvKeyLegacy, "")
	if _, err := unlock.Load(); err == nil {
		t.Fatal("expected short-key error")
	}
}

package configstore_test

import (
	"bytes"
	"errors"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/configstore"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{0x42}, 32)
	s, err := configstore.Open(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	in := &configstore.Data{
		Initialized: false,
		Storage:     configstore.StorageConfig{Backend: "sqlite", DSN: filepath.Join(dir, "vault.db")},
	}
	if err := s.Save(in); err != nil {
		t.Fatal(err)
	}
	out, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if out.Storage.Backend != "sqlite" || out.Storage.DSN != in.Storage.DSN {
		t.Fatalf("mismatch: %+v", out.Storage)
	}
	if out.Version != 1 {
		t.Fatalf("version=%d", out.Version)
	}
}

func TestWrongKeyFails(t *testing.T) {
	dir := t.TempDir()
	s1, err := configstore.Open(dir, bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if err := s1.Save(&configstore.Data{Storage: configstore.StorageConfig{Backend: "sqlite"}}); err != nil {
		t.Fatal(err)
	}
	s2, err := configstore.Open(dir, bytes.Repeat([]byte{2}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s2.Load(); err == nil {
		t.Fatal("expected decrypt failure")
	}
}

func TestSealBlobRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := configstore.Open(dir, bytes.Repeat([]byte{0x7a}, 32))
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte("totp-secret-material")
	blob, err := s.SealBlob(plain)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.OpenBlob(blob)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != string(plain) {
		t.Fatalf("got %q", out)
	}
}

func TestLoadMissing(t *testing.T) {
	s, err := configstore.Open(t.TempDir(), bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Load()
	if !errors.Is(err, configstore.ErrNotExist) {
		t.Fatalf("got %v", err)
	}
}

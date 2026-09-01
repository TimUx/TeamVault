package clients

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSeedDownloadsCopiesMissing(t *testing.T) {
	bundled := t.TempDir()
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(bundled, "tvcli-linux-amd64"), []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := SeedDownloads(bundled, target); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(target, "tvcli-linux-amd64"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "bin" {
		t.Fatalf("got %q", b)
	}
}

func TestBuildManifest(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "tvcli-windows-amd64.exe"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := BuildManifest(dir, "https://vault.example/vault")
	if len(m.CLI) != 1 || m.CLI[0].Platform != "windows" {
		t.Fatalf("cli: %+v", m.CLI)
	}
	if m.CLI[0].URL != "/downloads/tvcli-windows-amd64.exe" {
		t.Fatalf("url: %s", m.CLI[0].URL)
	}
	if m.Extension.Crx != nil || m.Extension.Zip != nil {
		t.Fatal("expected no extension artifacts")
	}
	if m.Install.CLIWindows == "" {
		t.Fatal("install scripts missing")
	}
}

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
	if len(m.Desktop) != 0 {
		t.Fatalf("expected no desktop artifacts: %+v", m.Desktop)
	}
	if m.Install.CLIWindows == "" {
		t.Fatal("install scripts missing")
	}
}

func TestBuildManifestDesktop(t *testing.T) {
	dir := t.TempDir()
	names := []string{
		"teamvault-desktop-linux-amd64",
		"teamvault-desktop-linux-amd64.AppImage",
		"teamvault-desktop-windows-amd64.exe",
		"teamvault-desktop-windows-amd64-setup.exe",
	}
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	m := BuildManifest(dir, "https://vault.example")
	if len(m.CLI) != 0 {
		t.Fatalf("expected no CLI artifacts leaking into desktop-only dir: %+v", m.CLI)
	}
	if len(m.Desktop) != 4 {
		t.Fatalf("expected 4 desktop artifacts, got %+v", m.Desktop)
	}
	byName := map[string]Artifact{}
	for _, a := range m.Desktop {
		byName[a.Name] = a
	}
	cases := map[string]struct{ platform, kind string }{
		"teamvault-desktop-linux-amd64":             {"linux", "portable"},
		"teamvault-desktop-linux-amd64.AppImage":    {"linux", "appimage"},
		"teamvault-desktop-windows-amd64.exe":       {"windows", "portable"},
		"teamvault-desktop-windows-amd64-setup.exe": {"windows", "installer"},
	}
	for name, want := range cases {
		got, ok := byName[name]
		if !ok {
			t.Fatalf("missing artifact %s", name)
		}
		if got.Platform != want.platform || got.Kind != want.kind {
			t.Fatalf("%s: got platform=%s kind=%s, want platform=%s kind=%s", name, got.Platform, got.Kind, want.platform, want.kind)
		}
		if got.URL != "/downloads/"+name {
			t.Fatalf("%s: url=%s", name, got.URL)
		}
	}
}

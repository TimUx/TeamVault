package clients

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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

func TestSeedDownloadsKeepsDesktopMetadataPaired(t *testing.T) {
	const name = "teamvault-desktop-windows-amd64.exe"
	for _, tc := range []struct {
		label, bundleVersion, targetVersion, wantVersion string
		preserveTarget                                   bool
	}{
		{"custom-with-version", "bundled", "custom", "custom", true},
		{"custom-without-version", "bundled", "", "", true},
		{"replacement", "bundled", "custom", "bundled", false},
		{"legacy-replacement", "", "custom", "", false},
	} {
		t.Run(tc.label, func(t *testing.T) {
			bundled, target := t.TempDir(), t.TempDir()
			write := func(dir, file, content string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			write(bundled, name, "bundled")
			write(target, name, "custom")
			if tc.bundleVersion != "" {
				write(bundled, name+".version", tc.bundleVersion)
			}
			if tc.targetVersion != "" {
				write(target, name+".version", tc.targetVersion)
			}
			bundleTime := time.Now().Add(-time.Hour)
			targetTime := bundleTime.Add(-time.Hour)
			if tc.preserveTarget {
				targetTime = bundleTime.Add(time.Hour)
			}
			for file, stamp := range map[string]time.Time{
				filepath.Join(bundled, name): bundleTime,
				filepath.Join(target, name):  targetTime,
			} {
				if err := os.Chtimes(file, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			}
			if err := SeedDownloads(bundled, target); err != nil {
				t.Fatal(err)
			}
			content, err := os.ReadFile(filepath.Join(target, name))
			wantContent := "bundled"
			if tc.preserveTarget {
				wantContent = "custom"
			}
			if err != nil || string(content) != wantContent {
				t.Fatalf("binary = %q, err = %v", content, err)
			}
			version, err := os.ReadFile(filepath.Join(target, name+".version"))
			if tc.wantVersion == "" {
				if !os.IsNotExist(err) {
					t.Fatalf("expected no sidecar, got %q, err = %v", version, err)
				}
			} else if err != nil || string(version) != tc.wantVersion {
				t.Fatalf("version = %q, want %q, err = %v", version, tc.wantVersion, err)
			}
		})
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

func TestDesktopDownloadName(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name, version, want string
	}{
		{"teamvault-desktop-windows-amd64.exe", "v1.5.34\n", "teamvault-desktop-windows-amd64-v1.5.34.exe"},
		{"teamvault-desktop-windows-amd64-setup.exe", "v1.5.34\r\n", "teamvault-desktop-windows-amd64-v1.5.34-setup.exe"},
		{"teamvault-desktop-linux-amd64", "v1.5.34", "teamvault-desktop-linux-amd64-v1.5.34"},
		{"teamvault-desktop-linux-amd64.AppImage", "v1.5.34", "teamvault-desktop-linux-amd64-v1.5.34.AppImage"},
		{"teamvault-desktop-windows-amd64.exe", "v1.5.35-rc.1", "teamvault-desktop-windows-amd64-v1.5.35-rc.1.exe"},
		{"teamvault-desktop-windows-amd64.exe", "v1.5.34-2-gabcdef-dirty", "teamvault-desktop-windows-amd64-v1.5.34-2-gabcdef-dirty.exe"},
		{"teamvault-desktop-windows-amd64.exe", "dev", "teamvault-desktop-windows-amd64-dev.exe"},
		{"teamvault-desktop-windows-amd64.exe", "", "teamvault-desktop-windows-amd64.exe"},
		{"teamvault-desktop-windows-amd64.exe", "../bad", "teamvault-desktop-windows-amd64.exe"},
		{"teamvault-desktop-windows-amd64.exe", "v1\r\nInjected: header", "teamvault-desktop-windows-amd64.exe"},
		{"tvcli-windows-amd64.exe", "v1.5.34", "tvcli-windows-amd64.exe"},
	} {
		t.Run(tc.name+"/"+tc.version, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dir, tc.name+".version"), []byte(tc.version), 0o644); err != nil {
				t.Fatal(err)
			}
			if got := DesktopDownloadName(dir, tc.name); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
	if got := DesktopDownloadName(t.TempDir(), "teamvault-desktop-windows-amd64.exe"); got != "teamvault-desktop-windows-amd64.exe" {
		t.Fatalf("missing metadata changed legacy name: %s", got)
	}
}

func TestSeedDownloadsAndManifestDesktopVersions(t *testing.T) {
	bundled, target := t.TempDir(), t.TempDir()
	versions := map[string]string{
		"teamvault-desktop-linux-amd64":             "v1.5.33",
		"teamvault-desktop-linux-amd64.AppImage":    "v1.5.33",
		"teamvault-desktop-windows-amd64.exe":       "v1.5.34",
		"teamvault-desktop-windows-amd64-setup.exe": "v1.5.34",
	}
	for name, version := range versions {
		if err := os.WriteFile(filepath.Join(bundled, name), []byte("binary"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(bundled, name+".version"), []byte(version+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := SeedDownloads(bundled, target); err != nil {
		t.Fatal(err)
	}
	m := BuildManifest(target, "https://vault.example")
	if len(m.Desktop) != 4 || len(m.CLI) != 0 {
		t.Fatalf("metadata exposed as downloadable artifact: %+v", m)
	}
	for _, artifact := range m.Desktop {
		storageName := filepath.Base(artifact.URL)
		version := versions[storageName]
		if version == "" || artifact.Name != DesktopDownloadName(target, storageName) || artifact.Name == storageName {
			t.Fatalf("incorrect versioned artifact: %+v", artifact)
		}
		if artifact.Arch != "amd64" || artifact.Size != 6 {
			t.Fatalf("version metadata changed platform/size: %+v", artifact)
		}
	}
}

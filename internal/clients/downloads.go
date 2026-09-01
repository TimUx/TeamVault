package clients

import (
	"io"
	"os"
	"path/filepath"
	"strings"
)

// BundledArtifactNames are copied from the image bundle into <data-dir>/downloads/.
var BundledArtifactNames = []string{
	"tvcli-linux-amd64",
	"tvcli-linux-arm64",
	"tvcli-windows-amd64.exe",
	"tvcli-windows-arm64.exe",
	"teamvault-extension.zip",
	"teamvault-extension.crx",
	"teamvault-extension.xpi",
	"extension/updates.xml",
	"extension/extension-id.txt",
	"extension/version.txt",
	"extension/chrome-policy.json",
	"extension/chrome-install-sources.json",
	"extension/firefox-policy.json",
}

// Artifact describes one downloadable client file.
type Artifact struct {
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
	Arch     string `json:"arch,omitempty"`
	Size     int64  `json:"size"`
	URL      string `json:"url"`
}

// ExtensionInfo describes browser extension install artifacts.
type ExtensionInfo struct {
	ID              string    `json:"id,omitempty"`
	Zip             *Artifact `json:"zip,omitempty"`
	Crx             *Artifact `json:"crx,omitempty"`
	Xpi             *Artifact `json:"xpi,omitempty"`
	UpdateURL       string    `json:"update_url,omitempty"`
	PolicyURL       string    `json:"policy_url,omitempty"`
	InstallSourcesURL string  `json:"install_sources_url,omitempty"`
}

// Manifest is returned by GET /api/client-downloads.
type Manifest struct {
	CLI       []Artifact    `json:"cli"`
	Extension ExtensionInfo `json:"extension"`
	Install   struct {
		CLIWindows        string `json:"cli_windows"`
		CLIUnix           string `json:"cli_unix"`
		ExtensionWindows  string `json:"extension_windows"`
		ExtensionUnix     string `json:"extension_unix"`
		ExtensionPolicyPS string `json:"extension_policy_ps"`
		ExtensionUserPS   string `json:"extension_user_ps"`
	} `json:"install"`
}

// ResolveBundledDir returns the directory with image-shipped client artifacts.
func ResolveBundledDir() string {
	if v := strings.TrimSpace(os.Getenv("TEAMVAULT_BUNDLED_DOWNLOADS")); v != "" {
		return v
	}
	return "/opt/teamvault/bundled-downloads"
}

// SeedDownloads copies bundled client artifacts into the runtime downloads folder
// when the target is missing or older than the bundle (image upgrade).
func SeedDownloads(bundledDir, targetDir string) error {
	if strings.TrimSpace(bundledDir) == "" {
		return nil
	}
	if _, err := os.Stat(bundledDir); err != nil {
		return nil
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return err
	}
	for _, name := range BundledArtifactNames {
		src := filepath.Join(bundledDir, filepath.FromSlash(name))
		dst := filepath.Join(targetDir, filepath.FromSlash(name))
		if err := copyIfNewer(src, dst); err != nil {
			return err
		}
	}
	return nil
}

func copyIfNewer(src, dst string) error {
	si, err := os.Stat(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !si.Mode().IsRegular() {
		return nil
	}
	di, err := os.Stat(dst)
	if err == nil && !di.ModTime().Before(si.ModTime()) {
		return nil
	}
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, si.Mode().Perm())
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Chmod(si.Mode().Perm())
}

func artifactIfExists(dir, name string) *Artifact {
	path := filepath.Join(dir, filepath.FromSlash(name))
	fi, err := os.Stat(path)
	if err != nil || !fi.Mode().IsRegular() {
		return nil
	}
	return &Artifact{Name: filepath.Base(name), Size: fi.Size(), URL: "/downloads/" + strings.ReplaceAll(name, "\\", "/")}
}

func readExtensionID(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "extension", "extension-id.txt"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.Split(string(b), "\n")[0])
}

// BuildManifest lists known client artifacts present in dir with public URLs.
func BuildManifest(dir, publicBase string) Manifest {
	publicBase = strings.TrimRight(strings.TrimSpace(publicBase), "/")
	var m Manifest
	for _, name := range BundledArtifactNames {
		if strings.HasPrefix(name, "teamvault-extension") || strings.HasPrefix(name, "extension/") {
			continue
		}
		path := filepath.Join(dir, filepath.FromSlash(name))
		fi, err := os.Stat(path)
		if err != nil || !fi.Mode().IsRegular() {
			continue
		}
		plat, arch := parseCLIPlatform(name)
		m.CLI = append(m.CLI, Artifact{
			Name: name, Platform: plat, Arch: arch, Size: fi.Size(),
			URL: "/downloads/" + name,
		})
	}
	updatePath := "/downloads/extension/updates.xml"
	m.Extension = ExtensionInfo{
		ID:                readExtensionID(dir),
		Zip:               artifactIfExists(dir, "teamvault-extension.zip"),
		Crx:               artifactIfExists(dir, "teamvault-extension.crx"),
		Xpi:               artifactIfExists(dir, "teamvault-extension.xpi"),
		UpdateURL:         updatePath,
		PolicyURL:         "/downloads/extension/chrome-policy.json",
		InstallSourcesURL: "/downloads/extension/chrome-install-sources.json",
	}
	m.Install.CLIWindows = `$env:TEAMVAULT_URL='` + publicBase + `'; irm "$env:TEAMVAULT_URL/help/install/tvcli.ps1" | iex`
	m.Install.CLIUnix = `curl -fsSL "` + publicBase + `/help/install/tvcli.sh" | TEAMVAULT_URL="` + publicBase + `" bash`
	m.Install.ExtensionWindows = `$env:TEAMVAULT_URL='` + publicBase + `'; irm "$env:TEAMVAULT_URL/help/install/extension-user.ps1" | iex`
	m.Install.ExtensionUnix = `curl -fsSL "` + publicBase + `/help/install/extension-user.sh" | TEAMVAULT_URL="` + publicBase + `" bash`
	m.Install.ExtensionPolicyPS = `$env:TEAMVAULT_URL='` + publicBase + `'; irm "$env:TEAMVAULT_URL/help/install/extension-policy.ps1" | iex`
	m.Install.ExtensionUserPS = m.Install.ExtensionWindows
	return m
}

func parseCLIPlatform(name string) (platform, arch string) {
	switch {
	case strings.HasPrefix(name, "tvcli-windows-"):
		platform = "windows"
	case strings.HasPrefix(name, "tvcli-linux-"):
		platform = "linux"
	default:
		return "", ""
	}
	rest := strings.TrimPrefix(strings.TrimPrefix(name, "tvcli-windows-"), "tvcli-linux-")
	rest = strings.TrimSuffix(rest, ".exe")
	return platform, rest
}

// DownloadContentType returns the MIME type for client download files.
func DownloadContentType(name string) string {
	switch {
	case strings.HasSuffix(name, ".crx"):
		return "application/x-chrome-extension"
	case strings.HasSuffix(name, ".xpi"):
		return "application/x-xpinstall"
	case strings.HasSuffix(name, ".xml"):
		return "application/xml"
	case strings.HasSuffix(name, ".json"):
		return "application/json"
	default:
		return ""
	}
}

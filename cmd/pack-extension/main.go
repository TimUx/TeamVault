// Command pack-extension builds extension distribution artifacts (zip, crx, xpi, updates.xml).
package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/teamvault/teamvault/internal/clients/crx3"
)

func main() {
	root, _ := os.Getwd()
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		root = filepath.Join(root, "..", "..")
	}
	extDir := filepath.Join(root, "clients", "extension")
	outDir := filepath.Join(root, "dist")
	keyPath := filepath.Join(extDir, "teamvault.pem")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fatal(err)
	}
	pem, err := os.ReadFile(keyPath)
	if err != nil {
		generated, gerr := crx3.GeneratePrivateKeyPEM()
		if gerr != nil {
			fatal(gerr)
		}
		if werr := os.WriteFile(keyPath, []byte(generated), 0o600); werr != nil {
			fatal(werr)
		}
		fmt.Fprintf(os.Stderr, "generated %s — keep it local (not git) for a stable extension ID\n", keyPath)
		pem = []byte(generated)
	}
	manifest, err := readManifest(filepath.Join(extDir, "manifest.json"))
	if err != nil {
		fatal(err)
	}
	zipPath := filepath.Join(outDir, "teamvault-extension.zip")
	if err := zipDir(extDir, zipPath); err != nil {
		fatal(err)
	}
	crxPath := filepath.Join(outDir, "teamvault-extension.crx")
	extID, err := crx3.PackDir(extDir, crxPath, string(pem))
	if err != nil {
		fatal(err)
	}
	xpiPath := filepath.Join(outDir, "teamvault-extension.xpi")
	if err := copyFile(zipPath, xpiPath); err != nil {
		fatal(err)
	}
	base := strings.TrimRight(envOr("TV_EXTENSION_UPDATE_BASE", "https://IHRE-VAULT-URL"), "/")
	if err := writeUpdates(outDir, extID, manifest.Version, base); err != nil {
		fatal(err)
	}
	if err := writePolicies(outDir, extID, base); err != nil {
		fatal(err)
	}
	fmt.Printf("packed extension id=%s version=%s\n", extID, manifest.Version)
}

type manifestJSON struct {
	Version string `json:"version"`
}

func readManifest(path string) (manifestJSON, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return manifestJSON{}, err
	}
	var m manifestJSON
	return m, json.Unmarshal(b, &m)
}

func zipDir(src, dest string) error {
	_ = os.Remove(dest)
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	zw := zip.NewWriter(out)
	err = filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		if filepath.Base(path) == "teamvault.pem" {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		w, err := zw.Create(rel)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(w, f)
		return err
	})
	if err != nil {
		return err
	}
	return zw.Close()
}

func writeUpdates(outDir, extID, version, base string) error {
	sub := filepath.Join(outDir, "extension")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		return err
	}
	codebase := base + "/downloads/teamvault-extension.crx"
	xml := fmt.Sprintf(`<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='%s'>
    <updatecheck codebase='%s' version='%s' />
  </app>
</gupdate>
`, extID, codebase, version)
	if err := os.WriteFile(filepath.Join(sub, "updates.xml"), []byte(xml), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(sub, "extension-id.txt"), []byte(extID+"\n"), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(sub, "version.txt"), []byte(version+"\n"), 0o644)
}

func writePolicies(outDir, extID, base string) error {
	sub := filepath.Join(outDir, "extension")
	updateURL := base + "/downloads/extension/updates.xml"
	policy := map[string]any{
		extID: map[string]string{
			"installation_mode": "normal_installed",
			"update_url":        updateURL,
		},
	}
	b, _ := json.MarshalIndent(policy, "", "  ")
	if err := os.WriteFile(filepath.Join(sub, "chrome-policy.json"), append(b, '\n'), 0o644); err != nil {
		return err
	}
	sources, _ := json.MarshalIndent([]string{base + "/*"}, "", "  ")
	if err := os.WriteFile(filepath.Join(sub, "chrome-install-sources.json"), append(sources, '\n'), 0o644); err != nil {
		return err
	}
	xpiURL := base + "/downloads/teamvault-extension.xpi"
	firefoxPolicy := map[string]any{
		"policies": map[string]any{
			"xpinstall.signatures.required": false,
			"Extensions": map[string]any{
				"Install": []string{xpiURL},
			},
		},
	}
	fb, _ := json.MarshalIndent(firefoxPolicy, "", "  ")
	return os.WriteFile(filepath.Join(sub, "firefox-policy.json"), append(fb, '\n'), 0o644)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

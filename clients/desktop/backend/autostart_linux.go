//go:build linux

package backend

import (
	"fmt"
	"os"
	"path/filepath"
)

const autostartDesktopFile = "teamvault-desktop.desktop"

func autostartDir() (string, error) {
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, ".config")
	}
	full := filepath.Join(dir, "autostart")
	if err := os.MkdirAll(full, 0o755); err != nil {
		return "", err
	}
	return full, nil
}

// EnableAutostart writes a per-user XDG autostart .desktop entry
// (~/.config/autostart/) — no root/admin rights required.
func EnableAutostart(execPath string) error {
	dir, err := autostartDir()
	if err != nil {
		return err
	}
	content := fmt.Sprintf(`[Desktop Entry]
Type=Application
Name=TeamVault Desktop
Comment=TeamVault Vault (Autostart, minimiert im Systemtray)
Exec=%s --hidden
Icon=teamvault-desktop
Terminal=false
X-GNOME-Autostart-enabled=true
`, execPath)
	return os.WriteFile(filepath.Join(dir, autostartDesktopFile), []byte(content), 0o644)
}

// DisableAutostart removes the autostart entry, if present.
func DisableAutostart() error {
	dir, err := autostartDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, autostartDesktopFile))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// IsAutostartEnabled reports whether the autostart entry exists.
func IsAutostartEnabled() (bool, error) {
	dir, err := autostartDir()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(filepath.Join(dir, autostartDesktopFile))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

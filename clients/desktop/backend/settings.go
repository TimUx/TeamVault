package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings holds the desktop app's local, non-secret configuration:
// last used server/tenant and UX toggles. Never contains credentials,
// master password or plaintext secret data.
type Settings struct {
	ServerURL      string `json:"server_url"`
	TenantSlug     string `json:"tenant_slug"`
	Username       string `json:"username"`
	AutostartOn    bool   `json:"autostart_enabled"`
	CloseToTray    bool   `json:"close_to_tray"`
	OfflineOptIn   bool   `json:"offline_opt_in"`
	StartMinimized bool   `json:"start_minimized"`
}

func configDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	full := filepath.Join(dir, "teamvault-desktop")
	if err := os.MkdirAll(full, 0o700); err != nil {
		return "", err
	}
	return full, nil
}

func settingsPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

// LoadSettings reads the settings file, returning zero-value Settings if
// it does not exist yet.
func LoadSettings() (Settings, error) {
	var s Settings
	p, err := settingsPath()
	if err != nil {
		return s, err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return s, err
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// SaveSettings persists the settings file (0600, user-only).
func SaveSettings(s Settings) error {
	p, err := settingsPath()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0o600)
}

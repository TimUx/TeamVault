//go:build windows

package backend

import (
	"fmt"

	"golang.org/x/sys/windows/registry"
)

const autostartValueName = "TeamVaultDesktop"

// EnableAutostart adds a Run-key entry under HKCU (per-user, no admin
// rights required, unlike HKLM).
func EnableAutostart(execPath string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(autostartValueName, fmt.Sprintf(`"%s" --hidden`, execPath))
}

// DisableAutostart removes the Run-key entry, if present.
func DisableAutostart() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	defer k.Close()
	err = k.DeleteValue(autostartValueName)
	if err != nil && err != registry.ErrNotExist {
		return err
	}
	return nil
}

// IsAutostartEnabled reports whether the Run-key entry exists.
func IsAutostartEnabled() (bool, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.QUERY_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return false, nil
		}
		return false, err
	}
	defer k.Close()
	_, _, err = k.GetStringValue(autostartValueName)
	if err != nil {
		if err == registry.ErrNotExist {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

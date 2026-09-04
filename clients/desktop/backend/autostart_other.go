//go:build !windows && !linux

package backend

import "errors"

// Autostart is only implemented for Linux and Windows (the two target
// platforms for TeamVault Desktop).
var errAutostartUnsupported = errors.New("autostart wird auf dieser Plattform nicht unterstützt")

func EnableAutostart(execPath string) error { return errAutostartUnsupported }
func DisableAutostart() error               { return errAutostartUnsupported }
func IsAutostartEnabled() (bool, error)     { return false, nil }

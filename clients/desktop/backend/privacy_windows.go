//go:build windows

package backend

import (
	"errors"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	windowDisplayAffinityNone               = 0
	windowDisplayAffinityMonitor            = 1
	windowDisplayAffinityExcludeFromCapture = 0x11
)

var (
	user32                         = syscall.NewLazyDLL("user32.dll")
	procEnumWindows                = user32.NewProc("EnumWindows")
	procGetWindowTextW             = user32.NewProc("GetWindowTextW")
	procGetWindowThreadProcessID   = user32.NewProc("GetWindowThreadProcessId")
	procSetWindowDisplayAffinity   = user32.NewProc("SetWindowDisplayAffinity")
)

func ApplyWindowCaptureProtection(enabled bool) error {
	hwnd, err := findMainWindow(3 * time.Second)
	if err != nil {
		return err
	}
	if !enabled {
		return setWindowDisplayAffinity(hwnd, windowDisplayAffinityNone)
	}
	if err := setWindowDisplayAffinity(hwnd, windowDisplayAffinityExcludeFromCapture); err == nil {
		return nil
	}
	return setWindowDisplayAffinity(hwnd, windowDisplayAffinityMonitor)
}

func findMainWindow(timeout time.Duration) (uintptr, error) {
	deadline := time.Now().Add(timeout)
	pid := uint32(os.Getpid())
	for {
		if hwnd := enumProcessWindow(pid); hwnd != 0 {
			return hwnd, nil
		}
		if time.Now().After(deadline) {
			return 0, errors.New("TeamVault-Fenster für Bildschirmaufnahme-Schutz nicht gefunden")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func enumProcessWindow(pid uint32) uintptr {
	var found uintptr
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var winPID uint32
		procGetWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&winPID)))
		if winPID != pid {
			return 1
		}
		title := windowText(hwnd)
		if title == "" || !strings.HasPrefix(strings.ToLower(title), "teamvault") {
			return 1
		}
		found = hwnd
		return 0
	})
	procEnumWindows.Call(cb, 0)
	return found
}

func windowText(hwnd uintptr) string {
	buf := make([]uint16, 256)
	n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:n])
}

func setWindowDisplayAffinity(hwnd uintptr, affinity uintptr) error {
	r1, _, err := procSetWindowDisplayAffinity.Call(hwnd, affinity)
	if r1 != 0 {
		return nil
	}
	if err != syscall.Errno(0) {
		return err
	}
	return errors.New("SetWindowDisplayAffinity fehlgeschlagen")
}

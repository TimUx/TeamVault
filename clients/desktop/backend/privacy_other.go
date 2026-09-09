//go:build !windows

package backend

func ApplyWindowCaptureProtection(bool) error {
	return nil
}

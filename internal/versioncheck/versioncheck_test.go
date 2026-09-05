package versioncheck

import "testing"

func TestCompareReleaseVersions(t *testing.T) {
	tests := []struct {
		local, remote string
		want          bool
	}{
		{"v1.2.3", "v1.2.4", true},
		{"1.2.3", "v1.3.0", true},
		{"1.2.3", "1.2.3", false},
		{"1.2.4", "1.2.3", false},
		{"dev", "v1.2.3", false},
		{"v1.2.3", "dev", false},
		{"v1.2.3-rc.1", "v1.2.3", true},
		{"v1.2.3", "v1.2.4-rc.1", true},
	}
	for _, tt := range tests {
		if got := Newer(tt.local, tt.remote); got != tt.want {
			t.Fatalf("Newer(%q, %q) = %v, want %v", tt.local, tt.remote, got, tt.want)
		}
	}
}

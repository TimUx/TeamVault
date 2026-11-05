package server_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestOfflineKeyPolicyInheritanceAndLegacyUpdates(t *testing.T) {
	dir := t.TempDir()
	app, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: bytes.Repeat([]byte("s"), 32)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Vault.Close() })
	ts := httptest.NewServer(server.New(app).Handler())
	t.Cleanup(ts.Close)
	argon := cryptocore.Argon2Params{Time: 1, Memory: 8192, Threads: 1, KeyLen: 32}
	postJSON(t, ts.URL+"/api/setup/commit", map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "vault.db")},
		"tenant":  map[string]any{"name": "Tenant", "slug": "tenant", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "Password1234!!!!"},
		"argon2":  argon,
	}, nil)
	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "tenant", "username": "admin", "password": "Password1234!!!!",
	}, jar)
	onboardUser(t, ts.URL, jar, []byte("admin-master-pw!"), argon)

	check := func(want string) {
		t.Helper()
		policy := getJSONCookie(t, ts.URL+"/api/policy/client", jar)
		if policy["offline_key_requirement"] != want {
			t.Fatalf("client policy = %v, want %s", policy, want)
		}
	}
	check("ANY")
	platformPolicy := getJSONCookie(t, ts.URL+"/api/admin/policy", jar)
	if platformPolicy["offline_key_requirement"] != "ANY" {
		t.Fatalf("default platform requirement = %v, want ANY", platformPolicy)
	}
	putJSONCookie(t, ts.URL+"/api/admin/tenant/settings", map[string]any{
		"totp_required": false, "offline_key_requirement": "HARDWARE",
	}, jar)
	check("HARDWARE")
	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"offline_key_requirement": "SOFTWARE",
	}, jar)
	check("COMBINED")
	settings := getJSONCookie(t, ts.URL+"/api/admin/tenant/settings", jar)
	if settings["platform_offline_key_requirement"] != "SOFTWARE" ||
		settings["tenant_offline_key_requirement"] != "HARDWARE" ||
		settings["offline_key_requirement"] != "COMBINED" {
		t.Fatalf("tenant policy = %v", settings)
	}

	// Older admin clients must not erase the new security fields.
	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{"totp_required": false}, jar)
	putJSONCookie(t, ts.URL+"/api/admin/tenant/settings", map[string]any{"totp_required": false}, jar)
	check("COMBINED")
	putJSONCookie(t, ts.URL+"/api/admin/tenant/settings", map[string]any{
		"totp_required": false, "offline_key_requirement": "ANY",
	}, jar)
	check("SOFTWARE")
	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"offline_key_requirement": "HARDWARE",
	}, jar)
	check("HARDWARE")
	putJSONCookie(t, ts.URL+"/api/admin/tenant/settings", map[string]any{
		"totp_required": false, "offline_key_requirement": "SOFTWARE",
	}, jar)
	check("COMBINED")

	for _, path := range []string{"/api/admin/policy", "/api/admin/tenant/settings"} {
		for _, invalid := range []string{"", "STANDARD", "unknown"} {
			code, body := putJSONCookieStatus(t, ts.URL+path, map[string]any{
				"totp_required": false, "offline_key_requirement": invalid,
			}, jar)
			if code != http.StatusBadRequest {
				t.Fatalf("%s accepted %q: %d %v", path, invalid, code, body)
			}
		}
	}
	check("COMBINED")
}

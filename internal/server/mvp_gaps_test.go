package server_test

import (
	"bytes"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
	"github.com/teamvault/teamvault/internal/shamir"
)

func TestMVPGapsLDAPConnPolicyRateLimitShamir(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte("s"), 32)
	app, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: key})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Vault.Close() })
	api := server.New(app)
	ts := httptest.NewServer(api.Handler())
	t.Cleanup(ts.Close)

	argon := cryptocore.Argon2Params{Time: 1, Memory: 8192, Threads: 1, KeyLen: 32}
	postJSON(t, ts.URL+"/api/setup/commit", map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "v.db")},
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "Password1234!!!!"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "Password1234!!!!",
	}, jar)
	onboardUser(t, ts.URL, jar, []byte("admin-master-pw!"), argon)

	me := getJSONCookie(t, ts.URL+"/api/me", jar)
	tid, _ := me["tenant_id"].(string)

	conn := postJSONCookie(t, ts.URL+"/api/admin/ldap/connections", map[string]any{
		"tenant_id": tid, "name": "corp", "enabled": false,
		"host": "ldap.invalid", "base_dn": "dc=ex", "bind_dn": "cn=svc", "bind_password": "x",
	}, jar)
	if conn["id"] == "" {
		t.Fatal(conn)
	}
	list := getJSONListCookie(t, ts.URL+"/api/admin/ldap/connections", jar)
	if len(list) < 1 {
		t.Fatal(list)
	}

	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"totp_required": false, "session_hours": 8, "unlock_idle_minutes": 15,
		"escrow_shamir_k": 3, "escrow_shamir_n": 5, "ldap_sync_hours": 24,
	}, jar)
	pol := getJSONCookie(t, ts.URL+"/api/policy/client", jar)
	if int(pol["unlock_idle_minutes"].(float64)) != 15 {
		t.Fatal(pol)
	}
	if pol["offline_cache_allowed"] != true {
		t.Fatalf("offline default enabled, got %v", pol["offline_cache_allowed"])
	}
	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"totp_required": false, "session_hours": 8, "unlock_idle_minutes": 15,
		"escrow_shamir_k": 3, "escrow_shamir_n": 5, "ldap_sync_hours": 24,
		"offline_cache_allowed": false,
	}, jar)
	pol = getJSONCookie(t, ts.URL+"/api/policy/client", jar)
	if pol["offline_cache_allowed"] != false {
		t.Fatalf("offline disable, got %v", pol["offline_cache_allowed"])
	}
	if pol["cli_integration_enabled"] != false {
		t.Fatalf("cli integration default off, got %v", pol["cli_integration_enabled"])
	}
	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"totp_required": false, "session_hours": 8, "unlock_idle_minutes": 15,
		"escrow_shamir_k": 3, "escrow_shamir_n": 5, "ldap_sync_hours": 24,
		"cli_integration_enabled": true, "browser_integration_enabled": true,
	}, jar)
	pol = getJSONCookie(t, ts.URL+"/api/policy/client", jar)
	if pol["cli_integration_enabled"] != true || pol["browser_integration_enabled"] != true {
		t.Fatalf("integration enable, got %v", pol)
	}
	dl := getJSON(t, ts.URL+"/api/client-downloads")
	feat, _ := dl["features"].(map[string]any)
	if feat["cli"] != true || feat["browser_extension"] != true {
		t.Fatalf("downloads features: %v", feat)
	}

	putJSONCookie(t, ts.URL+"/api/admin/mail/templates", map[string]any{
		"invite_subject": "Hi", "invite_body": "u={{username}} t={{tenant}}",
		"disabled_subject": "Bye", "disabled_body": "u={{username}}",
	}, jar)

	created := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "bob", "password": "Password1234!!!!", "email": "bob@example.com",
	}, jar)
	bobID := created["id"].(string)
	postJSONCookie(t, ts.URL+"/api/admin/users/"+bobID+"/roles", map[string]any{
		"roles": []string{"member", "tenant_admin"},
	}, jar)
	postJSONCookie(t, ts.URL+"/api/admin/users/"+bobID+"/password", map[string]string{
		"password": "Password5678!!!!",
	}, jar)

	// Shamir roundtrip (vendored HashiCorp)
	secret := bytes.Repeat([]byte{0x42}, 32)
	shares, err := shamir.Split(secret, 5, 3)
	if err != nil {
		t.Fatal(err)
	}
	got, err := shamir.Combine(shares[:3])
	if err != nil || !bytes.Equal(got, secret) {
		t.Fatalf("shamir combine failed %x err=%v", got, err)
	}
	_ = hex.EncodeToString(shares[0])

	// Rate limit smoke: many bad logins should eventually 429
	blocked := false
	for i := 0; i < 25; i++ {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/login", bytes.NewReader([]byte(
			`{"tenant_slug":"t1","username":"admin","password":"wrong-password!!"}`)))
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests {
			blocked = true
			break
		}
	}
	if !blocked {
		t.Fatal("expected rate limit")
	}
}

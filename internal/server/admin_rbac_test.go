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

func TestTenantAdminCannotAccessPlatformConfig(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte("k"), 32)
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

	platJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "Password1234!!!!",
	}, platJar)

	postJSONCookie(t, ts.URL+"/api/admin/users", map[string]any{
		"username": "orgadmin", "password": "Password1234!!!!", "auth_backend": "local",
	}, platJar)
	users := getJSONListCookie(t, ts.URL+"/api/admin/users", platJar)
	var orgID string
	for _, u := range users {
		if u["username"] == "orgadmin" {
			orgID, _ = u["id"].(string)
		}
	}
	if orgID == "" {
		t.Fatal("orgadmin not created")
	}
	postJSONCookie(t, ts.URL+"/api/admin/users/"+orgID+"/roles", map[string]any{
		"roles": []string{"tenant_admin", "member"},
	}, platJar)

	orgJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "orgadmin", "password": "Password1234!!!!",
	}, orgJar)

	forbidden := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/admin/overview"},
		{http.MethodGet, "/api/admin/trust"},
		{http.MethodGet, "/api/admin/mail"},
		{http.MethodGet, "/api/admin/policy"},
		{http.MethodGet, "/api/admin/public-access"},
		{http.MethodGet, "/api/admin/api-keys"},
	}
	for _, tc := range forbidden {
		code, _ := getJSONCookieStatus(t, ts.URL+tc.path, orgJar)
		if code != http.StatusForbidden {
			t.Fatalf("%s %s: want 403 got %d", tc.method, tc.path, code)
		}
	}

	code, _ := getJSONCookieStatus(t, ts.URL+"/api/admin/ldap", orgJar)
	if code != http.StatusOK {
		t.Fatalf("tenant admin ldap GET: %d", code)
	}
	putJSONCookie(t, ts.URL+"/api/admin/ldap", map[string]any{
		"enabled": false, "host": "ldap.tenant.local", "port": 636,
		"base_dn": "dc=tenant", "bind_dn": "cn=svc", "bind_password": "x",
		"use_tls": true,
	}, orgJar)
	ldap := getJSONCookie(t, ts.URL+"/api/admin/ldap", orgJar)
	if ldap["host"] != "ldap.tenant.local" {
		t.Fatalf("tenant ldap not saved: %v", ldap)
	}
}

package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestWave1SetupTokenLDAPAPIKeyAndPlatformAdminGuard(t *testing.T) {
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
	body := map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "v.db")},
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "Password1234!!!!"},
		"argon2":  argon,
	}

	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/setup/commit", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	setTestOrigin(req)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("setup without token want 401 got %d", res.StatusCode)
	}

	postJSON(t, ts.URL+"/api/setup/commit", body, nil)

	platJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "Password1234!!!!",
	}, platJar)
	me := getJSONCookie(t, ts.URL+"/api/me", platJar)
	platID, _ := me["user_id"].(string)
	if platID == "" {
		t.Fatal("platform admin id missing")
	}

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

	code, _ := postJSONCookieStatus(t, ts.URL+"/api/admin/users/"+platID+"/password", map[string]any{
		"password": "Password9999!!!!",
	}, orgJar)
	if code != http.StatusForbidden {
		t.Fatalf("tenant admin password reset of platform admin want 403 got %d", code)
	}
	code, _ = postJSONCookieStatus(t, ts.URL+"/api/admin/users/"+platID+"/disable", map[string]any{}, orgJar)
	if code != http.StatusForbidden {
		t.Fatalf("tenant admin disable platform admin want 403 got %d", code)
	}

	code, bodyLDAP := postJSONCookieStatus(t, ts.URL+"/api/admin/ldap/test", map[string]any{
		"host": "attacker.example", "port": 389, "bind_dn": "cn=x", "bind_password": "",
	}, orgJar)
	if code != http.StatusBadRequest {
		t.Fatalf("ldap test with foreign host and empty password want 400 got %d %v", code, bodyLDAP)
	}

	vaultKey := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "vault", "scopes": []string{"vault"},
	}, platJar)
	vtok, _ := vaultKey["token"].(string)
	for _, path := range []string{"/api/totp/setup", "/api/webauthn/register/begin", "/api/me/password"} {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+path, bytes.NewReader([]byte(`{}`)))
		req.Header.Set("Authorization", "Bearer "+vtok)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("vault key %s want 403 got %d", path, res.StatusCode)
		}
	}

	bob := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]any{
		"username": "bob", "password": "Password1234!!!!",
	}, platJar)
	bobID, _ := bob["id"].(string)
	bobJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "bob", "password": "Password1234!!!!",
	}, bobJar)
	postJSONCookie(t, ts.URL+"/api/admin/users/"+bobID+"/disable", map[string]any{}, platJar)
	reqMe, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	if c := bobJar.m["tv_session"]; c != "" {
		reqMe.AddCookie(&http.Cookie{Name: "tv_session", Value: c})
	}
	resMe, err := http.DefaultClient.Do(reqMe)
	if err != nil {
		t.Fatal(err)
	}
	resMe.Body.Close()
	if resMe.StatusCode == http.StatusOK {
		t.Fatal("disabled user cookie session should not remain valid")
	}
}

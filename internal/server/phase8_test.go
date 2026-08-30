package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestPhase8OpenAPIAndAPIKeyBearer(t *testing.T) {
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

	res, err := http.Get(ts.URL + "/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.Status)
	}
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(res.Body)
	if !strings.Contains(buf.String(), "TeamVault API") {
		t.Fatalf("openapi missing title: %s", buf.String()[:80])
	}

	argon := cryptocore.Argon2Params{Time: 1, Memory: 8192, Threads: 1, KeyLen: 32}
	postJSON(t, ts.URL+"/api/setup/commit", map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "v.db")},
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "password1234"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, jar)
	onboardUser(t, ts.URL, jar, []byte("admin-master-pw!"), argon)

	keyRes := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "cli", "scopes": []string{"vault"},
	}, jar)
	token, _ := keyRes["token"].(string)
	if token == "" {
		t.Fatal(keyRes)
	}

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var me map[string]any
	_ = json.NewDecoder(r.Body).Decode(&me)
	if r.StatusCode != 200 || me["username"] != "admin" {
		t.Fatalf("%d %v", r.StatusCode, me)
	}

	// Revoked key rejected
	postJSONCookie(t, ts.URL+"/api/admin/api-keys/"+keyRes["id"].(string)+"/revoke", map[string]any{}, jar)
	req2, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	r2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Body.Close()
	if r2.StatusCode != 401 {
		t.Fatalf("expected 401 after revoke, got %d", r2.StatusCode)
	}
}

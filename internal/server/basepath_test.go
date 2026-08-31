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

func TestBasePathLoginAndUI(t *testing.T) {
	t.Setenv("TEAMVAULT_BASE_PATH", "/vault")
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
	postJSON(t, ts.URL+"/vault/api/setup/commit", map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "v.db")},
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "password1234"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/vault/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, jar)

	res, err := http.Get(ts.URL + "/vault/app")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("app status %d", res.StatusCode)
	}

	res2, err := http.Get(ts.URL + "/api/me")
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != http.StatusNotFound {
		t.Fatalf("unprefixed api want 404, got %d", res2.StatusCode)
	}
}

package server_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/instcfg"
	"github.com/teamvault/teamvault/internal/server"
)

func TestPublicAccessFromAdminConfig(t *testing.T) {
	t.Setenv("TEAMVAULT_BASE_PATH", "")
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
		"admin":   map[string]string{"username": "admin", "password": "password1234"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, jar)

	tf := true
	putJSONCookie(t, ts.URL+"/api/admin/public-access", map[string]any{
		"base_path": "/vault",
		"trust_forwarded": tf,
	}, jar)

	cfg := getJSONCookie(t, ts.URL+"/vault/api/public/config", jar)
	if cfg["base_path"] != "/vault" {
		t.Fatalf("base_path: %v", cfg["base_path"])
	}

	res, err := http.Get(ts.URL + "/vault/login")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("login under /vault want 200, got %d", res.StatusCode)
	}
}

func TestPublicAccessForwardedPrefix(t *testing.T) {
	t.Setenv("TEAMVAULT_BASE_PATH", "")
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
		"tenant":  map[string]any{"name": "T", "slug": "t2", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "password1234"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t2", "username": "admin", "password": "password1234",
	}, jar)

	tf := true
	putJSONCookie(t, ts.URL+"/api/admin/public-access", map[string]any{
		"use_forwarded_prefix": true,
		"trust_forwarded":      tf,
	}, jar)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/pw/app", nil)
	req.Header.Set("X-Forwarded-Prefix", "/pw")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("auto prefix want 200, got %d", res.StatusCode)
	}
}

func TestPublicAccessEnvOverridesAdmin(t *testing.T) {
	t.Setenv("TEAMVAULT_BASE_PATH", "/envpath")
	dir := t.TempDir()
	key := bytes.Repeat([]byte("k"), 32)
	app, err := bootstrap.Run(bootstrap.Options{DataDir: dir, UnlockKey: key})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Vault.Close() })
	b := instcfg.Load(app.Config)
	b.PublicAccess.BasePath = "/adminpath"
	_ = instcfg.Save(app.Config, app.ConfigStore, b)

	api := server.New(app)
	ts := httptest.NewServer(api.Handler())
	t.Cleanup(ts.Close)

	cfg := getJSON(t, ts.URL+"/envpath/api/public/config")
	overrides, _ := cfg["env_overrides"].(map[string]any)
	if overrides["base_path"] != true {
		t.Fatalf("expected env override: %v", cfg)
	}
	if cfg["base_path"] != "/envpath" {
		t.Fatalf("effective base: %v", cfg["base_path"])
	}
}

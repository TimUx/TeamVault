package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/server"
)

func TestSetupCommitAndLoginHTTP(t *testing.T) {
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

	status := getJSON(t, ts.URL+"/api/setup/status")
	if status["initialized"] != false {
		t.Fatal(status)
	}

	body := map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "v.db")},
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "user_kit", "escrow_allowed": false},
		"admin":   map[string]string{"username": "admin", "password": "password1234", "display_name": "A"},
		"argon2":  map[string]any{"Time": 1, "Memory": 8192, "Threads": 1, "KeyLen": 32},
	}
	postJSON(t, ts.URL+"/api/setup/commit", body, nil)

	status = getJSON(t, ts.URL+"/api/setup/status")
	if status["initialized"] != true {
		t.Fatal(status)
	}

	jar := &cookieJar{m: map[string]string{}}
	login := postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, jar)
	if login["username"] != "admin" {
		t.Fatal(login)
	}
	if login["needs_vault_onboard"] != true {
		t.Fatal(login)
	}
	me := getJSONCookie(t, ts.URL+"/api/me", jar)
	if me["username"] != "admin" {
		t.Fatal(me)
	}
	ts.Close()
	_ = app.Vault.Close()
}

func getJSON(t *testing.T, url string) map[string]any {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	return m
}

func getJSONCookie(t *testing.T, url string, jar *cookieJar) map[string]any {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	if c := jar.m["tv_session"]; c != "" {
		req.AddCookie(&http.Cookie{Name: "tv_session", Value: c})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	if res.StatusCode >= 300 {
		t.Fatalf("%d %v", res.StatusCode, m)
	}
	return m
}

func postJSON(t *testing.T, rawURL string, body any, jar *cookieJar) map[string]any {
	t.Helper()
	b, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	setTestOrigin(req)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if jar != nil {
		for _, c := range res.Cookies() {
			jar.m[c.Name] = c.Value
		}
	}
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	if res.StatusCode >= 300 {
		t.Fatalf("%d %v", res.StatusCode, m)
	}
	return m
}

func setTestOrigin(req *http.Request) {
	u, err := url.Parse(req.URL.String())
	if err != nil || u.Host == "" {
		return
	}
	scheme := u.Scheme
	if scheme == "" {
		scheme = "http"
	}
	req.Header.Set("Origin", scheme+"://"+u.Host)
}

type cookieJar struct{ m map[string]string }

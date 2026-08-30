package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
	"github.com/teamvault/teamvault/internal/store"
)

func TestPhase7PasskeyRegisterBeginAndStore(t *testing.T) {
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
		"admin":   map[string]string{"username": "admin", "password": "password1234"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, jar)
	onboardUser(t, ts.URL, jar, []byte("admin-master-pw!"), argon)

	begin := postJSONCookie(t, ts.URL+"/api/webauthn/register/begin", map[string]any{}, jar)
	if begin["challenge_key"] == "" || begin["publicKey"] == nil {
		t.Fatalf("begin=%v", begin)
	}
	if begin["note"] == "" {
		t.Fatal("expected login-only note")
	}

	me := getJSONCookie(t, ts.URL+"/api/me", jar)
	uid := store.UserID(me["user_id"].(string))
	tid := store.TenantID(me["tenant_id"].(string))

	if err := app.Vault.PutWebAuthnCredential(context.Background(), store.WebAuthnCredential{
		ID: "wak_test", TenantID: tid, UserID: uid,
		CredentialID: []byte{1, 2, 3, 4}, PublicKey: []byte{9, 9, 9},
		Name: "test-key", Transport: "[]",
	}); err != nil {
		t.Fatal(err)
	}
	list := getJSONListCookie(t, ts.URL+"/api/webauthn/credentials", jar)
	if len(list) != 1 || list[0]["name"] != "test-key" {
		t.Fatal(list)
	}

	loginBegin := postJSON(t, ts.URL+"/api/webauthn/login/begin", map[string]string{
		"tenant_slug": "t1", "username": "admin",
	}, nil)
	if loginBegin["challenge_key"] == "" {
		t.Fatal(loginBegin)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/webauthn/credentials/wak_test", nil)
	setTestOrigin(req)
	if c := jar.m["tv_session"]; c != "" {
		req.AddCookie(&http.Cookie{Name: "tv_session", Value: c})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var del map[string]any
	_ = json.NewDecoder(res.Body).Decode(&del)
	if res.StatusCode >= 300 {
		t.Fatalf("%d %v", res.StatusCode, del)
	}
	list = getJSONListCookie(t, ts.URL+"/api/webauthn/credentials", jar)
	if len(list) != 0 {
		t.Fatal(list)
	}
}

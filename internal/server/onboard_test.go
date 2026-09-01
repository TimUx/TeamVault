package server_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestOnboardAndTOTP(t *testing.T) {
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

	postJSON(t, ts.URL+"/api/setup/commit", map[string]any{
		"storage": map[string]string{"backend": "sqlite", "dsn": filepath.Join(dir, "v.db")},
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "user_kit"},
		"admin":   map[string]string{"username": "admin", "password": "password1234"},
		"argon2":  map[string]any{"Time": 1, "Memory": 8192, "Threads": 1, "KeyLen": 32},
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, jar)

	// Simulate client onboarding with Go cryptocore
	pw := []byte("vault-master-pw!")
	kp, sealed, err := cryptocore.CreateIdentity(pw, cryptocore.Argon2Params{Time: 1, Memory: 8192, Threads: 1, KeyLen: 32})
	if err != nil {
		t.Fatal(err)
	}
	kit := bytes.Repeat([]byte("r"), 32)
	rec, err := cryptocore.SealPrivateKeyWithRecoveryKey(kp.Private[:], kit, cryptocore.Argon2Params{Time: 1, Memory: 8192, Threads: 1, KeyLen: 32})
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, ts.URL+"/api/vault/onboard", map[string]any{
		"public_key_b64":                     base64.StdEncoding.EncodeToString(kp.Public[:]),
		"encrypted_private_key_b64":          base64.StdEncoding.EncodeToString(sealed.Ciphertext),
		"encrypted_private_key_nonce_b64":    base64.StdEncoding.EncodeToString(sealed.Nonce),
		"salt_b64":                           base64.StdEncoding.EncodeToString(sealed.Salt),
		"encrypted_private_key_recovery_b64": base64.StdEncoding.EncodeToString(rec.Ciphertext),
		"recovery_nonce_b64":                 base64.StdEncoding.EncodeToString(rec.Nonce),
		"recovery_salt_b64":                  base64.StdEncoding.EncodeToString(rec.Salt),
	}, jar)

	me := getJSONCookie(t, ts.URL+"/api/me", jar)
	if me["needs_vault_onboard"] != false {
		t.Fatalf("me=%v", me)
	}

	setup := postJSONCookie(t, ts.URL+"/api/totp/setup", map[string]any{}, jar)
	secret, _ := setup["secret"].(string)
	if secret == "" {
		t.Fatal(setup)
	}
	if qr, _ := setup["qr_data_url"].(string); qr == "" || len(qr) < 64 {
		t.Fatalf("missing qr_data_url: %v", setup)
	}
	code, err := totp.GenerateCode(secret, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	enable := postJSONCookie(t, ts.URL+"/api/totp/enable", map[string]string{"code": code}, jar)
	if enable["status"] != "enabled" {
		t.Fatalf("enable: %v", enable)
	}
	me2 := getJSONCookie(t, ts.URL+"/api/me", jar)
	if me2["totp_enabled"] != true {
		t.Fatalf("me after enable: %v", me2)
	}
	// verify setup stored
	keys := getJSONCookie(t, ts.URL+"/api/vault/keys", jar)
	if keys["public_key_b64"] == "" {
		t.Fatal(keys)
	}
	ts.Close()
	_ = app.Vault.Close()
}

func postJSONCookie(t *testing.T, url string, body any, jar *cookieJar) map[string]any {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	setTestOrigin(req)
	if c := jar.m["tv_session"]; c != "" {
		req.AddCookie(&http.Cookie{Name: "tv_session", Value: c})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	for _, c := range res.Cookies() {
		jar.m[c.Name] = c.Value
	}
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	if res.StatusCode >= 300 {
		t.Fatalf("%d %v", res.StatusCode, m)
	}
	return m
}

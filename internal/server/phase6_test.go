package server_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestPhase6AdminConfigAuditAPIKeysMigrate(t *testing.T) {
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

	ov := getJSONCookie(t, ts.URL+"/api/admin/overview", jar)
	if ov["initialized"] != true {
		t.Fatal(ov)
	}

	putJSONCookie(t, ts.URL+"/api/admin/ldap", map[string]any{
		"enabled": false, "host": "ldap.example.invalid", "port": 636,
		"base_dn": "dc=ex", "bind_dn": "cn=svc", "bind_password": "secret-bind",
		"use_tls": true, "insecure_skip_verify": true,
	}, jar)
	ldap := getJSONCookie(t, ts.URL+"/api/admin/ldap", jar)
	if ldap["bind_password"] != "***" {
		t.Fatalf("ldap password not redacted: %v", ldap)
	}
	if ldap["insecure_skip_verify"] != true || ldap["use_tls"] != true {
		t.Fatalf("ldap tls flags: %v", ldap)
	}

	trust := getJSONCookie(t, ts.URL+"/api/admin/trust", jar)
	if trust["present"] == true {
		t.Fatalf("expected empty trust store: %v", trust)
	}
	putJSONCookie(t, ts.URL+"/api/admin/trust", map[string]any{"ca_cert_pem": ""}, jar)
	bad := map[string]any{"ca_cert_pem": "not-a-certificate"}
	raw, _ := json.Marshal(bad)
	trustReq, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/admin/trust", bytes.NewReader(raw))
	trustReq.Header.Set("Content-Type", "application/json")
	setTestOrigin(trustReq)
	trustReq.AddCookie(&http.Cookie{Name: "tv_session", Value: jar.m["tv_session"]})
	trustRes, trustErr := http.DefaultClient.Do(trustReq)
	if trustErr != nil {
		t.Fatal(trustErr)
	}
	_ = trustRes.Body.Close()
	if trustRes.StatusCode < 400 {
		t.Fatalf("invalid CA PEM should fail, got %d", trustRes.StatusCode)
	}

	putJSONCookie(t, ts.URL+"/api/admin/mail", map[string]any{
		"enabled": true, "host": "127.0.0.1", "port": 1, "from": "tv@example", "password": "mailpass",
	}, jar)
	mail := getJSONCookie(t, ts.URL+"/api/admin/mail", jar)
	if mail["password"] != "***" {
		t.Fatal(mail)
	}

	putJSONCookie(t, ts.URL+"/api/admin/crypto", map[string]any{
		"Time": 2, "Memory": 16384, "Threads": 1, "KeyLen": 32,
	}, jar)
	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"totp_required": true, "session_hours": 8,
	}, jar)

	keyRes := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "ci", "scopes": []string{"read"},
	}, jar)
	token, _ := keyRes["token"].(string)
	id, _ := keyRes["id"].(string)
	if token == "" || id == "" {
		t.Fatal(keyRes)
	}
	postJSONCookie(t, ts.URL+"/api/admin/api-keys/"+id+"/revoke", map[string]any{}, jar)

	ten := postJSONCookie(t, ts.URL+"/api/admin/tenants", map[string]string{
		"name": "Other", "slug": "other",
	}, jar)
	if ten["id"] == "" {
		t.Fatal(ten)
	}

	audit := getJSONListCookie(t, ts.URL+"/api/admin/audit", jar)
	if len(audit) == 0 {
		t.Fatal("expected audit events")
	}

	kp, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, ts.URL+"/api/admin/tenant/escrow-pubkey", map[string]string{
		"public_key_b64": base64.StdEncoding.EncodeToString(kp.Public[:]),
	}, jar)
	ep := getJSONCookie(t, ts.URL+"/api/vault/escrow-pubkey", jar)
	if ep["public_key_b64"] == "" {
		t.Fatal(ep)
	}

	dst := filepath.Join(dir, "migrated.json")
	mig := postJSONCookie(t, ts.URL+"/api/admin/storage/migrate", map[string]string{
		"backend": "json", "dsn": dst, "confirm": "MIGRATE",
	}, jar)
	st, _ := mig["storage"].(map[string]any)
	if st["backend"] != "json" {
		t.Fatal(mig)
	}
	_ = getJSONCookie(t, ts.URL+"/api/admin/overview", jar)

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/admin/storage/migrate", bytes.NewReader([]byte(
		`{"backend":"sqlite","dsn":"x.db","confirm":"no"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "tv_session", Value: jar.m["tv_session"]})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode < 400 {
		t.Fatalf("expected reject, got %d", res.StatusCode)
	}
}

func putJSONCookie(t *testing.T, url string, body any, jar *cookieJar) map[string]any {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodPut, url, bytes.NewReader(b))
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

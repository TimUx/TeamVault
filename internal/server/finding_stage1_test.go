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

func TestAuthzDeleteShareRecovery(t *testing.T) {
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

	adminJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "Password1234!!!!",
	}, adminJar)
	adminKP, adminSK := onboardUser(t, ts.URL, adminJar, []byte("admin-master-pw!"), argon)

	created := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "alice", "password": "Password1234!!!!", "display_name": "Alice",
	}, adminJar)
	aliceID, _ := created["id"].(string)

	aliceJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "alice", "password": "Password1234!!!!",
	}, aliceJar)
	_, _ = onboardUser(t, ts.URL, aliceJar, []byte("alice-master-pw!"), argon)

	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	titleCT, _ := cryptocore.EncryptPayload([]byte("VPN"), dk, 1)
	bodyCT, _ := cryptocore.EncryptPayload([]byte(`{"password":"x"}`), dk, 1)
	envAdmin, err := cryptocore.SealDataKeyForRecipient(dk, adminKP.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	me := getJSONCookie(t, ts.URL+"/api/me", adminJar)
	adminUID, _ := me["user_id"].(string)
	createdSec := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(adminUID, envAdmin)},
	}, adminJar)
	sid, _ := createdSec["id"].(string)

	// A1: alice without envelope cannot delete
	status, _ := deleteJSONCookie(t, ts.URL+"/api/secrets/"+sid, aliceJar)
	if status != http.StatusForbidden {
		t.Fatalf("delete without envelope: want 403 got %d", status)
	}

	// A2: share with wrong key_version rejected
	aliceKeys := getJSONCookie(t, ts.URL+"/api/users/public-keys", adminJar)
	var alicePub []byte
	for _, row := range getJSONListCookie(t, ts.URL+"/api/users/public-keys", adminJar) {
		if row["user_id"] == aliceID {
			alicePub = mustB64(t, row["public_key_b64"].(string))
			break
		}
	}
	_ = aliceKeys
	if len(alicePub) == 0 {
		t.Fatal("alice pubkey missing")
	}
	badEnv, err := cryptocore.SealDataKeyForRecipient(dk, alicePub, 99)
	if err != nil {
		t.Fatal(err)
	}
	status, body := postJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid+"/share", map[string]any{
		"envelopes": []map[string]any{envAPI(aliceID, badEnv)},
	}, adminJar)
	if status != http.StatusBadRequest {
		t.Fatalf("share wrong kv: want 400 got %d %v", status, body)
	}

	// A3: recovery mode change blocked while secrets exist
	status, body = postJSONCookieStatus(t, ts.URL+"/api/admin/tenant/recovery", map[string]any{
		"recovery_mode": "admin_escrow", "escrow_allowed": true, "confirm": "REONBOARD",
	}, adminJar)
	if status != http.StatusConflict {
		t.Fatalf("recovery with secrets: want 409 got %d %v", status, body)
	}

	// escrow flag only (no mode change) still OK
	postJSONCookie(t, ts.URL+"/api/admin/tenant/recovery", map[string]any{
		"recovery_mode": "user_kit", "escrow_allowed": true, "confirm": "REONBOARD",
	}, adminJar)

	_ = adminSK
	zero(dk)
}

func deleteJSONCookie(t *testing.T, url string, jar *cookieJar) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, url, nil)
	setTestOrigin(req)
	if c := jar.m["tv_session"]; c != "" {
		req.AddCookie(&http.Cookie{Name: "tv_session", Value: c})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func postJSONCookieStatus(t *testing.T, url string, body any, jar *cookieJar) (int, map[string]any) {
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
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

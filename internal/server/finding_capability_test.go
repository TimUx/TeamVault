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
	"github.com/teamvault/teamvault/internal/store"
)

func TestPentestCapabilityReadCannotUpdate(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte("p"), 32)
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

	ownerJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "Password1234!!!!",
	}, ownerJar)
	ownerKP, _ := onboardUser(t, ts.URL, ownerJar, []byte("TEST_ONLY_OWNER_MP"), argon)
	me := getJSONCookie(t, ts.URL+"/api/me", ownerJar)
	ownerID, _ := me["user_id"].(string)

	att := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "reader", "password": "Password1234!!!!", "display_name": "Reader",
	}, ownerJar)
	readerID, _ := att["id"].(string)
	readerJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "reader", "password": "Password1234!!!!",
	}, readerJar)
	readerKP, _ := onboardUser(t, ts.URL, readerJar, []byte("TEST_ONLY_READER_MP"), argon)

	dk, _ := cryptocore.GenerateDataKey()
	defer zero(dk)
	titleCT, _ := cryptocore.EncryptPayload([]byte("Doc"), dk, 1)
	bodyCT, _ := cryptocore.EncryptPayload([]byte(`{"n":1}`), dk, 1)
	envOwner, _ := cryptocore.SealDataKeyForRecipient(dk, ownerKP.Public[:], 1)
	sec := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(ownerID, envOwner)},
	}, ownerJar)
	sid, _ := sec["id"].(string)

	envR, _ := cryptocore.SealDataKeyForRecipient(dk, readerKP.Public[:], 1)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/share", map[string]any{
		"capability": store.CapRead,
		"envelopes":  []map[string]any{envAPI(readerID, envR)},
	}, ownerJar)

	st, _ := getJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid, readerJar)
	if st != http.StatusOK {
		t.Fatalf("reader GET want 200 got %d", st)
	}
	newTitle, _ := cryptocore.EncryptPayload([]byte("Doc2"), dk, 1)
	newBody, _ := cryptocore.EncryptPayload([]byte(`{"n":2}`), dk, 1)
	code, body := putJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid, map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(newTitle.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(newTitle.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(newBody.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(newBody.Nonce),
		"key_version":          1,
	}, readerJar)
	if code != http.StatusForbidden {
		t.Fatalf("read-only update want 403 got %d %v", code, body)
	}
}

func putJSONCookieStatus(t *testing.T, url string, body any, jar *cookieJar) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
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
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

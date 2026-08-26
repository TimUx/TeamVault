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

func TestFindingStage2ScopesOriginShareGroup(t *testing.T) {
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

	adminJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "password1234",
	}, adminJar)
	adminKP, _ := onboardUser(t, ts.URL, adminJar, []byte("admin-master-pw!"), argon)

	created := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "alice", "password": "password1234", "display_name": "Alice",
	}, adminJar)
	aliceID, _ := created["id"].(string)
	bob := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "bob", "password": "password1234", "display_name": "Bob",
	}, adminJar)
	bobID, _ := bob["id"].(string)

	grp := postJSONCookie(t, ts.URL+"/api/admin/groups", map[string]string{"name": "ops"}, adminJar)
	gid, _ := grp["id"].(string)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": aliceID}, adminJar)

	aliceJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "alice", "password": "password1234",
	}, aliceJar)
	aliceKP, _ := onboardUser(t, ts.URL, aliceJar, []byte("alice-master-pw!"), argon)
	_ = aliceKP

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

	// A4: read-scoped API key cannot mutate / admin
	keyRes := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "ro", "scopes": []string{"read"},
	}, adminJar)
	token, _ := keyRes["token"].(string)
	if token == "" {
		t.Fatal(keyRes)
	}
	reqMe, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	reqMe.Header.Set("Authorization", "Bearer "+token)
	resMe, err := http.DefaultClient.Do(reqMe)
	if err != nil {
		t.Fatal(err)
	}
	resMe.Body.Close()
	if resMe.StatusCode != 200 {
		t.Fatalf("read key GET me: %d", resMe.StatusCode)
	}
	reqAdmin, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/admin/users", nil)
	reqAdmin.Header.Set("Authorization", "Bearer "+token)
	resAdmin, err := http.DefaultClient.Do(reqAdmin)
	if err != nil {
		t.Fatal(err)
	}
	resAdmin.Body.Close()
	if resAdmin.StatusCode != http.StatusForbidden {
		t.Fatalf("read key admin GET: want 403 got %d", resAdmin.StatusCode)
	}
	b, _ := json.Marshal(map[string]string{"username": "x", "password": "password1234"})
	reqPost, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/admin/users", bytes.NewReader(b))
	reqPost.Header.Set("Content-Type", "application/json")
	reqPost.Header.Set("Authorization", "Bearer "+token)
	resPost, err := http.DefaultClient.Do(reqPost)
	if err != nil {
		t.Fatal(err)
	}
	resPost.Body.Close()
	if resPost.StatusCode != http.StatusForbidden {
		t.Fatalf("read key POST: want 403 got %d", resPost.StatusCode)
	}

	// A6: cookie mutating without Origin rejected
	b2, _ := json.Marshal(map[string]any{"recovery_mode": "user_kit", "escrow_allowed": false, "confirm": "REONBOARD"})
	reqNoOrigin, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/admin/tenant/recovery", bytes.NewReader(b2))
	reqNoOrigin.Header.Set("Content-Type", "application/json")
	reqNoOrigin.AddCookie(&http.Cookie{Name: "tv_session", Value: adminJar.m["tv_session"]})
	resNo, err := http.DefaultClient.Do(reqNoOrigin)
	if err != nil {
		t.Fatal(err)
	}
	resNo.Body.Close()
	if resNo.StatusCode != http.StatusForbidden {
		t.Fatalf("cookie without origin: want 403 got %d", resNo.StatusCode)
	}
	// Bearer without Origin still OK (full-scope key)
	fullKey := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "full", "scopes": []string{"vault", "admin"},
	}, adminJar)
	fullTok, _ := fullKey["token"].(string)
	reqBearer, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/admin/tenant/recovery", bytes.NewReader(b2))
	reqBearer.Header.Set("Content-Type", "application/json")
	reqBearer.Header.Set("Authorization", "Bearer "+fullTok)
	resBearer, err := http.DefaultClient.Do(reqBearer)
	if err != nil {
		t.Fatal(err)
	}
	resBearer.Body.Close()
	if resBearer.StatusCode >= 300 {
		t.Fatalf("bearer without origin: want 2xx got %d", resBearer.StatusCode)
	}

	// A5: rotate invalidates old version then writes (success path)
	newDK, _ := cryptocore.GenerateDataKey()
	title2, _ := cryptocore.EncryptPayload([]byte("VPN"), newDK, 2)
	body2, _ := cryptocore.EncryptPayload([]byte(`{"password":"y"}`), newDK, 2)
	env2, _ := cryptocore.SealDataKeyForRecipient(newDK, adminKP.Public[:], 2)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/rotate", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(title2.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(title2.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(body2.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(body2.Nonce),
		"key_version":          2,
		"envelopes":            []map[string]any{envAPI(adminUID, env2)},
	}, adminJar)
	zero(newDK)

	// B1: group-member-keys requires envelope
	status, _ := getJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid+"/group-member-keys?group_id="+gid, aliceJar)
	if status != http.StatusForbidden {
		t.Fatalf("group-member-keys without envelope: want 403 got %d", status)
	}
	keys := getJSONListCookie(t, ts.URL+"/api/secrets/"+sid+"/group-member-keys?group_id="+gid, adminJar)
	if len(keys) != 1 || keys[0]["user_id"] != aliceID {
		t.Fatalf("group-member-keys: %v", keys)
	}

	// B3: share to non-onboarded bob rejected
	fakePub := make([]byte, 32)
	copy(fakePub, adminKP.Public[:])
	badEnv, err := cryptocore.SealDataKeyForRecipient(dk, fakePub, 2)
	if err != nil {
		t.Fatal(err)
	}
	st, body := postJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid+"/share", map[string]any{
		"envelopes": []map[string]any{envAPI(bobID, badEnv)},
	}, adminJar)
	if st != http.StatusBadRequest {
		t.Fatalf("share non-onboarded: want 400 got %d %v", st, body)
	}

	zero(dk)
}

func getJSONCookieStatus(t *testing.T, url string, jar *cookieJar) (int, map[string]any) {
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
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

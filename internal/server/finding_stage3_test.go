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

func TestFindingStage3PostStufenplan(t *testing.T) {
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
	_, _ = onboardUser(t, ts.URL, adminJar, []byte("admin-master-pw!"), argon)

	alice := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "alice", "password": "password1234", "display_name": "Alice",
	}, adminJar)
	aliceID, _ := alice["id"].(string)
	grp := postJSONCookie(t, ts.URL+"/api/admin/groups", map[string]string{"name": "ops"}, adminJar)
	gid, _ := grp["id"].(string)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": aliceID}, adminJar)

	aliceJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "alice", "password": "password1234",
	}, aliceJar)
	aliceKP, _ := onboardUser(t, ts.URL, aliceJar, []byte("alice-master-pw!"), argon)

	// R4: member can list own groups
	reqG, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/groups", nil)
	if c := aliceJar.m["tv_session"]; c != "" {
		reqG.AddCookie(&http.Cookie{Name: "tv_session", Value: c})
	}
	resG, err := http.DefaultClient.Do(reqG)
	if err != nil {
		t.Fatal(err)
	}
	defer resG.Body.Close()
	if resG.StatusCode != 200 {
		t.Fatalf("GET /api/groups status %d", resG.StatusCode)
	}
	var glist []map[string]any
	if err := json.NewDecoder(resG.Body).Decode(&glist); err != nil {
		t.Fatal(err)
	}
	if len(glist) != 1 || glist[0]["id"] != gid {
		t.Fatalf("expected alice in ops group, got %#v", glist)
	}

	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	titleCT, _ := cryptocore.EncryptPayload([]byte("VPN"), dk, 1)
	bodyCT, _ := cryptocore.EncryptPayload([]byte(`{"password":"x"}`), dk, 1)
	envAlice, err := cryptocore.SealDataKeyForRecipient(dk, aliceKP.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	createdSec := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(aliceID, envAlice)},
	}, aliceJar)
	sid, _ := createdSec["id"].(string)

	// R1: rotate with empty envelopes → 400, old version still usable
	code, _ := postJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid+"/rotate", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          2,
		"envelopes":            []map[string]any{},
	}, aliceJar)
	if code != 400 {
		t.Fatalf("empty envelopes rotate want 400 got %d", code)
	}
	getJSONCookie(t, ts.URL+"/api/secrets/"+sid, aliceJar)

	// R1: bad envelope rejected before mutate
	code, _ = postJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid+"/rotate", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          2,
		"envelopes": []map[string]any{{
			"user_id": aliceID, "key_version": 2,
			"wrapped_dk_b64": "!!!", "ephemeral_pub_b64": base64.StdEncoding.EncodeToString(make([]byte, 32)),
			"nonce_b64": base64.StdEncoding.EncodeToString(make([]byte, 24)),
		}},
	}, aliceJar)
	if code != 400 {
		t.Fatalf("bad envelope rotate want 400 got %d", code)
	}
	getJSONCookie(t, ts.URL+"/api/secrets/"+sid, aliceJar)

	// Happy-path rotate (transactional)
	newDk, _ := cryptocore.GenerateDataKey()
	title2, _ := cryptocore.EncryptPayload([]byte("VPN"), newDk, 2)
	body2, _ := cryptocore.EncryptPayload([]byte(`{"password":"y"}`), newDk, 2)
	env2, _ := cryptocore.SealDataKeyForRecipient(newDk, aliceKP.Public[:], 2)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/rotate", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(title2.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(title2.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(body2.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(body2.Nonce),
		"key_version":          2,
		"envelopes":            []map[string]any{envAPI(aliceID, env2)},
	}, aliceJar)
	got := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, aliceJar)
	if int(got["key_version"].(float64)) != 2 {
		t.Fatalf("want key_version 2 got %#v", got["key_version"])
	}

	// R3: vault-scoped key cannot hit admin
	vaultKey := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "vault", "scopes": []string{"vault"},
	}, adminJar)
	vtok, _ := vaultKey["token"].(string)
	reqAdmin, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/admin/users", nil)
	reqAdmin.Header.Set("Authorization", "Bearer "+vtok)
	resAdmin, err := http.DefaultClient.Do(reqAdmin)
	if err != nil {
		t.Fatal(err)
	}
	resAdmin.Body.Close()
	if resAdmin.StatusCode != 403 {
		t.Fatalf("vault key admin GET want 403 got %d", resAdmin.StatusCode)
	}

	adminKey := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "adm", "scopes": []string{"admin"},
	}, adminJar)
	atok, _ := adminKey["token"].(string)
	reqUsers, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/admin/users", nil)
	reqUsers.Header.Set("Authorization", "Bearer "+atok)
	resUsers, err := http.DefaultClient.Do(reqUsers)
	if err != nil {
		t.Fatal(err)
	}
	resUsers.Body.Close()
	if resUsers.StatusCode != 200 {
		t.Fatalf("admin key users GET want 200 got %d", resUsers.StatusCode)
	}

	code, _ = postJSONCookieStatus(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "bad", "scopes": []string{"root"},
	}, adminJar)
	if code != 400 {
		t.Fatalf("invalid scope want 400 got %d", code)
	}
}

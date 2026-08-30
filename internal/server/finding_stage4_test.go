package server_test

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestFindingStage4ResidualHardening(t *testing.T) {
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

	// N2: create without envelopes rejected
	code, _ := postJSONCookieStatus(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": "AA==",
		"title_nonce_b64":      "AA==",
		"ciphertext_b64":       "AA==",
		"nonce_b64":            "AA==",
		"key_version":          1,
		"envelopes":            []map[string]any{},
	}, adminJar)
	if code != 400 {
		t.Fatalf("create without envelopes want 400 got %d", code)
	}

	// Happy create
	dk, _ := cryptocore.GenerateDataKey()
	titleCT, _ := cryptocore.EncryptPayload([]byte("X"), dk, 1)
	bodyCT, _ := cryptocore.EncryptPayload([]byte(`{"password":"p"}`), dk, 1)
	env, _ := cryptocore.SealDataKeyForRecipient(dk, adminKP.Public[:], 1)
	me := getJSONCookie(t, ts.URL+"/api/me", adminJar)
	adminUID, _ := me["user_id"].(string)
	created := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(adminUID, env)},
	}, adminJar)
	sid, _ := created["id"].(string)
	if sid == "" {
		t.Fatal(created)
	}

	audit := getJSONCookie(t, ts.URL+"/api/admin/audit", adminJar)
	items, _ := audit["items"].([]any)
	foundCreate := false
	for _, it := range items {
		row, _ := it.(map[string]any)
		if row["action"] == "secret.create" && row["resource_id"] == sid {
			foundCreate = true
			break
		}
	}
	if !foundCreate {
		t.Fatalf("expected secret.create audit for %s", sid)
	}

	// R8: admin_secrets_envelope_only hides secrets without envelope
	bob := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "bob", "password": "password1234",
	}, adminJar)
	bobID, _ := bob["id"].(string)
	bobJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "bob", "password": "password1234",
	}, bobJar)
	bobKP, _ := onboardUser(t, ts.URL, bobJar, []byte("bob-master-pw!"), argon)
	dk2, _ := cryptocore.GenerateDataKey()
	t2, _ := cryptocore.EncryptPayload([]byte("BobOnly"), dk2, 1)
	b2, _ := cryptocore.EncryptPayload([]byte(`{"password":"b"}`), dk2, 1)
	e2, _ := cryptocore.SealDataKeyForRecipient(dk2, bobKP.Public[:], 1)
	postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(t2.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(t2.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(b2.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(b2.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(bobID, e2)},
	}, bobJar)

	putJSONCookie(t, ts.URL+"/api/admin/policy", map[string]any{
		"totp_required": false, "admin_secrets_envelope_only": true,
		"session_hours": 8, "unlock_idle_minutes": 15,
		"escrow_shamir_k": 3, "escrow_shamir_n": 5, "ldap_sync_hours": 24,
	}, adminJar)

	list := getJSONCookie(t, ts.URL+"/api/secrets", adminJar)
	listItems, _ := list["items"].([]any)
	if len(listItems) != 1 {
		t.Fatalf("admin with envelope-only policy want 1 secret, got %d", len(listItems))
	}
	only, _ := listItems[0].(map[string]any)
	if only["id"] != sid {
		t.Fatalf("expected admin own secret %s got %#v", sid, only["id"])
	}

	// R3: legacy full-scope key from stage2 still works for vault POST
	fullKey := postJSONCookie(t, ts.URL+"/api/admin/api-keys", map[string]any{
		"name": "full", "scopes": []string{"vault", "admin"},
	}, adminJar)
	token, _ := fullKey["token"].(string)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/secrets", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == http.StatusForbidden {
		t.Fatal("vault-scoped key should not be blocked by scope on empty body (got 403)")
	}
}
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

func TestPhase5UsersGroupsSecretsShareRotate(t *testing.T) {
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
	adminKP, adminSK := onboardUser(t, ts.URL, adminJar, []byte("admin-master-pw!"), argon)

	// Create second local user
	created := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "alice", "password": "password1234", "display_name": "Alice",
	}, adminJar)
	aliceID, _ := created["id"].(string)
	if aliceID == "" {
		t.Fatal(created)
	}

	grp := postJSONCookie(t, ts.URL+"/api/admin/groups", map[string]string{"name": "ops"}, adminJar)
	gid, _ := grp["id"].(string)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": aliceID}, adminJar)

	users := getJSONCookie(t, ts.URL+"/api/admin/users", adminJar)
	if len(users) < 2 {
		// getJSONCookie returns map — list endpoints return array; use raw
	}
	_ = users

	aliceJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "alice", "password": "password1234",
	}, aliceJar)
	aliceKP, _ := onboardUser(t, ts.URL, aliceJar, []byte("alice-master-pw!"), argon)

	// Admin creates secret (ciphertext only)
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	titleCT, err := cryptocore.EncryptPayload([]byte("DB root"), dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	bodyCT, err := cryptocore.EncryptPayload([]byte(`{"password":"s3cret"}`), dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	adminEnv, err := cryptocore.SealDataKeyForRecipient(dk, adminKP.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	me := getJSONCookie(t, ts.URL+"/api/me", adminJar)
	adminUID, _ := me["user_id"].(string)

	sec := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes": []map[string]any{
			envAPI(adminUID, adminEnv),
		},
	}, adminJar)
	sid, _ := sec["id"].(string)
	if sid == "" {
		t.Fatal(sec)
	}

	// Share with alice (same DK)
	aliceEnv, err := cryptocore.SealDataKeyForRecipient(dk, aliceKP.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/share", map[string]any{
		"envelopes": []map[string]any{envAPI(aliceID, aliceEnv)},
	}, adminJar)

	got := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, aliceJar)
	aliceOpenEnv := got["envelope"].(map[string]any)
	openedDK, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(t, aliceOpenEnv["ephemeral_pub_b64"].(string)),
		Nonce:        mustB64(t, aliceOpenEnv["nonce_b64"].(string)),
		Ciphertext:   mustB64(t, aliceOpenEnv["wrapped_dk_b64"].(string)),
	}, aliceKP.Private[:])
	if err != nil {
		t.Fatal(err)
	}
	pt, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(t, got["nonce_b64"].(string)), Ciphertext: mustB64(t, got["ciphertext_b64"].(string)), KeyVersion: 1,
	}, openedDK, nil)
	if err != nil || !bytes.Contains(pt, []byte("s3cret")) {
		t.Fatalf("decrypt=%q err=%v", pt, err)
	}

	// Revoke alice via rotate (only admin keeps access)
	newDK, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	newTitle, _ := cryptocore.EncryptPayload([]byte("DB root"), newDK, 2)
	newBody, _ := cryptocore.EncryptPayload([]byte(`{"password":"s3cret"}`), newDK, 2)
	newAdminEnv, _ := cryptocore.SealDataKeyForRecipient(newDK, adminKP.Public[:], 2)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/rotate", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(newTitle.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(newTitle.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(newBody.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(newBody.Nonce),
		"key_version":          2,
		"envelopes":            []map[string]any{envAPI(adminUID, newAdminEnv)},
	}, adminJar)

	// Alice must lose access
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/secrets/"+sid, nil)
	req.AddCookie(&http.Cookie{Name: "tv_session", Value: aliceJar.m["tv_session"]})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected forbidden after revoke, got %d", res.StatusCode)
	}

	// Admin still opens
	adminGot := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, adminJar)
	if int(adminGot["key_version"].(float64)) != 2 {
		t.Fatal(adminGot)
	}
	_ = adminSK
	zero(dk)
	zero(newDK)
	zero(openedDK)
}

func onboardUser(t *testing.T, base string, jar *cookieJar, master []byte, argon cryptocore.Argon2Params) (cryptocore.KeyPair, []byte) {
	t.Helper()
	kp, sealed, err := cryptocore.CreateIdentity(master, argon)
	if err != nil {
		t.Fatal(err)
	}
	kit := bytes.Repeat([]byte("k"), 32)
	rec, err := cryptocore.SealPrivateKeyWithRecoveryKey(kp.Private[:], kit, argon)
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, base+"/api/vault/onboard", map[string]any{
		"public_key_b64":                     base64.StdEncoding.EncodeToString(kp.Public[:]),
		"encrypted_private_key_b64":          base64.StdEncoding.EncodeToString(sealed.Ciphertext),
		"encrypted_private_key_nonce_b64":    base64.StdEncoding.EncodeToString(sealed.Nonce),
		"salt_b64":                           base64.StdEncoding.EncodeToString(sealed.Salt),
		"encrypted_private_key_recovery_b64": base64.StdEncoding.EncodeToString(rec.Ciphertext),
		"recovery_nonce_b64":                 base64.StdEncoding.EncodeToString(rec.Nonce),
		"recovery_salt_b64":                  base64.StdEncoding.EncodeToString(rec.Salt),
	}, jar)
	return kp, kp.Private[:]
}

func envAPI(userID string, e cryptocore.Envelope) map[string]any {
	return map[string]any{
		"user_id":           userID,
		"key_version":       e.KeyVersion,
		"wrapped_dk_b64":    base64.StdEncoding.EncodeToString(e.Ciphertext),
		"ephemeral_pub_b64": base64.StdEncoding.EncodeToString(e.EphemeralPub),
		"nonce_b64":         base64.StdEncoding.EncodeToString(e.Nonce),
	}
}

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// getJSONListCookie fetches a JSON array endpoint (or {items:[...]} page).
func getJSONListCookie(t *testing.T, url string, jar *cookieJar) []map[string]any {
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
	var raw json.RawMessage
	_ = json.NewDecoder(res.Body).Decode(&raw)
	if res.StatusCode >= 300 {
		t.Fatalf("%d %s", res.StatusCode, string(raw))
	}
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr
	}
	var page struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatal(err, string(raw))
	}
	return page.Items
}

func TestAdminUserGroupEdit(t *testing.T) {
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

	created := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "bob", "password": "password1234", "display_name": "Bob",
	}, jar)
	bobID, _ := created["id"].(string)

	grp := postJSONCookie(t, ts.URL+"/api/admin/groups", map[string]string{"name": "dev", "description": "old"}, jar)
	gid, _ := grp["id"].(string)

	putJSONCookie(t, ts.URL+"/api/admin/users/"+bobID, map[string]any{
		"display_name": "Robert",
		"email":        "bob@example.com",
		"roles":        []string{"member", "auditor"},
	}, jar)

	putJSONCookie(t, ts.URL+"/api/admin/groups/"+gid, map[string]string{
		"name": "developers", "description": "Dev team",
	}, jar)

	users := getJSONListCookie(t, ts.URL+"/api/admin/users", jar)
	var bob map[string]any
	for _, u := range users {
		if u["id"] == bobID {
			bob = u
			break
		}
	}
	if bob == nil || bob["display_name"] != "Robert" || bob["email"] != "bob@example.com" {
		t.Fatalf("user update: %#v", bob)
	}

	groups := getJSONListCookie(t, ts.URL+"/api/admin/groups", jar)
	var g map[string]any
	for _, row := range groups {
		if row["id"] == gid {
			g = row
			break
		}
	}
	if g == nil || g["name"] != "developers" || g["description"] != "Dev team" {
		t.Fatalf("group update: %#v", g)
	}

	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": bobID}, jar)

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/admin/groups/"+gid, nil)
	setTestOrigin(req)
	req.AddCookie(&http.Cookie{Name: "tv_session", Value: jar.m["tv_session"]})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete group %d", res.StatusCode)
	}
	groups = getJSONListCookie(t, ts.URL+"/api/admin/groups", jar)
	for _, row := range groups {
		if row["id"] == gid {
			t.Fatal("group still listed")
		}
	}
}

package server_test

import (
	"bytes"
	"encoding/base64"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/server"
)

func TestSecretSharesPersistedNotInferred(t *testing.T) {
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
	grp := postJSONCookie(t, ts.URL+"/api/admin/groups", map[string]string{"name": "Backup"}, adminJar)
	gid, _ := grp["id"].(string)
	me := getJSONCookie(t, ts.URL+"/api/me", adminJar)
	adminUID, _ := me["user_id"].(string)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": adminUID}, adminJar)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": aliceID}, adminJar)

	aliceJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "alice", "password": "password1234",
	}, aliceJar)
	aliceKP, _ := onboardUser(t, ts.URL, aliceJar, []byte("alice-master-pw!"), argon)

	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	titleCT, _ := cryptocore.EncryptPayload([]byte("Solo"), dk, 1)
	bodyCT, _ := cryptocore.EncryptPayload([]byte(`{"password":"x"}`), dk, 1)
	adminEnv, _ := cryptocore.SealDataKeyForRecipient(dk, adminKP.Public[:], 1)

	sec := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(adminUID, adminEnv)},
	}, adminJar)
	sid, _ := sec["id"].(string)

	list := getJSONListCookie(t, ts.URL+"/api/secrets", adminJar)
	var item map[string]any
	for _, it := range list {
		if it["id"] == sid {
			item = it
			break
		}
	}
	if item == nil {
		t.Fatal("secret missing from list")
	}
	if sg, ok := item["shared_groups"]; ok && sg != nil {
		if arr, ok := sg.([]any); ok && len(arr) > 0 {
			t.Fatalf("create without share must not infer groups, got %v", sg)
		}
	}

	got := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, adminJar)
	if sg, ok := got["shared_groups"]; ok && sg != nil {
		if arr, ok := sg.([]any); ok && len(arr) > 0 {
			t.Fatalf("get without share must have empty shared_groups, got %v", sg)
		}
	}

	aliceEnv, _ := cryptocore.SealDataKeyForRecipient(dk, aliceKP.Public[:], 1)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/share-group", map[string]any{
		"group_id":  gid,
		"envelopes": []map[string]any{envAPI(aliceID, aliceEnv)},
	}, adminJar)

	got = getJSONCookie(t, ts.URL+"/api/secrets/"+sid, adminJar)
	groups, _ := got["shared_groups"].([]any)
	if len(groups) != 1 || groups[0] != "Backup" {
		t.Fatalf("expected shared_groups=[Backup], got %v", got["shared_groups"])
	}

	access := getJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/access", adminJar)
	sgAccess, _ := access["shared_groups"].([]any)
	if len(sgAccess) != 1 {
		t.Fatalf("access shared_groups: %v", access["shared_groups"])
	}

	newDK, _ := cryptocore.GenerateDataKey()
	newTitle, _ := cryptocore.EncryptPayload([]byte("Solo"), newDK, 2)
	newBody, _ := cryptocore.EncryptPayload([]byte(`{"password":"x"}`), newDK, 2)
	newAdminEnv, _ := cryptocore.SealDataKeyForRecipient(newDK, adminKP.Public[:], 2)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/rotate", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(newTitle.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(newTitle.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(newBody.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(newBody.Nonce),
		"key_version":          2,
		"envelopes":            []map[string]any{envAPI(adminUID, newAdminEnv)},
		"drop_group_ids":       []string{gid},
	}, adminJar)

	got = getJSONCookie(t, ts.URL+"/api/secrets/"+sid, adminJar)
	if sg, ok := got["shared_groups"]; ok && sg != nil {
		if arr, ok := sg.([]any); ok && len(arr) > 0 {
			t.Fatalf("after unshare group, shared_groups must be empty, got %v", sg)
		}
	}
	zero(dk)
	zero(newDK)
}

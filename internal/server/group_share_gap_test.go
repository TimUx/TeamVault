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

func TestGroupShareGapsAfterNewMember(t *testing.T) {
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
	adminKP, _ := onboardUser(t, ts.URL, adminJar, []byte("admin-master-pw!"), argon)
	me := getJSONCookie(t, ts.URL+"/api/me", adminJar)
	adminUID, _ := me["user_id"].(string)

	alice := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "alice", "password": "Password1234!!!!", "display_name": "Alice",
	}, adminJar)
	aliceID, _ := alice["id"].(string)
	bob := postJSONCookie(t, ts.URL+"/api/admin/users", map[string]string{
		"username": "bob", "password": "Password1234!!!!", "display_name": "Bob",
	}, adminJar)
	bobID, _ := bob["id"].(string)

	grp := postJSONCookie(t, ts.URL+"/api/admin/groups", map[string]string{"name": "Ops"}, adminJar)
	gid, _ := grp["id"].(string)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": adminUID}, adminJar)
	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": aliceID}, adminJar)

	aliceJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "alice", "password": "Password1234!!!!",
	}, aliceJar)
	aliceKP, _ := onboardUser(t, ts.URL, aliceJar, []byte("alice-master-pw!"), argon)

	bobJar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "bob", "password": "Password1234!!!!",
	}, bobJar)
	bobKP, _ := onboardUser(t, ts.URL, bobJar, []byte("bob-master-pw!!"), argon)

	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	titleCT, _ := cryptocore.EncryptPayload([]byte("Shared"), dk, 1)
	bodyCT, _ := cryptocore.EncryptPayload([]byte(`{"password":"x"}`), dk, 1)
	adminEnv, _ := cryptocore.SealDataKeyForRecipient(dk, adminKP.Public[:], 1)
	aliceEnv, _ := cryptocore.SealDataKeyForRecipient(dk, aliceKP.Public[:], 1)

	sec := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString(titleCT.Ciphertext),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString(titleCT.Nonce),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString(bodyCT.Ciphertext),
		"nonce_b64":            base64.StdEncoding.EncodeToString(bodyCT.Nonce),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(adminUID, adminEnv)},
	}, adminJar)
	sid, _ := sec["id"].(string)
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/share-group", map[string]any{
		"group_id":  gid,
		"envelopes": []map[string]any{envAPI(aliceID, aliceEnv)},
	}, adminJar)

	// Bob not yet in group → no gap for bob
	gaps := getJSONCookie(t, ts.URL+"/api/secrets/group-share-gaps?group_id="+gid+"&user_id="+bobID, adminJar)
	items, _ := gaps["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected no gaps before bob joins, got %v", gaps["items"])
	}

	postJSONCookie(t, ts.URL+"/api/admin/groups/"+gid+"/members", map[string]string{"user_id": bobID}, adminJar)

	gaps = getJSONCookie(t, ts.URL+"/api/secrets/group-share-gaps?group_id="+gid+"&user_id="+bobID, adminJar)
	items, _ = gaps["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 gap for bob, got %v", gaps["items"])
	}
	g0 := items[0].(map[string]any)
	if g0["secret_id"] != sid || g0["user_id"] != bobID {
		t.Fatalf("gap mismatch: %v", g0)
	}
	envMap := g0["envelope"].(map[string]any)
	openedDK, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(t, envMap["ephemeral_pub_b64"].(string)),
		Nonce:        mustB64(t, envMap["nonce_b64"].(string)),
		Ciphertext:   mustB64(t, envMap["wrapped_dk_b64"].(string)),
	}, adminKP.Private[:])
	if err != nil {
		t.Fatal(err)
	}
	bobEnv, err := cryptocore.SealDataKeyForRecipient(openedDK, bobKP.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, ts.URL+"/api/secrets/"+sid+"/share-group", map[string]any{
		"group_id":  gid,
		"envelopes": []map[string]any{envAPI(bobID, bobEnv)},
	}, adminJar)

	gaps = getJSONCookie(t, ts.URL+"/api/secrets/group-share-gaps?group_id="+gid+"&user_id="+bobID, adminJar)
	items, _ = gaps["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected no gaps after reseal, got %v", gaps["items"])
	}

	got := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, bobJar)
	if got["envelope"] == nil {
		t.Fatal("bob should have envelope after reseal")
	}

	delReq, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/admin/groups/"+gid+"/members/"+bobID, nil)
	setTestOrigin(delReq)
	delReq.AddCookie(&http.Cookie{Name: "tv_session", Value: adminJar.m["tv_session"]})
	delRes, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatal(err)
	}
	defer delRes.Body.Close()
	if delRes.StatusCode != http.StatusOK {
		t.Fatalf("remove member status %d", delRes.StatusCode)
	}
	var delBody map[string]any
	_ = json.NewDecoder(delRes.Body).Decode(&delBody)
	ids, _ := delBody["rotate_secret_ids"].([]any)
	if len(ids) != 1 || ids[0] != sid {
		t.Fatalf("rotate_secret_ids: %#v", delBody)
	}
	code, _ := getJSONCookieStatus(t, ts.URL+"/api/secrets/"+sid, bobJar)
	if code == http.StatusOK {
		t.Fatal("bob should lose envelope after group remove")
	}

	// No access without envelope before reseal is already covered; ensure alice still ok
	_ = getJSONCookie(t, ts.URL+"/api/secrets/"+sid, aliceJar)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/secrets/group-share-gaps", nil)
	req.AddCookie(&http.Cookie{Name: "tv_session", Value: adminJar.m["tv_session"]})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list all gaps status %d", res.StatusCode)
	}

	zero(dk)
	zero(openedDK)
}

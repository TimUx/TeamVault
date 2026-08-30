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

func TestAdminBackupRestoreAndMigratePreservesCiphertext(t *testing.T) {
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
	adminKP, _ := onboardUser(t, ts.URL, jar, []byte("admin-master-pw!"), argon)
	me := getJSONCookie(t, ts.URL+"/api/me", jar)
	adminUID, _ := me["user_id"].(string)

	dk := bytes.Repeat([]byte{7}, 32)
	env, err := cryptocore.SealDataKeyForRecipient(dk, adminKP.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	created := postJSONCookie(t, ts.URL+"/api/secrets", map[string]any{
		"title_ciphertext_b64": base64.StdEncoding.EncodeToString([]byte("t")),
		"title_nonce_b64":      base64.StdEncoding.EncodeToString([]byte("n")),
		"ciphertext_b64":       base64.StdEncoding.EncodeToString([]byte("c")),
		"nonce_b64":            base64.StdEncoding.EncodeToString([]byte("o")),
		"key_version":          1,
		"envelopes":            []map[string]any{envAPI(adminUID, env)},
	}, jar)
	sid, _ := created["id"].(string)
	if sid == "" {
		t.Fatal(created)
	}

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/admin/backup", nil)
	req.AddCookie(&http.Cookie{Name: "tv_session", Value: jar.m["tv_session"]})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("backup GET %d", res.StatusCode)
	}
	var snap store.StoreSnapshot
	if err := json.NewDecoder(res.Body).Decode(&snap); err != nil {
		t.Fatal(err)
	}
	if snap.FormatVersion != 1 || len(snap.Records) == 0 {
		t.Fatalf("empty snapshot: %+v", snap)
	}

	code, _ := postJSONCookieStatus(t, ts.URL+"/api/admin/backup/restore", map[string]any{
		"confirm": "nope", "snapshot": snap,
	}, jar)
	if code < 400 {
		t.Fatalf("expected reject without RESTORE, got %d", code)
	}

	ok := postJSONCookie(t, ts.URL+"/api/admin/backup/restore", map[string]any{
		"confirm": "RESTORE", "snapshot": snap,
	}, jar)
	if ok["status"] != "ok" {
		t.Fatal(ok)
	}
	got := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, jar)
	if got["id"] != sid {
		t.Fatalf("secret lost after restore: %#v", got)
	}

	dst := filepath.Join(dir, "migrated.json")
	mig := postJSONCookie(t, ts.URL+"/api/admin/storage/migrate", map[string]string{
		"backend": "json", "dsn": dst, "confirm": "MIGRATE",
	}, jar)
	st, _ := mig["storage"].(map[string]any)
	if st["backend"] != "json" {
		t.Fatal(mig)
	}
	got2 := getJSONCookie(t, ts.URL+"/api/secrets/"+sid, jar)
	if got2["id"] != sid {
		t.Fatalf("secret lost after migrate: %#v", got2)
	}
}

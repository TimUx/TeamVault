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

func TestWave3EscrowReplaceCeremony(t *testing.T) {
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
		"tenant":  map[string]any{"name": "T", "slug": "t1", "recovery_mode": "admin_escrow", "escrow_allowed": true},
		"admin":   map[string]string{"username": "admin", "password": "Password1234!!!!"},
		"argon2":  argon,
	}, nil)

	jar := &cookieJar{m: map[string]string{}}
	postJSON(t, ts.URL+"/api/auth/login", map[string]string{
		"tenant_slug": "t1", "username": "admin", "password": "Password1234!!!!",
	}, jar)

	oldKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, ts.URL+"/api/admin/tenant/escrow-pubkey", map[string]string{
		"public_key_b64": base64.StdEncoding.EncodeToString(oldKP.Public[:]),
	}, jar)
	st, _ := postJSONCookieStatus(t, ts.URL+"/api/admin/tenant/escrow-pubkey", map[string]string{
		"public_key_b64": base64.StdEncoding.EncodeToString(oldKP.Public[:]),
	}, jar)
	if st != http.StatusConflict {
		t.Fatalf("second set want 409 got %d", st)
	}

	begin := postJSONCookie(t, ts.URL+"/api/admin/tenant/escrow/replace/begin", map[string]any{}, jar)
	eph, _ := base64.StdEncoding.DecodeString(begin["ephemeral_pub_b64"].(string))
	nonce, _ := base64.StdEncoding.DecodeString(begin["nonce_b64"].(string))
	wrapped, _ := base64.StdEncoding.DecodeString(begin["wrapped_dk_b64"].(string))
	opened, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: eph, Nonce: nonce, Ciphertext: wrapped,
	}, oldKP.Private[:])
	if err != nil {
		t.Fatal(err)
	}
	wrong := bytes.Repeat([]byte{9}, 32)
	bad, _ := postJSONCookieStatus(t, ts.URL+"/api/admin/tenant/escrow/replace/finish", map[string]string{
		"challenge_b64":  base64.StdEncoding.EncodeToString(wrong),
		"public_key_b64": base64.StdEncoding.EncodeToString(oldKP.Public[:]),
	}, jar)
	if bad != http.StatusForbidden {
		t.Fatalf("wrong challenge want 403 got %d", bad)
	}

	newKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	postJSONCookie(t, ts.URL+"/api/admin/tenant/escrow/replace/finish", map[string]string{
		"challenge_b64":  base64.StdEncoding.EncodeToString(opened),
		"public_key_b64": base64.StdEncoding.EncodeToString(newKP.Public[:]),
	}, jar)
	got := getJSONCookie(t, ts.URL+"/api/vault/escrow-pubkey", jar)
	want := base64.StdEncoding.EncodeToString(newKP.Public[:])
	if got["public_key_b64"] != want {
		t.Fatalf("escrow pubkey %v want %s", got["public_key_b64"], want)
	}
}

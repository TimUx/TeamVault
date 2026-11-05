package backend

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestDesktopOfflinePolicyFailsClosed(t *testing.T) {
	policy := map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/policy/client" {
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(policy)
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	s := Session{Client: client}
	for _, tc := range []struct {
		name        string
		policy      map[string]any
		wantAllowed bool
	}{
		{"missing policy", map[string]any{}, false},
		{"missing requirement", map[string]any{"offline_cache_allowed": true}, false},
		{"unknown requirement", map[string]any{"offline_cache_allowed": true, "offline_key_requirement": "unknown"}, false},
		{"disabled", map[string]any{"offline_cache_allowed": false, "offline_key_requirement": "ANY"}, false},
		{"user choice", map[string]any{"offline_cache_allowed": true, "offline_key_requirement": "ANY"}, true},
		{"software required", map[string]any{"offline_cache_allowed": true, "offline_key_requirement": "SOFTWARE"}, true},
		{"hardware required", map[string]any{"offline_cache_allowed": true, "offline_key_requirement": "HARDWARE"}, false},
		{"combined required", map[string]any{"offline_cache_allowed": true, "offline_key_requirement": "COMBINED"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			policy = tc.policy
			_, err := s.checkOfflinePolicy("STANDARD")
			if (err == nil) != tc.wantAllowed {
				t.Fatalf("policy %v: %v", tc.policy, err)
			}
		})
	}
}

func TestDesktopSyncRechecksPolicyBeforeSaving(t *testing.T) {
	for _, updatedRequirement := range []string{"HARDWARE", "SOFTWARE"} {
		t.Run(updatedRequirement, func(t *testing.T) {
			t.Setenv("XDG_CONFIG_HOME", t.TempDir())
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/policy/client":
					calls++
					requirement := "ANY"
					if calls > 1 {
						requirement = updatedRequirement
					}
					_ = json.NewEncoder(w).Encode(map[string]any{
						"offline_cache_allowed": true, "offline_key_requirement": requirement,
					})
				case "/api/vault/keys":
					_, _ = w.Write([]byte(`{}`))
				case "/api/secrets":
					_, _ = w.Write([]byte(`{"items":[],"total":0}`))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			client, err := NewClient(server.URL, "")
			if err != nil {
				t.Fatal(err)
			}
			s := Session{
				Client: client, TenantSlug: "tenant", Username: "alice",
				Me: map[string]any{"tenant_id": "t1", "user_id": "u1"},
			}
			if err := s.SyncOfflineSnapshot(bytes.Repeat([]byte{1}, 32)); err == nil {
				t.Fatalf("sync accepted a policy that changed to %s", updatedRequirement)
			}
			if calls != 2 {
				t.Fatalf("policy was checked %d times, want 2", calls)
			}
			if _, ok, err := LoadOfflineCache("tenant", "alice"); err != nil || ok {
				t.Fatalf("cache saved with stale policy: present=%v err=%v", ok, err)
			}
		})
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	in := Settings{ServerURL: "https://vault.example.test", TenantSlug: "acme", Username: "alice", AutostartOn: true, CloseToTray: true, PreventScreenCapture: true, Theme: "dark", Accent: "teal"}
	if err := SaveSettings(in); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	out, err := LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}
	if out != in {
		t.Fatalf("roundtrip mismatch: got %+v want %+v", out, in)
	}
}

func TestOfflineSnapshotRequiresSoftwareKeyAndAuthenticatedScope(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	snap := OfflineSnapshot{
		Version:    2,
		TenantID:   "t1",
		TenantSlug: "acme",
		UserID:     "u1",
		Username:   "alice",
		SyncedAt:   time.Now().UTC(),
		Keys:       OfflineKeys{SaltB64: "c2FsdA==", PublicKeyB64: "cHVi"},
		Secrets:    []OfflineSecret{{ID: "sec_1", HasAccess: true}},
	}
	key, err := GenerateOfflineSoftwareKey()
	if err != nil {
		t.Fatalf("GenerateOfflineSoftwareKey: %v", err)
	}
	defer zeroBytes(key)
	cache, err := SealOfflineSnapshot(snap, key, "https://vault.example.test", "SOFTWARE")
	if err != nil {
		t.Fatalf("SealOfflineSnapshot: %v", err)
	}
	if cache.Format != "teamvault-offline" || cache.Profile != "STANDARD" || cache.SecretCount != 1 {
		t.Fatalf("unexpected cache envelope: %+v", cache)
	}
	if cache.ServerRequirement != "SOFTWARE" {
		t.Fatalf("server requirement = %q", cache.ServerRequirement)
	}
	if err := SaveOfflineCache(cache); err != nil {
		t.Fatalf("SaveOfflineCache: %v", err)
	}
	loaded, ok, err := LoadOfflineCache("acme", "alice")
	if err != nil || !ok {
		t.Fatalf("LoadOfflineCache: ok=%v err=%v", ok, err)
	}
	if loaded.Expired() {
		t.Fatal("fresh snapshot should not be expired")
	}
	opened, err := OpenOfflineSnapshot(loaded, key, "https://vault.example.test", "t1", "u1")
	if err != nil {
		t.Fatalf("OpenOfflineSnapshot: %v", err)
	}
	if len(opened.Secrets) != 1 || opened.Secrets[0].ID != "sec_1" {
		t.Fatalf("unexpected secrets: %+v", opened.Secrets)
	}

	wrongKey := bytes.Clone(key)
	wrongKey[0] ^= 0xff
	if _, err := OpenOfflineSnapshot(loaded, wrongKey, "https://vault.example.test", "t1", "u1"); err == nil {
		t.Fatal("wrong software key unexpectedly opened snapshot")
	}
	zeroBytes(wrongKey)
	if _, err := OpenOfflineSnapshot(loaded, key, "https://other.example.test", "t1", "u1"); err == nil {
		t.Fatal("wrong origin unexpectedly opened snapshot")
	}
	tampered := loaded
	tampered.SecretCount++
	if _, err := OpenOfflineSnapshot(tampered, key, "https://vault.example.test", "t1", "u1"); err == nil {
		t.Fatal("tampered authenticated metadata unexpectedly opened snapshot")
	}
	for _, requirement := range []string{"ANY", "", "HARDWARE"} {
		tampered = loaded
		tampered.ServerRequirement = requirement
		if _, err := OpenOfflineSnapshot(tampered, key, "https://vault.example.test", "t1", "u1"); err == nil {
			t.Fatalf("tampered server requirement %q unexpectedly opened snapshot", requirement)
		}
	}
	if _, err := SealOfflineSnapshot(snap, key, "https://vault.example.test", "HARDWARE"); err == nil {
		t.Fatal("STANDARD snapshot accepted a hardware requirement")
	}

	if err := DeleteOfflineSnapshot("acme", "alice"); err != nil {
		t.Fatalf("DeleteOfflineSnapshot: %v", err)
	}
	if _, ok, err := LoadOfflineCache("acme", "alice"); err != nil || ok {
		t.Fatalf("expected no snapshot after delete: ok=%v err=%v", ok, err)
	}
}

func TestDesktopLegacyProtectedCacheRemainsReadable(t *testing.T) {
	snap := OfflineSnapshot{
		TenantID: "t1", TenantSlug: "acme", UserID: "u1", Username: "alice",
		SyncedAt: time.Now().UTC(), Secrets: []OfflineSecret{{ID: "sec_1"}},
	}
	key := bytes.Repeat([]byte{7}, 32)
	cache, err := SealOfflineSnapshot(snap, key, "https://vault.example.test", "SOFTWARE")
	if err != nil {
		t.Fatal(err)
	}
	decode := func(value string) []byte {
		t.Helper()
		out, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	kek, err := deriveOfflineKEK(key, decode(cache.SaltB64), cache)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroBytes(kek)
	aad := offlineCacheAAD(cache)
	dek, err := decryptOfflineData(kek, decode(cache.WrappedDEKNonceB64), decode(cache.WrappedDEKB64), aad)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroBytes(dek)
	plain, err := decryptOfflineData(dek, decode(cache.SnapshotNonceB64), decode(cache.CiphertextB64), aad)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroBytes(plain)

	legacy := cache
	legacy.PolicyVersion = offlineLegacyPolicy
	legacy.ServerRequirement = ""
	wrapNonce, snapshotNonce := make([]byte, 12), make([]byte, 12)
	if _, err := rand.Read(wrapNonce); err != nil {
		t.Fatal(err)
	}
	if _, err := rand.Read(snapshotNonce); err != nil {
		t.Fatal(err)
	}
	legacy.WrappedDEKNonceB64 = base64.StdEncoding.EncodeToString(wrapNonce)
	legacy.SnapshotNonceB64 = base64.StdEncoding.EncodeToString(snapshotNonce)
	aad = offlineCacheAAD(legacy)
	legacy.WrappedDEKB64, err = encryptOfflineData(kek, wrapNonce, dek, aad)
	if err != nil {
		t.Fatal(err)
	}
	legacy.CiphertextB64, err = encryptOfflineData(dek, snapshotNonce, plain, aad)
	if err != nil {
		t.Fatal(err)
	}
	opened, err := OpenOfflineSnapshot(legacy, key, cache.Origin, cache.TenantID, cache.UserID)
	if err != nil || len(opened.Secrets) != 1 || opened.Secrets[0].ID != "sec_1" {
		t.Fatalf("legacy cache: %+v, %v", opened, err)
	}
}

func TestOfflineSnapshotPathKeepsAccountIdentifiersWithinConfigDir(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	path, err := offlineSnapshotPath("../../../../tmp", `..\..\alice`)
	if err != nil {
		t.Fatalf("offlineSnapshotPath: %v", err)
	}
	dir, err := configDir()
	if err != nil {
		t.Fatalf("configDir: %v", err)
	}
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		t.Fatalf("filepath.Rel: %v", err)
	}
	if !filepath.IsLocal(rel) {
		t.Fatalf("offline cache path escaped config directory: %q", path)
	}
}

func TestBuildBodyDefaultsToEmptySlices(t *testing.T) {
	body := buildBody(SecretInput{Title: "x"})
	if body["urls"] == nil || body["tags"] == nil || body["extra"] == nil {
		t.Fatalf("expected non-nil default slices, got %+v", body)
	}
}

func TestStringSliceAcceptsJSONAndNativeSlices(t *testing.T) {
	if got := stringSlice([]string{"one", "two"}); len(got) != 2 || got[1] != "two" {
		t.Fatalf("native slice was not preserved: %#v", got)
	}
	if got := stringSlice([]any{"one", "", 42, "two"}); len(got) != 2 || got[1] != "two" {
		t.Fatalf("JSON slice was not normalized: %#v", got)
	}
}

func TestClientSetsOriginForMutatingRequests(t *testing.T) {
	c, err := NewClient("https://vault.example.test/base", "")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req, err := c.newRequest(method, "/api/me/preferences", []byte("{}"))
		if err != nil {
			t.Fatalf("newRequest(%s): %v", method, err)
		}
		if got, want := req.Header.Get("Origin"), "https://vault.example.test"; got != want {
			t.Fatalf("%s Origin = %q, want %q", method, got, want)
		}
	}
}

func TestClientDoesNotSetOriginForReadRequests(t *testing.T) {
	c, err := NewClient("https://vault.example.test", "")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	req, err := c.newRequest(http.MethodGet, "/api/me", nil)
	if err != nil {
		t.Fatalf("newRequest: %v", err)
	}
	if got := req.Header.Get("Origin"); got != "" {
		t.Fatalf("GET Origin = %q, want empty", got)
	}
}

func TestParseArgon2ParamsAcceptsOfflineCacheFormat(t *testing.T) {
	cached := map[string]any{"time": 1, "memory": 8192, "threads": 1, "key_len": 32}
	p := parseArgon2Params(cached)
	if p.Time != 1 || p.Memory != 8192 || p.Threads != 1 || p.KeyLen != 32 {
		t.Fatalf("offline cache params not parsed: %+v", p)
	}
	server := map[string]any{"Time": 3, "Memory": 65536, "Threads": 4, "KeyLen": 32}
	if p := parseArgon2Params(server); p.Time != 3 || p.KeyLen != 32 {
		t.Fatalf("server params not parsed: %+v", p)
	}
}

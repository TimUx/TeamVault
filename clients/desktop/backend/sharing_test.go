package backend

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/teamvault/teamvault/internal/cryptocore"
)

func b64Bytes(b []byte) string { return b64(b) }

// newTestSession wires a Session's Client at a httptest server and unlocks
// it with an already-generated keypair (bypassing the real Argon2/login
// flow, which isn't relevant to the sharing logic under test).
func newTestSession(t *testing.T, server *httptest.Server, kp cryptocore.KeyPair, meID string) *Session {
	t.Helper()
	c, err := NewClient(server.URL, "")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return &Session{
		Client: c,
		sk:     append([]byte{}, kp.Private[:]...),
		pubKey: b64Bytes(kp.Public[:]),
		Me:     map[string]any{"user_id": meID},
	}
}

func TestShareSecretWithUserSealsEnvelopeForRecipient(t *testing.T) {
	meKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	targetKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatalf("GenerateDataKey: %v", err)
	}
	myEnv, err := cryptocore.SealDataKeyForRecipient(dk, meKP.Public[:], 1)
	if err != nil {
		t.Fatalf("SealDataKeyForRecipient: %v", err)
	}

	var captured map[string]any
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/secrets/sec1", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "sec1", "key_version": 1,
			"envelope": map[string]any{
				"ephemeral_pub_b64": b64Bytes(myEnv.EphemeralPub),
				"nonce_b64":         b64Bytes(myEnv.Nonce),
				"wrapped_dk_b64":    b64Bytes(myEnv.Ciphertext),
			},
		})
	})
	mux.HandleFunc("GET /api/users/public-keys", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"user_id": "target", "username": "bob", "public_key_b64": b64Bytes(targetKP.Public[:])},
		})
	})
	mux.HandleFunc("POST /api/secrets/sec1/share", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&captured)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	s := newTestSession(t, server, meKP, "me")
	if err := s.ShareSecretWithUser("sec1", "target", "write"); err != nil {
		t.Fatalf("ShareSecretWithUser: %v", err)
	}
	if captured == nil {
		t.Fatal("share request was not received")
	}
	if captured["capability"] != "write" {
		t.Fatalf("expected capability write, got %v", captured["capability"])
	}
	envs, _ := captured["envelopes"].([]any)
	if len(envs) != 1 {
		t.Fatalf("expected 1 envelope, got %d", len(envs))
	}
	env := envs[0].(map[string]any)
	if env["user_id"] != "target" {
		t.Fatalf("unexpected user_id: %v", env["user_id"])
	}
	opened, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, targetKP.Private[:])
	if err != nil {
		t.Fatalf("target could not open envelope: %v", err)
	}
	if string(opened) != string(dk) {
		t.Fatal("recipient did not recover the same data key")
	}
}

func TestUnshareSecretRotatesAndDropsRevokedUser(t *testing.T) {
	ownerKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	keepKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	dropKP, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatalf("GenerateDataKey: %v", err)
	}
	titleCT, err := cryptocore.EncryptPayload([]byte("My Secret"), dk, 1)
	if err != nil {
		t.Fatalf("EncryptPayload title: %v", err)
	}
	bodyCT, err := cryptocore.EncryptPayload([]byte(`{"username":"u","tags":["x"]}`), dk, 1)
	if err != nil {
		t.Fatalf("EncryptPayload body: %v", err)
	}
	ownerEnv, err := cryptocore.SealDataKeyForRecipient(dk, ownerKP.Public[:], 1)
	if err != nil {
		t.Fatalf("SealDataKeyForRecipient: %v", err)
	}

	var rotateBody map[string]any
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/secrets/sec1/access", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"owner":         map[string]any{"id": "owner", "username": "owner"},
			"my_capability": "admin",
			"shared_users": []map[string]any{
				{"id": "keep", "username": "keep", "capability": "write"},
				{"id": "drop", "username": "drop", "capability": "write"},
			},
			"shared_groups":    []map[string]any{},
			"available_users":  []map[string]any{},
			"available_groups": []map[string]any{},
		})
	})
	mux.HandleFunc("GET /api/secrets/sec1", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "sec1", "key_version": 1,
			"title_ciphertext_b64": b64Bytes(titleCT.Ciphertext), "title_nonce_b64": b64Bytes(titleCT.Nonce),
			"ciphertext_b64": b64Bytes(bodyCT.Ciphertext), "nonce_b64": b64Bytes(bodyCT.Nonce),
			"envelope": map[string]any{
				"ephemeral_pub_b64": b64Bytes(ownerEnv.EphemeralPub),
				"nonce_b64":         b64Bytes(ownerEnv.Nonce),
				"wrapped_dk_b64":    b64Bytes(ownerEnv.Ciphertext),
			},
		})
	})
	mux.HandleFunc("GET /api/users/public-keys", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"user_id": "owner", "username": "owner", "public_key_b64": b64Bytes(ownerKP.Public[:])},
			{"user_id": "keep", "username": "keep", "public_key_b64": b64Bytes(keepKP.Public[:])},
			{"user_id": "drop", "username": "drop", "public_key_b64": b64Bytes(dropKP.Public[:])},
		})
	})
	mux.HandleFunc("POST /api/secrets/sec1/rotate", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&rotateBody)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	s := newTestSession(t, server, ownerKP, "owner")
	if err := s.UnshareSecret("sec1", []string{"drop"}, nil); err != nil {
		t.Fatalf("UnshareSecret: %v", err)
	}
	if rotateBody == nil {
		t.Fatal("rotate request was not received")
	}
	if rotateBody["key_version"].(float64) != 2 {
		t.Fatalf("expected key_version 2, got %v", rotateBody["key_version"])
	}
	envs, _ := rotateBody["envelopes"].([]any)
	seen := map[string]bool{}
	for _, e := range envs {
		m := e.(map[string]any)
		seen[str(m["user_id"])] = true
	}
	if !seen["owner"] || !seen["keep"] {
		t.Fatalf("expected owner+keep envelopes, got %+v", seen)
	}
	if seen["drop"] {
		t.Fatal("dropped user must not receive a new envelope")
	}
	dropIDs, _ := rotateBody["drop_user_ids"].([]any)
	if len(dropIDs) != 1 || dropIDs[0] != "drop" {
		t.Fatalf("unexpected drop_user_ids: %v", dropIDs)
	}
}

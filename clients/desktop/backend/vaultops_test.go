package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/teamvault/teamvault/internal/cryptocore"
)

func encryptedListFixture(t *testing.T, kp cryptocore.KeyPair, id, title, owner, visibility string) map[string]any {
	t.Helper()
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	defer zero(dk)
	titleCT, err := cryptocore.EncryptPayload([]byte(title), dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	bodyCT, err := cryptocore.EncryptPayload([]byte(`{"tags":["test"],"favorite":true}`), dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	env, err := cryptocore.SealDataKeyForRecipient(dk, kp.Public[:], 1)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"id": id, "has_access": true, "key_version": float64(1),
		"created_by": owner, "created_by_username": owner, "visibility": visibility,
		"title_ciphertext_b64": b64(titleCT.Ciphertext), "title_nonce_b64": b64(titleCT.Nonce),
		"ciphertext_b64": b64(bodyCT.Ciphertext), "nonce_b64": b64(bodyCT.Nonce),
		"envelope": map[string]any{
			"ephemeral_pub_b64": b64(env.EphemeralPub),
			"nonce_b64":         b64(env.Nonce),
			"wrapped_dk_b64":    b64(env.Ciphertext),
		},
	}
}

func TestListSecretsExcludesAdminInventory(t *testing.T) {
	kp, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	fixtures := []map[string]any{
		encryptedListFixture(t, kp, "own", "Zulu private", "me", "private"),
		encryptedListFixture(t, kp, "shared-by-me", "Beta shared", "me", "shared"),
		encryptedListFixture(t, kp, "shared-with-me", "Alpha shared", "other", "shared"),
	}
	for _, mode := range []string{"paginated", "legacy", "inventory-only"} {
		t.Run(mode, func(t *testing.T) {
			// A full inaccessible first page must not hide accessible later pages.
			items := make([]map[string]any, 0, 204)
			for i := 0; i < 200; i++ {
				items = append(items, map[string]any{
					"id": fmt.Sprintf("inventory-%d", i), "has_access": false,
					"created_by": "other", "created_by_username": "other",
					"visibility": []string{"private", "shared"}[i%2],
				})
			}
			items = append(items, map[string]any{"id": "missing-access"})
			if mode != "inventory-only" {
				items = append(items, fixtures...)
			}
			var detailCalls atomic.Int32
			mux := http.NewServeMux()
			mux.HandleFunc("GET /api/secrets", func(w http.ResponseWriter, r *http.Request) {
				if mode == "legacy" {
					_ = json.NewEncoder(w).Encode(items)
					return
				}
				offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
				limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
				if limit != 200 || offset > len(items) {
					t.Errorf("unexpected pagination: %s", r.URL)
					http.Error(w, "bad pagination", http.StatusBadRequest)
					return
				}
				end := min(offset+limit, len(items))
				_ = json.NewEncoder(w).Encode(map[string]any{"items": items[offset:end], "total": len(items)})
			})
			mux.HandleFunc("GET /api/secrets/{id}", func(w http.ResponseWriter, r *http.Request) {
				detailCalls.Add(1)
				for _, fixture := range fixtures {
					if fixture["id"] == r.PathValue("id") {
						_ = json.NewEncoder(w).Encode(fixture)
						return
					}
				}
				t.Errorf("requested inaccessible secret %q", r.PathValue("id"))
				http.Error(w, "no access envelope", http.StatusForbidden)
			})
			server := httptest.NewServer(mux)
			defer server.Close()
			s := newTestSession(t, server, kp, "me")
			defer s.Lock()
			rows, err := s.ListSecrets()
			if err != nil {
				t.Fatal(err)
			}
			if mode == "inventory-only" {
				if rows == nil || len(rows) != 0 || detailCalls.Load() != 0 {
					t.Fatalf("expected empty list without detail requests, got %+v (%d requests)", rows, detailCalls.Load())
				}
				return
			}
			if len(rows) != 3 || detailCalls.Load() != 3 {
				t.Fatalf("expected 3 accessible rows/requests, got %+v (%d requests)", rows, detailCalls.Load())
			}
			for i, id := range []string{"shared-with-me", "shared-by-me", "own"} {
				row := rows[i]
				if row.ID != id || !row.HasAccess || row.Title == row.ID || !row.Favorite || !reflect.DeepEqual(row.Tags, []string{"test"}) {
					t.Errorf("unexpected decrypted row: %+v", row)
				}
				if row.IsOwner != (id != "shared-with-me") {
					t.Errorf("incorrect owner: %+v", row)
				}
			}
			if rows[0].Visibility != "shared" || rows[1].Visibility != "shared" || rows[2].Visibility != "private" {
				t.Fatalf("visibility changed: %+v", rows)
			}
		})
	}
}

func TestListSecretsOfflineExcludesInaccessibleEntries(t *testing.T) {
	kp, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	s := &Session{sk: append([]byte(nil), kp.Private[:]...), Me: map[string]any{"user_id": "me"}}
	defer s.Lock()
	snap := OfflineSnapshot{}
	for _, owner := range []string{"me", "other"} {
		for _, visibility := range []string{"private", "shared"} {
			for _, access := range []bool{false, true} {
				id := fmt.Sprintf("%s-%s-%t", owner, visibility, access)
				fixture := encryptedListFixture(t, kp, id, id, owner, visibility)
				snap.Secrets = append(snap.Secrets, OfflineSecret{
					ID: id, HasAccess: access, Visibility: visibility,
					CreatedBy: owner, CreatedByUsername: owner,
					KeyVersion: 1, Envelope: fixture["envelope"].(map[string]any),
					TitleCiphertextB64: str(fixture["title_ciphertext_b64"]),
					TitleNonceB64:      str(fixture["title_nonce_b64"]),
					CiphertextB64:      str(fixture["ciphertext_b64"]), NonceB64: str(fixture["nonce_b64"]),
				})
			}
		}
	}
	rows, err := s.ListSecretsOffline(snap)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("expected 4 accessible rows, got %+v", rows)
	}
	for i, id := range []string{"me-private-true", "me-shared-true", "other-private-true", "other-shared-true"} {
		row := rows[i]
		if row.ID != id || row.Title != id || !row.HasAccess || !row.Favorite || !reflect.DeepEqual(row.Tags, []string{"test"}) {
			t.Errorf("unexpected offline row: %+v", row)
		}
	}
}

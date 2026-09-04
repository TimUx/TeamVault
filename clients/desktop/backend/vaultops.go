package backend

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pquerna/otp/totp"
	"github.com/teamvault/teamvault/internal/cryptocore"
)

// Session holds everything needed to talk to a TeamVault server and
// decrypt the current user's vault locally. SK/DK-style keys only ever
// live in process memory; nothing plaintext is written to disk.
type Session struct {
	Client     *Client
	TenantSlug string
	Username   string
	Me         map[string]any

	sk     []byte // Ed25519/X25519 private key (unlocked identity)
	params cryptocore.Argon2Params
	pubKey string

	Offline bool // true if the current view is served from the local cache
}

// ErrInvalidMasterPassword indicates the master password did not match the
// sealed identity (as opposed to a network/connectivity failure). Callers
// use this to decide whether falling back to the offline cache makes sense.
var ErrInvalidMasterPassword = errors.New("Master-Passwort falsch oder Schlüssel beschädigt")

func mustB64(s string) []byte {
	if s == "" {
		return nil
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func str(v any) string {
	s, _ := v.(string)
	return s
}

// Login authenticates against /api/auth/login (local or LDAP bind); the
// server sets a session cookie tracked by the client's cookie jar.
func Login(c *Client, tenant, username, password, totpCode string) error {
	_, err := c.PostJSON("/api/auth/login", map[string]string{
		"tenant_slug": tenant,
		"username":    username,
		"password":    password,
		"totp_code":   totpCode,
	})
	return err
}

// Logout ends the server session (best-effort).
func Logout(c *Client) {
	_, _ = c.PostJSON("/api/auth/logout", map[string]string{})
}

// Unlock derives SK from the master password against the server-provided
// (or offline-cached) sealed identity, never sending the password anywhere.
func Unlock(c *Client, masterPassword []byte, cached *OfflineSnapshot) (*Session, error) {
	sess := &Session{Client: c}

	var keys map[string]any
	var params cryptocore.Argon2Params
	if cached == nil {
		var err error
		keys, err = c.GetJSON("/api/vault/keys")
		if err != nil {
			return nil, err
		}
		if raw, ok := keys["argon2"]; ok {
			b, _ := json.Marshal(raw)
			_ = json.Unmarshal(b, &params)
		}
		if params.Time == 0 {
			paramsRaw, err := c.GetJSON("/api/vault/crypto-params")
			if err == nil {
				b, _ := json.Marshal(paramsRaw)
				_ = json.Unmarshal(b, &params)
			}
		}
	} else {
		keys = map[string]any{
			"salt_b64":                        cached.Keys.SaltB64,
			"encrypted_private_key_nonce_b64": cached.Keys.EncryptedPrivateKeyNonceB64,
			"encrypted_private_key_b64":       cached.Keys.EncryptedPrivateKeyB64,
			"public_key_b64":                  cached.Keys.PublicKeyB64,
		}
		b, _ := json.Marshal(cached.CryptoParams)
		_ = json.Unmarshal(b, &params)
		sess.Offline = true
	}
	if params.KeyLen == 0 {
		params = cryptocore.DefaultArgon2
	}

	salt := mustB64(str(keys["salt_b64"]))
	nonce := mustB64(str(keys["encrypted_private_key_nonce_b64"]))
	ct := mustB64(str(keys["encrypted_private_key_b64"]))
	sk, mk, err := cryptocore.UnlockIdentity(masterPassword, cryptocore.SealedPrivateKey{
		Salt: salt, Nonce: nonce, Ciphertext: ct, Params: params,
	})
	if mk != nil {
		zero(mk)
	}
	if err != nil {
		return nil, ErrInvalidMasterPassword
	}
	sess.sk = sk
	sess.params = params
	sess.pubKey = str(keys["public_key_b64"])

	if !sess.Offline {
		me, err := c.GetJSON("/api/me")
		if err == nil {
			sess.Me = me
			sess.TenantSlug = str(me["tenant_slug"])
			sess.Username = str(me["username"])
		}
		stored, _ := keys["kdf_params_stored"].(bool)
		if !stored {
			_, _ = c.PostJSON("/api/vault/kdf-params", map[string]any{"argon2": params})
		}
	} else {
		sess.TenantSlug = cached.TenantSlug
		sess.Username = cached.Username
		sess.Me = map[string]any{
			"tenant_id":   cached.TenantID,
			"tenant_slug": cached.TenantSlug,
			"user_id":     cached.UserID,
			"username":    cached.Username,
		}
	}
	return sess, nil
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// Lock wipes the in-memory private key. The session object must not be
// used afterwards for decryption.
func (s *Session) Lock() {
	if s == nil {
		return
	}
	zero(s.sk)
	s.sk = nil
}

// SecretListItem is a UI-friendly, already-decrypted (title) row.
type SecretListItem struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	HasAccess    bool     `json:"has_access"`
	Visibility   string   `json:"visibility"`
	Favorite     bool     `json:"favorite"`
	Tags         []string `json:"tags"`
	Owner        string   `json:"owner"`
	IsOwner      bool     `json:"is_owner"`
	SharedUsers  []string `json:"shared_users"`
	SharedGroups []string `json:"shared_groups"`
}

func stringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// FetchAllSecrets pages through GET /api/secrets.
func (c *Client) FetchAllSecrets() ([]map[string]any, error) {
	const pageSize = 200
	var all []map[string]any
	for offset := 0; ; offset += pageSize {
		raw, err := c.GetRaw(fmt.Sprintf("/api/secrets?limit=%d&offset=%d", pageSize, offset))
		if err != nil {
			return nil, err
		}
		var page struct {
			Items []map[string]any `json:"items"`
			Total int              `json:"total"`
		}
		if err := json.Unmarshal(raw, &page); err == nil && page.Items != nil {
			all = append(all, page.Items...)
			if len(all) >= page.Total || len(page.Items) == 0 {
				return all, nil
			}
			continue
		}
		var legacy []map[string]any
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return nil, err
		}
		return legacy, nil
	}
}

func (s *Session) decryptTitle(item map[string]any) (string, error) {
	env, _ := item["envelope"].(map[string]any)
	if env == nil {
		return "", errors.New("kein Envelope")
	}
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, s.sk)
	if err != nil {
		return "", err
	}
	defer zero(dk)
	kv := uint32(numberOr(item["key_version"], 1))
	titlePT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(item["title_nonce_b64"])), Ciphertext: mustB64(str(item["title_ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return "", err
	}
	return string(titlePT), nil
}

func numberOr(v any, def float64) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return def
}

// ListSecrets returns decrypted-title rows, sorted A-Z, including tags and
// favorite/sharing metadata (own vs. shared with me). When online it also
// refreshes the on-disk offline snapshot (best-effort).
func (s *Session) ListSecrets() ([]SecretListItem, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	items, err := s.Client.FetchAllSecrets()
	if err != nil {
		return nil, err
	}
	meID := str(s.Me["user_id"])
	out := make([]SecretListItem, len(items))
	for i, it := range items {
		li := SecretListItem{
			ID:           str(it["id"]),
			HasAccess:    it["has_access"] == true,
			Visibility:   str(it["visibility"]),
			Owner:        str(it["created_by_username"]),
			IsOwner:      str(it["created_by"]) == meID && meID != "",
			SharedUsers:  stringSlice(it["shared_users"]),
			SharedGroups: stringSlice(it["shared_groups"]),
		}
		if li.Visibility == "" {
			li.Visibility = "private"
		}
		if li.HasAccess {
			if t, err := s.decryptTitle(it); err == nil {
				li.Title = t
			} else {
				li.Title = li.ID
			}
		} else {
			li.Title = "(kein Zugriff)"
		}
		out[i] = li
	}
	// Enrich tags/favorite from each accessible secret's encrypted body, with
	// bounded concurrency (mirrors the web app's enrichSecretMeta pool).
	s.enrichListMeta(out)
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out, nil
}

// enrichListMeta fills in Tags/Favorite for accessible items by fetching and
// decrypting each secret's full body, using a small worker pool.
func (s *Session) enrichListMeta(items []SecretListItem) {
	const workers = 4
	jobs := make(chan int, len(items))
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				if !items[idx].HasAccess {
					continue
				}
				det, err := s.GetSecret(items[idx].ID)
				if err != nil {
					continue
				}
				items[idx].Tags = det.Tags
				items[idx].Favorite = det.Favorite
			}
		}()
	}
	for i := range items {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
}

// SecretDetail is the fully decrypted secret shown in the UI.
type SecretDetail struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	KeyVersion   uint32         `json:"key_version"`
	Body         map[string]any `json:"body"`
	TOTPCode     string         `json:"totp_code,omitempty"`
	TOTPSecs     int            `json:"totp_seconds_left,omitempty"`
	Visibility   string         `json:"visibility"`
	Favorite     bool           `json:"favorite"`
	Tags         []string       `json:"tags"`
	Owner        string         `json:"owner"`
	IsOwner      bool           `json:"is_owner"`
	SharedUsers  []string       `json:"shared_users"`
	SharedGroups []string       `json:"shared_groups"`
}

// GetSecret fetches and fully decrypts one secret (title + body payload).
func (s *Session) GetSecret(id string) (*SecretDetail, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	det, err := s.Client.GetJSON("/api/secrets/" + pathEscape(id))
	if err != nil {
		return nil, err
	}
	return s.decryptDetail(det)
}

func (s *Session) decryptDetail(det map[string]any) (*SecretDetail, error) {
	env, _ := det["envelope"].(map[string]any)
	if env == nil {
		return nil, errors.New("kein Envelope (kein Zugriff)")
	}
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, s.sk)
	if err != nil {
		return nil, err
	}
	defer zero(dk)
	kv := uint32(numberOr(det["key_version"], 1))
	titlePT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(det["title_nonce_b64"])), Ciphertext: mustB64(str(det["title_ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return nil, err
	}
	bodyPT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(det["nonce_b64"])), Ciphertext: mustB64(str(det["ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(bodyPT, &body); err != nil {
		body = map[string]any{"raw": string(bodyPT)}
	}
	meID := str(s.Me["user_id"])
	out := &SecretDetail{
		ID:           str(det["id"]),
		Title:        string(titlePT),
		KeyVersion:   kv,
		Body:         body,
		Visibility:   str(det["visibility"]),
		Favorite:     body["favorite"] == true,
		Tags:         stringSlice(body["tags"]),
		Owner:        str(det["created_by_username"]),
		IsOwner:      str(det["created_by"]) == meID && meID != "",
		SharedUsers:  stringSlice(det["shared_users"]),
		SharedGroups: stringSlice(det["shared_groups"]),
	}
	if seed, ok := body["totp_seed"].(string); ok && strings.TrimSpace(seed) != "" {
		if code, err := totp.GenerateCode(strings.TrimSpace(seed), time.Now().UTC()); err == nil {
			out.TOTPCode = code
			out.TOTPSecs = 30 - int(time.Now().UTC().Unix()%30)
		}
	}
	return out, nil
}

// SecretInput is the editable, plaintext form model for create/update
// (own-key secrets only; sharing continues to be managed in the Web-UI).
type SecretInput struct {
	Title    string              `json:"title"`
	Username string              `json:"username"`
	Password string              `json:"password"`
	URLs     []string            `json:"urls"`
	Notes    string              `json:"notes"`
	TOTPSeed string              `json:"totp_seed"`
	Tags     []string            `json:"tags"`
	Favorite bool                `json:"favorite"`
	Extra    []map[string]string `json:"extra"`
}

func buildBody(in SecretInput) map[string]any {
	urls := in.URLs
	if urls == nil {
		urls = []string{}
	}
	tags := in.Tags
	if tags == nil {
		tags = []string{}
	}
	extra := in.Extra
	if extra == nil {
		extra = []map[string]string{}
	}
	return map[string]any{
		"username":  in.Username,
		"password":  in.Password,
		"urls":      urls,
		"notes":     in.Notes,
		"totp_seed": in.TOTPSeed,
		"tags":      tags,
		"favorite":  in.Favorite,
		"extra":     extra,
	}
}

// CreateSecret creates a new private, own-key-only secret.
func (s *Session) CreateSecret(in SecretInput) (string, error) {
	if s.sk == nil {
		return "", errors.New("gesperrt")
	}
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		return "", err
	}
	defer zero(dk)
	const kv uint32 = 1
	titleCT, err := cryptocore.EncryptPayload([]byte(in.Title), dk, kv)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(buildBody(in))
	if err != nil {
		return "", err
	}
	bodyCT, err := cryptocore.EncryptPayload(payload, dk, kv)
	if err != nil {
		return "", err
	}
	pub := mustB64(s.pubKey)
	if pub == nil {
		me, err := s.Client.GetJSON("/api/me")
		if err != nil {
			return "", err
		}
		keys, err := s.Client.GetJSON("/api/vault/keys")
		if err != nil {
			return "", err
		}
		s.pubKey = str(keys["public_key_b64"])
		pub = mustB64(s.pubKey)
		s.Me = me
	}
	env, err := cryptocore.SealDataKeyForRecipient(dk, pub, kv)
	if err != nil {
		return "", err
	}
	meID := str(s.Me["user_id"])
	body := map[string]any{
		"title_ciphertext_b64": b64(titleCT.Ciphertext),
		"title_nonce_b64":      b64(titleCT.Nonce),
		"ciphertext_b64":       b64(bodyCT.Ciphertext),
		"nonce_b64":            b64(bodyCT.Nonce),
		"key_version":          kv,
		"visibility":           "private",
		"envelopes": []map[string]any{
			{
				"user_id":           meID,
				"key_version":       kv,
				"ephemeral_pub_b64": b64(env.EphemeralPub),
				"nonce_b64":         b64(env.Nonce),
				"wrapped_dk_b64":    b64(env.Ciphertext),
			},
		},
	}
	resp, err := s.Client.PostJSON("/api/secrets", body)
	if err != nil {
		return "", err
	}
	return str(resp["id"]), nil
}

// UpdateSecret re-encrypts title+body of an existing (own-key) secret in
// place, keeping the existing key_version and envelopes untouched.
func (s *Session) UpdateSecret(id string, in SecretInput) error {
	if s.sk == nil {
		return errors.New("gesperrt")
	}
	det, err := s.Client.GetJSON("/api/secrets/" + pathEscape(id))
	if err != nil {
		return err
	}
	env, _ := det["envelope"].(map[string]any)
	if env == nil {
		return errors.New("kein Envelope (kein Schreibzugriff)")
	}
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, s.sk)
	if err != nil {
		return err
	}
	defer zero(dk)
	kv := uint32(numberOr(det["key_version"], 1))
	titleCT, err := cryptocore.EncryptPayload([]byte(in.Title), dk, kv)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(buildBody(in))
	if err != nil {
		return err
	}
	bodyCT, err := cryptocore.EncryptPayload(payload, dk, kv)
	if err != nil {
		return err
	}
	_, err = s.Client.PutJSON("/api/secrets/"+pathEscape(id), map[string]any{
		"title_ciphertext_b64": b64(titleCT.Ciphertext),
		"title_nonce_b64":      b64(titleCT.Nonce),
		"ciphertext_b64":       b64(bodyCT.Ciphertext),
		"nonce_b64":            b64(bodyCT.Nonce),
		"key_version":          kv,
	})
	return err
}

// DeleteSecret removes an owned secret.
func (s *Session) DeleteSecret(id string) error {
	return s.Client.Delete("/api/secrets/" + pathEscape(id))
}

// SyncOfflineSnapshot re-downloads and decrypts nothing (ciphertext only)
// but fetches every accessible secret's detail so the local cache is
// complete, then persists it. Best-effort; caller may ignore errors.
func (s *Session) SyncOfflineSnapshot() error {
	if s.Offline {
		return errors.New("bereits offline: kein Sync möglich")
	}
	keys, err := s.Client.GetJSON("/api/vault/keys")
	if err != nil {
		return err
	}
	items, err := s.Client.FetchAllSecrets()
	if err != nil {
		return err
	}
	secrets := make([]OfflineSecret, 0, len(items))
	for _, it := range items {
		if it["has_access"] != true {
			continue
		}
		id := str(it["id"])
		det, err := s.Client.GetJSON("/api/secrets/" + pathEscape(id))
		if err != nil {
			continue
		}
		env, _ := det["envelope"].(map[string]any)
		secrets = append(secrets, OfflineSecret{
			ID:                 id,
			TitleCiphertextB64: str(det["title_ciphertext_b64"]),
			TitleNonceB64:      str(det["title_nonce_b64"]),
			CiphertextB64:      str(det["ciphertext_b64"]),
			NonceB64:           str(det["nonce_b64"]),
			KeyVersion:         uint32(numberOr(det["key_version"], 1)),
			Envelope:           env,
			Visibility:         str(det["visibility"]),
			HasAccess:          true,
			CreatedBy:          str(det["created_by"]),
			CreatedByUsername:  str(det["created_by_username"]),
			SharedUsers:        stringSlice(det["shared_users"]),
			SharedGroups:       stringSlice(det["shared_groups"]),
		})
	}
	var params cryptocore.Argon2Params
	if raw, ok := keys["argon2"]; ok {
		b, _ := json.Marshal(raw)
		_ = json.Unmarshal(b, &params)
	}
	paramsMap := map[string]any{"time": params.Time, "memory": params.Memory, "threads": params.Threads, "key_len": params.KeyLen}
	snap := OfflineSnapshot{
		Version:    1,
		TenantID:   str(s.Me["tenant_id"]),
		TenantSlug: s.TenantSlug,
		UserID:     str(s.Me["user_id"]),
		Username:   s.Username,
		SyncedAt:   time.Now().UTC(),
		Keys: OfflineKeys{
			SaltB64:                     str(keys["salt_b64"]),
			EncryptedPrivateKeyNonceB64: str(keys["encrypted_private_key_nonce_b64"]),
			EncryptedPrivateKeyB64:      str(keys["encrypted_private_key_b64"]),
			PublicKeyB64:                str(keys["public_key_b64"]),
		},
		CryptoParams: paramsMap,
		Secrets:      secrets,
	}
	return SaveOfflineSnapshot(snap)
}

// ListSecretsOffline decrypts titles and tags/favorite straight from the
// local snapshot (no network needed — the body ciphertext is cached too).
func (s *Session) ListSecretsOffline(snap OfflineSnapshot) ([]SecretListItem, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	meID := str(s.Me["user_id"])
	out := make([]SecretListItem, 0, len(snap.Secrets))
	for _, it := range snap.Secrets {
		item := map[string]any{
			"envelope":             it.Envelope,
			"key_version":          float64(it.KeyVersion),
			"title_nonce_b64":      it.TitleNonceB64,
			"title_ciphertext_b64": it.TitleCiphertextB64,
		}
		li := SecretListItem{
			ID: it.ID, HasAccess: true, Visibility: it.Visibility,
			Owner: it.CreatedByUsername, IsOwner: it.CreatedBy == meID && meID != "",
			SharedUsers: it.SharedUsers, SharedGroups: it.SharedGroups,
		}
		if li.Visibility == "" {
			li.Visibility = "private"
		}
		if t, err := s.decryptTitle(item); err == nil {
			li.Title = t
		} else {
			li.Title = li.ID
		}
		if det, err := s.decryptDetail(offlineSecretToDetailMap(it)); err == nil {
			li.Tags = det.Tags
			li.Favorite = det.Favorite
		}
		out = append(out, li)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title) })
	return out, nil
}

// offlineSecretToDetailMap rebuilds the map[string]any shape decryptDetail
// expects from a cached OfflineSecret.
func offlineSecretToDetailMap(it OfflineSecret) map[string]any {
	return map[string]any{
		"id":                   it.ID,
		"envelope":             it.Envelope,
		"key_version":          float64(it.KeyVersion),
		"title_nonce_b64":      it.TitleNonceB64,
		"title_ciphertext_b64": it.TitleCiphertextB64,
		"nonce_b64":            it.NonceB64,
		"ciphertext_b64":       it.CiphertextB64,
		"visibility":           it.Visibility,
		"created_by":           it.CreatedBy,
		"created_by_username":  it.CreatedByUsername,
		"shared_users":         toAnySlice(it.SharedUsers),
		"shared_groups":        toAnySlice(it.SharedGroups),
	}
}

func toAnySlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// GetSecretOffline decrypts one cached secret by ID.
func (s *Session) GetSecretOffline(snap OfflineSnapshot, id string) (*SecretDetail, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	for _, it := range snap.Secrets {
		if it.ID != id {
			continue
		}
		return s.decryptDetail(offlineSecretToDetailMap(it))
	}
	return nil, errors.New("Secret nicht im Offline-Cache")
}

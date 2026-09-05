package backend

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/teamvault/teamvault/internal/cryptocore"
)

// PublicKeyInfo mirrors one row of GET /api/users/public-keys.
type PublicKeyInfo struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	PublicKeyB64 string `json:"public_key_b64"`
	Fingerprint  string `json:"fingerprint"`
}

// ListPublicKeys returns onboarded users' public keys (for picking a share
// recipient); it never returns private-key material.
func (s *Session) ListPublicKeys() ([]PublicKeyInfo, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	raw, err := s.Client.GetRaw("/api/users/public-keys")
	if err != nil {
		return nil, err
	}
	return decodePublicKeyList(raw)
}

// NamedRef is a user/group reference with an optional capability, as
// returned by GET /api/secrets/{id}/access.
type NamedRef struct {
	ID         string `json:"id"`
	Username   string `json:"username,omitempty"`
	Name       string `json:"name,omitempty"`
	Capability string `json:"capability,omitempty"`
}

// SecretAccess is the full sharing state of one secret: who owns it, who
// it is already shared with, and who/what it could still be shared with.
type SecretAccess struct {
	Owner           NamedRef   `json:"owner"`
	Visibility      string     `json:"visibility"`
	MyCapability    string     `json:"my_capability"`
	SharedUsers     []NamedRef `json:"shared_users"`
	SharedGroups    []NamedRef `json:"shared_groups"`
	AvailableUsers  []NamedRef `json:"available_users"`
	AvailableGroups []NamedRef `json:"available_groups"`
}

// GetSecretAccess fetches the sharing state of a secret (owner, direct/group
// shares, and candidates still available to share with).
func (s *Session) GetSecretAccess(id string) (*SecretAccess, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	det, err := s.Client.GetJSON("/api/secrets/" + pathEscape(id) + "/access")
	if err != nil {
		return nil, err
	}
	access := &SecretAccess{
		Visibility:   str(det["visibility"]),
		MyCapability: str(det["my_capability"]),
	}
	if owner, ok := det["owner"].(map[string]any); ok {
		access.Owner = namedRefFrom(owner)
	}
	access.SharedUsers = namedRefsFrom(det["shared_users"])
	access.SharedGroups = namedRefsFrom(det["shared_groups"])
	access.AvailableUsers = namedRefsFrom(det["available_users"])
	access.AvailableGroups = namedRefsFrom(det["available_groups"])
	return access, nil
}

func namedRefFrom(m map[string]any) NamedRef {
	return NamedRef{ID: str(m["id"]), Username: str(m["username"]), Name: str(m["name"]), Capability: str(m["capability"])}
}

func namedRefsFrom(v any) []NamedRef {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]NamedRef, 0, len(arr))
	for _, e := range arr {
		if m, ok := e.(map[string]any); ok {
			out = append(out, namedRefFrom(m))
		}
	}
	return out
}

// myEnvelopeAndDK fetches the secret's current key_version and this user's
// own key envelope, then unwraps the data key so it can be re-sealed for a
// new recipient. Callers must zero the returned key when done.
func (s *Session) myEnvelopeAndDK(id string) (dk []byte, kv uint32, err error) {
	det, err := s.Client.GetJSON("/api/secrets/" + pathEscape(id))
	if err != nil {
		return nil, 0, err
	}
	env, _ := det["envelope"].(map[string]any)
	if env == nil {
		return nil, 0, errors.New("kein Envelope (kein Zugriff)")
	}
	dk, err = cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, s.sk)
	if err != nil {
		return nil, 0, err
	}
	kv = uint32(numberOr(det["key_version"], 1))
	return dk, kv, nil
}

func sealedEnvelopeBody(userID string, env cryptocore.Envelope, kv uint32) map[string]any {
	return map[string]any{
		"user_id":           userID,
		"key_version":       kv,
		"ephemeral_pub_b64": b64(env.EphemeralPub),
		"nonce_b64":         b64(env.Nonce),
		"wrapped_dk_b64":    b64(env.Ciphertext),
	}
}

// ShareSecretWithUser grants a user access to an already-decryptable secret
// by sealing its data key for their public key, with the given capability
// (read|write|share|admin).
func (s *Session) ShareSecretWithUser(id, userID, capability string) error {
	if s.sk == nil {
		return errors.New("gesperrt")
	}
	pks, err := s.ListPublicKeys()
	if err != nil {
		return err
	}
	var pub string
	for _, pk := range pks {
		if pk.UserID == userID {
			pub = pk.PublicKeyB64
			break
		}
	}
	if pub == "" {
		return fmt.Errorf("kein öffentlicher Schlüssel für Nutzer %s", userID)
	}
	dk, kv, err := s.myEnvelopeAndDK(id)
	if err != nil {
		return err
	}
	defer zero(dk)
	env, err := cryptocore.SealDataKeyForRecipient(dk, mustB64(pub), kv)
	if err != nil {
		return err
	}
	_, err = s.Client.PostJSON("/api/secrets/"+pathEscape(id)+"/share", map[string]any{
		"envelopes":  []map[string]any{sealedEnvelopeBody(userID, env, kv)},
		"capability": capability,
	})
	return err
}

// ShareSecretWithGroup grants every current, onboarded member of a group
// access to a secret. Members who join later are caught up separately via
// ListGroupShareGaps/FixGroupShareGap.
func (s *Session) ShareSecretWithGroup(id, groupID, capability string) error {
	if s.sk == nil {
		return errors.New("gesperrt")
	}
	raw, err := s.Client.GetRaw("/api/groups/" + pathEscape(groupID) + "/member-keys")
	if err != nil {
		return err
	}
	members, err := decodePublicKeyList(raw)
	if err != nil {
		return err
	}
	dk, kv, err := s.myEnvelopeAndDK(id)
	if err != nil {
		return err
	}
	defer zero(dk)
	envelopes := make([]map[string]any, 0, len(members))
	for _, m := range members {
		env, err := cryptocore.SealDataKeyForRecipient(dk, mustB64(m.PublicKeyB64), kv)
		if err != nil {
			continue
		}
		envelopes = append(envelopes, sealedEnvelopeBody(m.UserID, env, kv))
	}
	_, err = s.Client.PostJSON("/api/secrets/"+pathEscape(id)+"/share-group", map[string]any{
		"group_id":   groupID,
		"envelopes":  envelopes,
		"capability": capability,
	})
	return err
}

// MyGroup is one row of GET /api/groups (groups the current user belongs to
// or, for admins, all tenant groups).
type MyGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ListMyGroups returns groups available for sharing.
func (s *Session) ListMyGroups() ([]MyGroup, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	raw, err := s.Client.GetRaw("/api/groups")
	if err != nil {
		return nil, err
	}
	var groups []MyGroup
	if err := json.Unmarshal(raw, &groups); err != nil {
		return nil, err
	}
	return groups, nil
}

// GroupShareGap describes one group member still missing an envelope for a
// secret shared with their group (e.g. because they joined after the
// group-share happened). The server never sees plaintext data keys: it
// hands back the caller's own envelope so the client can unwrap and reseal
// it for the missing member, zero-knowledge end to end.
type GroupShareGap struct {
	SecretID     string         `json:"secret_id"`
	GroupID      string         `json:"group_id"`
	UserID       string         `json:"user_id"`
	Username     string         `json:"username"`
	PublicKeyB64 string         `json:"public_key_b64"`
	Fingerprint  string         `json:"fingerprint"`
	KeyVersion   uint32         `json:"key_version"`
	Envelope     map[string]any `json:"envelope"`
}

// ListGroupShareGaps lists members who still lack an envelope for secrets
// shared with one of their groups.
func (s *Session) ListGroupShareGaps() ([]GroupShareGap, error) {
	if s.sk == nil {
		return nil, errors.New("gesperrt")
	}
	det, err := s.Client.GetJSON("/api/secrets/group-share-gaps")
	if err != nil {
		return nil, err
	}
	raw, ok := det["items"].([]any)
	if !ok {
		return nil, nil
	}
	out := make([]GroupShareGap, 0, len(raw))
	for _, e := range raw {
		m, ok := e.(map[string]any)
		if !ok {
			continue
		}
		env, _ := m["envelope"].(map[string]any)
		out = append(out, GroupShareGap{
			SecretID: str(m["secret_id"]), GroupID: str(m["group_id"]), UserID: str(m["user_id"]),
			Username: str(m["username"]), PublicKeyB64: str(m["public_key_b64"]), Fingerprint: str(m["fingerprint"]),
			KeyVersion: uint32(numberOr(m["key_version"], 1)), Envelope: env,
		})
	}
	return out, nil
}

// FixGroupShareGap seals a fresh envelope for the missing member described
// by gap, reusing the caller's own existing envelope to recover the data
// key (never touching plaintext or the server).
func (s *Session) FixGroupShareGap(gap GroupShareGap) error {
	if s.sk == nil {
		return errors.New("gesperrt")
	}
	if gap.Envelope == nil {
		return errors.New("kein Envelope für dieses Secret")
	}
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(gap.Envelope["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(gap.Envelope["nonce_b64"])),
		Ciphertext:   mustB64(str(gap.Envelope["wrapped_dk_b64"])),
	}, s.sk)
	if err != nil {
		return err
	}
	defer zero(dk)
	env, err := cryptocore.SealDataKeyForRecipient(dk, mustB64(gap.PublicKeyB64), gap.KeyVersion)
	if err != nil {
		return err
	}
	_, err = s.Client.PostJSON("/api/secrets/"+pathEscape(gap.SecretID)+"/share-group", map[string]any{
		"group_id":  gap.GroupID,
		"envelopes": []map[string]any{sealedEnvelopeBody(gap.UserID, env, gap.KeyVersion)},
	})
	return err
}

func decodePublicKeyList(raw []byte) ([]PublicKeyInfo, error) {
	var out []PublicKeyInfo
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// UnshareSecret revokes access for the given users/groups by rotating the
// secret to a new key version and re-sealing its data key only for the
// remaining recipients (owner + caller + everyone else still entitled),
// exactly like the web app's "remove access" flow. The server never learns
// the plaintext or the data key.
func (s *Session) UnshareSecret(id string, dropUserIDs, dropGroupIDs []string) error {
	if s.sk == nil {
		return errors.New("gesperrt")
	}
	if len(dropUserIDs) == 0 && len(dropGroupIDs) == 0 {
		return nil
	}
	dropUsers := map[string]bool{}
	for _, u := range dropUserIDs {
		dropUsers[u] = true
	}
	dropGroups := map[string]bool{}
	for _, g := range dropGroupIDs {
		dropGroups[g] = true
	}

	access, err := s.GetSecretAccess(id)
	if err != nil {
		return err
	}
	meID := str(s.Me["user_id"])
	keepUsers := map[string]bool{meID: true}
	if access.Owner.ID != "" {
		keepUsers[access.Owner.ID] = true
	}
	for _, u := range access.SharedUsers {
		if !dropUsers[u.ID] {
			keepUsers[u.ID] = true
		}
	}
	for _, g := range access.SharedGroups {
		if dropGroups[g.ID] {
			continue
		}
		raw, err := s.Client.GetRaw("/api/groups/" + pathEscape(g.ID) + "/member-keys")
		if err != nil {
			continue
		}
		members, err := decodePublicKeyList(raw)
		if err != nil {
			continue
		}
		for _, m := range members {
			keepUsers[m.UserID] = true
		}
	}

	det, err := s.Client.GetJSON("/api/secrets/" + pathEscape(id))
	if err != nil {
		return err
	}
	full, err := s.decryptDetail(det)
	if err != nil {
		return err
	}
	oldKV := full.KeyVersion
	newKV := oldKV + 1

	newDK, err := cryptocore.GenerateDataKey()
	if err != nil {
		return err
	}
	defer zero(newDK)
	titleCT, err := cryptocore.EncryptPayload([]byte(full.Title), newDK, newKV)
	if err != nil {
		return err
	}
	bodyPT, err := json.Marshal(full.Body)
	if err != nil {
		return err
	}
	bodyCT, err := cryptocore.EncryptPayload(bodyPT, newDK, newKV)
	if err != nil {
		return err
	}

	pks, err := s.ListPublicKeys()
	if err != nil {
		return err
	}
	pubByID := make(map[string]string, len(pks))
	for _, pk := range pks {
		pubByID[pk.UserID] = pk.PublicKeyB64
	}
	envelopes := make([]map[string]any, 0, len(keepUsers))
	for uid := range keepUsers {
		pub := pubByID[uid]
		if pub == "" {
			continue
		}
		env, err := cryptocore.SealDataKeyForRecipient(newDK, mustB64(pub), newKV)
		if err != nil {
			return err
		}
		envelopes = append(envelopes, sealedEnvelopeBody(uid, env, newKV))
	}

	_, err = s.Client.PostJSON("/api/secrets/"+pathEscape(id)+"/rotate", map[string]any{
		"title_ciphertext_b64": b64(titleCT.Ciphertext),
		"title_nonce_b64":      b64(titleCT.Nonce),
		"ciphertext_b64":       b64(bodyCT.Ciphertext),
		"nonce_b64":            b64(bodyCT.Nonce),
		"key_version":          newKV,
		"envelopes":            envelopes,
		"drop_user_ids":        dropUserIDs,
		"drop_group_ids":       dropGroupIDs,
	})
	return err
}

// Package passkey implements WebAuthn/Passkeys for LOGIN ONLY (OQ-04 / OQ-20).
//
// Security: Passkeys never unlock the vault. Master-password material is never
// stored behind a passkey (Zero-Knowledge Prinzip 1).
package passkey

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/teamvault/teamvault/internal/store"
)

type User struct {
	Record      store.UserRecord
	Credentials []webauthn.Credential
}

func (u *User) WebAuthnID() []byte   { return []byte(u.Record.ID) }
func (u *User) WebAuthnName() string { return u.Record.Username }
func (u *User) WebAuthnDisplayName() string {
	if u.Record.DisplayName != "" {
		return u.Record.DisplayName
	}
	return u.Record.Username
}
func (u *User) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }

func ToWebAuthnCreds(list []store.WebAuthnCredential) []webauthn.Credential {
	out := make([]webauthn.Credential, 0, len(list))
	for _, c := range list {
		var transports []protocol.AuthenticatorTransport
		_ = json.Unmarshal([]byte(c.Transport), &transports)
		out = append(out, webauthn.Credential{
			ID:              c.CredentialID,
			PublicKey:       c.PublicKey,
			AttestationType: c.Attestation,
			Transport:       transports,
			Flags: webauthn.CredentialFlags{
				UserPresent: true, UserVerified: true, BackupEligible: true, BackupState: true,
			},
			Authenticator: webauthn.Authenticator{
				AAGUID:    c.AAGUID,
				SignCount: c.SignCount,
			},
		})
	}
	return out
}

func FromWebAuthnCred(tenant store.TenantID, user store.UserID, id, name string, cred *webauthn.Credential) store.WebAuthnCredential {
	tr, _ := json.Marshal(cred.Transport)
	return store.WebAuthnCredential{
		ID: id, TenantID: tenant, UserID: user,
		CredentialID: cred.ID, PublicKey: cred.PublicKey,
		Attestation: cred.AttestationType, Transport: string(tr),
		SignCount: cred.Authenticator.SignCount, Name: name,
		AAGUID: cred.Authenticator.AAGUID, CreatedAt: time.Now().UTC(),
	}
}

type challengeStore struct {
	mu   sync.Mutex
	data map[string]challenge
}

type challenge struct {
	session webauthn.SessionData
	expires time.Time
}

func newChallengeStore() *challengeStore {
	return &challengeStore{data: map[string]challenge{}}
}

func (s *challengeStore) put(key string, sess webauthn.SessionData) {
	s.mu.Lock()
	now := time.Now()
	for k, v := range s.data {
		if !now.Before(v.expires) {
			delete(s.data, k)
		}
	}
	s.data[key] = challenge{session: sess, expires: now.Add(5 * time.Minute)}
	s.mu.Unlock()
}

func (s *challengeStore) take(key string) (webauthn.SessionData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data[key]
	if ok && !time.Now().Before(v.expires) {
		delete(s.data, key)
		return webauthn.SessionData{}, false
	}
	if ok {
		delete(s.data, key)
	}
	return v.session, ok
}

// Manager wraps go-webauthn with in-memory ceremony sessions.
type Manager struct {
	challenges *challengeStore
}

func NewManager() *Manager {
	return &Manager{challenges: newChallengeStore()}
}

func (m *Manager) webauthn(rpID string, origins []string) (*webauthn.WebAuthn, error) {
	if rpID == "" {
		return nil, fmt.Errorf("rp_id required")
	}
	if len(origins) == 0 {
		return nil, fmt.Errorf("origins required")
	}
	return webauthn.New(&webauthn.Config{
		RPDisplayName: "TeamVault",
		RPID:          rpID,
		RPOrigins:     origins,
	})
}

func (m *Manager) BeginRegistration(rpID string, origins []string, user *User) (*protocol.CredentialCreation, string, error) {
	wa, err := m.webauthn(rpID, origins)
	if err != nil {
		return nil, "", err
	}
	creation, sess, err := wa.BeginRegistration(user)
	if err != nil {
		return nil, "", err
	}
	key := "reg:" + string(user.Record.ID) + ":" + string(sess.Challenge)
	m.challenges.put(key, *sess)
	return creation, key, nil
}

func (m *Manager) FinishRegistration(rpID string, origins []string, user *User, challengeKey string, body []byte) (*webauthn.Credential, error) {
	wa, err := m.webauthn(rpID, origins)
	if err != nil {
		return nil, err
	}
	sess, ok := m.challenges.take(challengeKey)
	if !ok {
		return nil, fmt.Errorf("registration session expired")
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body)
	if err != nil {
		return nil, err
	}
	return wa.CreateCredential(user, sess, parsed)
}

func (m *Manager) BeginLogin(rpID string, origins []string, user *User) (*protocol.CredentialAssertion, string, error) {
	wa, err := m.webauthn(rpID, origins)
	if err != nil {
		return nil, "", err
	}
	if len(user.Credentials) == 0 {
		return nil, "", fmt.Errorf("no passkeys registered")
	}
	assertion, sess, err := wa.BeginLogin(user)
	if err != nil {
		return nil, "", err
	}
	key := "login:" + string(user.Record.ID) + ":" + string(sess.Challenge)
	m.challenges.put(key, *sess)
	return assertion, key, nil
}

func (m *Manager) FinishLogin(rpID string, origins []string, user *User, challengeKey string, body []byte) (*webauthn.Credential, error) {
	wa, err := m.webauthn(rpID, origins)
	if err != nil {
		return nil, err
	}
	sess, ok := m.challenges.take(challengeKey)
	if !ok {
		return nil, fmt.Errorf("login session expired")
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body)
	if err != nil {
		return nil, err
	}
	return wa.ValidateLogin(user, sess, parsed)
}

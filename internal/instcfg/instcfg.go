package instcfg

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/teamvault/teamvault/internal/auth/ldapauth"
	"github.com/teamvault/teamvault/internal/configstore"
	"github.com/teamvault/teamvault/internal/cryptocore"
)

type MailConfig struct {
	Enabled  bool   `json:"enabled"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	UseTLS   bool   `json:"use_tls"`
}

type MailTemplates struct {
	InviteSubject   string `json:"invite_subject"`
	InviteBody      string `json:"invite_body"` // placeholders: {{username}} {{tenant}}
	DisabledSubject string `json:"disabled_subject"`
	DisabledBody    string `json:"disabled_body"`
}

type Policy struct {
	TOTPRequired            bool `json:"totp_required"`
	SessionHours            int  `json:"session_hours"`               // default 8 (OQ-17)
	UnlockIdleMinutes       int  `json:"unlock_idle_minutes"`         // default 15 (OQ-17)
	EscrowShamirK           int  `json:"escrow_shamir_k"`             // default 3
	EscrowShamirN           int  `json:"escrow_shamir_n"`             // default 5
	LDAPSyncHours           int  `json:"ldap_sync_hours"`             // default 24; 0 = manual only
	AdminSecretsEnvelopeOnly bool `json:"admin_secrets_envelope_only"` // false = admins see all secret metadata in list (default)
}

// LDAPConnection is a per-tenant LDAP bind config (OQ-09).
type LDAPConnection struct {
	ID       string `json:"id"`
	TenantID string `json:"tenant_id"`
	Name     string `json:"name"`
	ldapauth.Config
}

type APIKeyRecord struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	HashHex   string     `json:"hash_hex"`
	Scopes    []string   `json:"scopes"`
	UserID    string     `json:"user_id"`
	TenantID  string     `json:"tenant_id"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	Revoked   bool       `json:"revoked"`
}

type Bundle struct {
	Argon2            cryptocore.Argon2Params `json:"argon2"`
	LDAP              ldapauth.Config         `json:"ldap"` // legacy single; used if LDAPConnections empty
	LDAPConnections   []LDAPConnection        `json:"ldap_connections"`
	Mail              MailConfig              `json:"mail"`
	MailTemplates     MailTemplates           `json:"mail_templates"`
	Policy            Policy                  `json:"policy"`
	APIKeys           []APIKeyRecord          `json:"api_keys"`
	PrimaryTenantID   string                  `json:"primary_tenant_id"`
	PrimaryTenantSlug string                  `json:"primary_tenant_slug"`
	LastLDAPSyncAt    *time.Time              `json:"last_ldap_sync_at,omitempty"`
}

func DefaultMailTemplates() MailTemplates {
	return MailTemplates{
		InviteSubject:   "TeamVault Einladung",
		InviteBody:      "Hallo {{username}},\n\ndu wurdest zu Tenant {{tenant}} eingeladen. Bitte melde dich an und schließe das Vault-Onboarding ab.\n",
		DisabledSubject: "TeamVault Konto deaktiviert",
		DisabledBody:    "Hallo {{username}},\n\ndein Konto in Tenant {{tenant}} wurde deaktiviert.\n",
	}
}

func Load(cfg *configstore.Data) Bundle {
	b := Bundle{
		Argon2: cryptocore.DefaultArgon2,
		Policy: Policy{SessionHours: 8, UnlockIdleMinutes: 15, EscrowShamirK: 3, EscrowShamirN: 5, LDAPSyncHours: 24},
		MailTemplates: DefaultMailTemplates(),
	}
	if cfg == nil || len(cfg.Extra) == 0 {
		return b
	}
	_ = json.Unmarshal(cfg.Extra, &b)
	if b.Policy.SessionHours <= 0 {
		b.Policy.SessionHours = 8
	}
	if b.Policy.UnlockIdleMinutes <= 0 {
		b.Policy.UnlockIdleMinutes = 15
	}
	if b.Policy.EscrowShamirK < 2 {
		b.Policy.EscrowShamirK = 3
	}
	if b.Policy.EscrowShamirN < b.Policy.EscrowShamirK {
		b.Policy.EscrowShamirN = 5
	}
	if b.Argon2.KeyLen == 0 {
		b.Argon2 = cryptocore.DefaultArgon2
	}
	if b.MailTemplates.InviteSubject == "" {
		b.MailTemplates = DefaultMailTemplates()
	}
	return b
}

func Save(cfg *configstore.Data, store *configstore.Store, b Bundle) error {
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	cfg.Extra = raw
	return store.Save(cfg)
}

func (b Bundle) LDAPForTenant(tenantID string) ldapauth.Config {
	for _, c := range b.LDAPConnections {
		if c.TenantID == tenantID && c.Enabled {
			return c.Config
		}
	}
	// Prefer any enabled connection for tenant (even if matching disabled skipped)
	for _, c := range b.LDAPConnections {
		if c.TenantID == tenantID {
			return c.Config
		}
	}
	return b.LDAP
}

func RedactLDAP(c ldapauth.Config) ldapauth.Config {
	out := c
	if out.BindPassword != "" {
		out.BindPassword = "***"
	}
	return out
}

func RedactLDAPConn(c LDAPConnection) LDAPConnection {
	out := c
	out.Config = RedactLDAP(c.Config)
	return out
}

func RedactMail(m MailConfig) MailConfig {
	out := m
	if out.Password != "" {
		out.Password = "***"
	}
	return out
}

func NewAPIKey(name string, scopes []string, userID, tenantID string) (plaintext string, rec APIKeyRecord, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", APIKeyRecord{}, err
	}
	plaintext = "tvk_" + hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(plaintext))
	rec = APIKeyRecord{
		ID: "apk_" + hex.EncodeToString(b[:8]),
		Name: name, HashHex: hex.EncodeToString(sum[:]), Scopes: scopes,
		UserID: userID, TenantID: tenantID,
		CreatedAt: time.Now().UTC(),
	}
	return plaintext, rec, nil
}

func HashAPIKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

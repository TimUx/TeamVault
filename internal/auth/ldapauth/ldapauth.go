package ldapauth

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"strings"

	ldap "github.com/go-ldap/ldap/v3"
	"github.com/teamvault/teamvault/internal/tlsutil"
)

// Config for optional LDAP bind authentication.
type Config struct {
	Enabled            bool   `json:"enabled"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	UseTLS             bool   `json:"use_tls"`
	InsecureSkipVerify bool   `json:"insecure_skip_verify"`
	// CACertPEM is filled from the instance trust store at dial time; not edited per LDAP form.
	CACertPEM    string `json:"ca_cert_pem,omitempty"`
	BindDN       string `json:"bind_dn"`
	BindPassword string `json:"bind_password"`
	BaseDN       string `json:"base_dn"`
	UserFilter   string `json:"user_filter"` // e.g. (uid=%s) or (sAMAccountName=%s)
}

// DirectoryUser is a directory entry suitable for admin pre-provisioning.
type DirectoryUser struct {
	Username    string `json:"username"`
	DN          string `json:"dn"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
}

// UserIDFromDN derives a stable local user id from an LDAP DN (matches JIT login).
func UserIDFromDN(dn string) string {
	return "usr_" + strings.ReplaceAll(base64.RawURLEncoding.EncodeToString([]byte(dn))[:12], "/", "_")
}

// Authenticate tries a user bind. Returns DN on success.
// Security: LDAP is login-only — never used for authorization (Prinzip 6).
func Authenticate(cfg Config, username, password string) (dn string, err error) {
	if !cfg.Enabled {
		return "", fmt.Errorf("ldap disabled")
	}
	if cfg.Host == "" || username == "" || password == "" {
		return "", fmt.Errorf("invalid ldap credentials")
	}
	conn, err := dial(cfg)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	userDN := username
	if cfg.BindDN != "" && cfg.BaseDN != "" {
		if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
			return "", fmt.Errorf("service bind: %w", err)
		}
		du, err := lookupUser(conn, cfg, username)
		if err != nil {
			return "", err
		}
		userDN = du.DN
	} else if !strings.Contains(username, "=") && cfg.BaseDN != "" {
		userDN = fmt.Sprintf("uid=%s,%s", ldap.EscapeDN(username), cfg.BaseDN)
	}

	if err := conn.Bind(userDN, password); err != nil {
		return "", fmt.Errorf("user bind failed")
	}
	return userDN, nil
}

// LookupUser resolves a login username via service bind + search.
func LookupUser(cfg Config, username string) (DirectoryUser, error) {
	if cfg.Host == "" || username == "" {
		return DirectoryUser{}, fmt.Errorf("invalid ldap config")
	}
	conn, err := dial(cfg)
	if err != nil {
		return DirectoryUser{}, err
	}
	defer conn.Close()
	if err := serviceBind(conn, cfg); err != nil {
		return DirectoryUser{}, err
	}
	if cfg.BaseDN == "" {
		return DirectoryUser{}, fmt.Errorf("base_dn required")
	}
	return lookupUser(conn, cfg, username)
}

// SearchUsers finds directory users by substring (admin browse/import).
func SearchUsers(cfg Config, query string, limit int) ([]DirectoryUser, error) {
	query = strings.TrimSpace(query)
	if len(query) < 2 {
		return nil, fmt.Errorf("query min 2 chars")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if cfg.Host == "" || cfg.BaseDN == "" {
		return nil, fmt.Errorf("ldap host and base_dn required")
	}
	conn, err := dial(cfg)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := serviceBind(conn, cfg); err != nil {
		return nil, err
	}
	q := ldap.EscapeFilter(query)
	filter := fmt.Sprintf("(|(uid=*%[1]s*)(cn=*%[1]s*)(sAMAccountName=*%[1]s*)(mail=*%[1]s*)(displayName=*%[1]s*))", q)
	sr, err := conn.Search(ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, limit, 0, false,
		filter, []string{"dn", "uid", "cn", "sAMAccountName", "mail", "displayName"}, nil,
	))
	if err != nil {
		return nil, err
	}
	out := make([]DirectoryUser, 0, len(sr.Entries))
	seen := make(map[string]struct{}, len(sr.Entries))
	for _, e := range sr.Entries {
		du := entryToDirectoryUser(e)
		if du.Username == "" {
			continue
		}
		key := strings.ToLower(du.Username)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, du)
	}
	return out, nil
}

// UserExists checks whether username resolves via service bind + search (OQ-11 sync).
// Does not perform user authentication.
func UserExists(cfg Config, username string) (bool, error) {
	_, err := LookupUser(cfg, username)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func serviceBind(conn *ldap.Conn, cfg Config) error {
	if cfg.BindDN == "" {
		return nil
	}
	return conn.Bind(cfg.BindDN, cfg.BindPassword)
}

func userFilter(cfg Config, username string) string {
	filter := cfg.UserFilter
	if filter == "" {
		filter = "(uid=%s)"
	}
	return fmt.Sprintf(filter, ldap.EscapeFilter(username))
}

func lookupUser(conn *ldap.Conn, cfg Config, username string) (DirectoryUser, error) {
	sr, err := conn.Search(ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 1, 0, false,
		userFilter(cfg, username), []string{"dn", "uid", "cn", "sAMAccountName", "mail", "displayName"}, nil,
	))
	if err != nil {
		return DirectoryUser{}, err
	}
	if len(sr.Entries) == 0 {
		return DirectoryUser{}, fmt.Errorf("user not found in directory")
	}
	return entryToDirectoryUser(sr.Entries[0]), nil
}

func entryToDirectoryUser(e *ldap.Entry) DirectoryUser {
	du := DirectoryUser{
		DN:          e.DN,
		DisplayName: firstAttr(e, "displayName", "cn"),
		Email:       firstAttr(e, "mail"),
	}
	du.Username = firstAttr(e, "sAMAccountName", "uid")
	if du.Username == "" {
		du.Username = usernameFromDN(e.DN)
	}
	if du.DisplayName == "" {
		du.DisplayName = du.Username
	}
	return du
}

func firstAttr(e *ldap.Entry, names ...string) string {
	for _, n := range names {
		if v := strings.TrimSpace(e.GetAttributeValue(n)); v != "" {
			return v
		}
	}
	return ""
}

func usernameFromDN(dn string) string {
	parts := strings.Split(dn, ",")
	if len(parts) == 0 {
		return ""
	}
	rdn := strings.TrimSpace(parts[0])
	if i := strings.IndexByte(rdn, '='); i >= 0 && i+1 < len(rdn) {
		return strings.TrimSpace(rdn[i+1:])
	}
	return ""
}

// TestServiceBind verifies LDAP connectivity with the service account only.
// Does not authenticate end-users (Prinzip 6: LDAP is login-bind only).
func TestServiceBind(cfg Config) error {
	if cfg.Host == "" {
		return fmt.Errorf("host required")
	}
	conn, err := dial(cfg)
	if err != nil {
		return err
	}
	defer conn.Close()
	if cfg.BindDN == "" {
		return nil
	}
	return conn.Bind(cfg.BindDN, cfg.BindPassword)
}

// ValidateTLS checks optional per-connection CA PEM. Prefer the instance trust store.
func ValidateTLS(cfg Config) error {
	return tlsutil.ValidatePEM(cfg.CACertPEM)
}

// TLSConfig builds the client TLS settings for LDAPS.
func TLSConfig(cfg Config) (*tls.Config, error) {
	return tlsutil.ClientConfig(cfg.Host, cfg.CACertPEM, cfg.InsecureSkipVerify)
}

func dial(cfg Config) (*ldap.Conn, error) {
	if cfg.Host == "" {
		return nil, fmt.Errorf("host required")
	}
	port := cfg.Port
	if port == 0 {
		if cfg.UseTLS {
			port = 636
		} else {
			port = 389
		}
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)
	if !cfg.UseTLS {
		return ldap.DialURL(fmt.Sprintf("ldap://%s", addr))
	}
	tlsCfg, err := TLSConfig(cfg)
	if err != nil {
		return nil, err
	}
	return ldap.DialTLS("tcp", addr, tlsCfg)
}

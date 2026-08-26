package ldapauth

import (
	"crypto/tls"
	"fmt"
	"strings"

	ldap "github.com/go-ldap/ldap/v3"
)

// Config for optional LDAP bind authentication.
type Config struct {
	Enabled      bool   `json:"enabled"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	UseTLS       bool   `json:"use_tls"`
	BindDN       string `json:"bind_dn"`
	BindPassword string `json:"bind_password"`
	BaseDN       string `json:"base_dn"`
	UserFilter   string `json:"user_filter"` // e.g. (uid=%s) or (sAMAccountName=%s)
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
	port := cfg.Port
	if port == 0 {
		if cfg.UseTLS {
			port = 636
		} else {
			port = 389
		}
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)
	var conn *ldap.Conn
	if cfg.UseTLS {
		conn, err = ldap.DialTLS("tcp", addr, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: cfg.Host})
	} else {
		conn, err = ldap.DialURL(fmt.Sprintf("ldap://%s", addr))
	}
	if err != nil {
		return "", err
	}
	defer conn.Close()

	userDN := username
	filter := cfg.UserFilter
	if filter == "" {
		filter = "(uid=%s)"
	}
	if cfg.BindDN != "" && cfg.BaseDN != "" {
		if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
			return "", fmt.Errorf("service bind: %w", err)
		}
		f := fmt.Sprintf(filter, ldap.EscapeFilter(username))
		sr, err := conn.Search(ldap.NewSearchRequest(
			cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 1, 0, false,
			f, []string{"dn"}, nil,
		))
		if err != nil {
			return "", err
		}
		if len(sr.Entries) == 0 {
			return "", fmt.Errorf("user not found in directory")
		}
		userDN = sr.Entries[0].DN
	} else if !strings.Contains(username, "=") && cfg.BaseDN != "" {
		userDN = fmt.Sprintf("uid=%s,%s", username, cfg.BaseDN)
	}

	if err := conn.Bind(userDN, password); err != nil {
		return "", fmt.Errorf("user bind failed")
	}
	return userDN, nil
}

// UserExists checks whether username resolves via service bind + search (OQ-11 sync).
// Does not perform user authentication.
func UserExists(cfg Config, username string) (bool, error) {
	if cfg.Host == "" || username == "" {
		return false, fmt.Errorf("invalid ldap config")
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
	var conn *ldap.Conn
	var err error
	if cfg.UseTLS {
		conn, err = ldap.DialTLS("tcp", addr, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: cfg.Host})
	} else {
		conn, err = ldap.DialURL(fmt.Sprintf("ldap://%s", addr))
	}
	if err != nil {
		return false, err
	}
	defer conn.Close()
	filter := cfg.UserFilter
	if filter == "" {
		filter = "(uid=%s)"
	}
	if cfg.BindDN != "" {
		if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
			return false, fmt.Errorf("service bind: %w", err)
		}
	}
	if cfg.BaseDN == "" {
		return false, fmt.Errorf("base_dn required for sync")
	}
	f := fmt.Sprintf(filter, ldap.EscapeFilter(username))
	sr, err := conn.Search(ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 1, 0, false,
		f, []string{"dn"}, nil,
	))
	if err != nil {
		return false, err
	}
	return len(sr.Entries) > 0, nil
}

// TestServiceBind verifies LDAP connectivity with the service account only.
// Does not authenticate end-users (Prinzip 6: LDAP is login-bind only).
func TestServiceBind(cfg Config) error {
	if cfg.Host == "" {
		return fmt.Errorf("host required")
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
	var conn *ldap.Conn
	var err error
	if cfg.UseTLS {
		conn, err = ldap.DialTLS("tcp", addr, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: cfg.Host})
	} else {
		conn, err = ldap.DialURL(fmt.Sprintf("ldap://%s", addr))
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	if cfg.BindDN == "" {
		return nil
	}
	return conn.Bind(cfg.BindDN, cfg.BindPassword)
}

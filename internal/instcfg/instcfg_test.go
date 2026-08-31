package instcfg

import (
	"encoding/json"
	"testing"

	"github.com/teamvault/teamvault/internal/configstore"
)

func TestMigrateCompanyCAFromLDAP(t *testing.T) {
	extra, err := json.Marshal(map[string]any{
		"ldap": map[string]any{
			"host":        "dc.corp.local",
			"ca_cert_pem": "-----BEGIN CERTIFICATE-----\nlegacy\n-----END CERTIFICATE-----",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	b := Load(&configstore.Data{Extra: extra})
	if b.CACertPEM == "" {
		t.Fatal("expected CA migrated to instance trust store")
	}
	if b.LDAP.CACertPEM != "" {
		t.Fatalf("ldap CA should be cleared: %q", b.LDAP.CACertPEM)
	}
	cfg := b.WithTrust(b.LDAP)
	if cfg.CACertPEM != b.CACertPEM {
		t.Fatal("WithTrust should inject instance CA")
	}
}

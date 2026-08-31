package tlsutil

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"strings"
)

// MaxCACertPEM is the maximum size of a company CA bundle stored in config.
const MaxCACertPEM = 64 << 10

// ValidatePEM checks size and parseability. Empty PEM is allowed (system CAs only).
func ValidatePEM(pem string) error {
	pem = strings.TrimSpace(pem)
	if pem == "" {
		return nil
	}
	if len(pem) > MaxCACertPEM {
		return fmt.Errorf("CA certificate too large (max %d bytes)", MaxCACertPEM)
	}
	_, err := ClientConfig("placeholder", pem, false)
	return err
}

// CertCount returns how many PEM certificate blocks are present.
func CertCount(pem string) int {
	return strings.Count(pem, "-----BEGIN CERTIFICATE-----")
}

// ClientConfig builds outbound TLS settings. Company CA PEM is appended to the
// system pool. skipVerify is an admin opt-in (internal PKI without a CA file).
func ClientConfig(serverName, caPEM string, skipVerify bool) (*tls.Config, error) {
	t := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		ServerName:         serverName,
		InsecureSkipVerify: skipVerify, //nolint:gosec // admin opt-in for internal PKI
	}
	pem := strings.TrimSpace(caPEM)
	if pem == "" {
		return t, nil
	}
	if len(pem) > MaxCACertPEM {
		return nil, fmt.Errorf("CA certificate too large (max %d bytes)", MaxCACertPEM)
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM([]byte(pem)) {
		return nil, fmt.Errorf("invalid CA certificate PEM")
	}
	t.RootCAs = pool
	return t, nil
}

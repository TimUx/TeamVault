package ldapauth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/teamvault/teamvault/internal/tlsutil"
)

func TestUserIDFromDNStable(t *testing.T) {
	dn := "uid=alice,ou=users,dc=example,dc=com"
	id1 := UserIDFromDN(dn)
	id2 := UserIDFromDN(dn)
	if id1 != id2 || !strings.HasPrefix(id1, "usr_") {
		t.Fatalf("id=%q", id1)
	}
}

func TestSearchUsersQueryTooShort(t *testing.T) {
	_, err := SearchUsers(Config{Host: "x", BaseDN: "dc=ex"}, "a", 10)
	if err == nil {
		t.Fatal("expected min length error")
	}
}

func TestTLSConfigInvalidPEM(t *testing.T) {
	_, err := TLSConfig(Config{Host: "ldap.example", CACertPEM: "not-a-certificate"})
	if err == nil {
		t.Fatal("expected invalid PEM error")
	}
}

func TestTLSConfigSkipVerify(t *testing.T) {
	cfg, err := TLSConfig(Config{Host: "dc.corp.local", InsecureSkipVerify: true})
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.InsecureSkipVerify || cfg.ServerName != "dc.corp.local" || cfg.MinVersion != tls.VersionTLS12 {
		t.Fatalf("%+v", cfg)
	}
}

func TestValidateTLSTooLarge(t *testing.T) {
	err := ValidateTLS(Config{CACertPEM: strings.Repeat("A", tlsutil.MaxCACertPEM+1)})
	if err == nil {
		t.Fatal("expected size error")
	}
}

func TestTLSConfigCustomCAHandshake(t *testing.T) {
	caPEM, serverTLS := mustTestCA(t)
	ln, err := tls.Listen("tcp", "127.0.0.1:0", serverTLS)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_ = c.(*tls.Conn).Handshake()
			_ = c.Close()
		}
	}()

	addr := ln.Addr().String()
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}

	dialWith := func(cfg *tls.Config) error {
		conn, err := tls.Dial("tcp", net.JoinHostPort(host, port), cfg)
		if err != nil {
			return err
		}
		_ = conn.Close()
		return nil
	}

	withoutCA, err := TLSConfig(Config{Host: "localhost"})
	if err != nil {
		t.Fatal(err)
	}
	if err := dialWith(withoutCA); err == nil {
		t.Fatal("system pool should reject test CA")
	}

	withCA, err := TLSConfig(Config{Host: "localhost", CACertPEM: string(caPEM)})
	if err != nil {
		t.Fatal(err)
	}
	if err := dialWith(withCA); err != nil {
		t.Fatalf("custom CA should verify: %v", err)
	}

	skip, err := TLSConfig(Config{Host: "localhost", InsecureSkipVerify: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := dialWith(skip); err != nil {
		t.Fatalf("skip verify should connect: %v", err)
	}

	if err := ValidateTLS(Config{UseTLS: true, CACertPEM: string(caPEM)}); err != nil {
		t.Fatal(err)
	}
}

func mustTestCA(t *testing.T) ([]byte, *tls.Config) {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "TeamVault Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

	srvKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	srvTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	srvDER, err := x509.CreateCertificate(rand.Reader, srvTmpl, caCert, &srvKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	return caPEM, &tls.Config{
		Certificates: []tls.Certificate{{
			Certificate: [][]byte{srvDER},
			PrivateKey:  srvKey,
		}},
		MinVersion: tls.VersionTLS12,
	}
}

package tlsutil

import (
	"strings"
	"testing"
)

func TestValidatePEMEmpty(t *testing.T) {
	if err := ValidatePEM(""); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePEM("   "); err != nil {
		t.Fatal(err)
	}
}

func TestValidatePEMInvalid(t *testing.T) {
	if err := ValidatePEM("not-a-certificate"); err == nil {
		t.Fatal("expected error")
	}
}

func TestValidatePEMTooLarge(t *testing.T) {
	if err := ValidatePEM(strings.Repeat("A", MaxCACertPEM+1)); err == nil {
		t.Fatal("expected size error")
	}
}

func TestCertCount(t *testing.T) {
	if CertCount("") != 0 {
		t.Fatal()
	}
	pem := "-----BEGIN CERTIFICATE-----\na\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nb\n-----END CERTIFICATE-----"
	if CertCount(pem) != 2 {
		t.Fatal(CertCount(pem))
	}
}

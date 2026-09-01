// Package crx3 packs Chrome MV3 extensions as CRX3 for enterprise / policy install.
package crx3

import (
	"archive/zip"
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const magic = "Cr24"

// ExtensionID derives the stable Chrome extension ID from an RSA public key (SPKI DER).
func ExtensionID(pubDER []byte) string {
	sum := sha256.Sum256(pubDER)
	var b strings.Builder
	for i := 0; i < 16; i++ {
		b.WriteByte('a' + (sum[i] >> 4))
		b.WriteByte('a' + (sum[i] & 0x0f))
	}
	return b.String()
}

// PackDir zips extensionDir and writes a CRX3 to outPath using privateKeyPEM.
func PackDir(extensionDir, outPath, privateKeyPEM string) (string, error) {
	key, pubDER, err := parsePrivateKey(privateKeyPEM)
	if err != nil {
		return "", err
	}
	extID := ExtensionID(pubDER)
	zipBytes, err := zipDirectory(extensionDir)
	if err != nil {
		return "", err
	}
	crx, err := buildCRX(key, extID, zipBytes)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return "", err
	}
	return extID, os.WriteFile(outPath, crx, 0o644)
}

func parsePrivateKey(pemBytes string) (*rsa.PrivateKey, []byte, error) {
	block, _ := pem.Decode([]byte(pemBytes))
	if block == nil {
		return nil, nil, fmt.Errorf("invalid pem key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		keyAny, err2 := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err2 != nil {
			return nil, nil, err
		}
		rsaKey := keyAny
		pubDER, err := x509.MarshalPKIXPublicKey(&rsaKey.PublicKey)
		return rsaKey, pubDER, err
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, nil, fmt.Errorf("not rsa key")
	}
	pubDER, err := x509.MarshalPKIXPublicKey(&rsaKey.PublicKey)
	return rsaKey, pubDER, err
}

func zipDirectory(dir string) ([]byte, error) {
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if strings.HasPrefix(rel, "..") || rel == "teamvault.pem" {
			return nil
		}
		w, err := zw.Create(rel)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(w, f)
		return err
	})
	if err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func buildCRX(key *rsa.PrivateKey, extID string, zipBytes []byte) ([]byte, error) {
	signedData := encodeSignedData(extID)
	signedSize := uint32(len(signedData))
	zipSize := uint32(len(zipBytes))

	var toSign bytes.Buffer
	toSign.WriteString("CRX3 SignedData\x00")
	_ = binary.Write(&toSign, binary.LittleEndian, signedSize)
	toSign.Write(signedData)
	_ = binary.Write(&toSign, binary.LittleEndian, zipSize)
	toSign.Write(zipBytes)

	hash := sha256.Sum256(toSign.Bytes())
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
	if err != nil {
		return nil, err
	}
	header := encodeCrxFileHeader(sig, signedData)

	var out bytes.Buffer
	out.WriteString(magic)
	_ = binary.Write(&out, binary.LittleEndian, uint32(3))
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(header)))
	out.Write(header)
	out.Write(zipBytes)
	return out.Bytes(), nil
}

func encodeSignedData(extID string) []byte {
	// message SignedData { optional bytes crx_id = 1; }
	var b bytes.Buffer
	b.WriteByte(0x0a) // field 1, wire type 2
	b.WriteByte(byte(len(extID)))
	b.WriteString(extID)
	return b.Bytes()
}

func encodeCrxFileHeader(sig, signedData []byte) []byte {
	var b bytes.Buffer
	// field 2: sha256_with_rsa
	b.WriteByte(0x12)
	writeLenDelimited(&b, sig)
	// field 10000: signed_header_data
	b.Write([]byte{0x80, 0x4e, 0x12})
	writeLenDelimited(&b, signedData)
	return b.Bytes()
}

func writeLenDelimited(b *bytes.Buffer, data []byte) {
	n := len(data)
	switch {
	case n < 128:
		b.WriteByte(byte(n))
	case n < 16384:
		b.WriteByte(byte(n>>7) | 0x80)
		b.WriteByte(byte(n))
	default:
		b.WriteByte(byte(n>>14) | 0x80)
		b.WriteByte(byte(n>>7) | 0x80)
		b.WriteByte(byte(n))
	}
	b.Write(data)
}

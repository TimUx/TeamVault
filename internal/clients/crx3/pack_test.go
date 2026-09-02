package crx3

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPackDirProducesCRX(t *testing.T) {
	ext := filepath.Join("..", "..", "..", "clients", "extension")
	pem, err := GeneratePrivateKeyPEM()
	if err != nil {
		t.Fatal(err)
	}
	b64, err := PublicKeySPKIB64(pem)
	if err != nil || b64 == "" {
		t.Fatalf("public key: %q err %v", b64, err)
	}
	out := filepath.Join(t.TempDir(), "test.crx")
	id, err := PackDir(ext, out, string(pem))
	if err != nil {
		t.Fatal(err)
	}
	if len(id) != 32 {
		t.Fatalf("id len %d", len(id))
	}
	st, err := os.Stat(out)
	if err != nil || st.Size() < 1000 {
		t.Fatalf("crx size %v err %v", st, err)
	}
	b, _ := os.ReadFile(out)
	if len(b) < 4 || string(b[:4]) != "Cr24" {
		t.Fatal("not crx3")
	}
}

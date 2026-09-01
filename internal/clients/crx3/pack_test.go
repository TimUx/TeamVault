package crx3

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPackDirProducesCRX(t *testing.T) {
	ext := filepath.Join("..", "..", "..", "clients", "extension")
	keyPath := filepath.Join(ext, "teamvault.pem")
	pem, err := os.ReadFile(keyPath)
	if err != nil {
		t.Skip("extension key missing")
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

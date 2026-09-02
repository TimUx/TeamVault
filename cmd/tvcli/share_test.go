package main

import (
	"encoding/base64"
	"testing"

	"github.com/teamvault/teamvault/internal/cryptocore"
)

func TestAppendShareEnvelopeIncludesCreatorOnce(t *testing.T) {
	kp, err := cryptocore.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		t.Fatal(err)
	}
	pub := base64.StdEncoding.EncodeToString(kp.Public[:])
	seen := map[string]bool{}
	out, err := appendShareEnvelope(nil, seen, "usr_me", pub, dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0]["user_id"] != "usr_me" {
		t.Fatalf("creator envelope missing: %#v", out)
	}
	out, err = appendShareEnvelope(out, seen, "usr_me", pub, dk, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("duplicate creator envelope: %#v", out)
	}
	if !seen["usr_me"] {
		t.Fatal("creator should be marked seen after successful add")
	}
}

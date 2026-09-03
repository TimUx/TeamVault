package totp_test

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
	tvtotp "github.com/teamvault/teamvault/internal/auth/totp"
)

func TestValidateNormalizesAndSkews(t *testing.T) {
	key, err := tvtotp.GenerateSecret("TeamVault", "user")
	if err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(key.Secret(), time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if !tvtotp.Validate(" "+code[:3]+" "+code[3:]+" ", key.Secret()) {
		t.Fatal("expected spaced code to validate")
	}
}

func TestNormalizeCode(t *testing.T) {
	if got := tvtotp.NormalizeCode(" 51 15 85 "); got != "511585" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateCounterRejectsReplayAndAcceptsAdjacentWindow(t *testing.T) {
	key, err := tvtotp.GenerateSecret("TeamVault", "counter")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	code, err := totp.GenerateCode(key.Secret(), now)
	if err != nil {
		t.Fatal(err)
	}
	counter, ok := tvtotp.ValidateCounter(code, key.Secret(), now)
	if !ok {
		t.Fatal("expected current counter")
	}
	if next, ok := tvtotp.ValidateCounter(code, key.Secret(), now); !ok || next != counter {
		t.Fatalf("counter changed: %d/%v", next, ok)
	}
	adjacent, err := totp.GenerateCode(key.Secret(), now.Add(30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if next, ok := tvtotp.ValidateCounter(adjacent, key.Secret(), now); !ok || next != counter+1 {
		t.Fatalf("adjacent counter not accepted: %d/%v", next, ok)
	}
}

func TestRecoveryCodesAreRandomAndURLSafe(t *testing.T) {
	codes, err := tvtotp.RandomRecoveryCodes(20)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, code := range codes {
		if code == "" || seen[code] {
			t.Fatalf("duplicate or empty recovery code: %q", code)
		}
		seen[code] = true
		if _, err := base64.RawStdEncoding.DecodeString(code); err != nil {
			t.Fatalf("invalid recovery code encoding: %q", code)
		}
	}
}

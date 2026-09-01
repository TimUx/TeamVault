package totp_test

import (
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

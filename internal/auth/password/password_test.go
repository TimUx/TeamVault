package password_test

import (
	"testing"

	"github.com/teamvault/teamvault/internal/auth/password"
)

func TestHashVerify(t *testing.T) {
	h, err := password.Hash("s3cret-login-pass", password.Default)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := password.Verify("s3cret-login-pass", h)
	if err != nil || !ok {
		t.Fatalf("verify: %v %v", ok, err)
	}
	ok, err = password.Verify("wrong", h)
	if err != nil || ok {
		t.Fatalf("wrong should fail: %v %v", ok, err)
	}
}

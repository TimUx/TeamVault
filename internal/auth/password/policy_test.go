package password_test

import (
	"testing"

	"github.com/teamvault/teamvault/internal/auth/password"
)

func TestValidateLocal(t *testing.T) {
	if err := password.ValidateLocal("Password1234!!!!"); err != nil {
		t.Fatal(err)
	}
	for _, pw := range []string{
		"short",
		"password1234!!!!", // no uppercase
		"PASSWORD1234!!!!", // no lowercase
		"Password!!!!!!aa", // no digit
		"Password1234aaaa", // no special
		"Pässword1234!!!!", // umlaut ä
		"Password1234!!! ", // space
	} {
		if err := password.ValidateLocal(pw); err == nil {
			t.Fatalf("accepted %q", pw)
		}
	}
}

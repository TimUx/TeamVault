package password

import (
	"errors"
	"unicode"
)

const MinLocalLen = 16

// TestLocalPassword satisfies ValidateLocal for unit and integration tests.
const TestLocalPassword = "Password1234!!!!"

// ErrLocalPolicy is returned when a local login password does not meet complexity rules.
// LDAP passwords are never validated here — the directory policy applies.
var ErrLocalPolicy = errors.New("password must be at least 16 characters with uppercase, lowercase, digit, special character, and no umlauts")

// ValidateLocal enforces the TeamVault login-password policy for local users.
// Master-password policy is client-side (Zero-Knowledge); this is only the server-side login hash.
func ValidateLocal(pw string) error {
	if len([]rune(pw)) < MinLocalLen {
		return ErrLocalPolicy
	}
	var upper, lower, digit, special bool
	for _, r := range pw {
		if r == 'ä' || r == 'ö' || r == 'ü' || r == 'Ä' || r == 'Ö' || r == 'Ü' || r == 'ß' {
			return ErrLocalPolicy
		}
		if r < 0x21 || r > 0x7E {
			return ErrLocalPolicy
		}
		switch {
		case r >= 'A' && r <= 'Z':
			upper = true
		case r >= 'a' && r <= 'z':
			lower = true
		case unicode.IsDigit(r):
			digit = true
		default:
			special = true
		}
	}
	if !upper || !lower || !digit || !special {
		return ErrLocalPolicy
	}
	return nil
}

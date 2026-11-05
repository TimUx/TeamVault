// Package offlinepolicy combines the minimum offline key requirements of a
// platform and a tenant. The master password is required by every profile.
package offlinepolicy

import "fmt"

const (
	Any      = "ANY"
	Software = "SOFTWARE"
	Hardware = "HARDWARE"
	Combined = "COMBINED"
)

type factors uint8

const (
	software factors = 1 << iota
	hardware
)

func parse(value string) (factors, error) {
	switch value {
	case Any:
		return 0, nil
	case Software:
		return software, nil
	case Hardware:
		return hardware, nil
	case Combined:
		return software | hardware, nil
	default:
		return 0, fmt.Errorf("unknown offline key requirement %q", value)
	}
}

// Validate rejects unrecognized values, including an omitted API field.
func Validate(value string) error {
	_, err := parse(value)
	return err
}

// Stored normalizes a missing value from configurations predating the policy.
func Stored(value string) string {
	if value == "" {
		return Any
	}
	return value
}

// Combine never removes a factor required by either policy level.
func Combine(platform, tenant string) (string, error) {
	p, err := parse(Stored(platform))
	if err != nil {
		return "", err
	}
	t, err := parse(Stored(tenant))
	if err != nil {
		return "", err
	}
	switch p | t {
	case 0:
		return Any, nil
	case software:
		return Software, nil
	case hardware:
		return Hardware, nil
	default:
		return Combined, nil
	}
}

// Allows reports whether a profile contains all required independent keys.
func Allows(requirement, profile string) (bool, error) {
	required, err := parse(requirement)
	if err != nil {
		return false, err
	}
	var provided factors
	switch profile {
	case "STANDARD":
		provided = software
	case "HARDWARE":
		provided = hardware
	case "COMBINED":
		provided = software | hardware
	default:
		return false, fmt.Errorf("unknown offline profile %q", profile)
	}
	return provided&required == required, nil
}

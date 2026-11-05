package offlinepolicy

import "testing"

func TestCombineAndAllowedProfiles(t *testing.T) {
	requirements := []string{Any, Software, Hardware, Combined}
	want := [][]string{
		{Any, Software, Hardware, Combined},
		{Software, Software, Combined, Combined},
		{Hardware, Combined, Hardware, Combined},
		{Combined, Combined, Combined, Combined},
	}
	profiles := []string{"STANDARD", "HARDWARE", "COMBINED"}
	allowed := map[string][]bool{
		Any:      {true, true, true},
		Software: {true, false, true},
		Hardware: {false, true, true},
		Combined: {false, false, true},
	}
	for i, platform := range requirements {
		for j, tenant := range requirements {
			got, err := Combine(platform, tenant)
			if err != nil || got != want[i][j] {
				t.Fatalf("Combine(%q, %q) = %q, %v; want %q", platform, tenant, got, err, want[i][j])
			}
			for k, profile := range profiles {
				ok, err := Allows(got, profile)
				if err != nil || ok != allowed[got][k] {
					t.Fatalf("Allows(%q, %q) = %v, %v", got, profile, ok, err)
				}
			}
		}
	}
	if got, err := Combine("", ""); err != nil || got != Any {
		t.Fatalf("legacy defaults = %q, %v", got, err)
	}
	for _, invalid := range []string{"", "STANDARD", "hardware", "OTHER"} {
		if err := Validate(invalid); err == nil {
			t.Fatalf("invalid requirement %q accepted", invalid)
		}
		if _, err := Allows(invalid, "STANDARD"); err == nil {
			t.Fatalf("invalid client requirement %q accepted", invalid)
		}
	}
	if _, err := Combine("unknown", Any); err == nil {
		t.Fatal("invalid stored platform requirement accepted")
	}
	if _, err := Allows(Any, "UNKNOWN"); err == nil {
		t.Fatal("invalid profile accepted")
	}
}

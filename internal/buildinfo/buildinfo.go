// Package buildinfo holds release metadata set at link time.
package buildinfo

// Version and Commit are overridden via -ldflags, e.g.
// -X github.com/teamvault/teamvault/internal/buildinfo.Version=1.2.3
var (
	Version = "dev"
	Commit  = "none"
)

// Developer is shown in the product UI and /api/version.
const Developer = "Timo Braun"

// Product is the display name.
const Product = "TeamVault"

// Package postgres is a Phase-13 storage backend stub.
//
// The VaultStore interface in store/ is already backend-neutral. A full Postgres
// implementation mirrors internal/store/sqlite with pgx or database/sql.
// Enable when GOPROXY allows module fetch: github.com/jackc/pgx/v5
//
// Until then, use sqlite (default) or jsonfile. Setup wizard already accepts
// backend name "postgres" in config; openVault must be extended to wire this package.
package postgres

import "errors"

// ErrNotImplemented is returned until the driver is fully wired.
var ErrNotImplemented = errors.New("postgres store: not implemented in this build — use sqlite or see docs/planning/roadmap-phase9plus.md Phase 13.2")

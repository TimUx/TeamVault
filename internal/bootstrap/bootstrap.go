package bootstrap

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/teamvault/teamvault/internal/configstore"
	"github.com/teamvault/teamvault/internal/store"
	"github.com/teamvault/teamvault/internal/store/jsonfile"
	"github.com/teamvault/teamvault/internal/store/sqlite"
	"github.com/teamvault/teamvault/internal/unlock"
)

type Result struct {
	DataDir     string
	Config      *configstore.Data
	ConfigStore *configstore.Store
	Vault       store.VaultStore
	FirstRun    bool
	// UnlockKey remains in process memory after bootstrap to re-seal config.
	// Never log or persist this value.
	UnlockKey []byte
}

type Options struct {
	DataDir   string
	UnlockKey []byte
}

func Run(opts Options) (*Result, error) {
	dataDir := opts.DataDir
	if dataDir == "" {
		dataDir = os.Getenv("TEAMVAULT_DATA_DIR")
	}
	if dataDir == "" {
		dataDir = "./data"
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}

	key := opts.UnlockKey
	if key == nil {
		var err error
		key, err = unlock.Load()
		if err != nil {
			return nil, err
		}
	}

	cs, err := configstore.Open(filepath.Join(dataDir, "config"), key)
	if err != nil {
		return nil, err
	}

	var cfg *configstore.Data
	firstRun := !cs.Exists()
	if firstRun {
		cfg = &configstore.Data{
			Initialized: false,
			Storage: configstore.StorageConfig{
				Backend: "sqlite",
				DSN:     filepath.Join(dataDir, "vault.db"),
			},
		}
		if err := cs.Save(cfg); err != nil {
			return nil, fmt.Errorf("create sealed config: %w", err)
		}
	} else {
		cfg, err = cs.Load()
		if err != nil {
			return nil, err
		}
	}

	vault, err := openVault(cfg.Storage)
	if err != nil {
		return nil, err
	}

	if !cfg.Initialized {
		if _, err := EnsureSetupToken(dataDir); err != nil {
			_ = vault.Close()
			return nil, fmt.Errorf("setup token: %w", err)
		}
	} else {
		ClearSetupToken(dataDir)
	}

	return &Result{
		DataDir:     dataDir,
		Config:      cfg,
		ConfigStore: cs,
		Vault:       vault,
		FirstRun:    firstRun,
		UnlockKey:   append([]byte{}, key...),
	}, nil
}

// ReopenVault closes the current vault and opens according to cfg.Storage.
func (r *Result) ReopenVault() error {
	if r.Vault != nil {
		_ = r.Vault.Close()
	}
	v, err := openVault(r.Config.Storage)
	if err != nil {
		return err
	}
	r.Vault = v
	return nil
}

func openVault(sc configstore.StorageConfig) (store.VaultStore, error) {
	switch sc.Backend {
	case "", "sqlite":
		if sc.DSN == "" {
			return nil, errors.New("sqlite DSN empty")
		}
		return sqlite.Open(sc.DSN)
	case "json", "jsonfile":
		if sc.DSN == "" {
			return nil, errors.New("json store path empty")
		}
		return jsonfile.Open(sc.DSN)
	case "postgres", "pg":
		return nil, fmt.Errorf("%w", errors.New("postgres store not wired yet — see internal/store/postgres"))
	default:
		return nil, fmt.Errorf("storage backend %q not implemented", sc.Backend)
	}
}

// OpenVault opens a vault backend without mutating the running app (migration helper).
func OpenVault(sc configstore.StorageConfig) (store.VaultStore, error) {
	return openVault(sc)
}

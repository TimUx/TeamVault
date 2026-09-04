package main

import (
	"context"
	"errors"
	"os"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/teamvault/teamvault/clients/desktop/backend"
)

// App is the Wails-bound backend. Every exported method becomes callable
// from the frontend as window.go.main.App.<Method>(...). It only ever
// exposes decrypted data to the local UI process — the network calls and
// crypto happen here, never in remote JS.
type App struct {
	ctx     context.Context
	client  *backend.Client
	session *backend.Session
	tray    *backend.Tray
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// beforeClose intercepts the window close button: minimize to tray
// instead of quitting, unless the user disabled that behaviour.
func (a *App) beforeClose(ctx context.Context) bool {
	settings, _ := backend.LoadSettings()
	if !settings.CloseToTray {
		return false
	}
	wailsruntime.WindowHide(ctx)
	return true
}

// --- Settings -------------------------------------------------------------

func (a *App) GetSettings() backend.Settings {
	s, _ := backend.LoadSettings()
	return s
}

func (a *App) SaveSettings(s backend.Settings) error {
	return backend.SaveSettings(s)
}

func (a *App) IsAutostartEnabled() (bool, error) {
	return backend.IsAutostartEnabled()
}

func (a *App) SetAutostart(enabled bool) error {
	if enabled {
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		return backend.EnableAutostart(exe)
	}
	return backend.DisableAutostart()
}

// --- Auth / session ---------------------------------------------------

func (a *App) Connect(serverURL string) error {
	c, err := backend.NewClient(serverURL, "")
	if err != nil {
		return err
	}
	a.client = c
	return nil
}

func (a *App) Login(tenant, username, password, totpCode string) error {
	if a.client == nil {
		return errors.New("nicht verbunden: Connect() zuerst aufrufen")
	}
	return backend.Login(a.client, tenant, username, password, totpCode)
}

// UnlockResult tells the frontend whether the vault was unlocked online
// or served from the local offline cache.
type UnlockResult struct {
	Offline bool   `json:"offline"`
	Warning string `json:"warning,omitempty"`
}

func (a *App) Unlock(masterPassword string, tenant, username string) (UnlockResult, error) {
	pw := []byte(masterPassword)
	defer zero(pw)

	if a.client != nil {
		sess, err := backend.Unlock(a.client, pw, nil)
		if err == nil {
			a.session = sess
			return UnlockResult{Offline: false}, nil
		}
		if errors.Is(err, backend.ErrInvalidMasterPassword) {
			// Definitely a wrong password, not a connectivity problem —
			// surface it directly instead of confusingly retrying offline.
			return UnlockResult{}, err
		}
		// Any other error (network unreachable, server down, etc.) falls
		// through to the offline cache below.
	}
	snap, ok, loadErr := backend.LoadOfflineSnapshot(tenant, username)
	if loadErr != nil || !ok {
		return UnlockResult{}, errors.New("kein Netzwerk und kein Offline-Cache für dieses Konto vorhanden")
	}
	if snap.Expired() {
		return UnlockResult{}, errors.New("Offline-Kopie abgelaufen (max. 30 Tage) — bitte online anmelden")
	}
	if a.client == nil {
		var err error
		a.client, err = backend.NewClient("", "")
		if err != nil {
			return UnlockResult{}, err
		}
	}
	sess, err := backend.Unlock(a.client, pw, &snap)
	if err != nil {
		return UnlockResult{}, err
	}
	a.session = sess
	return UnlockResult{Offline: true, Warning: "Offline-Modus: Anlegen/Ändern ist erst nach erneutem Online-Login möglich."}, nil
}

func (a *App) Lock() {
	if a.session != nil {
		a.session.Lock()
	}
	a.session = nil
}

func (a *App) Logout() {
	if a.client != nil {
		backend.Logout(a.client)
	}
	a.Lock()
	a.client = nil
}

func (a *App) Me() map[string]any {
	if a.session == nil {
		return nil
	}
	return a.session.Me
}

// --- Vault --------------------------------------------------------------

func (a *App) ListSecrets() ([]backend.SecretListItem, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		snap, ok, err := backend.LoadOfflineSnapshot(a.session.TenantSlug, a.session.Username)
		if err != nil || !ok {
			return nil, errors.New("Offline-Cache nicht lesbar")
		}
		return a.session.ListSecretsOffline(snap)
	}
	items, err := a.session.ListSecrets()
	if err != nil {
		return nil, err
	}
	go func() { _ = a.session.SyncOfflineSnapshot() }()
	return items, nil
}

func (a *App) GetSecret(id string) (*backend.SecretDetail, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		snap, ok, err := backend.LoadOfflineSnapshot(a.session.TenantSlug, a.session.Username)
		if err != nil || !ok {
			return nil, errors.New("Offline-Cache nicht lesbar")
		}
		return a.session.GetSecretOffline(snap, id)
	}
	return a.session.GetSecret(id)
}

func (a *App) CreateSecret(in backend.SecretInput) (string, error) {
	if a.session == nil {
		return "", errors.New("gesperrt")
	}
	if a.session.Offline {
		return "", errors.New("Anlegen ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.CreateSecret(in)
}

func (a *App) UpdateSecret(id string, in backend.SecretInput) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("Ändern ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.UpdateSecret(id, in)
}

func (a *App) DeleteSecret(id string) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("Löschen ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.DeleteSecret(id)
}

func (a *App) SyncOfflineCache() error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	return a.session.SyncOfflineSnapshot()
}

func (a *App) HasOfflineCache(tenant, username string) bool {
	snap, ok, err := backend.LoadOfflineSnapshot(tenant, username)
	if err != nil || !ok {
		return false
	}
	return !snap.Expired()
}

func (a *App) ForgetOfflineCache(tenant, username string) error {
	return backend.DeleteOfflineSnapshot(tenant, username)
}

// --- Window / tray --------------------------------------------------------

func (a *App) ShowWindow() {
	wailsruntime.WindowShow(a.ctx)
	wailsruntime.WindowUnminimise(a.ctx)
}

func (a *App) HideWindow() {
	wailsruntime.WindowHide(a.ctx)
}

func (a *App) Quit() {
	wailsruntime.Quit(a.ctx)
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

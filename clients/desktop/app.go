package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	goruntime "runtime"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/teamvault/teamvault/clients/desktop/backend"
)

// App is the Wails-bound backend. Every exported method becomes callable
// from the frontend as window.go.main.App.<Method>(...). It only ever
// exposes decrypted data to the local UI process — the network calls and
// crypto happen here, never in remote JS.
type App struct {
	ctx             context.Context
	client          *backend.Client
	session         *backend.Session
	offlineSnapshot *backend.OfflineSnapshot
	tray            *backend.Tray
}

// Set by build scripts via -ldflags "-X main.version=…".
var version = "dev"

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if s, err := backend.LoadSettings(); err == nil {
		_ = backend.ApplyWindowCaptureProtection(s.PreventScreenCapture)
	}
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
	if err := backend.SaveSettings(s); err != nil {
		return err
	}
	return backend.ApplyWindowCaptureProtection(s.PreventScreenCapture)
}

func (a *App) Platform() string {
	return goruntime.GOOS
}

func (a *App) GetAppearancePreferences() (map[string]any, error) {
	if a.client == nil {
		return map[string]any{}, nil
	}
	me, err := a.client.GetJSON("/api/me")
	if err != nil {
		return nil, err
	}
	if prefs, ok := me["preferences"].(map[string]any); ok {
		return prefs, nil
	}
	return map[string]any{}, nil
}

func (a *App) SaveAppearancePreferences(theme, accent string) error {
	if a.client == nil {
		return nil
	}
	_, err := a.client.PutJSON("/api/me/preferences", map[string]string{
		"theme":  theme,
		"accent": accent,
	})
	return err
}

func (a *App) CheckForUpdate(serverURL string) (backend.UpdateInfo, error) {
	return backend.CheckForUpdate(serverURL, version)
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
	if sessionID, ok := backend.LoadRememberedLogin(serverURL); ok {
		c.SetSessionCookie(sessionID)
	}
	a.client = c
	return nil
}

func (a *App) CurrentUser() (map[string]any, error) {
	if a.client == nil {
		return nil, errors.New("nicht verbunden: Connect() zuerst aufrufen")
	}
	return a.client.GetJSON("/api/me")
}

func (a *App) Login(tenant, username, password, totpCode string, remember bool) (map[string]any, error) {
	if a.client == nil {
		return nil, errors.New("nicht verbunden: Connect() zuerst aufrufen")
	}
	res, err := backend.Login(a.client, tenant, username, password, totpCode, remember)
	if err == nil {
		a.saveRememberedLoginIfComplete(remember, res)
	}
	return res, err
}

func (a *App) LoginStep(loginToken, tenant, username string, totpCode string, remember bool) (map[string]any, error) {
	if a.client == nil {
		return nil, errors.New("nicht verbunden: Connect() zuerst aufrufen")
	}
	res, err := backend.LoginStep(a.client, tenant, username, "", totpCode, loginToken, remember)
	if err == nil {
		a.saveRememberedLoginIfComplete(remember, res)
	}
	return res, err
}

func (a *App) saveRememberedLoginIfComplete(remember bool, res map[string]any) {
	if res == nil || res["needs_tenant"] == true || res["needs_totp"] == true {
		return
	}
	if !remember {
		_ = backend.ClearRememberedLogin()
		return
	}
	if a.client != nil {
		_ = backend.SaveRememberedLogin(a.client.BaseURL(), a.client.SessionCookieValue())
	}
}

// UnlockResult tells the frontend whether the vault was unlocked online
// or served from the local offline cache.
type UnlockResult struct {
	Offline bool   `json:"offline"`
	Warning string `json:"warning,omitempty"`
}

func (a *App) Unlock(masterPassword string, tenant, username, softwareKeyB64 string) (UnlockResult, error) {
	pw := []byte(masterPassword)
	defer zero(pw)

	a.offlineSnapshot = nil
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
	cache, ok, loadErr := backend.LoadOfflineCache(tenant, username)
	if loadErr != nil {
		return UnlockResult{}, fmt.Errorf("Offline-Kopie kann nicht gelesen werden: %w", loadErr)
	}
	if !ok {
		return UnlockResult{}, errors.New("kein Netzwerk und kein Offline-Cache für dieses Konto vorhanden")
	}
	if cache.Format != "teamvault-offline" || cache.Version != 2 {
		if err := backend.DeleteOfflineSnapshot(tenant, username); err != nil {
			return UnlockResult{}, err
		}
		return UnlockResult{}, errors.New("altes Offline-Format gelöscht; bitte online eine neue Offline-Kopie einrichten")
	}
	if cache.Expired() {
		return UnlockResult{}, errors.New("Offline-Kopie abgelaufen oder muss sicher neu synchronisiert werden")
	}
	if cache.TenantSlug != tenant || cache.Username != username {
		return UnlockResult{}, errors.New("Offline-Kopie gehört nicht zu diesem Konto")
	}
	if a.client == nil {
		return UnlockResult{}, errors.New("Server-Adresse für Offline-Entsperrung fehlt")
	}
	softwareKey, err := backend.DecodeOfflineSoftwareKey(softwareKeyB64)
	if err != nil {
		return UnlockResult{}, err
	}
	defer zero(softwareKey)
	origin, err := backend.OfflineOrigin(a.client.BaseURL())
	if err != nil {
		return UnlockResult{}, err
	}
	snap, err := backend.OpenOfflineSnapshot(cache, softwareKey, origin, cache.TenantID, cache.UserID)
	if err != nil {
		return UnlockResult{}, err
	}
	sess, err := backend.Unlock(a.client, pw, &snap)
	if err != nil {
		return UnlockResult{}, err
	}
	a.session = sess
	a.offlineSnapshot = &snap
	return UnlockResult{Offline: true, Warning: "Offline-Modus: Anlegen/Ändern ist erst nach erneutem Online-Login möglich."}, nil
}

func (a *App) Lock() {
	if a.session != nil {
		a.session.Lock()
	}
	a.session = nil
	a.offlineSnapshot = nil
}

func (a *App) Logout() {
	if a.client != nil {
		backend.Logout(a.client)
	}
	_ = backend.ClearRememberedLogin()
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
		if a.offlineSnapshot == nil {
			return nil, errors.New("Offline-Cache nicht entsperrt")
		}
		return a.session.ListSecretsOffline(*a.offlineSnapshot)
	}
	return a.session.ListSecrets()
}

func (a *App) GetSecret(id string) (*backend.SecretDetail, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		if a.offlineSnapshot == nil {
			return nil, errors.New("Offline-Cache nicht entsperrt")
		}
		return a.session.GetSecretOffline(*a.offlineSnapshot, id)
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

func (a *App) SyncOfflineCache(softwareKeyB64 string) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("Offline-Sync nur nach Online-Anmeldung möglich")
	}
	softwareKey, err := backend.DecodeOfflineSoftwareKey(softwareKeyB64)
	if err != nil {
		return err
	}
	defer zero(softwareKey)
	return a.session.SyncOfflineSnapshot(softwareKey)
}

// --- Sharing --------------------------------------------------------------

func (a *App) ListPublicKeys() ([]backend.PublicKeyInfo, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		return nil, errors.New("Freigabe verwalten ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.ListPublicKeys()
}

func (a *App) ListMyGroups() ([]backend.MyGroup, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		return nil, errors.New("Freigabe verwalten ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.ListMyGroups()
}

func (a *App) GetSecretAccess(id string) (*backend.SecretAccess, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		return nil, errors.New("Freigabe verwalten ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.GetSecretAccess(id)
}

func (a *App) ShareSecretWithUser(id, userID, capability string) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("Freigabe ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.ShareSecretWithUser(id, userID, capability)
}

func (a *App) ShareSecretWithGroup(id, groupID, capability string) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("Freigabe ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.ShareSecretWithGroup(id, groupID, capability)
}

func (a *App) UnshareSecret(id string, dropUserIDs, dropGroupIDs []string) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("Freigabe entziehen ist offline nicht möglich — bitte online anmelden")
	}
	return a.session.UnshareSecret(id, dropUserIDs, dropGroupIDs)
}

func (a *App) ListGroupShareGaps() ([]backend.GroupShareGap, error) {
	if a.session == nil {
		return nil, errors.New("gesperrt")
	}
	if a.session.Offline {
		return nil, errors.New("nicht offline möglich — bitte online anmelden")
	}
	return a.session.ListGroupShareGaps()
}

func (a *App) FixGroupShareGap(gap backend.GroupShareGap) error {
	if a.session == nil {
		return errors.New("gesperrt")
	}
	if a.session.Offline {
		return errors.New("nicht offline möglich — bitte online anmelden")
	}
	return a.session.FixGroupShareGap(gap)
}

func (a *App) HasOfflineCache(tenant, username string) (bool, error) {
	cache, ok, err := backend.LoadOfflineCache(tenant, username)
	if err != nil || !ok {
		return false, err
	}
	if cache.Format != "teamvault-offline" || cache.Version != 2 {
		if err := backend.DeleteOfflineSnapshot(tenant, username); err != nil {
			return false, err
		}
		return false, nil
	}
	return !cache.Expired(), nil
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

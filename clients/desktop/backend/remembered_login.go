package backend

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const rememberedLoginMaxAge = 90 * 24 * time.Hour

type rememberedLogin struct {
	ServerURL string    `json:"server_url"`
	SessionID string    `json:"session_id"`
	SavedAt   time.Time `json:"saved_at"`
}

func rememberedLoginPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "remembered-login.json"), nil
}

func normalizeRememberedServerURL(s string) string {
	return strings.TrimRight(strings.TrimSpace(s), "/")
}

func SaveRememberedLogin(serverURL, sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return ClearRememberedLogin()
	}
	p, err := rememberedLoginPath()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(rememberedLogin{
		ServerURL: normalizeRememberedServerURL(serverURL),
		SessionID: sessionID,
		SavedAt:   time.Now().UTC(),
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0o600)
}

func LoadRememberedLogin(serverURL string) (string, bool) {
	p, err := rememberedLoginPath()
	if err != nil {
		return "", false
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return "", false
	}
	var rec rememberedLogin
	if err := json.Unmarshal(raw, &rec); err != nil {
		_ = os.Remove(p)
		return "", false
	}
	if rec.SessionID == "" ||
		normalizeRememberedServerURL(rec.ServerURL) != normalizeRememberedServerURL(serverURL) ||
		time.Since(rec.SavedAt) > rememberedLoginMaxAge {
		_ = os.Remove(p)
		return "", false
	}
	return rec.SessionID, true
}

func ClearRememberedLogin() error {
	p, err := rememberedLoginPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (c *Client) SetSessionCookie(sessionID string) {
	if c == nil || c.http == nil || c.http.Jar == nil || strings.TrimSpace(sessionID) == "" {
		return
	}
	u, err := url.Parse(c.base)
	if err != nil {
		return
	}
	c.http.Jar.SetCookies(u, []*http.Cookie{{
		Name:     "tv_session",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
	}})
}

func (c *Client) SessionCookieValue() string {
	if c == nil || c.http == nil || c.http.Jar == nil {
		return ""
	}
	u, err := url.Parse(c.base)
	if err != nil {
		return ""
	}
	for _, ck := range c.http.Jar.Cookies(u) {
		if ck.Name == "tv_session" {
			return ck.Value
		}
	}
	return ""
}

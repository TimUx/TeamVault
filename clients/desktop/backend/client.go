// Package backend implements the Go side of the TeamVault Desktop app
// (Wails v2): a thin, vault-only client around the same REST API used by
// tvcli and the browser extension. All decrypt/encrypt operations use
// internal/cryptocore; the server and this file never see plaintext
// secrets or the master password beyond the current in-memory unlock.
package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// Client is a minimal REST client for the TeamVault vault API.
type Client struct {
	base   string
	apiKey string
	http   *http.Client
}

func NewClient(base, apiKey string) (*Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &Client{
		base:   strings.TrimRight(strings.TrimSpace(base), "/"),
		apiKey: apiKey,
		http:   &http.Client{Jar: jar, Timeout: 30 * time.Second},
	}, nil
}

func (c *Client) BaseURL() string { return c.base }

func (c *Client) newRequest(method, path string, body []byte) (*http.Request, error) {
	req, err := http.NewRequest(method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	return req, nil
}

func (c *Client) do(method, path string, body any) ([]byte, int, error) {
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
	}
	req, err := c.newRequest(method, path, raw)
	if err != nil {
		return nil, 0, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode >= 400 {
		return respBody, resp.StatusCode, fmt.Errorf("%s %s: %s", method, path, apiErrMessage(respBody, resp.StatusCode))
	}
	return respBody, resp.StatusCode, nil
}

func apiErrMessage(body []byte, status int) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &e) == nil && e.Error != "" {
		return e.Error
	}
	if len(body) > 0 && len(body) < 300 {
		return string(body)
	}
	return http.StatusText(status)
}

// GetJSON performs a GET request and decodes the JSON body into a map.
func (c *Client) GetJSON(path string) (map[string]any, error) {
	raw, _, err := c.do(http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetRaw performs a GET request and returns the raw response body.
func (c *Client) GetRaw(path string) ([]byte, error) {
	raw, _, err := c.do(http.MethodGet, path, nil)
	return raw, err
}

// PostJSON performs a POST request with a JSON body and decodes the response.
func (c *Client) PostJSON(path string, body any) (map[string]any, error) {
	raw, _, err := c.do(http.MethodPost, path, body)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// PutJSON performs a PUT request with a JSON body and decodes the response.
func (c *Client) PutJSON(path string, body any) (map[string]any, error) {
	raw, _, err := c.do(http.MethodPut, path, body)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Delete performs a DELETE request.
func (c *Client) Delete(path string) error {
	_, _, err := c.do(http.MethodDelete, path, nil)
	return err
}

func pathEscape(s string) string { return url.PathEscape(s) }

// Command tvcli is the teamVault command-line client.
//
// Security: all vault decrypt/encrypt uses internal/cryptocore (Phase 2).
// The server never sees master passwords or plaintext secrets.
//
// Standalone binaries: build with CGO_ENABLED=0 for linux/windows (see scripts/build-tvcli.*).
package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/teamvault/teamvault/internal/cryptocore"
	"github.com/teamvault/teamvault/internal/shamir"
	"golang.org/x/term"
)

// Set via -ldflags "-X main.version=… -X main.commit=…"
var (
	version = "dev"
	commit  = "none"
)

func main() {
	base := flag.String("base", envOr("TEAMVAULT_BASE", "http://127.0.0.1:8080"), "API base URL")
	apiKey := flag.String("api-key", os.Getenv("TEAMVAULT_API_KEY"), "Bearer API key (optional)")
	flag.Parse()
	args := flag.Args()
	if len(args) < 1 {
		usage()
		os.Exit(2)
	}
	if args[0] == "version" || args[0] == "-version" || args[0] == "--version" {
		fmt.Printf("tvcli %s (%s) %s/%s\n", version, commit, runtime.GOOS, runtime.GOARCH)
		return
	}
	c, err := newClient(*base, *apiKey)
	if err != nil {
		fatal(err)
	}
	switch args[0] {
	case "escrow-split":
		fs := flag.NewFlagSet("escrow-split", flag.ExitOnError)
		k := fs.Int("k", 3, "threshold")
		n := fs.Int("n", 5, "parts")
		in := fs.String("in", "", "file with raw escrow private key (32 bytes) or base64")
		_ = fs.Parse(args[1:])
		if err := escrowSplit(*k, *n, *in); err != nil {
			fatal(err)
		}
	case "escrow-combine":
		fs := flag.NewFlagSet("escrow-combine", flag.ExitOnError)
		_ = fs.Parse(args[1:])
		if err := escrowCombine(fs.Args()); err != nil {
			fatal(err)
		}
	case "login":
		fs := flag.NewFlagSet("login", flag.ExitOnError)
		tenant := fs.String("tenant", "", "tenant slug")
		user := fs.String("user", "", "username")
		_ = fs.Parse(args[1:])
		if *tenant == "" || *user == "" {
			fatal(fmt.Errorf("login requires -tenant and -user"))
		}
		pw, err := readSecret("Login password: ")
		if err != nil {
			fatal(err)
		}
		totp, _ := readOptional("TOTP (optional): ")
		if err := c.login(*tenant, *user, string(pw), totp); err != nil {
			fatal(err)
		}
		zero(pw)
		fmt.Println("logged in (session cookie stored)")
	case "secrets":
		if len(args) < 2 {
			fatal(fmt.Errorf("secrets requires list|get|create"))
		}
		switch args[1] {
		case "list":
			if err := c.secretsList(); err != nil {
				fatal(err)
			}
		case "get":
			fs := flag.NewFlagSet("get", flag.ExitOnError)
			id := fs.String("id", "", "secret id")
			_ = fs.Parse(args[2:])
			if *id == "" && fs.NArg() > 0 {
				*id = fs.Arg(0)
			}
			if *id == "" {
				fatal(fmt.Errorf("get requires -id"))
			}
			if err := c.secretsGet(*id); err != nil {
				fatal(err)
			}
		case "create":
			fs := flag.NewFlagSet("create", flag.ExitOnError)
			title := fs.String("title", "", "title")
			user := fs.String("username", "", "username field")
			pass := fs.String("password", "", "password field (prefer prompt)")
			_ = fs.Parse(args[2:])
			if *title == "" {
				fatal(fmt.Errorf("create requires -title"))
			}
			pw := []byte(*pass)
			if len(pw) == 0 {
				var err error
				pw, err = readSecret("Secret password: ")
				if err != nil {
					fatal(err)
				}
			}
			if err := c.secretsCreate(*title, *user, string(pw)); err != nil {
				fatal(err)
			}
			zero(pw)
			fmt.Println("created")
		default:
			fatal(fmt.Errorf("unknown secrets subcommand"))
		}
	case "whoami":
		me, err := c.getJSON("/api/me")
		if err != nil {
			fatal(err)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(me)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `tvcli — teamVault CLI (standalone; client-side crypto via cryptocore)

Usage:
  tvcli -base URL [-api-key KEY] login -tenant SLUG -user NAME
  tvcli [-api-key KEY] whoami
  tvcli secrets list
  tvcli secrets get -id ID
  tvcli secrets create -title TITLE [-username U] [-password P]

  tvcli escrow-split -k 3 -n 5 -in escrow.sk
  tvcli escrow-combine share1.hex share2.hex share3.hex
  tvcli version

Auth: session cookie after login, or TEAMVAULT_API_KEY / -api-key.
Unlock: master password prompted when decrypting (never sent to server).
No Go toolchain or other runtime required for release binaries.
`)
}

type client struct {
	base   string
	apiKey string
	http   *http.Client
	state  string
}

func newClient(base, apiKey string) (*client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	c := &client{base: strings.TrimRight(base, "/"), apiKey: apiKey, http: &http.Client{Jar: jar}}
	dir, err := os.UserConfigDir()
	if err != nil {
		return c, nil
	}
	c.state = filepath.Join(dir, "teamvault", "cookies.json")
	_ = c.loadCookies()
	return c, nil
}

func (c *client) login(tenant, user, password, totp string) error {
	body := map[string]string{
		"tenant_slug": tenant, "username": user, "password": password, "totp_code": totp,
	}
	_, err := c.postJSON("/api/auth/login", body)
	if err != nil {
		return err
	}
	return c.saveCookies()
}

func (c *client) unlockSK() ([]byte, cryptocore.Argon2Params, error) {
	keys, err := c.getJSON("/api/vault/keys")
	if err != nil {
		return nil, cryptocore.Argon2Params{}, err
	}
	paramsRaw, err := c.getJSON("/api/vault/crypto-params")
	if err != nil {
		return nil, cryptocore.Argon2Params{}, err
	}
	b, _ := json.Marshal(paramsRaw)
	var params cryptocore.Argon2Params
	_ = json.Unmarshal(b, &params)
	if params.KeyLen == 0 {
		params = cryptocore.DefaultArgon2
	}
	mpw, err := readSecret("Master password: ")
	if err != nil {
		return nil, params, err
	}
	defer zero(mpw)
	salt := mustB64(str(keys["salt_b64"]))
	nonce := mustB64(str(keys["encrypted_private_key_nonce_b64"]))
	ct := mustB64(str(keys["encrypted_private_key_b64"]))
	sk, mk, err := cryptocore.UnlockIdentity(mpw, cryptocore.SealedPrivateKey{
		Salt: salt, Nonce: nonce, Ciphertext: ct, Params: params,
	})
	if mk != nil {
		zero(mk)
	}
	return sk, params, err
}

func (c *client) secretsList() error {
	sk, _, err := c.unlockSK()
	if err != nil {
		return err
	}
	defer zero(sk)
	raw, err := c.getRaw("/api/secrets")
	if err != nil {
		return err
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}
	for _, it := range items {
		id := str(it["id"])
		title := id
		if it["has_access"] == true {
			if t, err := c.decryptTitle(sk, it); err == nil {
				title = t
			}
		}
		fmt.Printf("%s\t%v\t%s\n", id, it["has_access"], title)
	}
	return nil
}

func (c *client) secretsGet(id string) error {
	sk, _, err := c.unlockSK()
	if err != nil {
		return err
	}
	defer zero(sk)
	det, err := c.getJSON("/api/secrets/" + url.PathEscape(id))
	if err != nil {
		return err
	}
	env := det["envelope"].(map[string]any)
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, sk)
	if err != nil {
		return err
	}
	defer zero(dk)
	kv := uint32(det["key_version"].(float64))
	titlePT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(det["title_nonce_b64"])), Ciphertext: mustB64(str(det["title_ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return err
	}
	bodyPT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(det["nonce_b64"])), Ciphertext: mustB64(str(det["ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return err
	}
	fmt.Printf("title: %s\n%s\n", string(titlePT), string(bodyPT))
	return nil
}

func (c *client) secretsCreate(title, username, password string) error {
	sk, _, err := c.unlockSK()
	if err != nil {
		return err
	}
	defer zero(sk)
	me, err := c.getJSON("/api/me")
	if err != nil {
		return err
	}
	keys, err := c.getJSON("/api/vault/keys")
	if err != nil {
		return err
	}
	dk, err := cryptocore.GenerateDataKey()
	if err != nil {
		return err
	}
	defer zero(dk)
	const kv uint32 = 1
	titleCT, err := cryptocore.EncryptPayload([]byte(title), dk, kv)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{"username": username, "password": password})
	bodyCT, err := cryptocore.EncryptPayload(payload, dk, kv)
	if err != nil {
		return err
	}
	pub := mustB64(str(keys["public_key_b64"]))
	env, err := cryptocore.SealDataKeyForRecipient(dk, pub, kv)
	if err != nil {
		return err
	}
	_ = sk // SK only needed for unlock path consistency
	_, err = c.postJSON("/api/secrets", map[string]any{
		"title_ciphertext_b64": b64(titleCT.Ciphertext),
		"title_nonce_b64":      b64(titleCT.Nonce),
		"ciphertext_b64":       b64(bodyCT.Ciphertext),
		"nonce_b64":            b64(bodyCT.Nonce),
		"key_version":          kv,
		"envelopes": []map[string]any{{
			"user_id": str(me["user_id"]), "key_version": kv,
			"wrapped_dk_b64": b64(env.Ciphertext), "ephemeral_pub_b64": b64(env.EphemeralPub), "nonce_b64": b64(env.Nonce),
		}},
	})
	return err
}

func (c *client) decryptTitle(sk []byte, it map[string]any) (string, error) {
	det, err := c.getJSON("/api/secrets/" + url.PathEscape(str(it["id"])))
	if err != nil {
		return "", err
	}
	env := det["envelope"].(map[string]any)
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, sk)
	if err != nil {
		return "", err
	}
	defer zero(dk)
	kv := uint32(1)
	if v, ok := it["key_version"].(float64); ok {
		kv = uint32(v)
	}
	pt, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(it["title_nonce_b64"])), Ciphertext: mustB64(str(it["title_ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func (c *client) do(method, path string, body any) (*http.Response, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	return c.http.Do(req)
}

func (c *client) postJSON(path string, body any) (map[string]any, error) {
	res, err := c.do(http.MethodPost, path, body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(res.Body).Decode(&m)
	if res.StatusCode >= 300 {
		return m, fmt.Errorf("%s: %v", res.Status, m["error"])
	}
	_ = c.saveCookies()
	return m, nil
}

func (c *client) getJSON(path string) (map[string]any, error) {
	raw, err := c.getRaw(path)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *client) getRaw(path string) ([]byte, error) {
	res, err := c.do(http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		return nil, fmt.Errorf("%s: %v", res.Status, m["error"])
	}
	return b, nil
}

type cookieFile struct {
	Cookies []*http.Cookie `json:"cookies"`
}

func (c *client) saveCookies() error {
	if c.state == "" || c.apiKey != "" {
		return nil
	}
	u, err := url.Parse(c.base)
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(c.state), 0o700)
	cf := cookieFile{Cookies: c.http.Jar.Cookies(u)}
	b, _ := json.Marshal(cf)
	return os.WriteFile(c.state, b, 0o600)
}

func (c *client) loadCookies() error {
	if c.state == "" {
		return nil
	}
	b, err := os.ReadFile(c.state)
	if err != nil {
		return err
	}
	var cf cookieFile
	if err := json.Unmarshal(b, &cf); err != nil {
		return err
	}
	u, err := url.Parse(c.base)
	if err != nil {
		return err
	}
	c.http.Jar.SetCookies(u, cf.Cookies)
	return nil
}

func readSecret(prompt string) ([]byte, error) {
	fmt.Fprint(os.Stderr, prompt)
	pw, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Fprintln(os.Stderr)
	return pw, err
}

func readOptional(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	s, err := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimSpace(s), err
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
func str(v any) string {
	s, _ := v.(string)
	return s
}
func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
func mustB64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}
func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func escrowSplit(k, n int, inPath string) error {
	var secret []byte
	var err error
	if inPath != "" {
		secret, err = os.ReadFile(inPath)
		if err != nil {
			return err
		}
		secret = bytes.TrimSpace(secret)
		if decoded, err := base64.StdEncoding.DecodeString(string(secret)); err == nil && len(decoded) == 32 {
			secret = decoded
		}
	} else {
		fmt.Fprintln(os.Stderr, "Paste escrow private key (base64), then EOF:")
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			return err
		}
		secret, err = base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil {
			return err
		}
	}
	if len(secret) != 32 {
		return fmt.Errorf("escrow secret must be 32 bytes, got %d", len(secret))
	}
	shares, err := shamir.Split(secret, n, k)
	zero(secret)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Shamir %d-of-%d shares (store separately; never on server):\n", k, n)
	for i, sh := range shares {
		fmt.Printf("share_%d=%s\n", i+1, hex.EncodeToString(sh))
	}
	return nil
}

func escrowCombine(paths []string) error {
	if len(paths) < 2 {
		return fmt.Errorf("need at least 2 share files or hex args")
	}
	var parts [][]byte
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			// treat as hex string
			b, err = hex.DecodeString(strings.TrimSpace(p))
			if err != nil {
				return err
			}
		} else {
			b = bytes.TrimSpace(b)
			if decoded, err := hex.DecodeString(string(b)); err == nil {
				b = decoded
			}
		}
		parts = append(parts, b)
	}
	secret, err := shamir.Combine(parts)
	if err != nil {
		return err
	}
	defer zero(secret)
	fmt.Println(base64.StdEncoding.EncodeToString(secret))
	return nil
}

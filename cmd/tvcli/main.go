// Command tvcli is the TeamVault command-line client.
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
			fatal(fmt.Errorf("secrets requires list|get|create|update"))
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
		case "create", "update":
			fs := flag.NewFlagSet(args[1], flag.ExitOnError)
			id := fs.String("id", "", "secret id (update only)")
			title := fs.String("title", "", "title (required for create)")
			user := fs.String("username", "", "username field")
			pass := fs.String("password", "", "password field (prefer prompt if empty)")
			urlsFlag := fs.String("urls", "", "URLs separated by ;")
			urlFlags := stringSlice{}
			fs.Var(&urlFlags, "url", "single URL (repeatable)")
			notes := fs.String("notes", "", "notes")
			totp := fs.String("totp", "", "TOTP seed or otpauth URL")
			tags := fs.String("tags", "", "comma-separated tags")
			favorite := fs.Bool("favorite", false, "mark favorite")
			folder := fs.String("folder", "", "collection / folder id")
			visibility := fs.String("visibility", "private", "private or shared (create)")
			shareUsers := stringSlice{}
			shareGroups := stringSlice{}
			fs.Var(&shareUsers, "share-user", "user id to share with (repeatable; create)")
			fs.Var(&shareGroups, "share-group", "group id to share with (repeatable; create)")
			sshPriv := fs.String("ssh-private", "", "SSH private key (PEM text)")
			sshPrivFile := fs.String("ssh-private-file", "", "SSH private key file")
			sshPub := fs.String("ssh-public", "", "SSH public key")
			sshPubFile := fs.String("ssh-public-file", "", "SSH public key file")
			s3Access := fs.String("s3-access", "", "S3 access key")
			s3Secret := fs.String("s3-secret", "", "S3 secret key")
			cert := fs.String("cert", "", "certificate PEM text")
			certFile := fs.String("cert-file", "", "certificate PEM file")
			extraFlags := stringSlice{}
			extraFileFlags := stringSlice{}
			fs.Var(&extraFlags, "extra", "custom field type=label:value (repeatable; type=text|secret)")
			fs.Var(&extraFileFlags, "extra-file", "custom field type=label:path (repeatable)")
			_ = fs.Parse(args[2:])
			provided := map[string]bool{}
			fs.Visit(func(f *flag.Flag) { provided[f.Name] = true })
			if args[1] == "update" {
				if *id == "" && fs.NArg() > 0 {
					*id = fs.Arg(0)
				}
				if *id == "" {
					fatal(fmt.Errorf("update requires -id"))
				}
			} else if *title == "" {
				fatal(fmt.Errorf("create requires -title"))
			}
			in := secretFlagInput{
				title: *title, username: *user, password: *pass,
				urlsFlag: *urlsFlag, urlFlags: urlFlags, notes: *notes, totp: *totp,
				tags: *tags, favorite: *favorite, folder: *folder, visibility: *visibility,
				shareUsers: shareUsers, shareGroups: shareGroups,
				sshPriv: *sshPriv, sshPrivFile: *sshPrivFile, sshPub: *sshPub, sshPubFile: *sshPubFile,
				s3Access: *s3Access, s3Secret: *s3Secret, cert: *cert, certFile: *certFile,
				extraFlags: extraFlags, extraFileFlags: extraFileFlags,
				provided: provided,
			}
			if args[1] == "create" {
				opts, err := secretOptsFromFlags(in, true)
				if err != nil {
					fatal(err)
				}
				if err := c.secretsCreate(opts); err != nil {
					fatal(err)
				}
				fmt.Println("created")
			} else {
				if err := c.secretsUpdate(*id, in); err != nil {
					fatal(err)
				}
				fmt.Println("updated")
			}
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
	fmt.Fprintf(os.Stderr, `tvcli — TeamVault CLI (standalone; client-side crypto via cryptocore)

Usage:
  tvcli -base URL [-api-key KEY] login -tenant SLUG -user NAME
  tvcli [-api-key KEY] whoami
  tvcli secrets list
  tvcli secrets get -id ID
  tvcli secrets create -title TITLE [-username U] [-password P]
      [-url URL]… [-urls "a;b"] [-notes N] [-totp SEED] [-tags t1,t2] [-favorite]
      [-folder NAME] [-visibility private|shared]
      [-share-user UID]… [-share-group GID]…
      [-ssh-private TEXT|-ssh-private-file PATH] [-ssh-public …]
      [-s3-access KEY] [-s3-secret KEY]
      [-cert PEM|-cert-file PATH]
      [-extra type=label:value]… [-extra-file type=label:path]…
  tvcli secrets update -id ID [-title T] [-username U] … (same field flags as create)

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
	items, err := c.fetchAllSecrets()
	if err != nil {
		return err
	}
	fmt.Println("id\thas_access\tvisibility\ttitle")
	for _, it := range items {
		id := str(it["id"])
		title := id
		if it["has_access"] == true {
			if t, err := c.decryptTitle(sk, it); err == nil {
				title = t
			}
		}
		vis := str(it["visibility"])
		if vis == "" {
			vis = "private"
		}
		fmt.Printf("%s\t%v\t%s\t%s\n", id, it["has_access"], vis, title)
	}
	return nil
}

func (c *client) fetchAllSecrets() ([]map[string]any, error) {
	const pageSize = 200
	var all []map[string]any
	for offset := 0; ; offset += pageSize {
		raw, err := c.getRaw(fmt.Sprintf("/api/secrets?limit=%d&offset=%d", pageSize, offset))
		if err != nil {
			return nil, err
		}
		var page struct {
			Items []map[string]any `json:"items"`
			Total int              `json:"total"`
		}
		if err := json.Unmarshal(raw, &page); err == nil && page.Items != nil {
			all = append(all, page.Items...)
			if len(all) >= page.Total || len(page.Items) == 0 {
				return all, nil
			}
			continue
		}
		var legacy []map[string]any
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return nil, err
		}
		return legacy, nil
	}
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
	fmt.Printf("title: %s\n", string(titlePT))
	var pretty any
	if err := json.Unmarshal(bodyPT, &pretty); err == nil {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(pretty)
	} else {
		fmt.Printf("%s\n", string(bodyPT))
	}
	return nil
}

type secretCreateOpts struct {
	Title, Username, Password string
	URLs                      []string
	Notes, TOTP               string
	Tags                      []string
	Favorite                  bool
	Folder                    string
	Visibility                string
	ShareUsers, ShareGroups   []string
	SSHPrivate, SSHPublic     string
	S3Access, S3Secret        string
	Cert                      string
	Extra                     []map[string]string
}

type secretFlagInput struct {
	title, username, password string
	urlsFlag                  string
	urlFlags                  stringSlice
	notes, totp, tags         string
	favorite                  bool
	folder, visibility        string
	shareUsers, shareGroups   stringSlice
	sshPriv, sshPrivFile      string
	sshPub, sshPubFile        string
	s3Access, s3Secret        string
	cert, certFile            string
	extraFlags, extraFileFlags stringSlice
	provided                  map[string]bool
}

func secretOptsFromFlags(in secretFlagInput, promptPassword bool) (secretCreateOpts, error) {
	pw := in.password
	if promptPassword && pw == "" && !in.provided["password"] {
		b, err := readSecret("Secret password: ")
		if err != nil {
			return secretCreateOpts{}, err
		}
		pw = string(b)
		zero(b)
	}
	opts := secretCreateOpts{
		Title: in.title, Username: in.username, Password: pw,
		URLs: append(splitSemi(in.urlsFlag), []string(in.urlFlags)...),
		Notes: in.notes, TOTP: in.totp, Tags: splitComma(in.tags),
		Favorite: in.favorite, Folder: in.folder,
		Visibility: strings.TrimSpace(in.visibility),
		ShareUsers: []string(in.shareUsers), ShareGroups: []string(in.shareGroups),
		S3Access: in.s3Access, S3Secret: in.s3Secret,
	}
	var err error
	if opts.SSHPrivate, err = valueOrFile(in.sshPriv, in.sshPrivFile); err != nil {
		return secretCreateOpts{}, err
	}
	if opts.SSHPublic, err = valueOrFile(in.sshPub, in.sshPubFile); err != nil {
		return secretCreateOpts{}, err
	}
	if opts.Cert, err = valueOrFile(in.cert, in.certFile); err != nil {
		return secretCreateOpts{}, err
	}
	for _, e := range in.extraFlags {
		ex, err := parseExtraFlag(e, false)
		if err != nil {
			return secretCreateOpts{}, err
		}
		opts.Extra = append(opts.Extra, ex)
	}
	for _, e := range in.extraFileFlags {
		ex, err := parseExtraFlag(e, true)
		if err != nil {
			return secretCreateOpts{}, err
		}
		opts.Extra = append(opts.Extra, ex)
	}
	if opts.Visibility == "" {
		opts.Visibility = "private"
	}
	return opts, nil
}

func buildSecretPayload(opts secretCreateOpts) (map[string]any, error) {
	extra := append([]map[string]string{}, opts.Extra...)
	push := func(typ, label, value string) {
		if value == "" {
			return
		}
		extra = append(extra, map[string]string{
			"id": fmt.Sprintf("x_%s_%d", typ, len(extra)), "type": typ, "label": label, "value": value,
		})
	}
	push("ssh_private_key", "SSH Private Key", opts.SSHPrivate)
	push("ssh_public_key", "SSH Public Key", opts.SSHPublic)
	push("s3_access_key", "S3 Access Key", opts.S3Access)
	push("s3_secret_key", "S3 Secret Key", opts.S3Secret)
	push("certificate", "Zertifikat", opts.Cert)
	payloadObj := map[string]any{
		"username":  opts.Username,
		"password":  opts.Password,
		"urls":      opts.URLs,
		"notes":     opts.Notes,
		"totp_seed": opts.TOTP,
		"tags":      opts.Tags,
		"favorite":  opts.Favorite,
		"extra":     extra,
	}
	if len(opts.URLs) == 0 {
		payloadObj["urls"] = []string{}
	}
	if opts.Tags == nil {
		payloadObj["tags"] = []string{}
	}
	return payloadObj, nil
}

type stringSlice []string

func (s *stringSlice) String() string { return strings.Join(*s, ",") }
func (s *stringSlice) Set(v string) error {
	*s = append(*s, v)
	return nil
}

func splitSemi(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitComma(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func valueOrFile(text, path string) (string, error) {
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	return text, nil
}

func parseExtraFlag(spec string, fromFile bool) (map[string]string, error) {
	// type=label:value  or type=label:path
	eq := strings.IndexByte(spec, '=')
	if eq <= 0 {
		return nil, fmt.Errorf("extra flag must be type=label:value, got %q", spec)
	}
	typ := strings.TrimSpace(spec[:eq])
	rest := spec[eq+1:]
	colon := strings.IndexByte(rest, ':')
	if colon < 0 {
		return nil, fmt.Errorf("extra flag must be type=label:value, got %q", spec)
	}
	label := strings.TrimSpace(rest[:colon])
	val := rest[colon+1:]
	if fromFile {
		b, err := os.ReadFile(val)
		if err != nil {
			return nil, err
		}
		val = string(b)
	}
	if typ == "" {
		typ = "text"
	}
	if label == "" {
		label = typ
	}
	return map[string]string{"id": fmt.Sprintf("x_%d", len(val)+len(label)), "type": typ, "label": label, "value": val}, nil
}

func (c *client) secretsCreate(opts secretCreateOpts) error {
	sk, _, err := c.unlockSK()
	if err != nil {
		return err
	}
	defer zero(sk)
	me, err := c.getJSON("/api/me")
	if err != nil {
		return err
	}
	meID := str(me["user_id"])
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
	titleCT, err := cryptocore.EncryptPayload([]byte(opts.Title), dk, kv)
	if err != nil {
		return err
	}
	payloadObj, err := buildSecretPayload(opts)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(payloadObj)
	if err != nil {
		return err
	}
	bodyCT, err := cryptocore.EncryptPayload(payload, dk, kv)
	if err != nil {
		return err
	}
	envelopes, shareUserIDs, shareGroupIDs, err := c.buildShareEnvelopes(dk, kv, meID, str(keys["public_key_b64"]), opts)
	if err != nil {
		return err
	}
	body := map[string]any{
		"title_ciphertext_b64": b64(titleCT.Ciphertext),
		"title_nonce_b64":      b64(titleCT.Nonce),
		"ciphertext_b64":       b64(bodyCT.Ciphertext),
		"nonce_b64":            b64(bodyCT.Nonce),
		"key_version":          kv,
		"envelopes":            envelopes,
	}
	if opts.Folder != "" {
		body["collection_id"] = opts.Folder
	}
	vis := strings.TrimSpace(opts.Visibility)
	if vis == "" {
		vis = "private"
	}
	if vis == "shared" || len(shareUserIDs)+len(shareGroupIDs) > 0 {
		if len(shareUserIDs)+len(shareGroupIDs) == 0 {
			return fmt.Errorf("shared secrets require -share-user and/or -share-group")
		}
		body["visibility"] = "shared"
		if len(shareUserIDs) > 0 {
			body["share_user_ids"] = shareUserIDs
		}
		if len(shareGroupIDs) > 0 {
			body["share_group_ids"] = shareGroupIDs
		}
	} else {
		body["visibility"] = "private"
	}
	_, err = c.postJSON("/api/secrets", body)
	return err
}

func (c *client) secretsUpdate(id string, in secretFlagInput) error {
	if len(in.provided) == 0 || (len(in.provided) == 1 && in.provided["id"]) {
		return fmt.Errorf("update requires at least one field flag")
	}
	sk, _, err := c.unlockSK()
	if err != nil {
		return err
	}
	defer zero(sk)
	det, err := c.getJSON("/api/secrets/" + url.PathEscape(id))
	if err != nil {
		return err
	}
	dk, kv, err := openDKFromDetail(det, sk)
	if err != nil {
		return err
	}
	defer zero(dk)
	titlePT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(det["title_nonce_b64"])), Ciphertext: mustB64(str(det["title_ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return err
	}
	title := string(titlePT)
	if in.provided["title"] {
		title = in.title
		if title == "" {
			return fmt.Errorf("title cannot be empty")
		}
	}
	bodyPT, err := cryptocore.DecryptPayload(cryptocore.Ciphertext{
		Nonce: mustB64(str(det["nonce_b64"])), Ciphertext: mustB64(str(det["ciphertext_b64"])), KeyVersion: kv,
	}, dk, nil)
	if err != nil {
		return err
	}
	var existing map[string]any
	if err := json.Unmarshal(bodyPT, &existing); err != nil {
		return err
	}
	if in.provided["username"] {
		existing["username"] = in.username
	}
	if in.provided["password"] {
		existing["password"] = in.password
	}
	if in.provided["urls"] || in.provided["url"] {
		existing["urls"] = append(splitSemi(in.urlsFlag), []string(in.urlFlags)...)
	}
	if in.provided["notes"] {
		existing["notes"] = in.notes
	}
	if in.provided["totp"] {
		existing["totp_seed"] = in.totp
	}
	if in.provided["tags"] {
		existing["tags"] = splitComma(in.tags)
	}
	if in.provided["favorite"] {
		existing["favorite"] = in.favorite
	}
	if in.provided["ssh-private"] || in.provided["ssh-private-file"] ||
		in.provided["ssh-public"] || in.provided["ssh-public-file"] ||
		in.provided["s3-access"] || in.provided["s3-secret"] ||
		in.provided["cert"] || in.provided["cert-file"] ||
		in.provided["extra"] || in.provided["extra-file"] {
		opts, err := secretOptsFromFlags(in, false)
		if err != nil {
			return err
		}
		merged, err := buildSecretPayload(opts)
		if err != nil {
			return err
		}
		existing["extra"] = patchExtraFields(existing["extra"], merged["extra"], in)
	}
	payload, err := json.Marshal(existing)
	if err != nil {
		return err
	}
	titleCT, err := cryptocore.EncryptPayload([]byte(title), dk, kv)
	if err != nil {
		return err
	}
	bodyCT, err := cryptocore.EncryptPayload(payload, dk, kv)
	if err != nil {
		return err
	}
	_, err = c.putJSON("/api/secrets/"+url.PathEscape(id), map[string]any{
		"title_ciphertext_b64": b64(titleCT.Ciphertext),
		"title_nonce_b64":      b64(titleCT.Nonce),
		"ciphertext_b64":       b64(bodyCT.Ciphertext),
		"nonce_b64":            b64(bodyCT.Nonce),
		"key_version":          kv,
	})
	return err
}

func patchExtraFields(existing any, patch any, in secretFlagInput) []map[string]string {
	cur := decodeExtra(existing)
	add := decodeExtra(patch)
	types := map[string]bool{}
	if in.provided["extra"] || in.provided["extra-file"] {
		return add
	}
	if in.provided["ssh-private"] || in.provided["ssh-private-file"] {
		types["ssh_private_key"] = true
	}
	if in.provided["ssh-public"] || in.provided["ssh-public-file"] {
		types["ssh_public_key"] = true
	}
	if in.provided["s3-access"] {
		types["s3_access_key"] = true
	}
	if in.provided["s3-secret"] {
		types["s3_secret_key"] = true
	}
	if in.provided["cert"] || in.provided["cert-file"] {
		types["certificate"] = true
	}
	out := make([]map[string]string, 0, len(cur)+len(add))
	for _, e := range cur {
		if !types[e["type"]] {
			out = append(out, e)
		}
	}
	for _, e := range add {
		if types[e["type"]] {
			out = append(out, e)
		}
	}
	return out
}

func decodeExtra(v any) []map[string]string {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var out []map[string]string
	_ = json.Unmarshal(b, &out)
	return out
}

func openDKFromDetail(det map[string]any, sk []byte) ([]byte, uint32, error) {
	env, ok := det["envelope"].(map[string]any)
	if !ok {
		return nil, 0, fmt.Errorf("no envelope")
	}
	dk, err := cryptocore.OpenDataKeyEnvelope(cryptocore.Envelope{
		EphemeralPub: mustB64(str(env["ephemeral_pub_b64"])),
		Nonce:        mustB64(str(env["nonce_b64"])),
		Ciphertext:   mustB64(str(env["wrapped_dk_b64"])),
	}, sk)
	if err != nil {
		return nil, 0, err
	}
	kv := uint32(det["key_version"].(float64))
	return dk, kv, nil
}

func (c *client) buildShareEnvelopes(dk []byte, kv uint32, meID, mePub string, opts secretCreateOpts) ([]map[string]any, []string, []string, error) {
	seen := map[string]bool{meID: true}
	var envelopes []map[string]any
	add := func(uid, pub string) error {
		if uid == "" || seen[uid] || pub == "" {
			return nil
		}
		env, err := cryptocore.SealDataKeyForRecipient(dk, mustB64(pub), kv)
		if err != nil {
			return err
		}
		envelopes = append(envelopes, map[string]any{
			"user_id": uid, "key_version": kv,
			"wrapped_dk_b64": b64(env.Ciphertext), "ephemeral_pub_b64": b64(env.EphemeralPub), "nonce_b64": b64(env.Nonce),
		})
		seen[uid] = true
		return nil
	}
	if err := add(meID, mePub); err != nil {
		return nil, nil, nil, err
	}
	vis := strings.TrimSpace(opts.Visibility)
	shareUsers := opts.ShareUsers
	shareGroups := opts.ShareGroups
	if vis != "shared" && len(shareUsers)+len(shareGroups) == 0 {
		return envelopes, nil, nil, nil
	}
	pkByUser := map[string]string{}
	rawPKs, err := c.getRaw("/api/users/public-keys")
	if err != nil {
		return nil, nil, nil, err
	}
	var pks []map[string]any
	if err := json.Unmarshal(rawPKs, &pks); err != nil {
		return nil, nil, nil, err
	}
	for _, row := range pks {
		pkByUser[str(row["user_id"])] = str(row["public_key_b64"])
	}
	var shareUserIDs []string
	for _, uid := range shareUsers {
		uid = strings.TrimSpace(uid)
		if uid == "" || uid == meID {
			continue
		}
		pub := pkByUser[uid]
		if pub == "" {
			return nil, nil, nil, fmt.Errorf("share-user %q: no public key (not onboarded?)", uid)
		}
		if err := add(uid, pub); err != nil {
			return nil, nil, nil, err
		}
		shareUserIDs = append(shareUserIDs, uid)
	}
	var shareGroupIDs []string
	for _, gid := range shareGroups {
		gid = strings.TrimSpace(gid)
		if gid == "" {
			continue
		}
		raw, err := c.getRaw("/api/groups/" + url.PathEscape(gid) + "/member-keys")
		if err != nil {
			return nil, nil, nil, err
		}
		var members []map[string]any
		if err := json.Unmarshal(raw, &members); err != nil {
			return nil, nil, nil, err
		}
		for _, m := range members {
			if err := add(str(m["user_id"]), str(m["public_key_b64"])); err != nil {
				return nil, nil, nil, err
			}
		}
		shareGroupIDs = append(shareGroupIDs, gid)
	}
	return envelopes, shareUserIDs, shareGroupIDs, nil
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

func (c *client) putJSON(path string, body any) (map[string]any, error) {
	res, err := c.do(http.MethodPut, path, body)
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

package mailer

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/instcfg"
	"github.com/teamvault/teamvault/internal/tlsutil"
)

// Send renders a simple plaintext template and delivers via SMTP.
// Never include vault secrets in templates (Prinzip 1).
// caPEM is the instance company-root bundle (may be empty → system CAs).
func Send(cfg instcfg.MailConfig, caPEM, to, subject, body string) error {
	if !cfg.Enabled || cfg.Host == "" || to == "" {
		return fmt.Errorf("mail not configured")
	}
	port := cfg.Port
	if port == 0 {
		port = 587
	}
	from := cfg.From
	if from == "" {
		from = "teamvault@localhost"
	}
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(port))
	msg := []byte("From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" +
		body + "\r\n")
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	conn, err := net.DialTimeout("tcp", addr, 8*time.Second)
	if err != nil {
		return err
	}
	_ = conn.Close()

	tlsCfg, err := tlsutil.ClientConfig(cfg.Host, caPEM, false)
	if err != nil {
		return err
	}
	if cfg.UseTLS || strings.TrimSpace(caPEM) != "" {
		return sendSTARTTLS(addr, auth, from, to, msg, tlsCfg)
	}
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

func sendSTARTTLS(addr string, auth smtp.Auth, from, to string, msg []byte, tlsCfg *tls.Config) error {
	c, err := smtp.Dial(addr)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(tlsCfg); err != nil {
			return err
		}
	}
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		_ = w.Close()
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func Render(tpl, username, tenant string) string {
	s := tpl
	s = strings.ReplaceAll(s, "{{username}}", username)
	s = strings.ReplaceAll(s, "{{tenant}}", tenant)
	return s
}

package mailer

import (
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/teamvault/teamvault/internal/instcfg"
)

// Send renders a simple plaintext template and delivers via SMTP.
// Never include vault secrets in templates (Prinzip 1).
func Send(cfg instcfg.MailConfig, to, subject, body string) error {
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
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)
	msg := []byte("From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" +
		body + "\r\n")
	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	// Dial with timeout first for clearer errors.
	conn, err := net.DialTimeout("tcp", addr, 8*time.Second)
	if err != nil {
		return err
	}
	_ = conn.Close()
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

func Render(tpl, username, tenant string) string {
	s := tpl
	s = strings.ReplaceAll(s, "{{username}}", username)
	s = strings.ReplaceAll(s, "{{tenant}}", tenant)
	return s
}
